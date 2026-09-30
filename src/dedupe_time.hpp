#pragma once

#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <nlohmann/json.hpp>

namespace orders3 {

// Call only after the caller verifies the detail identity and terminal evidence.
// Returns a record ready for storage; never discards history or close requirements.
inline nlohmann::json with_dedupe_time(nlohmann::json record,
        const nlohmann::json& detail, const std::string& unit,
        std::int64_t now_ms) {
    if (!record.is_object() || now_ms < 0)
        throw std::invalid_argument("INVALID_DEDUPE_TIME_INPUT");
    const nlohmann::json* raw = nullptr;
    const auto* node = &detail;
    for (const auto* key : {"data", "order", "finish_time"}) {
        if (!node->is_object() || !node->contains(key)) { node = nullptr; break; }
        node = &node->at(key);
    }
    raw = node;
    record["dedupe_time_source"] = {{"field", "data.order.finish_time"},
        {"raw_value", raw ? *raw : nlohmann::json(nullptr)}, {"unit", unit}};
    record["dedupe_at_ms"] = nullptr;
    if (unit != "seconds" || !raw || !raw->is_string()) return record;
    const auto& value = raw->get_ref<const std::string&>();
    if (value.empty()) return record;
    constexpr auto limit = std::numeric_limits<std::int64_t>::max() / 1000;
    std::int64_t seconds = 0;
    for (const char c : value) {
        if (c < '0' || c > '9' || seconds > (limit - (c - '0')) / 10)
            return record;
        seconds = seconds * 10 + (c - '0');
    }
    if (seconds == 0 || seconds * 1000 > now_ms) return record;
    record["dedupe_at_ms"] = seconds * 1000;
    return record;
}

} // namespace orders3
