#include "core/order_parser.hpp"
#include "core/error.hpp"
#include "core/decimal.hpp"

#include <QJsonDocument>
#include <QJsonParseError>
#include <QJsonObject>
#include <QRegularExpression>
#include <array>
#include <cmath>

namespace orders {
namespace {
struct OrderField {
    QString name;
    QRegularExpression pattern;
    bool isTimestamp = false;
};

QRegularExpression fieldPattern(const QString &label) {
    QRegularExpression pattern("\\b" + label + "[ \\t]*:[ \\t]*([^\\r\\n]+)",
                               QRegularExpression::CaseInsensitiveOption);
    pattern.optimize();
    return pattern;
}

const std::array<OrderField, 5> &orderFields() {
    static const std::array<OrderField, 5> fields{{
        {"contract", fieldPattern("(?:contract|Symbol)")},
        {"activation_price", fieldPattern("(?:activation_price|Price)")},
        {"side", fieldPattern("Side")},
        {"amount", fieldPattern("(?:amount|Size)")},
        {"timestamp", fieldPattern("(?:Timestamp|Orders Times)"), true},
    }};
    return fields;
}

QJsonValue parseField(const OrderField &field, const QString &block) {
    const auto match = field.pattern.match(block);
    if (!match.hasMatch())
        return QJsonValue::Null;

    const QString value = match.captured(1).trimmed();
    if (!field.isTimestamp)
        return value;

    bool valid = false;
    const qint64 timestamp = value.toLongLong(&valid);
    return valid ? QJsonValue(timestamp) : QJsonValue(QJsonValue::Null);
}
} // namespace

namespace {
QString decimalText(const QJsonValue &value, const QString &field) {
    QString text;
    if (value.isString()) text = value.toString().trimmed();
    else if (value.isDouble()) {
        const auto encoded = QJsonDocument(QJsonArray{value}).toJson(QJsonDocument::Compact);
        text = QString::fromUtf8(encoded.mid(1, encoded.size() - 2));
    } else throw Error("orders 表字段必须是数字或十进制文本：" + field);
    static const QRegularExpression pattern(R"(^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$)");
    const auto match = pattern.match(text);
    if (!match.hasMatch() || text.size() > 128)
        throw Error("orders 表十进制字段无效：" + field);
    if (!match.captured(4).isEmpty()) {
        bool valid = false;
        const int exponent = match.captured(4).toInt(&valid);
        if (!valid || std::abs(exponent) > 64)
            throw Error("orders 表十进制指数超出范围：" + field);
        const auto digits = match.captured(2) + match.captured(3);
        const int scale = int(match.captured(3).size()) - exponent;
        text = scale < 0 ? match.captured(1) + digits + QString(-scale, '0')
                         : decimal::format(digits, scale, !match.captured(1).isEmpty());
    }
    decimal::parse(text);
    return text;
}

QByteArray preserveOrderNumbers(const QByteArray &body) {
    QByteArray result;
    // Consume whole JSON strings, including escapes, so text resembling a field is untouched.
    for (qsizetype index = 0; index < body.size();) {
        if (body[index] != '"') { result.append(body[index++]); continue; }
        const qsizetype start = index++;
        while (index < body.size()) {
            const char character = body[index++];
            if (character == '\\' && index < body.size()) ++index;
            else if (character == '"') break;
        }
        const auto token = body.mid(start, index - start);
        result.append(token);
        const auto name = QJsonDocument::fromJson("[" + token + "]").array().first().toString();
        if (name != "id" && name != "activation_price" && name != "amount" && name != "value")
            continue;
        qsizetype number = index;
        while (number < body.size() && QByteArray(" \t\r\n").contains(body[number])) ++number;
        if (number == body.size() || body[number++] != ':') continue;
        while (number < body.size() && QByteArray(" \t\r\n").contains(body[number])) ++number;
        if (number == body.size() || !QByteArray("-0123456789").contains(body[number])) continue;
        qsizetype end = number;
        while (end < body.size() && QByteArray("0123456789.eE+-").contains(body[end])) ++end;
        result.append(body.mid(index, number - index));
        result.append('"');
        result.append(body.mid(number, end - number));
        result.append('"');
        index = end;
    }
    return result;
}
} // namespace

QJsonObject parseOrderRecord(const QJsonObject &record, int recordPosition) {
    const auto contract = record.value("contract").toString().trimmed();
    static const QRegularExpression contractPattern(R"(^[A-Z0-9]+_USDT$)");
    if (!contractPattern.match(contract).hasMatch()) throw Error("orders 表合约无效");
    const auto price = decimalText(record.value("activation_price"), "activation_price");
    const auto priceValue = decimal::parse(price);
    if (priceValue.negative || priceValue.digits == "0") throw Error("orders 表价格必须大于零");
    const auto amount = decimalText(record.value("amount"), "amount");
    static const QRegularExpression amountPattern(R"(^(-?\d+)(?:\.0+)?$)");
    const auto match = amountPattern.match(amount);
    bool valid = false;
    const qint64 contracts = match.captured(1).toLongLong(&valid);
    if (!match.hasMatch() || !valid || contracts == 0) throw Error("orders 表数量必须为非零整数张数");
    const auto time = record.value("timestamp");
    const auto timestamp = time.isString() ? time.toString().toLongLong(&valid) : time.toInteger(-1);
    if (time.isDouble()) valid = std::isfinite(time.toDouble()) && std::floor(time.toDouble()) == time.toDouble();
    else if (!time.isString()) valid = false;
    if (!valid || timestamp < 0 || timestamp > 9007199254740991LL)
        throw Error("orders 表缺少有效的毫秒 timestamp");
    const auto side = record.value("side");
    if (!side.isUndefined() && !side.isNull() && !side.isString()) throw Error("orders 表 side 必须为文本");
    return {{"record_position", recordPosition}, {"order_index", 0}, {"contract", contract},
            {"activation_price", price}, {"amount", amount}, {"side", side.isUndefined() ? QJsonValue(QJsonValue::Null) : side},
            {"timestamp", timestamp}};
}

QJsonArray parseSupabaseOrders(const QByteArray &body) {
    QJsonParseError error;
    const auto original = QJsonDocument::fromJson(body, &error);
    if (error.error != QJsonParseError::NoError || !original.isArray())
        throw Error("Supabase orders 响应必须为有效的对象数组");
    const auto document = QJsonDocument::fromJson(preserveOrderNumbers(body), &error);
    if (error.error != QJsonParseError::NoError || !document.isArray())
        throw Error("Supabase orders 响应无效");
    QJsonArray result;
    for (const auto &value : document.array()) {
        if (!value.isObject()) throw Error("Supabase orders 响应包含无效订单");
        auto record = value.toObject();
        const auto order = parseOrderRecord(record, int(result.size()));
        for (const QString &field : {"contract", "activation_price", "amount", "timestamp"})
            record.insert(field, order.value(field));
        result.append(record);
    }
    return result;
}

QJsonArray parseOrders(const QString &text, int recordPosition) {
    const auto &fields = orderFields();
    auto iterator = fields.front().pattern.globalMatch(text);
    QJsonArray orders;
    if (!iterator.hasNext())
        return orders;

    auto current = iterator.next();
    while (true) {
        const auto next = iterator.hasNext() ? iterator.next() : QRegularExpressionMatch{};
        const qsizetype begin = current.capturedStart();
        const qsizetype end = next.hasMatch() ? next.capturedStart() : text.size();
        const QString block = text.mid(begin, end - begin);
        QJsonObject order{{"record_position", recordPosition},
                          {"order_index", int(orders.size())}};
        for (const auto &field : fields)
            order.insert(field.name, parseField(field, block));
        orders.append(order);

        if (!next.hasMatch())
            break;
        current = next;
    }
    return orders;
}
} // namespace orders
