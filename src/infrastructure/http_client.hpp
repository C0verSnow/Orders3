#pragma once
#include "orders_core_export.h"
#include <QByteArray>
#include <QList>
#include <QPair>
#include <QUrl>
#include <atomic>
#include <memory>

namespace orders {
struct HttpResult {
    int status = 0;
    QByteArray body;
};
using HttpHeaders = QList<QPair<QByteArray, QByteArray>>;

// Each worker owns its network manager; credentials never follow redirects.
ORDERS_CORE_EXPORT HttpResult get(const QUrl &url, const HttpHeaders &headers = {}, bool redirects = true,
               const std::shared_ptr<std::atomic<bool>> &cancelled = {});
} // namespace orders
