#pragma once
#include "orders_core_export.h"
#include <QByteArray>
#include <QJsonArray>
#include <QString>
#include <QStringList>
#include <QSqlDatabase>

namespace orders {
inline constexpr qint64 databaseLimitBytes = 450000000;
// Shared by SQLite main files in the same data directory; temporary files are separate.
ORDERS_CORE_EXPORT void enforceDatabaseSizeLimit(QSqlDatabase &db,
                                                 qint64 maximumBytes = databaseLimitBytes);
struct SourceSnapshot {
    QJsonArray items;
    QJsonArray orders;
    QString updatedAt;
};
struct TrailingSnapshot {
    QJsonArray orders;
    QString updatedAt;
};
ORDERS_CORE_EXPORT SourceSnapshot readSources(const QString &path);
ORDERS_CORE_EXPORT TrailingSnapshot readTrailingOrders(const QString &path);
ORDERS_CORE_EXPORT void saveSources(const QString &path, const QJsonArray &items);
ORDERS_CORE_EXPORT void saveTrailingOrders(const QString &path, const QJsonArray &orders);
ORDERS_CORE_EXPORT QJsonArray readPositions(const QString &path);
ORDERS_CORE_EXPORT void savePositions(const QString &path, const QJsonArray &positions);
// Entry times and sync watermark are UTC milliseconds. Only confirmed opening fills belong here.
ORDERS_CORE_EXPORT qint64 entryHistoryWatermark(const QString &path, const QString &owner);
ORDERS_CORE_EXPORT void saveEntryHistory(const QString &path, const QString &owner,
                                         const QJsonArray &events, qint64 throughMs);
ORDERS_CORE_EXPORT bool hasRecentEntry(const QString &path, const QString &contract,
                                       int side, qint64 nowMs);
ORDERS_CORE_EXPORT QByteArray exportDatabase(const QString &path);
} // namespace orders
