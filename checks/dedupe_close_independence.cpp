#include "../src/dedupe_time.hpp"
#include "../src/open_dedupe.hpp"
#include "../src/close_task_price.hpp"
#include "../src/close_request.hpp"
#include "../src/storage_schema.hpp"
#include <iostream>

using nlohmann::json;
int main() {
    int checks = 0;
    auto require = [&](bool ok) {
        ++checks;
        if (!ok) throw std::runtime_error("Dedupe/close independence check failed");
    };
    constexpr std::int64_t now = 1800000000000LL;
    // Fixtures represent independently verified terminal identity/fill evidence
    // and a matched Position. This test does not infer fills from Position.
    for (const auto* side : {"LONG", "SHORT"}) {
        for (const auto* terminal : {"success", "partial_canceled"}) {
            for (const auto& detail : std::vector<json>{json::object(),
                    {{"data", {{"order", {{"finish_time", "0"}}}}}},
                    {{"data", {{"order", {{"finish_time", "1800000001"}}}}}}}) {
                const json original{{"record_id", "source-1"}, {"Contract", "BTC_USDT"},
                    {"position_side", side}, {"terminal_result", terminal},
                    {"tag", "finished open orders"}, {"trigger_price", "100.000"},
                    {"filled_quantity", nullptr}, {"close_assignment", "required"}};
                const json task{{"task_id", "task-1"}, {"state", "required"},
                    {"covered_source_record_ids", {"source-1"}},
                    {"publish_intent_id", nullptr}, {"close_order_id", nullptr}};
                auto store = orders3::make_empty_store();
                const auto source = orders3::with_dedupe_time(original, detail, "seconds", now);
                require(source["dedupe_at_ms"].is_null());
                for (auto it = original.begin(); it != original.end(); ++it)
                    require(source.at(it.key()) == it.value());
                store[0]["finished open orders"].push_back(source);
                store[0]["close_tasks"].push_back(task);
                store = orders3::parse_store(store.dump());
                const auto before = store;
                const auto& history = store[0]["finished open orders"];
                const auto decision = orders3::check_open_dedupe(history, "BTC_USDT", side, now);
                require(decision.decision == "deferred" && decision.code == "FINISH_TIME_INVALID");
                require(orders3::check_open_dedupe(history, "ETH_USDT", side, now).decision == "accepted");
                require(orders3::check_open_dedupe(history, "BTC_USDT",
                    std::string(side) == "LONG" ? "SHORT" : "LONG", now).decision == "accepted");
                const json position{{"entry_price", "100"}, {"value", "1000"},
                    {"initial_margin", "10"}, {"size", std::string(side) == "LONG" ? "10" : "-10"}};
                const auto calculated = orders3::with_close_task_price(
                    store[0]["close_tasks"][0], position, side, history);
                require(calculated["state"] == "checking_position");
                require(calculated["last_error"].is_null());
                require(calculated["task_id"] == task["task_id"]);
                require(calculated["covered_source_record_ids"] == task["covered_source_record_ids"]);
                require(calculated["calculation"]["activation_price"] ==
                    (std::string(side) == "LONG" ? "104.131" : "95.931"));
                const auto request = orders3::make_close_request("BTC_USDT", side, position,
                    calculated["calculation"]["activation_price"]);
                require(request["body"]["amount"] == (std::string(side) == "LONG" ? "-10" : "10"));
                require(request["body"]["reduce_only"] == true);
                // An invalid time must not hide an independently invalid price.
                auto invalid = history;
                invalid[0]["trigger_price"] = nullptr;
                const auto blocked = orders3::with_close_task_price(task, position, side, invalid);
                require(blocked["state"] == "blocked");
                require(blocked["last_error"]["field"] == "trigger_price");
                require(blocked["task_id"] == task["task_id"]);
                require(store == before);
                store[0]["close_tasks"][0] = calculated;
                const auto restored = orders3::parse_store(store.dump());
                require(restored[0]["finished open orders"] == history);
                require(restored[0]["close_tasks"][0] == calculated);
                require(orders3::check_open_dedupe(restored[0]["finished open orders"],
                    "BTC_USDT", side, now).code == "FINISH_TIME_INVALID");
            }
        }
    }
    std::cout << "Dedupe/close independence: " << checks << " checks passed\n";
}
