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
                          const QByteArray &body, const QString &key, const QString &secret,
                          qint64 timestampSeconds) {
    const QByteArray timestamp = QByteArray::number(
        timestampSeconds < 0 ? QDateTime::currentSecsSinceEpoch() : timestampSeconds);
    const QByteArray bodyHash =
        QCryptographicHash::hash(body, QCryptographicHash::Sha512).toHex();
    const auto separator = path.indexOf('?');
    const auto requestPath = separator < 0 ? path : path.left(separator);
    const auto query = separator < 0 ? QByteArray{} : path.mid(separator + 1);
    const QByteArray message = method + "\n" + requestPath + "\n" + query + "\n"
        + bodyHash + "\n" + timestamp;
    const QByteArray signature = QMessageAuthenticationCode::hash(
        message, secret.toUtf8(), QCryptographicHash::Sha512).toHex();
    return {{"KEY", key.toUtf8()}, {"Timestamp", timestamp}, {"SIGN", signature},
            {"Accept", "application/json"}, {"Content-Type", "application/json"}};
}

void ensureSuccess(const HttpResult &response) {
    if (response.status >= 200 && response.status < 300)
        return;
    QString message = QString("Gate 接口返回 HTTP %1").arg(response.status);
    const auto object = QJsonDocument::fromJson(response.body).object();
    const QString label = object.value("label").toString();
    QString hint;
    if (label == "IP_FORBIDDEN")
        hint = "当前出口 IP 不在 Gate API 白名单；请检查 Linux/Docker 宿主机或代理的公网出口 IP";
    else if (label == "REQUEST_EXPIRED")
        hint = "请求时间与 Gate 相差超过 60 秒；请同步宿主机系统时间，容器共用宿主机时钟";
    else if (label == "INVALID_SIGNATURE")
        hint = "签名不匹配；请检查 API Key 与 Secret 是否为同一组，并重新保存 Secret";
    else if (label == "INVALID_KEY" || label == "INVALID_CREDENTIALS")
        hint = "密钥无效；请检查 API Key 与 Secret 是否为有效的同一组 Gate APIv4 密钥";
    else if (label == "READ_ONLY")
        hint = "当前密钥仅有读取权限；下单需要 Gate 合约交易写入权限";
    else if (label == "FORBIDDEN" || label == "ACCOUNT_LOCKED")
        hint = "账户或 API 权限受限；请检查账户状态与合约交易权限";
    else if (label == "MISSING_REQUIRED_HEADER")
        hint = "缺少认证请求头；请检查代理是否保留 KEY、Timestamp 和 SIGN 请求头";
    if (!hint.isEmpty())
        message += "（" + label + "）：" + hint;
    else if (response.status == 401 || response.status == 403)
        message += "：认证被拒绝；请检查密钥配对、合约权限、出口 IP 白名单和宿主机时间";
    // Do not include arbitrary upstream bodies/messages: they may echo a key or request.
    throw Error(message);
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
