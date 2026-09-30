#pragma once
#include "publish_recovery.hpp"

namespace orders3 {

// Build the local response only after the caller has classified the outcome as
// unknown. This does not commit storage, send a request, or perform reconciliation.
inline nlohmann::json make_publish_unknown_response(const nlohmann::json& intent) {
    validate_publish_intent(intent);
    if (intent.at("state") != "unknown")
        throw std::runtime_error("EXPECTED_UNKNOWN_INTENT");
    if (!intent.contains("recovery_error") || !intent.at("recovery_error").is_object())
        throw std::runtime_error("MISSING_RECOVERY_ERROR");
    const auto& error = intent.at("recovery_error");
    if (!error.contains("code") || error.at("code") != "CREATE_OUTCOME_UNKNOWN" ||
        !error.contains("message") || !error.at("message").is_string() ||
        error.at("message").get_ref<const std::string&>().empty() ||
        !error.contains("retryable") || !error.at("retryable").is_boolean() ||
        error.at("retryable") != false)
        throw std::runtime_error("INVALID_RECOVERY_ERROR");
    if (!intent.contains("next_action") || intent.at("next_action") != "reconcile")
        throw std::runtime_error("EXPECTED_RECONCILE_ACTION");
    const auto id = intent.value("exchange_order_id", nlohmann::json(nullptr));
    if (!id.is_null() && (!id.is_string() || id.get_ref<const std::string&>().empty()))
        throw std::runtime_error("INVALID_EXCHANGE_ORDER_ID");
    return {{"schema_version", 1}, {"request_id", intent.at("request_id")},
        {"operation", intent.at("operation")}, {"outcome", "unknown"},
        {"result", {{"intent_id", intent.at("intent_id")}, {"exchange_order_id", id}}},
        {"error", error}, {"next_action", "reconcile"}};
}

} // namespace orders3
