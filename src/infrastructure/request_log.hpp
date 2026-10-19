#pragma once
#include "orders_core_export.h"
#include <QUrl>
#include <QString>

namespace orders {
inline constexpr qint64 requestLogLimitBytes = 50000000;
// Configure once before starting workers. Only request metadata is accepted.
ORDERS_CORE_EXPORT void configureRequestLog(const QString &directory);
ORDERS_CORE_EXPORT void logRequest(const QString &direction, const QString &method,
                                   const QUrl &url, int status, qint64 elapsedMs = -1);
} // namespace orders
