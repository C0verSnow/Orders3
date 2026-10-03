#pragma once
#include "infrastructure/http_client.hpp"
#include <QJsonArray>
#include <QString>

namespace orders::gate {
// Only transport helpers; refresh state and persistence belong to services.
ORDERS_CORE_EXPORT HttpHeaders signedHeaders(const QByteArray &method, const QByteArray &path,
    const QByteArray &body, const QString &key, const QString &secret);
HttpHeaders signedGetHeaders(const QByteArray &path, const QString &key, const QString &secret);
QJsonArray parseTrailingOrders(const QByteArray &body);
} // namespace orders::gate
