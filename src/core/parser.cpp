#include "core/parser.hpp"
#include <QJsonObject>
#include <QRegularExpression>
#include <QStringList>

namespace orders {
QJsonArray parseOrders(const QString &text, int recordPosition) {
    const auto flags = QRegularExpression::CaseInsensitiveOption;
    const QRegularExpression start("\\bSymbol\\s*:\\s*([^\\r\\n]+)", flags);
    QList<QRegularExpressionMatch> matches;
    auto iterator = start.globalMatch(text);
    while (iterator.hasNext())
        matches.append(iterator.next());
    QJsonArray orders;
    const QStringList names{"symbol", "price", "side", "size", "value", "orders_time"};
    const QStringList labels{"Symbol", "Price", "Side", "Size", "Value", "Orders Times"};
    for (qsizetype index = 0; index < matches.size(); ++index) {
        const qsizetype begin = matches[index].capturedStart();
        const qsizetype end = index + 1 < matches.size() ? matches[index + 1].capturedStart()
                                                       : text.size();
        const QString block = text.mid(begin, end - begin);
        QJsonObject order{{"record_position", recordPosition}, {"order_index", int(index)}};
        for (qsizetype field = 0; field < names.size(); ++field) {
            const auto found = QRegularExpression(
                "\\b" + labels[field] + "\\s*:\\s*([^\\r\\n]+)", flags).match(block);
            order.insert(names[field], found.hasMatch() ? QJsonValue(found.captured(1).trimmed())
                                                       : QJsonValue(QJsonValue::Null));
        }
        orders.append(order);
    }
    return orders;
}
} // namespace orders
