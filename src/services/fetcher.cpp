#include "services/fetcher.hpp"
#include "core/error.hpp"
#include "infrastructure/http_client.hpp"
#include "infrastructure/gate_api.hpp"
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QStringList>
#include <QRegularExpression>
#include <QUrlQuery>

namespace orders {
namespace {
QJsonDocument parseJsonDocument(const QByteArray &body) {
    QJsonParseError error;
    const auto parsed = QJsonDocument::fromJson(body, &error);
    if (error.error != QJsonParseError::NoError)
        throw Error("接口返回无效 JSON：" + error.errorString());
    return parsed;
}
void ensureHttpSuccess(const HttpResult &result) {
    if (result.status < 200 || result.status >= 300)
        throw Error(QString("接口返回 HTTP %1").arg(result.status));
}
} // namespace

QJsonArray parseOrders(const QString &text, int recordPosition) {
    const auto flags = QRegularExpression::CaseInsensitiveOption;
    const QRegularExpression start("\\b(?:contract|Symbol)[ \\t]*:[ \\t]*([^\\r\\n]+)", flags);
    QList<QRegularExpressionMatch> matches;
    auto iterator = start.globalMatch(text);
    while (iterator.hasNext())
        matches.append(iterator.next());
    QJsonArray orders;
    const QStringList names{"contract", "activation_price", "side", "amount", "timestamp"};
    const QStringList labels{"(?:contract|Symbol)", "(?:activation_price|Price)", "Side",
                             "(?:amount|Size)", "(?:Timestamp|Orders Times)"};
    for (qsizetype index = 0; index < matches.size(); ++index) {
        const qsizetype begin = matches[index].capturedStart();
        const qsizetype end = index + 1 < matches.size() ? matches[index + 1].capturedStart()
                                                       : text.size();
        const QString block = text.mid(begin, end - begin);
        QJsonObject order{{"record_position", recordPosition}, {"order_index", int(index)}};
        for (qsizetype field = 0; field < names.size(); ++field) {
            const auto found = QRegularExpression(
                "\\b" + labels[field] + "[ \\t]*:[ \\t]*([^\\r\\n]+)", flags).match(block);
            QJsonValue value(QJsonValue::Null);
            if (found.hasMatch()) {
                const QString text = found.captured(1).trimmed();
                if (names[field] == "timestamp") {
                    bool valid = false;
                    const qint64 timestamp = text.toLongLong(&valid);
                    if (valid)
                        value = QJsonValue(timestamp);
                } else {
                    value = text;
                }
            }
            order.insert(names[field], value);
        }
        orders.append(order);
    }
    return orders;
}

QJsonArray fetchSources(const Config &config) {
    if (config.supabaseUrl.isEmpty() || config.supabaseKey.isEmpty())
        throw Error("请在程序的「连接与存储配置」中填写 Supabase 地址和密钥");
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
        ensureHttpSuccess(response);
        const auto page = parseJsonDocument(response.body);
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
            ensureHttpSuccess(response);
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
        throw Error("请在程序的「连接与存储配置」中填写 Gate API Key 和 Secret");
    const QByteArray path = "/api/v4/futures/usdt/autoorder/v1/trail/list";
    const auto response = get(QUrl("https://api.gateio.ws" + QString::fromUtf8(path)),
                              gate::signedGetHeaders(path, config.gateKey, config.gateSecret),
                              false, config.cancelled);
    ensureHttpSuccess(response);
    return gate::parseTrailingOrders(response.body);
}
} // namespace orders
