#pragma once
#include "orders_core_export.h"
#include <QString>
#include <QJsonObject>
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
    // In-memory fallback; never persisted in environment or exposed by settings.
    QString infisicalGateKey;
    QString infisicalGateSecret;
    // Startup-only machine authentication; excluded from persisted/web settings.
    QString infisicalUrl = QStringLiteral("https://app.infisical.com");
    QString infisicalClientId;
    QString infisicalClientSecret;
    QString infisicalProjectId;
    QString infisicalEnvironment = QStringLiteral("prod");
    QString infisicalSecretPath = QStringLiteral("/");
    QString allowedOrigin;
    QJsonObject environment;
    // Shared by startup and live settings updates on every platform.
    void applyConnectionSettings();
    static Config load();
};

// Empty means missing or malformed; this does not authenticate with Gate.
ORDERS_CORE_EXPORT QString normalizeGateCredential(QString value);
ORDERS_CORE_EXPORT QString validateOutput(const QString &path);
ORDERS_CORE_EXPORT ScheduleConfig loadSchedule(const QString &path);
ORDERS_CORE_EXPORT void saveSchedule(const QString &path, const ScheduleConfig &config);
ORDERS_CORE_EXPORT QJsonObject loadEnvironmentSettings(const QString &path);
ORDERS_CORE_EXPORT void saveEnvironmentSettings(const QString &path, const QJsonObject &settings);
} // namespace orders
