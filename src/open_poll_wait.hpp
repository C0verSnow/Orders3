#pragma once
#include <nlohmann/json.hpp>
#include <stdexcept>
#include <string>

namespace orders3 {
// Pure nonterminal poll policy. Persist the returned record in the pending
// group. Terminal responses require a separate resolver; never authorize close.
inline nlohmann::json with_open_poll_wait(const nlohmann::json& record,
                                          const nlohmann::json& response) {
    using nlohmann::json;
    if (!record.is_object()) throw std::runtime_error("INVALID_PENDING_OPEN");
    for (const auto* key : {"record_id", "id", "Contract", "side", "position_side", "target_key"})
        if (!record.contains(key) || !record.at(key).is_string() ||
            record.at(key).get_ref<const std::string&>().empty())
            throw std::runtime_error(std::string("INVALID_PENDING_OPEN: ") + key);
    const bool is_long = record.at("side") == "Open Long";
    if ((!is_long && record.at("side") != "Open Short") ||
        record.at("position_side") != (is_long ? "LONG" : "SHORT") ||
        record.at("target_key") != record.at("Contract").get<std::string>() +
            (is_long ? ":LONG" : ":SHORT") ||
        record.value("tag", json()) != "pending open orders" ||
        record.value("terminal_result", json()) != nullptr ||
        !record.contains("close_assignment") || !record.at("close_assignment").is_object() ||
        record.at("close_assignment").value("state", json()) != "not_eligible" ||
        record.at("close_assignment").value("task_id", json()) != nullptr)
        throw std::runtime_error("INVALID_PENDING_OPEN_STATE");
    auto result = record;
    result["last_detail_response"] = response;
    result["next_action"] = "poll";
    auto reconcile = [&](const char* reason) {
        result["local_state"] = "reconciling";
        result["last_error"] = {{"code", reason}, {"retryable", true}};
        return result;
    };
    if (!response.is_object() || !response.contains("code") ||
        !response.at("code").is_number_integer() || response.at("code") != 0 ||
        !response.contains("data") || !response.at("data").is_object() ||
        !response.at("data").contains("order") || !response.at("data").at("order").is_object())
        return reconcile("DETAIL_UNAVAILABLE");
    const auto& order = response.at("data").at("order");
    if (order.value("id", json()) != record.at("id") ||
        order.value("contract", json()) != record.at("Contract") ||
        order.value("pos_margin_mode", json()) != "cross" ||
        order.value("position_mode", json()) != "dual_plus")
        return reconcile("DETAIL_IDENTITY_MISMATCH");
    const auto amount = order.value("amount", json());
    if (!amount.is_string()) return reconcile("DETAIL_DIRECTION_MISMATCH");
    const auto text = amount.get<std::string>();
    const auto start = !text.empty() && text[0] == '-' ? 1u : 0u;
    if (text.size() <= start || (start == 0) != is_long ||
        text.find_first_not_of("0123456789", start) != std::string::npos ||
        text.find_first_of("123456789", start) == std::string::npos)
        return reconcile("DETAIL_DIRECTION_MISMATCH");
    for (const auto* key : {"side_label", "position_side_output"})
        if (order.contains(key) && order.at(key) != record.at("side"))
            return reconcile("DETAIL_DIRECTION_MISMATCH");
    if (order.contains("reduce_only") && order.at("reduce_only") != false)
        return reconcile("DETAIL_DIRECTION_MISMATCH");
    const auto status = order.value("original_status", json());
    if (!status.is_number_integer() || (status != 1 && status != 2 && status != 3))
        return reconcile("DETAIL_REQUIRES_TERMINAL_RESOLUTION");
    const int index = status.get<int>() - 1;
    const char* codes[] = {"pending", "ongoing", "partial"};
    const char* states[] = {"waiting_activation", "tracking", "partial"};
    if (order.value("status_code", json()) != codes[index])
        return reconcile("DETAIL_STATUS_CONFLICT");
    // Keep independent quantity evidence and the original signal untouched.
    result["original_status"] = status;
    result["local_state"] = states[index];
    if (status == 3) result["partial_observed"] = true;
    result["last_error"] = nullptr;
    return result;
}
} // namespace orders3
