#pragma once

#include "orders_core_export.h"
#include <QJsonArray>
#include <QString>

namespace orders {
// Preserve textual amounts and prices; missing fields and invalid timestamps become null.
ORDERS_CORE_EXPORT QJsonArray parseOrders(const QString &text, int recordPosition);
} // namespace orders
