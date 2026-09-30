// Offline request-contract checks; no network calls or credentials.
#include "../src/stop_request.hpp"
#include <iostream>
#include <vector>

using nlohmann::json;

void require(bool condition) {
    if (!condition) throw std::runtime_error("Stop request check failed");
}

int main() {
    const json original = "1118433";
    const auto request = orders3::make_stop_request(original);
    require(original == "1118433");
    require(request == json({{"method", "POST"},
        {"path", "/futures/usdt/autoorder/v1/trail/stop"},
        {"query", ""}, {"body", {{"id", 1118433}}}}));
    for (const std::string id : {"1", "9007199254740993", "9223372036854775807"}) {
        const auto body = orders3::make_stop_request(id).at("body");
        require(body.at("id").is_number_integer());
        require(!body.at("id").is_number_float());
        require(body.dump() == "{\"id\":" + id + "}");
        require(json::parse(body.dump()).at("id").dump() == id);
    }
    require(orders3::make_stop_request("000123")["body"]["id"] == 123);

    int rejected = 0;
    auto reject = [&](const json& id, const std::string& code) {
        try { orders3::make_stop_request(id); }
        catch (const orders3::StopRequestError& error) {
            require(error.as_json() == json({{"code", code},
                {"field", "id"}, {"retryable", false}}));
            ++rejected;
            return;
        }
        throw std::runtime_error("Accepted invalid stop ID");
    };
    for (const auto& id : std::vector<json>{nullptr, true, 1118433, 1.5,
             json::array(), json::object(), "", "0", "000", "-1", "+1",
             " 1", "1 ", "1.0", "1e3", "12x", "1\n", std::string("1\0", 2)})
        reject(id, "INVALID_ORDER_ID");
    for (const auto& id : {"9223372036854775808", "18446744073709551615",
                           "999999999999999999999999999999"})
        reject(id, "ORDER_ID_OUT_OF_RANGE");
    std::cout << "Stop request checks passed; " << rejected
              << " invalid inputs rejected\n";
}
