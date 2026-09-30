#pragma once

#include <stdexcept>
#include <string>
#include <nlohmann/json.hpp>

namespace orders3 {

struct CloseSnapshotError : std::invalid_argument {
    std::string field;
    explicit CloseSnapshotError(const std::string& name)
        : std::invalid_argument("INVALID_CLOSE_SNAPSHOT: " + name), field(name) {}
};

struct CloseSnapshot {
    std::string entry_price;
    std::string value;
    std::string initial_margin;
    std::string size;
};

namespace close_snapshot_detail {
// Normalized local decimals: optional minus, digits, optional fraction.
// Inspect digits directly so large/tiny values never round or underflow.
inline int sign(const std::string& value, const std::string& field) {
    std::size_t i = (!value.empty() && value[0] == '-') ? 1 : 0;
    const bool negative = i == 1;
    bool nonzero = false;
    auto digits = [&]() {
        const auto start = i;
        while (i < value.size() && value[i] >= '0' && value[i] <= '9') {
            nonzero = nonzero || value[i] != '0';
            ++i;
        }
        if (i == start) throw CloseSnapshotError(field);
    };
    digits();
    if (i < value.size() && value[i] == '.') { ++i; digits(); }
    if (i != value.size()) throw CloseSnapshotError(field);
    return nonzero ? (negative ? -1 : 1) : 0;
}
} // namespace close_snapshot_detail

// Input is ONE normalized Position snapshot, after identity/mode matching.
// Raw exchange numbers must first be normalized losslessly by the adapter.
// This pure function neither completes zero-position tasks nor changes storage.
inline CloseSnapshot validate_close_snapshot(const nlohmann::json& snapshot,
                                             const std::string& position_side) {
    if (!snapshot.is_object()) throw CloseSnapshotError("snapshot");
    if (position_side != "LONG" && position_side != "SHORT")
        throw CloseSnapshotError("position_side");
    auto read = [&](const char* field, int& sign) {
        const auto it = snapshot.find(field);
        if (it == snapshot.end() || !it->is_string()) throw CloseSnapshotError(field);
        auto value = it->get<std::string>();
        sign = close_snapshot_detail::sign(value, field);
        return value;
    };
    int e, v, m, s;
    CloseSnapshot result{read("entry_price", e), read("value", v),
                         read("initial_margin", m), read("size", s)};
    if (e <= 0) throw CloseSnapshotError("entry_price");
    if (v == 0) throw CloseSnapshotError("value");
    if (m < 0) throw CloseSnapshotError("initial_margin");
    if (s != (position_side == "LONG" ? 1 : -1)) throw CloseSnapshotError("size");
    return result;
}

} // namespace orders3
