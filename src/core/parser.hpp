#pragma once
#include "orders_core_export.h"
#include <QJsonArray>
#include <QString>

namespace orders {
ORDERS_CORE_EXPORT QJsonArray parseOrders(const QString &text, int recordPosition);
} // namespace orders
