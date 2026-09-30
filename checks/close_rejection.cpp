#include "../src/close_rejection.hpp"
#include <iostream>

using nlohmann::json;
int checks = 0;
void require(bool ok) {
    ++checks;
    if (!ok) throw std::runtime_error("Close rejection check failed");
}
json fixture(const std::string& side) {
    auto store = orders3::make_empty_store();
    store[0]["revision"] = 9007199254740993LL;
    store[0]["publish_intents"].push_back({
        {"intent_id", "intent-1"}, {"request_id", "req-1"}, {"record_id", "close-1"},
        {"task_id", "task-1"}, {"target_key", "BTC_USDT:" + side},
        {"operation", "close.publish"}, {"state", "rejected"},
        {"exchange_order_id", nullptr}, {"http_request", {{"body", {{"amount", "-10"}}}}},
        {"response", {{"code", "PRICE_REJECTED"}}},
        {"last_error", {{"code", "PRICE_REJECTED"}, {"retryable", false}}}});
    store[0]["close_tasks"].push_back({
        {"task_id", "task-1"}, {"target_key", "BTC_USDT:" + side}, {"state", "publishing"},
        {"source_record_ids", {"open-2"}}, {"covered_source_record_ids", {"open-1", "open-2"}},
        {"replaces_task_ids", {"task-0"}}, {"previous_close_order_ids", {"9007199254740993"}},
        {"position_snapshot", {{"size", "10"}}}, {"calculation", {{"activation_price", "104.13"}}},
        {"publish_intent_id", "intent-1"}, {"close_order_id", nullptr},
        {"unfulfilled_quantity", nullptr}, {"last_error", nullptr}});
    store[0]["terminal_history"].push_back({{"record_id", "old-close"}, {"archive_reason", "replaced"}});
    store[0]["finished open orders"].push_back({{"record_id", "open-1"}});
    return store;
}
void rejects(const json& store, const std::string& id = "intent-1") {
    const auto original = store;
    bool caught = false;
    try { orders3::recover_rejected_close(store, id); }
    catch (const std::exception&) { caught = true; }
    require(caught);
    require(store == original);
}
int main() {
    for (const auto* side : {"LONG", "SHORT"}) {
        const auto store = fixture(side);
        const auto original = store;
        const auto result = orders3::recover_rejected_close(store, "intent-1");
        auto expected = store;
        auto& task = expected[0]["close_tasks"][0];
        task["state"] = "required";
        task["last_error"] = store[0]["publish_intents"][0]["last_error"];
        task["last_rejected_intent_id"] = "intent-1";
        task["publish_intent_id"] = nullptr;
        task["rejected_attempt_context"] = {{"position_snapshot", task["position_snapshot"]},
                                             {"calculation", task["calculation"]}};
        task["position_snapshot"] = nullptr;
        task["calculation"] = nullptr;
        task["next_action"] = "check_position";
        require(result == expected);
        require(store == original);
        require(orders3::parse_store(result.dump()) == result);
        require(orders3::recover_rejected_close(result, "intent-1") == result);
        require(!orders3::may_begin_publish(result[0]["publish_intents"][0]));
        for (const auto* state : {"prepared", "dispatching", "unknown", "acknowledged"}) {
            auto bad = store;
            bad[0]["publish_intents"][0]["state"] = state;
            rejects(bad);
        }
        for (const auto* state : {"required", "ready", "unknown", "active", "completed",
                                 "canceled_unfulfilled", "reconciling_previous", "stopping_previous"}) {
            auto bad = store;
            bad[0]["close_tasks"][0]["state"] = state;
            rejects(bad);
        }
        for (const auto* collection : {"publish_intents", "close_tasks"}) {
            auto bad = store;
            bad[0][collection].push_back(bad[0][collection][0]);
            rejects(bad);
            bad[0][collection] = json::array();
            rejects(bad);
        }
        for (const auto* key : {"task_id", "exchange_order_id", "response", "last_error"}) {
            auto bad = store;
            bad[0]["publish_intents"][0].erase(key);
            rejects(bad);
        }
        for (const auto* key : {"target_key", "close_order_id", "publish_intent_id"}) {
            auto bad = store;
            bad[0]["close_tasks"][0][key] = "other";
            rejects(bad);
        }
        for (const auto* key : {"operation", "task_id", "exchange_order_id"}) {
            auto bad = store;
            bad[0]["publish_intents"][0][key] = "other";
            rejects(bad);
        }
        auto newer = result;
        newer[0]["close_tasks"][0]["publish_intent_id"] = "intent-2";
        newer[0]["close_tasks"][0]["state"] = "publishing";
        rejects(newer);
        auto open = store;
        open[0]["publish_intents"][0]["operation"] = "open.publish";
        rejects(open);
        for (const auto& value : std::vector<json>{nullptr, "", 1, json::array()}) {
            for (const auto* key : {"response", "last_error", "task_id"}) {
                auto bad = store;
                bad[0]["publish_intents"][0][key] = value;
                rejects(bad);
            }
        }
        for (const auto& value : std::vector<json>{nullptr, "", 1}) {
            auto bad = store;
            bad[0]["publish_intents"][0]["last_error"]["code"] = value;
            rejects(bad);
        }
        rejects(store, "missing");
    }
    rejects(json::array());
    std::cout << "Close rejection: " << checks << " checks passed\n";
}
