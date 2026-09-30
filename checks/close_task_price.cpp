#include "../src/close_task_price.hpp"
#include <iostream>

using nlohmann::json;
int main() {
    int passed = 0;
    auto require = [&](bool ok) {
        if (!ok) throw std::runtime_error("close task price mismatch");
        ++passed;
    };
    const json task{{"task_id", "t1"}, {"state", "required"},
        {"covered_source_record_ids", {"s1", "s2"}}, {"source_record_ids", {"s2"}},
        {"replaces_task_ids", {"old"}}, {"publish_intent_id", nullptr},
        {"close_order_id", nullptr}, {"calculation", {{"activation_price", "999"}}},
        {"custom", "preserve"}};
    const json position{{"entry_price", "100"}, {"value", "1000"},
        {"initial_margin", "10"}, {"size", "10"}};
    const json sources = json::array({{{"record_id", "s1"}, {"trigger_price", "100.00"}},
        {{"record_id", "s2"}, {"trigger_price", "100.000"}}});
    for (const auto& invalid : std::vector<json>{nullptr, "0", "-1", "-0.00", "", 100, "1e2"}) {
        auto input = sources;
        input[1]["trigger_price"] = invalid;
        input[1]["signal_price"] = "100.000";
        auto expected = task;
        expected["state"] = "blocked";
        expected["calculation"] = nullptr;
        expected["last_error"] = {{"code", "INVALID_CLOSE_PRICE"},
            {"field", "trigger_price"}, {"retryable", false}};
        const auto before = input;
        const auto blocked = orders3::with_close_task_price(task, position, "LONG", input);
        require(blocked == expected);
        require(json::parse(blocked.dump()) == expected);
        require(input == before);
        const auto recovered = orders3::with_close_task_price(blocked, position, "LONG", sources);
        require(recovered["calculation"]["activation_price"] == "104.131");
        require(recovered["state"] == "checking_position" && recovered["last_error"].is_null());
        require(recovered["task_id"] == "t1" && recovered["custom"] == "preserve");
    }
    auto missing = sources;
    missing[1].erase("trigger_price");
    require(orders3::with_close_task_price(task, position, "LONG", missing)["state"] == "blocked");
    missing.erase(1);
    require(orders3::with_close_task_price(task, position, "LONG", missing)["state"] == "blocked");
    auto reversed = sources;
    std::reverse(reversed.begin(), reversed.end());
    require(orders3::with_close_task_price(task, position, "LONG", reversed) ==
            orders3::with_close_task_price(task, position, "LONG", sources));
    auto short_position = position;
    short_position["size"] = "-10";
    require(orders3::with_close_task_price(task, short_position, "SHORT", sources)
            ["calculation"]["activation_price"] == "95.931");
    for (const auto* state : {"publishing", "unknown", "active", "completed", "ready"}) {
        auto unsafe = task;
        unsafe["state"] = state;
        bool rejected = false;
        try { orders3::with_close_task_price(unsafe, position, "LONG", sources); }
        catch (const orders3::CloseSnapshotError&) { rejected = true; }
        require(rejected);
    }
    for (const auto* key : {"publish_intent_id", "close_order_id"}) {
        auto unsafe = task;
        unsafe[key] = "existing";
        bool rejected = false;
        try { orders3::with_close_task_price(unsafe, position, "LONG", sources); }
        catch (const orders3::CloseSnapshotError&) { rejected = true; }
        require(rejected);
    }
    auto duplicate = sources;
    duplicate.push_back(sources[0]);
    bool rejected = false;
    try { orders3::with_close_task_price(task, position, "LONG", duplicate); }
    catch (const orders3::CloseSnapshotError&) { rejected = true; }
    require(rejected);
    require(task["state"] == "required" && task["calculation"]["activation_price"] == "999");
    std::cout << "Close task price checks passed: " << passed << '\n';
}
