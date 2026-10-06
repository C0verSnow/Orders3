#pragma once

#include "orders_core_export.h"
#include <QByteArray>
#include <QJsonArray>
#include <QJsonObject>
#include <QString>

namespace orders {
// Preserve textual amounts and prices; missing fields and invalid timestamps become null.
ORDERS_CORE_EXPORT QJsonArray parseOrders(const QString &text, int recordPosition);
// Direct Supabase rows; validate the full page and preserve numeric JSON literals as text.
ORDERS_CORE_EXPORT QJsonArray parseSupabaseOrders(const QByteArray &body);
ORDERS_CORE_EXPORT QJsonObject parseOrderRecord(const QJsonObject &record, int recordPosition);
} // namespace orders
