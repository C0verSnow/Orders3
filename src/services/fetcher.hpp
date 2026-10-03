#pragma once
#include "orders_core_export.h"
#include "core/config.hpp"
#include <QJsonArray>

namespace orders {
ORDERS_CORE_EXPORT QJsonArray fetchSources(const Config &config);
ORDERS_CORE_EXPORT QJsonArray fetchTrailingOrders(const Config &config);
} // namespace orders
