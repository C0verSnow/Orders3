#pragma once
#include "orders_core_export.h"
#include <QString>
#include <atomic>
#include <memory>

namespace orders {
struct ScheduleConfig {
    bool enabled = true;
    QString cron = QStringLiteral("*/15 * * * *");
};

struct ORDERS_CORE_EXPORT Config {
    std::shared_ptr<std::atomic<bool>> cancelled = std::make_shared<std::atomic<bool>>(false);
    QString dataPath;
    QString ordersPath;
    QString schedulePath;
    QString supabaseUrl;
    QString supabaseKey;
    QString gateKey;
    QString gateSecret;
    QString allowedOrigin;
    static Config load();
};

ORDERS_CORE_EXPORT QString validateOutput(const QString &path);
ORDERS_CORE_EXPORT ScheduleConfig loadSchedule(const QString &path);
ORDERS_CORE_EXPORT void saveSchedule(const QString &path, const ScheduleConfig &config);
} // namespace orders
