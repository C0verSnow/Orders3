#include "../src/order_groups.hpp"
#include <iostream>

using nlohmann::json;
int checks = 0;
void require(bool condition) {
    ++checks;
    if (!condition) throw std::runtime_error("Order group check failed");
}
json record(const std::string& id, const std::string& group) {
    return {{"record_id", id}, {"tag", group}, {"id", "9007199254740993"},
            {"terminal_result", "success"}, {"trigger_price", "100.00"},
            {"dedupe_at_ms", 1790054385000LL}, {"execution", {{"filled_quantity", nullptr}}}};
}
void reject(const json& store, const std::string& from, const std::string& to,
            const std::string& error, const std::string& id = "open") {
    const auto original = store;
    try { orders3::move_order_record(store, id, from, to); }
    catch (const std::runtime_error& e) {
        require(e.what() == error);
        require(store == original);
        return;
    }
    throw std::runtime_error("Invalid transfer accepted");
}
int main() {
    auto initial = orders3::make_empty_store();
    initial[0]["raw orders"].push_back(record("open", "raw orders"));
    const auto original = initial;
    auto pending = orders3::move_order_record(initial, "open", "raw orders", "pending open orders");
    require(initial == original);
    require(pending[0]["raw orders"].empty());
    auto expected = record("open", "pending open orders");
    require(pending[0]["pending open orders"] == json::array({expected}));
    for (const auto* outcome : {"success", "partial_canceled", "canceled_no_fill"}) {
        pending[0]["pending open orders"][0]["terminal_result"] = outcome;
        auto done = orders3::move_order_record(pending, "open", "pending open orders", "finished open orders");
        require(done[0]["pending open orders"].empty());
        require(done[0]["finished open orders"][0]["terminal_result"] == outcome);
    }
    auto done = orders3::move_order_record(pending, "open", "pending open orders", "finished open orders");
    auto close = record("close", "pending close orders");
    close["source_record_ids"] = {"open"};
    close["task_id"] = "task-1";
    close["covered_quantity"] = "10";
    close["closed_quantity"] = nullptr;
    close["remaining_quantity"] = nullptr;
    done[0]["pending close orders"].push_back(close);
    done[0]["terminal_history"].push_back({{"reason", "existing history"}});
    auto closed = orders3::move_order_record(done, "close", "pending close orders", "finished close orders");
    auto expected_store = done;
    close["tag"] = "finished close orders";
    expected_store[0]["pending close orders"] = json::array();
    expected_store[0]["finished close orders"] = json::array({close});
    require(closed == expected_store); // All open history and recovery collections retained.
    require(orders3::parse_store(closed.dump()) == closed);
    orders3::validate_order_groups(closed);
    for (const auto* group : {"raw orders", "pending open orders", "finished open orders",
                             "pending close orders", "finished close orders"}) {
        auto bad = initial;
        bad[0][group].push_back(record("open", group));
        reject(bad, "raw orders", "pending open orders", "DUPLICATE_RECORD_ID");
    }
    for (const json& id : std::vector<json>{nullptr, "", 123, true, json::array()}) {
        auto bad = initial;
        bad[0]["raw orders"][0]["record_id"] = id;
        reject(bad, "raw orders", "pending open orders", "INVALID_RECORD_ID");
    }
    auto bad = initial;
    bad[0]["raw orders"][0].erase("record_id");
    reject(bad, "raw orders", "pending open orders", "INVALID_RECORD_ID");
    bad = initial;
    bad[0]["raw orders"][0]["tag"] = "pending open orders";
    reject(bad, "raw orders", "pending open orders", "INVALID_RECORD_TAG");
    reject(initial, "raw orders", "pending open orders", "RECORD_NOT_FOUND", "missing");
    reject(pending, "raw orders", "pending open orders", "RECORD_NOT_FOUND");
    for (const auto* to : {"raw orders", "finished open orders", "pending close orders", "bogus"})
        reject(initial, "raw orders", to, "INVALID_GROUP_TRANSITION");
    reject(closed, "finished open orders", "terminal_history", "INVALID_GROUP_TRANSITION");
    reject(closed, "finished close orders", "pending close orders", "INVALID_GROUP_TRANSITION", "close");
    for (const json& outcome : std::vector<json>{nullptr, "", "pending", 4, "canceled"}) {
        bad = pending;
        bad[0]["pending open orders"][0]["terminal_result"] = outcome;
        reject(bad, "pending open orders", "finished open orders", "INVALID_OPEN_TERMINAL_RESULT");
        bad = done;
        bad[0]["pending close orders"][0]["terminal_result"] = outcome;
        reject(bad, "pending close orders", "finished close orders", "INVALID_CLOSE_TERMINAL_RESULT", "close");
    }
    for (const auto* from : {"raw orders", "pending close orders"}) {
        auto archived = orders3::make_empty_store();
        archived[0][from].push_back(record("open", from));
        reject(archived, from, "terminal_history", "MISSING_ARCHIVE_REASON");
        archived[0][from][0]["archive_reason"] = "verified cancellation";
        const auto result = orders3::move_order_record(archived, "open", from, "terminal_history");
        require(result[0][from].empty());
        auto archived_record = archived[0][from][0];
        archived_record["tag"] = "terminal_history";
        require(result[0]["terminal_history"] == json::array({archived_record}));
    }
    std::cout << "Order group checks passed: " << checks << '\n';
}
