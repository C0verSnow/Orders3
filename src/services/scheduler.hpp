#pragma once
#include "orders_core_export.h"
#include "core/config.hpp"
#include "services/dashboard.hpp"
#include <QDateTime>
#include <QFuture>
#include <QJsonObject>
#include <QObject>
#include <QTimer>
#include <mutex>

namespace orders {
class ORDERS_CORE_EXPORT Scheduler : public QObject {
public:
    Scheduler(Dashboard &dashboard, ScheduleConfig config, QString path);
    ~Scheduler() override;
    QJsonObject snapshot() const;
    QJsonObject configure(const QJsonObject &payload);
    void start();
    void stop();

private:
    void runDue();
    Dashboard &dashboard_;
    QString path_;
    ScheduleConfig config_;
    QDateTime next_;
    QDateTime last_;
    QString result_;
    quint64 generation_ = 0;
    mutable std::mutex mutex_;
    QTimer timer_;
    QFuture<void> task_;
};
} // namespace orders
