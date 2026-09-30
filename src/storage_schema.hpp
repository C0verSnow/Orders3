#pragma once

#include <cstdint>
#include <limits>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>

namespace orders3 {

inline nlohmann::json make_empty_store() {
    nlohmann::json root = {{"schema_version", 1}, {"revision", 0},
                           {"last timestamp", 0}};
    for (const auto* key : {"raw orders", "pending open orders",
             "finished open orders", "pending close orders",
             "finished close orders", "batches", "publish_intents",
             "close_tasks", "terminal_history", "workflow_runs"})
        root[key] = nlohmann::json::array();
    return nlohmann::json::array({root});
}

// Validates the v1 envelope, not individual order/intent/task contracts.
inline void validate_store(const nlohmann::json& store) {
    if (!store.is_array() || store.size() != 1 || !store[0].is_object())
        throw std::runtime_error("INVALID_STORAGE_ROOT");
    const auto& root = store[0];
    for (const auto* key : {"schema_version", "revision", "last timestamp"}) {
        if (!root.contains(key))
            throw std::runtime_error(std::string("MISSING_STORAGE_FIELD: ") + key);
        const auto& value = root.at(key);
        const bool valid = value.is_number_unsigned()
            ? value.get<std::uint64_t>() <=
                static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())
            : value.is_number_integer() && value.get<std::int64_t>() >= 0;
        if (!valid)
            throw std::runtime_error(std::string("INVALID_STORAGE_INTEGER: ") + key);
    }
    if (root.at("schema_version") != 1)
        throw std::runtime_error("UNSUPPORTED_STORAGE_VERSION");
    for (const auto* key : {"raw orders", "pending open orders",
             "finished open orders", "pending close orders",
             "finished close orders", "batches", "publish_intents",
             "close_tasks", "terminal_history", "workflow_runs"}) {
        if (!root.contains(key) || !root.at(key).is_array())
            throw std::runtime_error(std::string("INVALID_STORAGE_COLLECTION: ") + key);
    }
}

// Pure decoding: a corrupt/legacy document is never replaced with empty data.
inline nlohmann::json parse_store(const std::string& text) {
    std::vector<std::set<std::string>> object_keys;
    auto callback = [&](int, nlohmann::json::parse_event_t event,
                        nlohmann::json& value) {
        using event_t = nlohmann::json::parse_event_t;
        if (event == event_t::object_start) object_keys.emplace_back();
        if (event == event_t::key &&
            !object_keys.back().insert(value.get<std::string>()).second)
            throw std::runtime_error("DUPLICATE_STORAGE_KEY");
        if (event == event_t::object_end) object_keys.pop_back();
        return true;
    };
    auto store = nlohmann::json::parse(text, callback);
    validate_store(store);
    return store;
}

} // namespace orders3
