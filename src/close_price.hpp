#pragma once

#include "close_formula.hpp"

namespace orders3 {
namespace close_price_detail {
inline bool at_least(const std::string& a, const std::string& b) {
    return a.size() > b.size() || (a.size() == b.size() && a >= b);
}

// Positive exact fraction, produced by calculate_close_formula. Long division
// bounds each quotient digit to 0..9 even for arbitrarily large operands.
inline std::string round_positive(const CloseFraction& fraction, std::size_t scale) {
    using namespace close_formula_detail;
    const auto dividend = fraction.numerator + std::string(scale, '0');
    std::string quotient, remainder = "0";
    for (char digit : dividend) {
        remainder = trim(remainder + digit);
        int q = 0;
        while (at_least(remainder, fraction.denominator)) {
            remainder = subtract(remainder, fraction.denominator);
            ++q;
        }
        quotient += static_cast<char>('0' + q);
    }
    quotient = trim(quotient);
    if (at_least(multiply(remainder, "2"), fraction.denominator))
        quotient = add(quotient, "1");
    if (quotient == "0") throw CloseSnapshotError("activation_price");
    if (scale) {
        if (quotient.size() <= scale)
            quotient.insert(0, scale + 1 - quotient.size(), '0');
        quotient.insert(quotient.size() - scale, 1, '.');
    }
    return quotient;
}
} // namespace close_price_detail

// Caller supplies ALL covered source records after resolving task/source
// identity. No signal-price fallback, tick adjustment, I/O or task mutation.
inline std::string calculate_close_price(const nlohmann::json& position,
                                         const std::string& side,
                                         const nlohmann::json& covered_sources) {
    if (!covered_sources.is_array() || covered_sources.empty())
        throw CloseSnapshotError("covered_sources");
    std::size_t scale = 0;
    for (const auto& source : covered_sources) {
        if (!source.is_object() || !source.contains("trigger_price") ||
            !source["trigger_price"].is_string())
            throw CloseSnapshotError("trigger_price");
        const auto& price = source["trigger_price"].get_ref<const std::string&>();
        if (close_snapshot_detail::sign(price, "trigger_price") <= 0)
            throw CloseSnapshotError("trigger_price");
        const auto dot = price.find('.');
        if (dot != std::string::npos) scale = std::max(scale, price.size() - dot - 1);
    }
    const auto formula = calculate_close_formula(position, side);
    return close_price_detail::round_positive(formula.target, scale);
}
} // namespace orders3
