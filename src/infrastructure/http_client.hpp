#pragma once
#include "orders_core_export.h"
#include <QByteArray>
#include <QList>
#include <QPair>
#include <QUrl>
#include <atomic>
#include <memory>
#include <functional>

namespace orders {
struct HttpResult {
    int status = 0;
    QByteArray body;
};
using HttpHeaders = QList<QPair<QByteArray, QByteArray>>;

// Scoped to the worker thread. Never expose headers, query strings or response bodies.
using HttpObserver = std::function<void(const QUrl &, bool, bool, int)>;
class ORDERS_CORE_EXPORT ScopedHttpObserver {
public:
    explicit ScopedHttpObserver(HttpObserver observer);
    ~ScopedHttpObserver();
    ScopedHttpObserver(const ScopedHttpObserver &) = delete;
    ScopedHttpObserver &operator=(const ScopedHttpObserver &) = delete;
private:
    HttpObserver previous_;
};

// Each worker owns its network manager; credentials never follow redirects.
ORDERS_CORE_EXPORT HttpResult get(const QUrl &url, const HttpHeaders &headers = {}, bool redirects = true,
               const std::shared_ptr<std::atomic<bool>> &cancelled = {});
ORDERS_CORE_EXPORT HttpResult post(const QUrl &url, const QByteArray &body,
               const HttpHeaders &headers = {},
               const std::shared_ptr<std::atomic<bool>> &cancelled = {});
} // namespace orders
