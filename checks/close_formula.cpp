#include "../src/close_formula.hpp"
#include <iostream>
#include <vector>

using nlohmann::json;

int main() {
    const json base{{"entry_price", "100"}, {"value", "1000"},
                    {"initial_margin", "10"}, {"size", "10"}};
    int passed = 0;
    auto require = [&](bool value) {
        if (!value) throw std::runtime_error("Close formula mismatch");
        ++passed;
    };
    auto equal = [&](const orders3::CloseFraction& value, long long n, long long d) {
        require(std::stoll(value.numerator) * d == n * std::stoll(value.denominator));
    };
    for (const auto* side : {"LONG", "SHORT"}) {
        for (const auto* v : {"1000", "-1000"}) {
            auto p = base;
            p["value"] = v;
            const bool short_side = std::string(side) == "SHORT";
            p["size"] = short_side ? "-10" : "10";
            const auto before = p.dump();
            const auto r = orders3::calculate_close_formula(p, side);
            const bool negative = (v[0] == '-') != short_side;
            equal(r.target_raw, negative ? 969 : 1031, 10);
            equal(r.target, (negative ? 969 : 1031) * (short_side ? 99 : 101), 1000);
            require(r.value_adjusted == (negative ? "-1000" : "1000"));
            require(p.dump() == before && r.snapshot.value == v);
        }
    }
    // Independent native-integer oracle over both signs, including rejection
    // of zero/negative results. Values are bounded to avoid oracle overflow.
    for (int e : {1, 7, 100}) for (int v : {-99, -31, -3, 3, 31, 99})
    for (int m : {0, 1, 10, 30}) for (bool short_side : {false, true}) {
        json p{{"entry_price", std::to_string(e)}, {"value", std::to_string(v)},
               {"initial_margin", std::to_string(m)}, {"size", short_side ? "-2" : "2"}};
        const long long adjusted = short_side ? -v : v;
        const long long denominator = 10 * (adjusted < 0 ? -adjusted : adjusted);
        const long long numerator = e * (denominator + (adjusted < 0 ? -31 : 31) * m);
        try {
            const auto r = orders3::calculate_close_formula(p, short_side ? "SHORT" : "LONG");
            require(numerator > 0);
            equal(r.target_raw, numerator, denominator);
            equal(r.target, numerator * (short_side ? 99 : 101), denominator * 100);
        } catch (const orders3::CloseSnapshotError& error) {
            require(numerator <= 0 && error.field == "target_raw");
        }
    }
    auto p = base;
    p["entry_price"] = "001.2500";
    p["value"] = "-0.500";
    p["initial_margin"] = "0.010";
    const auto decimal = orders3::calculate_close_formula(p, "LONG");
    equal(decimal.target_raw, 11725, 10000);
    equal(decimal.target, 1184225, 1000000);
    require(decimal.value_adjusted == "-0.500");

    // Large and tiny decimals must remain exact, with no double overflow or
    // underflow. Zero margin makes the expected fractions easy to audit.
    p = base;
    p["value"] = "1";
    p["initial_margin"] = "-0.00";
    p["entry_price"] = "9007199254740993";
    const auto huge = orders3::calculate_close_formula(p, "LONG");
    require(huge.target_raw.numerator == "9007199254740993000");
    require(huge.target_raw.denominator == "1000");
    require(huge.target.numerator == "909727124728840293000");
    require(huge.target.denominator == "100000");
    p["entry_price"] = "0." + std::string(400, '0') + "1";
    const auto tiny = orders3::calculate_close_formula(p, "LONG");
    require(tiny.target.numerator == "101000");
    require(tiny.target.denominator == "1" + std::string(406, '0'));
    p["value"] = "-0001.00";
    p["size"] = "-10";
    require(orders3::calculate_close_formula(p, "SHORT").value_adjusted == "0001.00");

    for (const auto* field : {"entry_price", "value", "initial_margin", "size"}) {
        for (const auto& bad : std::vector<json>{nullptr, 1, "", "1e3", "NaN"}) {
            auto invalid = base;
            invalid[field] = bad;
            bool rejected = false;
            try { orders3::calculate_close_formula(invalid, "LONG"); }
            catch (const orders3::CloseSnapshotError& error) { rejected = error.field == field; }
            require(rejected);
        }
    }
    std::cout << "Close formula checks passed: " << passed << '\n';
}
