#include "core/order_parser.hpp"

#include <QJsonObject>
#include <QRegularExpression>
#include <array>

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
