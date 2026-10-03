#include "infrastructure/gate_api.hpp"
#include "core/error.hpp"
#include <QCryptographicHash>
#include <QDateTime>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QMessageAuthenticationCode>
#include <cmath>

namespace orders::gate {
HttpHeaders signedGetHeaders(const QByteArray &path, const QString &key, const QString &secret) {
    return signedHeaders("GET", path, {}, key, secret);
}

HttpHeaders signedHeaders(const QByteArray &method, const QByteArray &path,
                          const QByteArray &body, const QString &key, const QString &secret) {
    const QByteArray timestamp = QByteArray::number(QDateTime::currentSecsSinceEpoch());
    const QByteArray bodyHash =
        QCryptographicHash::hash(body, QCryptographicHash::Sha512).toHex();
    const QByteArray message = method + "\n" + path + "\n\n" + bodyHash + "\n" + timestamp;
    const QByteArray signature = QMessageAuthenticationCode::hash(
        message, secret.toUtf8(), QCryptographicHash::Sha512).toHex();
    return {{"KEY", key.toUtf8()}, {"Timestamp", timestamp}, {"SIGN", signature},
            {"Accept", "application/json"}, {"Content-Type", "application/json"}};
}

QJsonArray parseTrailingOrders(const QByteArray &body) {
    QJsonParseError error;
    const auto payload = QJsonDocument::fromJson(body, &error);
    if (error.error != QJsonParseError::NoError)
        throw Error("接口返回无效 JSON：" + error.errorString());
    if (!payload.isObject())
        throw Error("订单接口返回无效响应");
    const auto object = payload.object();
    if (!object.value("code").isDouble() || object.value("code").toDouble() != 0)
        throw Error("订单接口返回业务错误");
    const auto time = object.value("timestamp");
    const auto data = object.value("data").toObject().value("orders");
    if (!time.isDouble() || !std::isfinite(time.toDouble())
        || std::floor(time.toDouble()) != time.toDouble()
        || std::abs(time.toDouble()) > 9007199254740991.0 || !data.isArray())
        throw Error("订单响应缺少有效的 data.orders 或 timestamp");
    QJsonArray rows;
    for (const auto &value : data.toArray()) {
        if (!value.isObject())
            throw Error("订单列表包含无效行");
        auto order = value.toObject();
        for (const QString &field : {"id", "contract", "amount", "activation_price"}) {
            if (!order.value(field).isString())
                throw Error("订单 ID、合约、数量和激活价格必须为字符串");
        }
        if (order.value("id").toString().isEmpty() || order.value("contract").toString().isEmpty()
            || !order.value("reduce_only").isBool()
            || !order.value("original_status").isDouble()
            || std::floor(order.value("original_status").toDouble())
                   != order.value("original_status").toDouble())
            throw Error("订单字段类型无效");
        order.insert("timestamp", time);
        rows.append(order);
    }
    return rows;
}
} // namespace orders::gate
