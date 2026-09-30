#pragma once

#include "close_price.hpp"
#include <algorithm>
#include <vector>

namespace orders3 {
// Pure task update. Caller resolves source identity and persists the returned
// task before any publication. This does not authorize sending or mark ready.
inline nlohmann::json with_close_task_price(const nlohmann::json& task,
                                           const nlohmann::json& position,
                                           const std::string& side,
                                           const nlohmann::json& sources) {
    if (!task.is_object() || !task.contains("task_id") ||
        !task["task_id"].is_string() || task["task_id"].get<std::string>().empty())
        throw CloseSnapshotError("task_id");
    const auto state = task.value("state", std::string{});
    if (state != "required" && state != "checking_position" && state != "blocked")
        throw CloseSnapshotError("state");
    // An unresolved/published intent must be reconciled, never recalculated.
    for (const auto* key : {"publish_intent_id", "close_order_id"})
        if (task.contains(key) && !task[key].is_null()) throw CloseSnapshotError(key);
    if (!task.contains("covered_source_record_ids") ||
        !task["covered_source_record_ids"].is_array() ||
        task["covered_source_record_ids"].empty() || !sources.is_array())
        throw CloseSnapshotError("covered_source_record_ids");
    nlohmann::json covered = nlohmann::json::array();
    std::vector<std::string> seen;
    for (const auto& id : task["covered_source_record_ids"]) {
        if (!id.is_string() || id.get<std::string>().empty())
            throw CloseSnapshotError("covered_source_record_ids");
        const auto value = id.get<std::string>();
        if (std::find(seen.begin(), seen.end(), value) != seen.end())
            throw CloseSnapshotError("covered_source_record_ids");
        seen.push_back(value);
        const nlohmann::json* match = nullptr;
        for (const auto& source : sources) {
            if (!source.is_object() || !source.contains("record_id") || source["record_id"] != id) continue;
            if (match) throw CloseSnapshotError("covered_source_record_ids");
            match = &source;
        }
        // Missing source is also missing trigger price; preserve the task.
        covered.push_back(match ? *match : nlohmann::json::object());
    }
    auto result = task;
    try {
        const auto price = calculate_close_price(position, side, covered);
        result["position_snapshot"] = position;
        result["calculation"] = {{"activation_price", price}};
        result["last_error"] = nullptr;
        result["state"] = "checking_position";
    } catch (const CloseSnapshotError& error) {
        result["state"] = "blocked";
        result["calculation"] = nullptr;
        result["last_error"] = {{"code", "INVALID_CLOSE_PRICE"},
                                {"field", error.field}, {"retryable", false}};
    }
    return result;
}
} // namespace orders3
