#pragma once
#include <QJsonArray>
#include <QString>

namespace orders {
QJsonArray parseOrders(const QString &text, int recordPosition);
} // namespace orders
