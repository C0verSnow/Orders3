#pragma once
#include "orders_core_export.h"
#include "core/config.hpp"
#include <QJsonArray>
#include <QString>

namespace orders {
ORDERS_CORE_EXPORT QJsonArray parseOrders(const QString &text, int recordPosition);
ORDERS_CORE_EXPORT QJsonArray fetchSources(const Config &config);
ORDERS_CORE_EXPORT QJsonArray fetchTrailingOrders(const Config &config);
} // namespace orders
