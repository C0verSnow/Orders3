#include "services/fetcher.hpp"
#include "core/error.hpp"
#include "infrastructure/http_client.hpp"
#include <QCryptographicHash>
#include <QDateTime>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QMessageAuthenticationCode>
#include <QStringList>
#include <QUrlQuery>
#include <cmath>

namespace orders {
namespace {
QJsonDocument document(const QByteArray &body) {
    QJsonParseError error;
    const auto parsed = QJsonDocument::fromJson(body, &error);
    if (error.error != QJsonParseError::NoError)
        throw Error("接口返回无效 JSON：" + error.errorString());
    return parsed;
}
void success(const HttpResult &result) {
    if (result.status < 200 || result.status >= 300)
        throw Error(QString("接口返回 HTTP %1").arg(result.status));
}
} // namespace

QJsonArray fetchSources(const Config &config) {
    if (config.supabaseUrl.isEmpty() || config.supabaseKey.isEmpty())
        throw Error("请在 .env 中设置 SUPABASE_URL 和 SUPABASE_ANON_KEY");
    QString base = config.supabaseUrl;
    while (base.endsWith('/'))
        base.chop(1);
    const HttpHeaders headers{{"apikey", config.supabaseKey.toUtf8()},
                              {"Authorization", "Bearer " + config.supabaseKey.toUtf8()}};
    QJsonArray sources;
    while (true) {
        QUrl url(base + "/rest/v1/1");
        QUrlQuery query;
        query.addQueryItem("select", "*");
        query.addQueryItem("order", "created_at.asc");
        query.addQueryItem("offset", QString::number(sources.size()));
        query.addQueryItem("limit", "1000");
        url.setQuery(query);
        const auto response = get(url, headers, false, config.cancelled);
        success(response);
        const auto page = document(response.body);
        if (!page.isArray())
            throw Error("数据库响应应为对象数组");
        if (page.array().isEmpty())
            break;
        for (const auto &row : page.array()) {
            if (!row.isObject())
                throw Error("数据库响应包含无效来源");
            sources.append(row);
        }
    }
    QJsonArray results;
    for (const auto &source : sources) {
        QJsonObject result = source.toObject();
        result.insert("data", QJsonValue::Null);
        try {
            const auto response = get(QUrl(result.value("url").toString()), {}, true,
                                      config.cancelled);
            result.insert("status_code", response.status);
            success(response);
            // Accept JSON scalars as well as documents, as the previous implementation did.
            QJsonParseError error;
            const auto wrapped = QJsonDocument::fromJson("[" + response.body + "]", &error);
            result.insert("data", error.error == QJsonParseError::NoError
                                      && wrapped.isArray() && wrapped.array().size() == 1
                                  ? wrapped.array().first()
                                  : QJsonValue(QString::fromUtf8(response.body)));
        } catch (const std::exception &error) {
            result.insert("error", QString::fromUtf8(error.what()));
        }
        if (config.cancelled->load())
            throw Error("程序正在关闭");
        results.append(result);
    }
    return results;
}

QJsonArray fetchTrailingOrders(const Config &config) {
    if (config.gateKey.isEmpty() || config.gateSecret.isEmpty())
        throw Error("请在 .env 或环境变量中设置 API_KEY 和 API_SECRET");
    const QByteArray path = "/api/v4/futures/usdt/autoorder/v1/trail/list";
    const QByteArray timestamp = QByteArray::number(QDateTime::currentSecsSinceEpoch());
    const QByteArray emptyHash =
        QCryptographicHash::hash(QByteArray{}, QCryptographicHash::Sha512).toHex();
    const QByteArray message = "GET\n" + path + "\n\n" + emptyHash + "\n" + timestamp;
    const QByteArray signature = QMessageAuthenticationCode::hash(
        message, config.gateSecret.toUtf8(), QCryptographicHash::Sha512).toHex();
    const auto response = get(QUrl("https://api.gateio.ws" + QString::fromUtf8(path)),
                              {{"KEY", config.gateKey.toUtf8()}, {"Timestamp", timestamp},
                               {"SIGN", signature}, {"Accept", "application/json"}}, false,
                              config.cancelled);
    success(response);
    const auto payload = document(response.body);
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
} // namespace orders
