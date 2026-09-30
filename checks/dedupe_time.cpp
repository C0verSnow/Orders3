#include "../src/dedupe_time.hpp"
#include "../src/open_dedupe.hpp"
#include "../src/storage_schema.hpp"
#include <iostream>
#include <vector>

using nlohmann::json;

int main() {
    int checks = 0;
    auto require = [&](bool ok) {
        if (!ok) throw std::runtime_error("Failed check " + std::to_string(checks));
        ++checks;
    };
    constexpr std::int64_t time = 1790054490000LL;
    auto detail = [](json raw) { return json{{"data", {{"order", {{"finish_time", raw}}}}}}; };
    for (const auto* terminal : {"success", "partial_canceled"}) {
        const json original = {{"Contract", "BTC_USDT"}, {"position_side", "LONG"},
            {"terminal_result", terminal}, {"close_assignment", "required"}};
        auto record = orders3::with_dedupe_time(original, detail("1790054490"), "seconds", time);
        require(record.at("dedupe_at_ms") == time);
        require(record.at("dedupe_time_source") == json({{"field", "data.order.finish_time"},
            {"raw_value", "1790054490"}, {"unit", "seconds"}}));
        auto store = orders3::make_empty_store();
        store[0]["finished open orders"].push_back(record);
        auto restored = orders3::parse_store(store.dump());
        require(restored == store);
        const auto& history = restored[0]["finished open orders"];
        require(orders3::check_open_dedupe(history, "BTC_USDT", "LONG", time + 604799999).code == "DEDUPE_7D");
        require(orders3::check_open_dedupe(history, "BTC_USDT", "LONG", time + 604800000).decision == "accepted");
        for (const auto& raw : std::vector<json>{nullptr, 0, true, 1.5, "", "0", "000", "-1", "+1",
                " 1", "1 ", "1.0", "1e3", "1790054491", "9223372036854776",
                "9223372036854775808", "999999999999999999999999999999"}) {
            auto bad = orders3::with_dedupe_time(record, detail(raw), "seconds", time);
            require(bad.at("dedupe_at_ms").is_null());
            require(bad.at("dedupe_time_source").at("raw_value") == raw);
            require(bad.at("terminal_result") == terminal && bad.at("close_assignment") == "required");
            require(orders3::check_open_dedupe(json::array({bad}), "BTC_USDT", "LONG", time).code == "FINISH_TIME_INVALID");
        }
        for (const auto& malformed : std::vector<json>{nullptr, json::object(), {{"data", 1}},
                {{"data", {{"order", json::object()}}}}})
            require(orders3::with_dedupe_time(record, malformed, "seconds", time).at("dedupe_at_ms").is_null());
        require(orders3::with_dedupe_time(record, detail("1790054490"), "milliseconds", time).at("dedupe_at_ms").is_null());
        require(!original.contains("dedupe_at_ms"));
    }
    const auto max = std::numeric_limits<std::int64_t>::max();
    require(orders3::with_dedupe_time(json::object(), detail("9223372036854775"), "seconds", max).at("dedupe_at_ms") == 9223372036854775000LL);
    require(orders3::with_dedupe_time(json::object(), detail("0001"), "seconds", 1000).at("dedupe_at_ms") == 1000);
    for (int i = 0; i < 2; ++i) {
        bool rejected = false;
        try { orders3::with_dedupe_time(i == 0 ? json(nullptr) : json::object(), detail("1"), "seconds", i == 0 ? 1000 : -1); }
        catch (const std::invalid_argument&) { rejected = true; }
        require(rejected);
    }
    std::cout << "Dedupe time checks passed: " << checks << '\n';
}
