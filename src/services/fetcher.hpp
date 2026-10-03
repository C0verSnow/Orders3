#pragma once

#include "core/config.hpp"
#include "core/order_parser.hpp" // Keep existing callers source-compatible.
#include "orders_core_export.h"
#include "infrastructure/http_client.hpp"
#include <QJsonArray>
#include <functional>

namespace orders {
// One-shot fetches. Scheduling and persistence belong to their respective services.
ORDERS_CORE_EXPORT QJsonArray fetchSources(const Config &config);
ORDERS_CORE_EXPORT QJsonArray fetchTrailingOrders(const Config &config);
// The optional sender allows offline verification without contacting an exchange.
using TrailingOrderSender = std::function<HttpResult(const QByteArray &, const QByteArray &,
                                                    const HttpHeaders &)>;
ORDERS_CORE_EXPORT QJsonArray createTrailingOrders(const Config &config,
                                                   const TrailingOrderSender &sender = {});
ORDERS_CORE_EXPORT QJsonArray createTrailingOrders();
using ClosePositionRequester = std::function<HttpResult(const QByteArray &, const QByteArray &,
                                                       const QByteArray &, const HttpHeaders &)>;
ORDERS_CORE_EXPORT QJsonArray closePositionOrders(const Config &config,
                                                 const ClosePositionRequester &requester = {});
ORDERS_CORE_EXPORT QJsonArray closePositionOrders();
} // namespace orders
