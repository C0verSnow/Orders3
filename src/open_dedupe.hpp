#pragma once

#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <nlohmann/json.hpp>

namespace orders3 {

struct DedupeDecision {
    std::string decision; // accepted, skipped, deferred
    std::string code;
};

// Input is normalized open history, after terminal identity/fill verification.
// This read-only decision does not replace pending-order reconciliation.
inline DedupeDecision check_open_dedupe(const nlohmann::json& history,
        const std::string& contract, const std::string& position_side,
        std::int64_t now_ms) {
    if (!history.is_array() || contract.empty() ||
        (position_side != "LONG" && position_side != "SHORT") || now_ms < 0)
        throw std::invalid_argument("INVALID_DEDUPE_INPUT");
    bool recent = false;
    bool invalid_time = false;
    bool unverified = false;
    for (const auto& record : history) {
        if (!record.is_object() || !record.contains("Contract") ||
            !record.at("Contract").is_string() ||
            record.at("Contract").get<std::string>().empty() ||
            !record.contains("position_side") ||
            (record.at("position_side") != "LONG" &&
             record.at("position_side") != "SHORT"))
            throw std::invalid_argument("INVALID_DEDUPE_TARGET");
        if (record.at("Contract") != contract ||
            record.at("position_side") != position_side) continue;
        const auto result = record.find("terminal_result");
        if (result != record.end() && *result == "canceled_no_fill") continue;
        if (result == record.end() ||
            (*result != "success" && *result != "partial_canceled")) {
            unverified = true;
            continue;
        }
        const auto time = record.find("dedupe_at_ms");
        if (time == record.end() || !time->is_number_integer() ||
            (time->is_number_unsigned() && time->get<std::uint64_t>() >
             static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max()))) {
            invalid_time = true;
            continue;
        }
        const auto completed = time->get<std::int64_t>();
        if (completed <= 0 || completed > now_ms) {
            invalid_time = true;
            continue;
        }
        if (now_ms - completed < 604800000) recent = true;
    }
    // Inspect every matching source: uncertain evidence takes precedence.
    if (unverified) return {"deferred", "EXECUTION_INCOMPLETE"};
    if (invalid_time) return {"deferred", "FINISH_TIME_INVALID"};
    if (recent) return {"skipped", "DEDUPE_7D"};
    return {"accepted", "OK"};
}

} // namespace orders3
