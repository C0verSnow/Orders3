#include "../src/open_dedupe.hpp"
#include <iostream>
#include <vector>

using nlohmann::json;

int main() {
    constexpr std::int64_t start = 1790054490000LL;
    constexpr std::int64_t week = 604800000;
    int checks = 0;
    auto record = [](const char* result, json time) {
        return json{{"Contract", "BTC_USDT"}, {"position_side", "LONG"},
                    {"terminal_result", result}, {"dedupe_at_ms", time}};
    };
    auto check = [&](const json& history, std::int64_t now,
                     const char* decision, const char* code,
                     const char* contract = "BTC_USDT", const char* side = "LONG") {
        const auto before = history.dump();
        const auto actual = orders3::check_open_dedupe(history, contract, side, now);
        if (actual.decision != decision || actual.code != code || history.dump() != before)
            throw std::runtime_error("Dedupe check failed: " + std::to_string(checks));
        ++checks;
    };
    check(json::array(), start, "accepted", "OK");
    for (const auto* result : {"success", "partial_canceled"}) {
        auto history = json::array({record(result, start)});
        for (const auto delta : {0LL, 518400000LL, 604799999LL})
            check(history, start + delta, "skipped", "DEDUPE_7D");
        check(history, start + week, "accepted", "OK");
        check(history, start + week + 1, "accepted", "OK");
        check(history, start, "accepted", "OK", "BTC_USDT", "SHORT");
        check(history, start, "accepted", "OK", "ETH_USDT");
        for (const auto& bad : std::vector<json>{nullptr, 0, -1, start + 1,
                 "1790054490000", true, 1.5, 9223372036854775808ULL})
            check(json::array({record(result, bad)}), start,
                  "deferred", "FINISH_TIME_INVALID");
        auto missing = record(result, start);
        missing.erase("dedupe_at_ms");
        check(json::array({missing}), start, "deferred", "FINISH_TIME_INVALID");
    }
    check(json::array({record("canceled_no_fill", nullptr)}), start, "accepted", "OK");
    check(json::array({record("unknown", start)}), start, "deferred", "EXECUTION_INCOMPLETE");
    auto old = record("success", start - week);
    auto recent = record("partial_canceled", start);
    auto invalid = record("success", nullptr);
    check(json::array({old, recent}), start, "skipped", "DEDUPE_7D");
    check(json::array({recent, invalid}), start, "deferred", "FINISH_TIME_INVALID");
    check(json::array({invalid, recent}), start, "deferred", "FINISH_TIME_INVALID");
    recent["batch_at_ms"] = 1;
    recent["timestamp"] = 1;
    check(json::array({recent}), start, "skipped", "DEDUPE_7D");
    const auto max = std::numeric_limits<std::int64_t>::max();
    check(json::array({record("success", max - week)}), max, "accepted", "OK");
    check(json::array({record("success", max)}), max, "skipped", "DEDUPE_7D");
    int rejected = 0;
    auto reject = [&](const json& history, const char* contract, const char* side, std::int64_t now) {
        try { orders3::check_open_dedupe(history, contract, side, now); }
        catch (const std::invalid_argument&) { ++rejected; return; }
        throw std::runtime_error("Accepted invalid input");
    };
    reject(json::object(), "BTC_USDT", "LONG", start);
    reject(json::array(), "", "LONG", start);
    reject(json::array(), "BTC_USDT", "Open Long", start);
    reject(json::array(), "BTC_USDT", "LONG", -1);
    reject(json::array({json::object()}), "BTC_USDT", "LONG", start);
    std::cout << "Open dedupe checks passed: " << checks << " decisions, "
              << rejected << " invalid inputs rejected\n";
}
