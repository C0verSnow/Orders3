#include <curl/curl.h>
#include <nlohmann/json.hpp>

#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <regex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

using nlohmann::json;
namespace fs = std::filesystem;
constexpr const char* URL =
    "https://raw.githubusercontent.com/huan00000/price/refs/heads/main/size.txt";

// Bound memory usage and never let C++ exceptions cross libcurl's C callback.
size_t receive(char* data, size_t size, size_t count, void* context) {
    auto& body = *static_cast<std::string*>(context);
    const size_t bytes = size * count;
    if (bytes > 1024 * 1024 - body.size()) return 0;
    try { body.append(data, bytes); } catch (...) { return 0; }
    return bytes;
}

std::string download() {
    CURL* curl = curl_easy_init();
    if (!curl) throw std::runtime_error("Cannot initialize curl");
    std::string body;
    char error[CURL_ERROR_SIZE] = {};
    curl_easy_setopt(curl, CURLOPT_URL, URL);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 5L);
    curl_easy_setopt(curl, CURLOPT_PROTOCOLS_STR, "https");
    curl_easy_setopt(curl, CURLOPT_REDIR_PROTOCOLS_STR, "https");
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 15L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 45L);
    curl_easy_setopt(curl, CURLOPT_FAILONERROR, 1L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "orders3-fetchorders/1.0");
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, receive);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
    curl_easy_setopt(curl, CURLOPT_ERRORBUFFER, error);
    const auto result = curl_easy_perform(curl);
    long status = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
    curl_easy_cleanup(curl);
    if (result != CURLE_OK)
        throw std::runtime_error(std::string("Download failed: ") +
                                 (error[0] ? error : curl_easy_strerror(result)));
    if (status != 200) throw std::runtime_error("Unexpected HTTP status: " + std::to_string(status));
    return body;
}

json parse_orders(const std::string& body) {
    const std::regex field(R"((Symbol|Price|Side|Size|Value|Orders Times)\s*:\s*(.*?)\s*$)");
    const std::regex symbol(R"([A-Z0-9]+_[A-Z0-9]+)");
    const std::regex decimal(R"([+-]?[0-9]+(?:\.[0-9]+)?)");
    const std::regex integer(R"(-?[0-9]+)");
    json orders = json::array(), order;
    long long timestamp = 0;
    bool value_seen = false;
    std::set<std::pair<std::string, std::string>> targets;
    auto finish = [&] {
        if (order.is_null()) return;
        if (order.size() != 4 || !value_seen)
            throw std::runtime_error("Incomplete order block");
        const auto side = order["Side"].get<std::string>();
        const auto size = order["Size"].get<long long>();
        if ((side == "Open Long") != (size > 0))
            throw std::runtime_error("Size sign does not match Side");
        if (!targets.emplace(order["Contract"].get<std::string>(), side).second)
            throw std::runtime_error("DUPLICATE_TARGET");
        orders.push_back(order);
        order = nullptr;
        value_seen = false;
    };
    auto number = [&](const std::string& text, const std::string& unit) {
        if (text.size() <= unit.size() || text.substr(text.size() - unit.size()) != unit)
            throw std::runtime_error("Invalid numeric field: " + text);
        auto digits = text.substr(0, text.size() - unit.size());
        if (!std::regex_match(digits, decimal)) throw std::runtime_error("Invalid number: " + digits);
        const double value = std::stod(digits);
        if (!std::isfinite(value)) throw std::runtime_error("Non-finite number");
        return value;
    };
    std::istringstream input(body);
    std::string line;
    while (std::getline(input, line)) {
        if (line.find("Order Alert") != std::string::npos) {
            finish();
            if (timestamp) throw std::runtime_error("Order after timestamp");
            order = json::object();
            continue;
        }
        std::smatch match;
        if (!std::regex_search(line, match, field)) {
            if (line.find_first_not_of(" \t\r=") != std::string::npos)
                throw std::runtime_error("Unrecognized response line");
            continue;
        }
        const std::string key = match[1], value = match[2];
        if (key == "Orders Times") {
            finish();
            if (timestamp || !std::regex_match(value, integer) || (timestamp = std::stoll(value)) <= 0)
                throw std::runtime_error("Invalid or duplicate Orders Times");
            continue;
        }
        if (order.is_null()) throw std::runtime_error("Field outside order block");
        const std::string output_key = key == "Symbol" ? "Contract" : key;
        if (order.contains(output_key) || (key == "Value" && value_seen))
            throw std::runtime_error("Duplicate field: " + key);
        if (key == "Symbol") {
            if (!std::regex_match(value, symbol)) throw std::runtime_error("Invalid Symbol");
            order["Contract"] = value;
        } else if (key == "Price") {
            const double price = number(value, " USDT");
            if (price <= 0) throw std::runtime_error("Price must be positive");
            order[key] = price;
        } else if (key == "Side") {
            if (value != "Open Short" && value != "Open Long")
                throw std::runtime_error("Invalid Side");
            order[key] = value;
        } else if (key == "Size") {
            const std::string unit = " Contracts";
            if (value.size() <= unit.size() || value.substr(value.size() - unit.size()) != unit)
                throw std::runtime_error("Invalid Size unit");
            const auto digits = value.substr(0, value.size() - unit.size());
            if (!std::regex_match(digits, integer)) throw std::runtime_error("Invalid Size");
            const auto size = std::stoll(digits);
            if (!size) throw std::runtime_error("Size must be nonzero");
            order[key] = size;
        } else {
            number(value, " U"); // The project schema does not store Value.
            value_seen = true;
        }
    }
    finish();
    if (!timestamp) throw std::runtime_error("Missing Orders Times");
    return {{"last timestamp", timestamp}, {"raw orders", orders}};
}

