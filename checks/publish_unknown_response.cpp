#include "../src/publish_unknown_response.hpp"
#include <iostream>
using nlohmann::json;
int checks = 0;
void require(bool ok) {
    ++checks;
    if (!ok) throw std::runtime_error("Unknown response check failed");
}
template<class F> void rejects(F action) {
    try { action(); } catch (const std::runtime_error&) { require(true); return; }
    throw std::runtime_error("Invalid response input accepted");
}
int main() {
    for (const auto* operation : {"open.publish", "close.publish"}) {
        const json source = {{"intent_id", "intent-002"}, {"request_id", "req-open-002"},
            {"record_id", "record-2"}, {"task_id", "task-2"},
            {"target_key", "BTC_USDT:LONG"}, {"operation", operation},
            {"state", "dispatching"}, {"last_error", {{"code", "TIMEOUT"}}},
            {"http_request", {{"body", {{"amount", "9007199254740993"}}}}}};
        for (const auto* reason : {"Timeout", "Connection interrupted", "Unparseable receipt", "Server error"}) {
            auto unknown = orders3::mark_publish_unknown(source, reason);
            unknown["recovery_error"]["details"] = {{"transport_code", 28}};
            const auto original = unknown;
            const auto response = orders3::make_publish_unknown_response(unknown);
            const json expected = {{"schema_version", 1}, {"request_id", "req-open-002"},
                {"operation", operation}, {"outcome", "unknown"},
                {"result", {{"intent_id", "intent-002"}, {"exchange_order_id", nullptr}}},
                {"error", unknown.at("recovery_error")}, {"next_action", "reconcile"}};
            require(response == expected);
            require(unknown == original);
            require(!orders3::may_begin_publish(unknown));
            require(json::parse(response.dump()) == expected);
            auto store = orders3::make_empty_store();
            store[0]["publish_intents"].push_back(unknown);
            const auto restored = orders3::recover_publish_intents(orders3::parse_store(store.dump()));
            require(restored == store);
            require(orders3::make_publish_unknown_response(restored[0]["publish_intents"][0]) == expected);
            for (const auto& id : std::vector<json>{nullptr, "9007199254740993"}) {
                auto with_id = unknown;
                with_id["exchange_order_id"] = id;
                require(orders3::make_publish_unknown_response(with_id)["result"]["exchange_order_id"] == id);
            }
            for (const auto& id : std::vector<json>{"", 1, false, json::object(), json::array()}) {
                auto bad = unknown;
                bad["exchange_order_id"] = id;
                rejects([&] { orders3::make_publish_unknown_response(bad); });
            }
            for (const auto* state : {"prepared", "dispatching", "acknowledged", "rejected"}) {
                auto bad = unknown;
                bad["state"] = state;
                rejects([&] { orders3::make_publish_unknown_response(bad); });
            }
            for (const auto* key : {"recovery_error", "next_action", "request_id", "intent_id"}) {
                auto bad = unknown;
                bad.erase(key);
                rejects([&] { orders3::make_publish_unknown_response(bad); });
            }
            for (const auto& error : std::vector<json>{nullptr, "error", json::object(),
                    {{"code", "CREATE_OUTCOME_UNKNOWN"}, {"message", "timeout"}, {"retryable", true}},
                    {{"code", "CREATE_OUTCOME_UNKNOWN"}, {"message", ""}, {"retryable", false}},
                    {{"code", "OTHER"}, {"message", "timeout"}, {"retryable", false}},
                    {{"code", "CREATE_OUTCOME_UNKNOWN"}, {"message", "timeout"}, {"retryable", 0}}}) {
                auto bad = unknown;
                bad["recovery_error"] = error;
                rejects([&] { orders3::make_publish_unknown_response(bad); });
            }
            auto bad = unknown;
            bad["next_action"] = "open.publish";
            rejects([&] { orders3::make_publish_unknown_response(bad); });
        }
    }
    std::cout << "Unknown response: " << checks << " checks passed\n";
}
