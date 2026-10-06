#pragma once
#include "orders_core_export.h"
#include <QByteArray>
#include <QJsonArray>
#include <QString>
#include <QStringList>
#include <QSqlDatabase>

namespace orders {
inline constexpr qint64 databaseLimitBytes = 500000000;
// Applied to every writable connection, including legacy databases with other page sizes.
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
ORDERS_CORE_EXPORT QStringList readManagedCloseOrderIds(const QString &path, const QString &owner);
ORDERS_CORE_EXPORT void saveManagedCloseOrderId(const QString &path, const QString &owner,
                                               const QString &id);
ORDERS_CORE_EXPORT QByteArray exportDatabase(const QString &path);
} // namespace orders
