#pragma once
#include "orders_core_export.h"
#include "core/config.hpp"
#include <QJsonObject>
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
    const Config &config() const { return config_; }
    bool sourcesBusy() const { return sourcesBusy_; }

private:
    Config config_;
    std::atomic<bool> sourcesBusy_{false};
    std::atomic<bool> ordersBusy_{false};
    mutable std::mutex sourceMutex_;
    mutable std::mutex ordersMutex_;
    QString sourceError_;
    QString ordersError_;
};
} // namespace orders
