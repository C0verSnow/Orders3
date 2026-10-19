#pragma once
#include "infrastructure/http_client.hpp"
#include <QJsonArray>
#include <QString>

namespace orders::gate {
// Only transport helpers; refresh state and persistence belong to services.
// path may include an already encoded query; it is signed separately from the URL path.
ORDERS_CORE_EXPORT HttpHeaders signedHeaders(const QByteArray &method, const QByteArray &path,
    const QByteArray &body, const QString &key, const QString &secret, qint64 timestampSeconds = -1);
// Report authentication categories without reflecting response messages or credentials.
ORDERS_CORE_EXPORT void ensureSuccess(const HttpResult &response);
HttpHeaders signedGetHeaders(const QByteArray &path, const QString &key, const QString &secret);
QJsonArray parseTrailingOrders(const QByteArray &body);
} // namespace orders::gate
