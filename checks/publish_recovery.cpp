#include "../src/publish_recovery.hpp"
#include <iostream>
using nlohmann::json;
int checks = 0;
void require(bool ok) {
    ++checks;
    if (!ok) throw std::runtime_error("Publish recovery check failed");
}
json intent(const std::string& state, const std::string& operation) {
    return {{"intent_id", state}, {"request_id", "req-1"}, {"record_id", "record-1"},
        {"target_key", "BTC_USDT:LONG"}, {"operation", operation}, {"state", state},
        {"task_id", "task-1"}, {"exchange_order_id", nullptr}, {"attempt", 1},
        {"http_request", {{"body", {{"amount", "9007199254740993"}}}}},
        {"response", {{"code", 0}}}, {"last_error", {{"code", "TIMEOUT"}}}};
}
template<class F> void rejects(F action) {
    try { action(); } catch (const std::runtime_error&) { require(true); return; }
    throw std::runtime_error("Invalid recovery accepted");
}
int main() {
    for (const auto* operation : {"open.publish", "close.publish"}) {
        auto store = orders3::make_empty_store();
        for (const auto* state : {"prepared", "dispatching", "unknown", "acknowledged", "rejected"})
            store[0]["publish_intents"].push_back(intent(state, operation));
        store[0]["close_tasks"].push_back({{"task_id", "task-1"}, {"state", "publishing"}});
        store[0]["revision"] = 9007199254740993LL;
        const auto original = store;
        auto recovered = orders3::recover_publish_intents(store);
        require(store == original);
        auto expected = store;
        expected[0]["publish_intents"][1] = orders3::mark_publish_unknown(
            store[0]["publish_intents"][1], "Restart recovered dispatching intent");
        require(recovered == expected);
        require(orders3::recover_publish_intents(recovered) == recovered);
        require(orders3::parse_store(recovered.dump()) == recovered);
        for (const auto& item : recovered[0]["publish_intents"])
            require(orders3::may_begin_publish(item) == (item["state"] == "prepared"));
        for (const auto* reason : {"Timeout", "Connection interrupted", "Missing reliable receipt"}) {
            const auto source = intent("dispatching", operation);
            const auto unknown = orders3::mark_publish_unknown(source, reason);
            require(!orders3::may_begin_publish(unknown));
            require(unknown["next_action"] == "reconcile");
            require(unknown["recovery_error"]["retryable"] == false);
            for (const auto* key : {"intent_id", "request_id", "record_id", "task_id", "target_key",
                                   "http_request", "response", "last_error", "attempt", "exchange_order_id"})
                require(unknown.at(key) == source.at(key));
        }
        for (const auto* state : {"prepared", "acknowledged", "rejected"})
            rejects([&] { orders3::mark_publish_unknown(intent(state, operation), "timeout"); });
        auto duplicate = store;
        duplicate[0]["publish_intents"].push_back(store[0]["publish_intents"][0]);
        rejects([&] { orders3::recover_publish_intents(duplicate); });
    }
    for (const auto& bad : std::vector<json>{nullptr, 1, json::array(), json::object()})
        rejects([&] { orders3::may_begin_publish(bad); });
    for (const auto* key : {"intent_id", "request_id", "record_id", "target_key", "operation", "state"}) {
        for (const auto& value : std::vector<json>{nullptr, 1, "", json::array()}) {
            auto bad = intent("prepared", "open.publish");
            bad[key] = value;
            rejects([&] { orders3::may_begin_publish(bad); });
        }
    }
    rejects([] { orders3::may_begin_publish(intent("invalid", "open.publish")); });
    rejects([] { orders3::may_begin_publish(intent("prepared", "order.poll")); });
    rejects([] { orders3::mark_publish_unknown(intent("dispatching", "open.publish"), ""); });
    rejects([] { orders3::recover_publish_intents(json::array()); });
    std::cout << "Publish recovery: " << checks << " checks passed\n";
}
