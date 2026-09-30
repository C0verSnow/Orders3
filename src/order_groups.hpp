#pragma once

#include "storage_schema.hpp"

namespace orders3 {

inline void validate_order_groups(const nlohmann::json& store) {
    validate_store(store);
    std::set<std::string> ids;
    for (const auto* group : {"raw orders", "pending open orders",
             "finished open orders", "pending close orders", "finished close orders"}) {
        for (const auto& record : store[0].at(group)) {
            if (!record.is_object() || !record.contains("record_id") ||
                !record.at("record_id").is_string() ||
                record.at("record_id").get_ref<const std::string&>().empty())
                throw std::runtime_error("INVALID_RECORD_ID");
            if (!ids.insert(record.at("record_id").get<std::string>()).second)
                throw std::runtime_error("DUPLICATE_RECORD_ID");
            if (!record.contains("tag") || record.at("tag") != group)
                throw std::runtime_error("INVALID_RECORD_TAG");
        }
    }
}

// Pure staging operation. Caller verifies exchange evidence and commits this
// returned snapshot together with related intent/task updates under one lock.
// No revision increment or disk commit is implied by an in-memory transfer.
inline nlohmann::json move_order_record(const nlohmann::json& store,
        const std::string& record_id, const std::string& from,
        const std::string& to) {
    validate_order_groups(store);
    const bool allowed =
        (from == "raw orders" && (to == "pending open orders" || to == "terminal_history")) ||
        (from == "pending open orders" && to == "finished open orders") ||
        (from == "pending close orders" && (to == "finished close orders" || to == "terminal_history"));
    if (!allowed) throw std::runtime_error("INVALID_GROUP_TRANSITION");
    const auto& records = store[0].at(from);
    std::size_t index = 0;
    while (index < records.size() && records[index].at("record_id") != record_id) ++index;
    if (index == records.size()) throw std::runtime_error("RECORD_NOT_FOUND");
    auto record = records[index];
    const auto result = record.find("terminal_result");
    if (to == "finished open orders" &&
        (result == record.end() || (*result != "success" &&
         *result != "partial_canceled" && *result != "canceled_no_fill")))
        throw std::runtime_error("INVALID_OPEN_TERMINAL_RESULT");
    if (to == "finished close orders" &&
        (result == record.end() || *result != "success"))
        throw std::runtime_error("INVALID_CLOSE_TERMINAL_RESULT");
    if (to == "terminal_history" &&
        (!record.contains("archive_reason") || !record.at("archive_reason").is_string() ||
         record.at("archive_reason").get_ref<const std::string&>().empty()))
        throw std::runtime_error("MISSING_ARCHIVE_REASON");
    record["tag"] = to;
    auto next = store;
    next[0].at(to).push_back(std::move(record));
    next[0].at(from).erase(index);
    return next;
}

} // namespace orders3
