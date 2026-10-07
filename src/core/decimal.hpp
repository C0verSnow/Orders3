#pragma once

#include "core/error.hpp"
#include <QRegularExpression>
#include <QString>
#include <algorithm>

// Bounded decimal inputs, with exact integer arithmetic for prices and PNL sums.
namespace orders::decimal {
inline QString normalized(QString value) {
    while (value.size() > 1 && value.front() == '0')
        value.remove(0, 1);
    return value;
}
inline int compare(const QString &a, const QString &b) {
    if (a.size() != b.size()) return a.size() < b.size() ? -1 : 1;
    return QString::compare(a, b);
}
inline QString add(const QString &a, const QString &b) {
    QString result;
    int carry = 0;
    for (qsizetype i = a.size() - 1, j = b.size() - 1; i >= 0 || j >= 0 || carry; --i, --j) {
        const int digit = (i >= 0 ? a[i].digitValue() : 0)
            + (j >= 0 ? b[j].digitValue() : 0) + carry;
        result.prepend(QChar('0' + digit % 10));
        carry = digit / 10;
    }
    return normalized(result);
}
// Requires a >= b.
inline QString subtract(const QString &a, const QString &b) {
    QString result;
    int borrow = 0;
    for (qsizetype i = a.size() - 1, j = b.size() - 1; i >= 0; --i, --j) {
        int digit = a[i].digitValue() - (j >= 0 ? b[j].digitValue() : 0) - borrow;
        borrow = digit < 0 ? 1 : 0;
        if (borrow) digit += 10;
        result.prepend(QChar('0' + digit));
    }
    return normalized(result);
}
inline QString multiply(const QString &a, const QString &b) {
    QString result = "0";
    for (const auto digit : b) {
        QString partial = "0";
        for (int i = 0; i < digit.digitValue(); ++i) partial = add(partial, a);
        result = add(normalized(result + '0'), partial);
    }
    return result;
}
struct Number {
    QString digits;
    int scale = 0;
    bool negative = false;
};
inline Number parse(const QString &text) {
    static const QRegularExpression pattern(R"(^(-?)(\d+)(?:\.(\d+))?$)");
    const auto match = pattern.match(text);
    if (!match.hasMatch() || text.size() > 128 || match.captured(3).size() > 64)
        throw Error("无效的十进制数：" + text);
    Number result{normalized(match.captured(2) + match.captured(3)),
                  int(match.captured(3).size()), !match.captured(1).isEmpty()};
    if (result.digits == "0") result.negative = false;
    return result;
}
inline QString scaled(const Number &value, int scale) {
    return normalized(value.digits + QString(scale - value.scale, '0'));
}
inline QString format(QString digits, int scale, bool negative = false) {
    digits = digits.rightJustified(scale + 1, '0');
    if (scale) digits.insert(digits.size() - scale, '.');
    return (negative ? "-" : "") + digits;
}
inline QString sum(const QString &left, const QString &right) {
    const auto a = parse(left), b = parse(right);
    const int scale = std::max(a.scale, b.scale);
    const auto x = scaled(a, scale), y = scaled(b, scale);
    if (a.negative == b.negative) return format(add(x, y), scale, a.negative);
    const bool larger = compare(x, y) >= 0;
    const auto digits = larger ? subtract(x, y) : subtract(y, x);
    return format(digits, scale, digits != "0" && (larger ? a.negative : b.negative));
}
inline QString product(const QString &left, const QString &right) {
    const auto a = parse(left), b = parse(right);
    const auto digits = multiply(a.digits, b.digits);
    return format(digits, a.scale + b.scale, digits != "0" && a.negative != b.negative);
}
inline QString divideRounded(const QString &numerator, const QString &denominator) {
    if (denominator == "0") throw Error("平仓价格计算的分母不能为零");
    QString remainder = "0", quotient;
    for (const auto digit : numerator) {
        remainder = normalized(remainder + digit);
        int count = 0;
        while (compare(remainder, denominator) >= 0) {
            remainder = subtract(remainder, denominator);
            ++count;
        }
        quotient.append(QChar('0' + count));
    }
    quotient = normalized(quotient);
    const int rounding = compare(multiply(remainder, "2"), denominator);
    // Decimal's default ROUND_HALF_EVEN: ties go to the nearest even last digit.
    if (rounding > 0 || (rounding == 0 && quotient.back().digitValue() % 2))
        quotient = add(quotient, "1");
    return quotient;
}
inline QString closePrice(const QString &entryText, const QString &valueText,
                          const QString &marginText, const QString &markText, bool shortPosition) {
    const auto entry = parse(entryText), value = parse(valueText);
    const auto margin = parse(marginText), mark = parse(markText);
    if (entry.negative || margin.negative || mark.negative
        || entry.digits == "0" || value.digits == "0" || mark.digits == "0")
        throw Error("持仓价格必须大于零，价值不能为零，初始保证金不能为负数");
    if (value.negative != shortPosition)
        throw Error("持仓价值的正负号与持仓方向不一致");
    const int scale = std::max(value.scale, margin.scale);
    const auto denominator = multiply(scaled(value, scale), "10");
    const auto adjustment = multiply(scaled(margin, scale), "31");
    if (value.negative && compare(denominator, adjustment) <= 0)
        throw Error("计算出的空仓平仓价格不大于零");
    const auto factor = value.negative ? subtract(denominator, adjustment)
                                      : add(denominator, adjustment);
    const auto priceMultiplier = shortPosition ? "99" : "101";
    const auto numerator = multiply(multiply(entry.digits, factor), priceMultiplier)
        + QString(mark.scale, '0');
    const auto divisor = multiply(denominator, "100") + QString(entry.scale, '0');
    const auto rounded = divideRounded(normalized(numerator), normalized(divisor));
    if (rounded == "0") throw Error("平仓价格对齐步长后为零");
    return format(rounded, mark.scale);
}
} // namespace orders::decimal
