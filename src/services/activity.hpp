#pragma once
#include "orders_core_export.h"
#include "infrastructure/http_client.hpp"
#include <QJsonArray>
#include <QJsonObject>
#include <mutex>

namespace orders {
// In-memory telemetry has its own lock; status reads never wait for network or SQLite.
class ORDERS_CORE_EXPORT Activity {
public:
    void begin(const QString &job);
    void finish(const QString &job, bool success);
    HttpObserver observer(const QString &job);
    QJsonObject snapshot() const;
private:
    void append(QJsonObject event);
    mutable std::mutex mutex_;
    QJsonObject jobs_;
    QJsonObject requests_;
    QJsonArray events_;
    qint64 sequence_ = 0;
};
} // namespace orders
