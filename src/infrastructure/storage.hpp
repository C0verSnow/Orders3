#pragma once
#include "orders_core_export.h"
#include <QByteArray>
#include <QJsonArray>
#include <QString>

namespace orders {
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
ORDERS_CORE_EXPORT QByteArray exportDatabase(const QString &path);
} // namespace orders
