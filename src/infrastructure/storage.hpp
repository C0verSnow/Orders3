#pragma once
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
SourceSnapshot readSources(const QString &path);
TrailingSnapshot readTrailingOrders(const QString &path);
void saveSources(const QString &path, const QJsonArray &items);
void saveTrailingOrders(const QString &path, const QJsonArray &orders);
QByteArray exportDatabase(const QString &path);
} // namespace orders
