// Offline contract tests, following docs/test/orders2/tests conventions.
#include "../src/http_request.hpp"
#include "../src/stop_request.hpp"
#include "../src/close_request.hpp"
#include "../src/storage_schema.hpp"
#include <iostream>
#include <limits>
#include <vector>

using nlohmann::json;
int checks = 0;
void require(bool ok) {
    ++checks;
    if (!ok) throw std::runtime_error("HTTP request check failed");
}
void reject(const json& value) {
    try { orders3::prepare_http_request(value); }
    catch (const orders3::HttpRequestError& error) {
        require(error.as_json().at("code") == "INVALID_HTTP_REQUEST");
        require(error.as_json().at("retryable") == false);
        return;
    }
    throw std::runtime_error("Accepted invalid HTTP descriptor");
}

int main() {
    const auto stop = orders3::make_stop_request("9007199254740993");
    const auto prepared = orders3::prepare_http_request(stop);
    require(prepared.method == "POST");
    require(prepared.path == "/futures/usdt/autoorder/v1/trail/stop");
    require(prepared.query.empty());
    require(prepared.has_body);
    require(prepared.body_bytes == "{\"id\":9007199254740993}");
    require(json::parse(prepared.body_bytes) == stop.at("body"));
    const json get = {{"method", "GET"}, {"path", "/futures/usdt/autoorder/v1/trail/detail"},
                      {"query", "id=1118433&text=a%2Fb"}, {"body", nullptr}};
    const auto read = orders3::prepare_http_request(get);
    require(!read.has_body && read.body_bytes.empty());
    require(read.query == "id=1118433&text=a%2Fb");
    auto post = stop;
    post["body"] = nullptr;
    require(!orders3::prepare_http_request(post).has_body);
    post["body"] = json::object();
    require(orders3::prepare_http_request(post).body_bytes == "{}");
    require(orders3::prepare_http_request(post).has_body);
    const auto close = orders3::make_close_request("BTC_USDT", "LONG",
        {{"entry_price", "100"}, {"value", "1000"}, {"initial_margin", "10"}, {"size", "10"}}, "104.13");
    const auto close_before = close;
    require(json::parse(orders3::prepare_http_request(close).body_bytes) == close.at("body"));
    require(close == close_before);
    post["body"] = {{"text", "quote\"\n\\"}, {"amount", "-10.00"}, {"unknown", nullptr}};
    require(json::parse(orders3::prepare_http_request(post).body_bytes) == post["body"]);
    for (const auto& bad : std::vector<json>{nullptr, true, json::array(),
            orders3::make_empty_store(), {{"operation", "open.publish"}, {"input", {{"record_id", "x"}}}},
            {{"outcome", "succeeded"}, {"result", {{"exchange_order_id", "1"}}}}}) reject(bad);
    for (const auto* key : {"method", "path", "query", "body"}) {
        auto bad = stop; bad.erase(key); reject(bad);
    }
    for (const auto* key : {"request_id", "record_id", "response", "steps", "store_effect"}) {
        auto bad = stop; bad[key] = "local-only"; reject(bad);
    }
    for (const auto& method : std::vector<json>{nullptr, 1, "post", "DELETE", "POST\r\n"}) {
        auto bad = stop; bad["method"] = method; reject(bad);
    }
    for (const auto& path : {"", "https://example.com", "//example.com", "/a?b", "/a#b", "/a b", "/a\\b"}) {
        auto bad = stop; bad["path"] = path; reject(bad);
    }
    for (const auto& query : {"?id=1", "id=1#x", "id=1\r\n", "id=a b"}) {
        auto bad = get; bad["query"] = query; reject(bad);
    }
    for (const auto& body : std::vector<json>{"null", 1, true, json::array(),
            {{"amount", 1.5}}, {{"nested", json::array({std::numeric_limits<double>::infinity()})}},
            {{"text", std::string(1, static_cast<char>(0xff))}}}) {
        auto bad = stop; bad["body"] = body; reject(bad);
    }
    auto bad_get = get; bad_get["body"] = json::object(); reject(bad_get);
    std::cout << "HTTP request checks passed: " << checks << '\n';
}
