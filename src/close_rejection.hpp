#pragma once

#include "publish_recovery.hpp"

namespace orders3 {

// Input intent must already be classified as an explicit exchange rejection.
// Transport failure/timeout is unknown, never rejected. Caller serializes and
// reliably commits this snapshot before scheduling fresh position validation.
inline nlohmann::json recover_rejected_close(const nlohmann::json& store,
                                            const std::string& intent_id) {
    validate_store(store);
    const nlohmann::json* selected = nullptr;
    std::set<std::string> ids;
    for (const auto& intent : store[0].at("publish_intents")) {
        validate_publish_intent(intent);
        if (!ids.insert(intent.at("intent_id").get<std::string>()).second)
            throw std::runtime_error("DUPLICATE_INTENT_ID");
        if (intent.at("intent_id") == intent_id) selected = &intent;
    }
    if (!selected) throw std::runtime_error("INTENT_NOT_FOUND");
    const auto& intent = *selected;
    if (intent.at("operation") != "close.publish" || intent.at("state") != "rejected")
        throw std::runtime_error("NOT_REJECTED_CLOSE");
    if (!intent.contains("task_id") || !intent.at("task_id").is_string() ||
        intent.at("task_id").get_ref<const std::string&>().empty() ||
        !intent.contains("exchange_order_id") || !intent.at("exchange_order_id").is_null())
        throw std::runtime_error("INVALID_REJECTION_ASSOCIATION");
    if (!intent.contains("response") || !intent.at("response").is_object() ||
        !intent.contains("last_error") || !intent.at("last_error").is_object() ||
        !intent.at("last_error").contains("code") ||
        !intent.at("last_error").at("code").is_string() ||
        intent.at("last_error").at("code").get_ref<const std::string&>().empty())
        throw std::runtime_error("MISSING_REJECTION_EVIDENCE");

    std::size_t index = store[0].at("close_tasks").size();
    ids.clear();
    for (std::size_t i = 0; i < store[0].at("close_tasks").size(); ++i) {
        const auto& task = store[0].at("close_tasks")[i];
        if (!task.is_object() || !task.contains("task_id") ||
            !task.at("task_id").is_string() ||
            task.at("task_id").get_ref<const std::string&>().empty())
            throw std::runtime_error("INVALID_TASK_ID");
        if (!ids.insert(task.at("task_id").get<std::string>()).second)
            throw std::runtime_error("DUPLICATE_TASK_ID");
        if (task.at("task_id") == intent.at("task_id")) index = i;
    }
    if (index == store[0].at("close_tasks").size())
        throw std::runtime_error("TASK_NOT_FOUND");
    const auto& task = store[0].at("close_tasks")[index];
    if (!task.contains("target_key") || task.at("target_key") != intent.at("target_key") ||
        !task.contains("close_order_id") || !task.at("close_order_id").is_null())
        throw std::runtime_error("INVALID_TASK_ASSOCIATION");
    // A replay cannot detach a newer attempt or revive a canceled/active task.
    const bool replay = task.value("state", std::string{}) == "required" &&
        task.contains("publish_intent_id") && task.at("publish_intent_id").is_null() &&
        task.contains("last_rejected_intent_id") && task.at("last_rejected_intent_id") == intent_id;
    if (!replay && (task.value("state", std::string{}) != "publishing" ||
        !task.contains("publish_intent_id") || task.at("publish_intent_id") != intent_id))
        throw std::runtime_error("INVALID_REJECTION_TRANSITION");
    if (replay) return store;
    auto result = store;
    auto& next = result[0]["close_tasks"][index];
    next["state"] = "required";
    next["last_error"] = intent.at("last_error");
    next["last_rejected_intent_id"] = intent_id;
    next["publish_intent_id"] = nullptr;
    // Preserve diagnostics, but invalidate the values used for a new attempt.
    next["rejected_attempt_context"] = {
        {"position_snapshot", task.value("position_snapshot", nlohmann::json(nullptr))},
        {"calculation", task.value("calculation", nlohmann::json(nullptr))}};
    next["position_snapshot"] = nullptr;
    next["calculation"] = nullptr;
    next["next_action"] = "check_position";
    return result;
}

} // namespace orders3
