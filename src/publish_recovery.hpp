#pragma once
#include "storage_schema.hpp"

namespace orders3 {

// This policy never sends requests. A prepared intent must be durably changed
// to dispatching BEFORE the caller sends it; dispatching is not permission to retry.
inline void validate_publish_intent(const nlohmann::json& intent) {
    if (!intent.is_object()) throw std::runtime_error("INVALID_PUBLISH_INTENT");
    for (const auto* key : {"intent_id", "request_id", "record_id", "target_key", "operation", "state"})
        if (!intent.contains(key) || !intent.at(key).is_string() ||
            intent.at(key).get_ref<const std::string&>().empty())
            throw std::runtime_error(std::string("INVALID_INTENT_FIELD: ") + key);
    if (intent.at("operation") != "open.publish" && intent.at("operation") != "close.publish")
        throw std::runtime_error("INVALID_PUBLISH_OPERATION");
    const auto state = intent.at("state").get<std::string>();
    if (state != "prepared" && state != "dispatching" && state != "unknown" &&
        state != "acknowledged" && state != "rejected")
        throw std::runtime_error("INVALID_INTENT_STATE");
}

inline bool may_begin_publish(const nlohmann::json& intent) {
    validate_publish_intent(intent);
    return intent.at("state") == "prepared";
}

// Preserve exact request, stable associations, response and any existing error.
inline nlohmann::json mark_publish_unknown(const nlohmann::json& intent,
                                         const std::string& reason) {
    validate_publish_intent(intent);
    if (intent.at("state") != "dispatching" && intent.at("state") != "unknown")
        throw std::runtime_error("INVALID_UNKNOWN_TRANSITION");
    if (reason.empty()) throw std::runtime_error("MISSING_UNKNOWN_REASON");
    auto result = intent;
    result["state"] = "unknown";
    result["recovery_error"] = {{"code", "CREATE_OUTCOME_UNKNOWN"},
        {"message", reason}, {"retryable", false}};
    result["next_action"] = "reconcile";
    return result;
}

// Return a snapshot for the caller's reliable commit. Do not increment revision
// here: this function is not a disk transaction or a scheduler startup hook.
inline nlohmann::json recover_publish_intents(const nlohmann::json& store) {
    validate_store(store);
    auto result = store;
    std::set<std::string> ids;
    for (auto& intent : result[0]["publish_intents"]) {
        validate_publish_intent(intent);
        if (!ids.insert(intent.at("intent_id").get<std::string>()).second)
            throw std::runtime_error("DUPLICATE_INTENT_ID");
        if (intent.at("state") == "dispatching")
            intent = mark_publish_unknown(intent, "Restart recovered dispatching intent");
    }
    return result;
}

} // namespace orders3
