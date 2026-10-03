#pragma once
#include "infrastructure/http_client.hpp"
#include <QJsonArray>
#include <QString>

namespace orders::gate {
// Only transport helpers; refresh state and persistence belong to services.
HttpHeaders signedGetHeaders(const QByteArray &path, const QString &key, const QString &secret);
QJsonArray parseTrailingOrders(const QByteArray &body);
} // namespace orders::gate
