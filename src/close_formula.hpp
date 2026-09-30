#pragma once

#include "close_snapshot.hpp"
#include <algorithm>

namespace orders3 {

// Exact rational output: numerator is signed, denominator is positive.
// These are calculation values, not activation_price or HTTP fields.
struct CloseFraction {
    std::string numerator;
    std::string denominator;
};

struct CloseFormula {
    CloseSnapshot snapshot;
    std::string value_adjusted;
    CloseFraction target_raw;
    CloseFraction target;
};

namespace close_formula_detail {
// Decimal integer arithmetic keeps arbitrary input precision without floating
// point or a platform-specific integer width. Fractions need not be reduced.
inline std::string trim(std::string s) {
    const auto p = s.find_first_not_of('0');
    return p == std::string::npos ? "0" : s.substr(p);
}

inline std::string multiply(const std::string& a, const std::string& b) {
    std::string out(a.size() + b.size(), '0');
    for (std::size_t i = a.size(); i-- > 0;) {
        int carry = 0;
        for (std::size_t j = b.size(); j-- > 0;) {
            const int n = (a[i] - '0') * (b[j] - '0') +
                          (out[i + j + 1] - '0') + carry;
            out[i + j + 1] = static_cast<char>('0' + n % 10);
            carry = n / 10;
        }
        out[i] = static_cast<char>('0' + carry);
    }
    return trim(out);
}

inline std::string add(const std::string& a, const std::string& b) {
    std::string out;
    std::size_t i = a.size(), j = b.size();
    int carry = 0;
    while (i || j || carry) {
        int n = carry;
        if (i) n += a[--i] - '0';
        if (j) n += b[--j] - '0';
        out.push_back(static_cast<char>('0' + n % 10));
        carry = n / 10;
    }
    std::reverse(out.begin(), out.end());
    return trim(out);
}

// Requires a >= b; both arguments are canonical nonnegative integers.
inline std::string subtract(const std::string& a, const std::string& b) {
    std::string out = a;
    std::size_t i = a.size(), j = b.size();
    int borrow = 0;
    while (i) {
        --i;
        int n = a[i] - '0' - borrow;
        if (j) n -= b[--j] - '0';
        borrow = n < 0 ? 1 : 0;
        out[i] = static_cast<char>('0' + n + 10 * borrow);
    }
    return trim(out);
}

struct Decimal {
    bool negative;
    std::string magnitude;
    std::string denominator;
};

// Called only after validate_close_snapshot has checked decimal syntax.
inline Decimal decimal(const std::string& value) {
    std::string digits;
    const auto dot = value.find('.');
    for (char c : value) if (c != '-' && c != '.') digits += c;
    return {value.front() == '-', trim(digits),
            "1" + std::string(dot == std::string::npos ? 0 : value.size() - dot - 1, '0')};
}
} // namespace close_formula_detail

// Caller must first uniquely match Position identity/account mode. Source
// prices, rounding, persistence and publishing belong to later stages.
inline CloseFormula calculate_close_formula(const nlohmann::json& position,
                                             const std::string& side) {
    using namespace close_formula_detail;
    const auto snapshot = validate_close_snapshot(position, side);
    const auto e = decimal(snapshot.entry_price);
    auto v = decimal(snapshot.value);
    const auto m = decimal(snapshot.initial_margin);
    const bool is_short = side == "SHORT";
    v.negative = v.negative != is_short;
    std::string adjusted = snapshot.value;
    if (is_short) {
        if (adjusted.front() == '-') adjusted.erase(0, 1);
        else adjusted.insert(0, 1, '-');
    }

    // 3.1*M/V = sign(V) * (31*M_num*V_den)/(10*M_den*V_num).
    const auto a = multiply(multiply("31", m.magnitude), v.denominator);
    const auto b = multiply(multiply("10", m.denominator), v.magnitude);
    std::string sum;
    if (v.negative) {
        if (b.size() < a.size() || (b.size() == a.size() && b <= a))
            throw CloseSnapshotError("target_raw");
        sum = subtract(b, a);
    } else {
        sum = add(b, a);
    }
    CloseFraction raw{multiply(e.magnitude, sum), multiply(e.denominator, b)};
    CloseFraction target{multiply(raw.numerator, is_short ? "99" : "101"),
                         multiply(raw.denominator, "100")};
    return {snapshot, adjusted, raw, target};
}

} // namespace orders3
