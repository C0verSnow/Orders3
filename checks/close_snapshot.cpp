#include "../src/close_snapshot.hpp"
#include <iostream>
#include <vector>

using nlohmann::json;

int main() {
    const json base{{"entry_price", "100"}, {"value", "1000"},
                    {"initial_margin", "10"}, {"size", "10"}};
    int passed = 0;
    auto accept = [&](const json& snapshot, const std::string& side) {
        const auto before = snapshot.dump();
        const auto actual = orders3::validate_close_snapshot(snapshot, side);
        if (actual.entry_price != snapshot.at("entry_price") ||
            actual.value != snapshot.at("value") ||
            actual.initial_margin != snapshot.at("initial_margin") ||
            actual.size != snapshot.at("size") || snapshot.dump() != before)
            throw std::runtime_error("Snapshot changed or fields mixed");
        ++passed;
    };
    auto reject = [&](const json& snapshot, const std::string& side, const char* field) {
        const auto before = snapshot.dump();
        try { orders3::validate_close_snapshot(snapshot, side); }
        catch (const orders3::CloseSnapshotError& error) {
            if (error.field != field || snapshot.dump() != before)
                throw std::runtime_error("Wrong error or input modified");
            ++passed;
            return;
        }
        throw std::runtime_error("Invalid snapshot accepted");
    };
    for (const auto* side : {"LONG", "SHORT"}) {
        for (const auto* value : {"1000", "-1000", "0001.2300", "-0001.2300"}) {
            auto snapshot = base;
            snapshot["size"] = std::string(side) == "LONG" ? "10" : "-10";
            snapshot["value"] = value;
            accept(snapshot, side);
            for (const auto* margin : {"0", "-0.000", "000.00"}) {
                snapshot["initial_margin"] = margin;
                accept(snapshot, side);
            }
        }
    }
    for (const auto* field : {"entry_price", "value", "initial_margin", "size"}) {
        auto missing = base;
        missing.erase(field);
        reject(missing, "LONG", field);
        for (const auto& bad : std::vector<json>{nullptr, true, 1, 1.5, json::array(),
                json::object(), "", "-", "+1", " 1", "1 ", "1e3", "NaN", "Infinity",
                ".1", "1.", "1.2.3", "--1", "1/2", "0x10", "1\n"}) {
            auto snapshot = base;
            snapshot[field] = bad;
            reject(snapshot, "LONG", field);
        }
        auto precise = base;
        precise[field] = "900719925474099312345678901234567890.123000";
        accept(precise, "LONG");
        precise[field] = "0." + std::string(400, '0') + "1";
        accept(precise, "LONG");
    }
    for (const auto* field : {"entry_price", "value", "size"}) {
        for (const auto* zero : {"0", "-0", "000.000", "-00.00"}) {
            auto snapshot = base;
            snapshot[field] = zero;
            reject(snapshot, "LONG", field);
        }
    }
    for (const auto* field : {"entry_price", "initial_margin", "size"}) {
        auto snapshot = base;
        snapshot[field] = "-0.000000001";
        reject(snapshot, "LONG", field);
    }
    reject(base, "SHORT", "size");
    for (const auto* side : {"", "long", "dual_long", "Open Long"})
        reject(base, side, "position_side");
    for (const auto& snapshot : std::vector<json>{nullptr, json::array({base}), "100", 1})
        reject(snapshot, "LONG", "snapshot");
    auto roundtrip = base;
    roundtrip["value"] = "-12345678901234567890.00100";
    accept(json::parse(roundtrip.dump()), "LONG");
    std::cout << "Close snapshot checks passed: " << passed << '\n';
}
