#pragma once
#include "orders_core_export.h"
#include "core/config.hpp"
#include <QJsonObject>
#include <QJsonArray>
#include <atomic>
#include <mutex>

namespace orders {
struct RefreshResult {
    bool accepted = false;
    bool success = false;
};

// Source and Gate refreshes have separate exclusion locks; SQL access is serialized per file.
class ORDERS_CORE_EXPORT Dashboard {
public:
    explicit Dashboard(Config config);
    RefreshResult refreshSources();
    RefreshResult refreshOrders();
    QJsonObject sourceSnapshot() const;
    QJsonObject ordersSnapshot() const;
    QByteArray download() const;
    Config config() const;
    QJsonObject environmentSnapshot() const;
    QJsonObject configureEnvironment(const QJsonObject &payload);
    bool sourcesBusy() const { return sourcesBusy_; }

private:
    Config config_;
    mutable std::mutex configMutex_;
    std::atomic<bool> sourcesBusy_{false};
    std::atomic<bool> ordersBusy_{false};
    mutable std::mutex sourceMutex_;
    mutable std::mutex ordersMutex_;
    // Serialize polling and trading while snapshots remain readable during network I/O.
    std::mutex gateMutex_;
    QJsonArray executionResults_;
    QString sourcePhase_;
    QString sourceError_;
    QString ordersError_;
};
} // namespace orders
