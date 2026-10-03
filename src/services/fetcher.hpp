#pragma once
#include "core/config.hpp"
#include <QJsonArray>

namespace orders {
QJsonArray fetchSources(const Config &config);
QJsonArray fetchTrailingOrders(const Config &config);
} // namespace orders