void save(const fs::path& path, const json& document) {
    fs::path temporary = path;
    temporary += ".tmp";
    try {
        std::ofstream out(temporary, std::ios::binary | std::ios::trunc);
        out.exceptions(std::ios::badbit | std::ios::failbit);
        out << document.dump(4) << '\n';
        out.close();
#ifdef _WIN32
        if (!MoveFileExW(temporary.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
            throw std::runtime_error("Cannot replace output file: " + std::to_string(GetLastError()));
#else
        fs::rename(temporary, path);
#endif
    } catch (...) {
        std::error_code ignored;
        fs::remove(temporary, ignored);
        throw;
    }
}

int main(int argc, char** argv) {
    if (argc > 2) {
        std::cerr << "Usage: fetchorders [output-path]\n";
        return 1;
    }
    if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) return 1;
    int result = 0;
    try {
        const fs::path output = argc == 2 ? fs::path(argv[1]) : fs::path("orderlist.js");
        const auto fetched = parse_orders(download());
        json document = json::array({json::object()});
        if (fs::exists(output)) {
            std::ifstream input(output);
            input >> document;
            if (!document.is_array() || document.size() != 1 || !document[0].is_object())
                throw std::runtime_error("Existing output must be an array containing one object");
        }
        auto& state = document[0];
        for (const auto* key : {"raw orders", "pending open orders", "finished open orders",
                               "pending close orders", "finished close orders"}) {
            if (!state.contains(key)) state[key] = json::array();
            if (!state[key].is_array()) throw std::runtime_error(std::string("Invalid array: ") + key);
        }
        state["last timestamp"] = fetched["last timestamp"];
        state["raw orders"] = fetched["raw orders"];
        save(output, document);
        std::cout << "Saved " << state["raw orders"].size() << " orders to "
                  << fs::absolute(output).string() << '\n';
    } catch (const std::exception& error) {
        std::cerr << "Error: " << error.what() << '\n';
        result = 1;
    }
    curl_global_cleanup();
    return result;
}
