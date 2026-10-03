#pragma once
#include <QString>
#include <atomic>
#include <memory>

namespace orders {
struct ScheduleConfig {
    bool enabled = true;
    QString cron = QStringLiteral("*/15 * * * *");
};

struct Config {
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

QString validateOutput(const QString &path);
ScheduleConfig loadSchedule(const QString &path);
void saveSchedule(const QString &path, const ScheduleConfig &config);
} // namespace orders
