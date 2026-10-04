#include "services/fetcher.hpp"

#include "core/error.hpp"
#include "core/decimal.hpp"
#include "infrastructure/gate_api.hpp"
#include "infrastructure/http_client.hpp"
#include "infrastructure/storage.hpp"
#include <QDateTime>
#include <QCryptographicHash>
#include <QRegularExpression>
#include <QSet>
#include <algorithm>
#include <cmath>
#include <limits>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QUrlQuery>

namespace orders {
namespace {
constexpr int kSourcePageSize = 1000;
const QString kSourcePath = QStringLiteral("/rest/v1/1");
const QString kGateHost = QStringLiteral("https://api.gateio.ws");
const QByteArray kTrailingOrdersPath = "/api/v4/futures/usdt/autoorder/v1/trail/list";

void ensureNotCancelled(const Config &config) {
    if (config.cancelled && config.cancelled->load())
        throw Error("程序正在关闭");
}

void ensureHttpSuccess(const HttpResult &result) {
    if (result.status < 200 || result.status >= 300)
        throw Error(QString("接口返回 HTTP %1").arg(result.status));
}

QJsonArray parseSourcePage(const QByteArray &body) {
    QJsonParseError error;
    const auto document = QJsonDocument::fromJson(body, &error);
    if (error.error != QJsonParseError::NoError)
        throw Error("接口返回无效 JSON：" + error.errorString());
    if (!document.isArray())
        throw Error("数据库响应应为对象数组");

    const auto page = document.array();
    for (const auto &row : page) {
        if (!row.isObject())
            throw Error("数据库响应包含无效来源");
    }
    return page;
}

QJsonValue parseSourceContent(const QByteArray &body) {
    // Wrapping accepts JSON scalars as well as objects and arrays.
    QJsonParseError error;
    const auto document = QJsonDocument::fromJson("[" + body + "]", &error);
    if (error.error == QJsonParseError::NoError && document.isArray()) {
        const auto values = document.array();
        if (values.size() == 1)
            return values.first();
    }
    return QString::fromUtf8(body);
}

QUrl sourcePageUrl(const QString &base, qsizetype offset) {
    QUrl url(base + kSourcePath);
    QUrlQuery query;
    query.addQueryItem("select", "*");
    query.addQueryItem("order", "created_at.asc");
    query.addQueryItem("offset", QString::number(offset));
    query.addQueryItem("limit", QString::number(kSourcePageSize));
    url.setQuery(query);
    return url;
}

QJsonArray fetchSourceRecords(const Config &config) {
    QString base = config.supabaseUrl;
    while (base.endsWith('/'))
        base.chop(1);
    const QByteArray key = config.supabaseKey.toUtf8();
    const HttpHeaders headers{{"apikey", key}, {"Authorization", "Bearer " + key}};

    QJsonArray sources;
    while (true) {
        ensureNotCancelled(config);
        const auto response = get(sourcePageUrl(base, sources.size()), headers, false,
                                  config.cancelled);
        ensureHttpSuccess(response);
        const auto page = parseSourcePage(response.body);
        // A server may cap pages below our limit; only an empty page ends pagination.
        if (page.isEmpty())
            return sources;
        for (const auto &row : page)
            sources.append(row);
    }
}

QJsonObject fetchSourceContent(QJsonObject source, const Config &config) {
    ensureNotCancelled(config);
    // Fetch metadata describes this attempt, even if the input has stale metadata.
    source.remove("error");
    source.remove("status_code");
    source.insert("data", QJsonValue::Null);
    try {
        // Supabase credentials must never be forwarded to a source URL.
        const auto response = get(QUrl(source.value("url").toString()), {}, true,
                                  config.cancelled);
        source.insert("status_code", response.status);
        ensureHttpSuccess(response);
        source.insert("data", parseSourceContent(response.body));
    } catch (const std::exception &error) {
        source.insert("error", QString::fromUtf8(error.what()));
    }
    // Cancellation aborts the batch rather than becoming an individual source error.
    ensureNotCancelled(config);
    return source;
}
} // namespace

QJsonArray fetchSources(const Config &config) {
    ensureNotCancelled(config);
    if (config.supabaseUrl.isEmpty() || config.supabaseKey.isEmpty())
        throw Error("请在程序的「连接与存储配置」中填写 Supabase 地址和密钥");

    const auto sources = fetchSourceRecords(config);
    QJsonArray results;
    for (const auto &source : sources)
        results.append(fetchSourceContent(source.toObject(), config));
    ensureNotCancelled(config);
    return results;
}

QJsonArray fetchTrailingOrders(const Config &config) {
    // Scheduler runs this one-shot operation independently every minute.
    ensureNotCancelled(config);
    if (config.gateKey.isEmpty() || config.gateSecret.isEmpty())
        throw Error("请在程序的「连接与存储配置」中填写 Gate API Key 和 Secret");

    const auto headers = gate::signedGetHeaders(kTrailingOrdersPath, config.gateKey,
                                               config.gateSecret);
    const auto response = get(QUrl(kGateHost + QString::fromUtf8(kTrailingOrdersPath)),
                              headers, false, config.cancelled);
    ensureHttpSuccess(response);
    const auto orders = gate::parseTrailingOrders(response.body);
    ensureNotCancelled(config);
    return orders;
}


namespace {
const QByteArray kCreatePath = "/api/v4/futures/usdt/autoorder/v1/trail/create";
const QByteArray kStopPath = "/api/v4/futures/usdt/autoorder/v1/trail/stop";
constexpr qint64 kSevenDaysMs = 7LL * 24 * 60 * 60 * 1000;

QString orderAmount(const QJsonValue &value) {
    static const QRegularExpression pattern(
        R"(^([+-]?\d+)(?:\.0+)?(?:\s+contracts?)?$)",
        QRegularExpression::CaseInsensitiveOption);
    const auto match = pattern.match(value.toString().trimmed());
    bool ok = false;
    const auto amount = match.captured(1).toLongLong(&ok);
    if (!match.hasMatch() || !ok || amount == 0)
        throw Error("订单数量必须为非零整数张，例如 371 Contracts 或 -371 Contracts");
    return QString::number(amount);
}

QString orderPrice(const QJsonValue &value) {
    static const QRegularExpression pattern(R"(^(\d+(?:\.\d+)?)(?:\s+USDT)?$)",
                                            QRegularExpression::CaseInsensitiveOption);
    const auto match = pattern.match(value.toString().trimmed());
    if (!match.hasMatch())
        throw Error("激活价格无效，例如 4071.29 USDT");
    return match.captured(1);
}

bool sameOrderParameters(const QJsonObject &old, const QJsonObject &desired) {
    if (old.value("contract") != desired.value("contract")
        || orderAmount(old.value("amount")) != desired.value("amount").toString())
        return false;
    // Signed amount already distinguishes long/short; compare prices without doubles.
    const auto left = decimal::parse(orderPrice(old.value("activation_price")));
    const auto right = decimal::parse(desired.value("activation_price").toString());
    const int scale = std::max(left.scale, right.scale);
    return decimal::scaled(left, scale) == decimal::scaled(right, scale);
}

qint64 orderTimestamp(const QJsonValue &value) {
    const double time = value.toDouble(-1);
    if (!value.isDouble() || !std::isfinite(time) || time < 0
        || time > 9007199254740991.0 || std::floor(time) != time)
        throw Error("订单缺少有效的毫秒 timestamp，无法判断是否重复");
    return value.toInteger();
}

QJsonObject successfulResponse(const HttpResult &response) {
    ensureHttpSuccess(response);
    QJsonParseError error;
    const auto document = QJsonDocument::fromJson(response.body, &error);
    if (error.error != QJsonParseError::NoError || !document.isObject())
        throw Error("交易接口返回无效 JSON");
    const auto object = document.object();
    if (!object.value("code").isDouble() || object.value("code").toDouble() != 0)
        throw Error("交易接口失败：" + object.value("message").toString("未知错误"));
    return object;
}
} // namespace

QJsonArray createTrailingOrders(const Config &config, const TrailingOrderSender &sender) {
    ensureNotCancelled(config);
    const auto sources = readSources(config.dataPath).orders;
    auto trailing = readTrailingOrders(config.ordersPath).orders;
    QJsonArray results;
    QJsonArray candidates;
    QSet<qsizetype> retained;
    // Validate the entire batch before stopping any existing order.
    for (const auto &value : sources) {
        const auto source = value.toObject();
        const auto contract = source.value("contract").toString().trimmed();
        static const QRegularExpression contractPattern(R"(^[A-Z0-9]+_USDT$)");
        if (!contractPattern.match(contract).hasMatch())
            throw Error("订单合约无效：" + contract);
        const auto amount = orderAmount(source.value("amount"));
        const auto price = orderPrice(source.value("activation_price"));
        const auto timestamp = orderTimestamp(source.value("timestamp"));
        bool duplicate = false;
        for (const auto &previous : trailing) {
            const auto old = previous.toObject();
            if (old.value("contract").toString() != contract
                || old.value("reduce_only").toBool()
                || old.value("original_status").toInt() != 4)
                continue;
            const auto oldAmount = orderAmount(old.value("amount"));
            const auto oldTime = orderTimestamp(old.value("timestamp"));
            if (amount.startsWith('-') == oldAmount.startsWith('-')
                && std::abs(timestamp - oldTime) < kSevenDaysMs) {
                duplicate = true;
                break;
            }
        }
        QJsonObject entry{{"contract", contract}, {"amount", amount},
                          {"activation_price", price}, {"timestamp", timestamp},
                          {"record_position", source.value("record_position")},
                          {"order_index", source.value("order_index")}};
        if (duplicate) {
            entry.insert("action", "skipped");
            entry.insert("message", "同合约、同方向已完成订单的时间相差不到7天");
            results.append(entry);
        } else {
            bool unchanged = false;
            for (qsizetype index = 0; index < trailing.size(); ++index) {
                const auto old = trailing[index].toObject();
                const int status = old.value("original_status").toInt();
                if (retained.contains(index) || old.value("reduce_only").toBool()
                    || (status != 1 && status != 2) || !sameOrderParameters(old, entry))
                    continue;
                retained.insert(index);
                entry.insert("id", old.value("id"));
                entry.insert("action", "skipped");
                entry.insert("message", "合约、方向、数量和激活价格未变化，保留有效开仓单");
                results.append(entry);
                unchanged = true;
                break;
            }
            if (!unchanged) candidates.append(entry);
        }
    }
    if (candidates.isEmpty() && retained.isEmpty())
        return results;
    if (config.gateKey.isEmpty() || config.gateSecret.isEmpty())
        throw Error("请在程序的「连接与存储配置」中填写 Gate API Key 和 Secret");
    const auto send = [&](const QByteArray &path, const QJsonObject &payload) {
        ensureNotCancelled(config);
        const auto body = QJsonDocument(payload).toJson(QJsonDocument::Compact);
        const auto headers = gate::signedHeaders("POST", path, body,
                                                 config.gateKey, config.gateSecret);
        const auto response = sender ? sender(path, body, headers)
            : post(QUrl(kGateHost + QString::fromUtf8(path)), body, headers, config.cancelled);
        const auto result = successfulResponse(response);
        // The caller records each acknowledged write before sending the next request.
        return result;
    };
    for (qsizetype index = 0; index < trailing.size(); ++index) {
        auto old = trailing[index].toObject();
        const int status = old.value("original_status").toInt();
        if (retained.contains(index) || old.value("reduce_only").toBool()
            || (status != 1 && status != 2))
            continue;
        QJsonObject result{{"action", "stopped"}, {"id", old.value("id")},
                           {"contract", old.value("contract")}};
        try {
            // Keep IDs as decimal integers in the body, without a floating-point conversion.
            bool valid = false;
            const qint64 id = old.value("id").toString().toLongLong(&valid);
            if (!valid || id <= 0)
                throw Error("旧订单 ID 无效");
            send(kStopPath, {{"id", id}});
            old.insert("original_status", 5);
            old.insert("timestamp", QDateTime::currentMSecsSinceEpoch());
            trailing[index] = old;
            saveTrailingOrders(config.ordersPath, trailing);
            results.append(result);
        } catch (const std::exception &error) {
            result.insert("action", "failed");
            result.insert("operation", "stop");
            result.insert("error", QString::fromUtf8(error.what()));
            results.append(result);
            return results; // No new orders if any old order failed to stop.
        }
    }
    for (const auto &value : candidates) {
        auto result = value.toObject();
        const auto amount = result.value("amount").toString();
        const QJsonObject body{{"contract", result.value("contract")}, {"amount", amount},
            {"activation_price", result.value("activation_price")},
            {"is_gte", amount.startsWith('-')}, {"reduce_only", false},
            {"price_type", 3}, {"price_offset", "1%"}, {"pos_margin_mode", "cross"},
            {"position_mode", "dual_plus"}, {"text", "apiv4"}};
        try {
            const auto response = send(kCreatePath, body);
            const auto id = response.value("data").toObject().value("id").toString();
            if (id.isEmpty())
                throw Error("创建响应缺少订单 ID；请先核对 Gate 列表");
            QJsonObject saved{{"id", id}, {"contract", body.value("contract")},
                {"amount", amount}, {"activation_price", body.value("activation_price")},
                {"reduce_only", false}, {"original_status", 1},
                {"timestamp", QDateTime::currentMSecsSinceEpoch()}};
            trailing.append(saved);
            saveTrailingOrders(config.ordersPath, trailing);
            result.insert("id", id);
            result.insert("action", "created");
            results.append(result);
        } catch (const std::exception &error) {
            result.insert("action", "failed");
            result.insert("operation", "create");
            result.insert("error", QString::fromUtf8(error.what()));
            results.append(result);
            return results; // Never automatically retry a possibly successful POST.
        }
    }
    return results;
}

QJsonArray createTrailingOrders() {
    return createTrailingOrders(Config::load());
}

QJsonArray closePositionOrders(const Config &config, const ClosePositionRequester &requester) {
    ensureNotCancelled(config);
    if (config.gateKey.isEmpty() || config.gateSecret.isEmpty())
        throw Error("请在程序的「连接与存储配置」中填写 Gate API Key 和 Secret");
    const auto request = [&](const QByteArray &method, const QByteArray &path,
                             const QByteArray &body = QByteArray{}) {
        ensureNotCancelled(config);
        const auto headers = gate::signedHeaders(method, path, body, config.gateKey, config.gateSecret);
        if (requester) return requester(method, path, body, headers);
        const QUrl url(kGateHost + QString::fromUtf8(path));
        return method == "GET" ? get(url, headers, false, config.cancelled)
                               : post(url, body, headers, config.cancelled);
    };
    const auto response = request("GET", "/api/v4/futures/usdt/positions");
    ensureHttpSuccess(response);
    QJsonParseError error;
    const auto document = QJsonDocument::fromJson(response.body, &error);
    if (error.error != QJsonParseError::NoError || !document.isArray())
        throw Error("持仓接口必须返回有效的 JSON 数组");

    QJsonArray positions;
    // Validate the complete snapshot before cancelling any protection orders.
    for (const auto &value : document.array()) {
        if (!value.isObject()) throw Error("持仓列表包含无效记录");
        const auto source = value.toObject();
        const auto positionValue = source.value("value");
        if (!positionValue.isString()) throw Error("持仓缺少十进制文本字段：value");
        // Only persist positions with nonzero value, including short positions.
        if (decimal::parse(positionValue.toString()).digits == "0") continue;
        const auto sizeValue = source.value("size");
        bool valid = false;
        const qint64 size = sizeValue.isString() ? sizeValue.toString().toLongLong(&valid)
                                                : sizeValue.toInteger();
        if (sizeValue.isDouble()) {
            const auto number = sizeValue.toDouble();
            valid = std::isfinite(number) && std::floor(number) == number
                && std::abs(number) <= 9007199254740991.0;
        }
        if (!valid || size == std::numeric_limits<qint64>::min())
            throw Error("持仓 size 必须为有效整数张数");
        const auto contract = source.value("contract").toString();
        static const QRegularExpression contractPattern(R"(^[A-Z0-9]+_USDT$)");
        if (!contractPattern.match(contract).hasMatch()) throw Error("持仓合约无效：" + contract);
        QJsonObject position{{"contract", contract}, {"size", size}};
        for (const QString &field : {"entry_price", "value", "leverage_max", "unrealised_pnl",
                                     "realised_pnl", "initial_margin", "mark_price"}) {
            if (!source.value(field).isString()) throw Error("持仓缺少十进制文本字段：" + field);
            decimal::parse(source.value(field).toString());
            position.insert(field, source.value(field));
        }
        position.insert("close_price", size == 0 ? QString("0") : decimal::closePrice(
            position.value("entry_price").toString(), position.value("value").toString(),
            position.value("initial_margin").toString(), position.value("mark_price").toString(),
            size < 0));
        positions.append(position);
    }
    ensureNotCancelled(config);
    savePositions(config.dataPath, positions);
    // Obtain the current exchange list, so completed or manually stopped orders are not stopped again.
    QJsonArray trailing;
    QSet<QString> seenIds;
    for (int pageNumber = 1; ; ++pageNumber) {
        const auto path = kTrailingOrdersPath + "?page_num=" + QByteArray::number(pageNumber)
            + "&page_size=100";
        const auto listResponse = request("GET", path);
        ensureHttpSuccess(listResponse);
        const auto page = gate::parseTrailingOrders(listResponse.body);
        if (page.isEmpty()) break;
        for (const auto &value : page) {
            const auto id = value.toObject().value("id").toString();
            if (seenIds.contains(id))
                throw Error("追踪订单分页出现重复 ID，请重新获取");
            seenIds.insert(id);
            trailing.append(value);
        }
        if (pageNumber == (std::numeric_limits<int>::max)())
            throw Error("追踪订单分页数量过多");
    }
    ensureNotCancelled(config);
    saveTrailingOrders(config.ordersPath, trailing);
    const auto owner = QString::fromLatin1(QCryptographicHash::hash(
        config.gateKey.toUtf8(), QCryptographicHash::Sha256).toHex());
    const auto managed = readManagedCloseOrderIds(config.ordersPath, owner);
    QJsonArray results;
    QJsonArray candidates;
    QSet<qsizetype> retained;
    // Match each desired close order to at most one active order owned by this account.
    for (const auto &value : readPositions(config.dataPath)) {
        const auto position = value.toObject();
        const auto size = position.value("size").toInteger();
        if (size == 0) continue;
        QJsonObject entry{{"contract", position.value("contract")},
                          {"amount", QString::number(-size)},
                          {"activation_price", position.value("close_price")}};
        bool unchanged = false;
        for (qsizetype index = 0; index < trailing.size(); ++index) {
            const auto old = trailing[index].toObject();
            const int status = old.value("original_status").toInt();
            if (retained.contains(index) || !old.value("reduce_only").toBool()
                || (status != 1 && status != 2)
                || !managed.contains(old.value("id").toString())
                || !sameOrderParameters(old, entry)) continue;
            retained.insert(index);
            entry.insert("id", old.value("id"));
            entry.insert("action", "skipped");
            entry.insert("message", "合约、数量和激活价格未变化，保留有效平仓单");
            results.append(entry);
            unchanged = true;
            break;
        }
        if (!unchanged) candidates.append(entry);
    }
    const auto send = [&](const QByteArray &path, const QJsonObject &payload) {
        return successfulResponse(request("POST", path,
            QJsonDocument(payload).toJson(QJsonDocument::Compact)));
    };
    // Prevalidate all stop IDs before the first write to the exchange.
    for (qsizetype index = 0; index < trailing.size(); ++index) {
        const auto old = trailing[index].toObject();
        const int status = old.value("original_status").toInt();
        if (retained.contains(index) || !old.value("reduce_only").toBool() || (status != 1 && status != 2)
            || !managed.contains(old.value("id").toString())) continue;
        bool valid = false;
        const auto id = old.value("id").toString().toLongLong(&valid);
        if (!valid || id <= 0) throw Error("旧平仓订单 ID 无效");
    }
    for (qsizetype index = 0; index < trailing.size(); ++index) {
        auto old = trailing[index].toObject();
        const int status = old.value("original_status").toInt();
        if (retained.contains(index) || !old.value("reduce_only").toBool() || (status != 1 && status != 2)
            || !managed.contains(old.value("id").toString())) continue;
        QJsonObject result{{"action", "stopped"}, {"id", old.value("id")},
                           {"contract", old.value("contract")}};
        try {
            send(kStopPath, {{"id", old.value("id").toString().toLongLong()}});
            old.insert("original_status", 5);
            old.insert("timestamp", QDateTime::currentMSecsSinceEpoch());
            trailing[index] = old;
            saveTrailingOrders(config.ordersPath, trailing);
            results.append(result);
        } catch (const std::exception &error) {
            result.insert("action", "failed");
            result.insert("operation", "stop");
            result.insert("error", QString::fromUtf8(error.what()));
            results.append(result);
            return results;
        }
    }
    // Only unmatched orders need a new request.
    for (const auto &value : candidates) {
        auto result = value.toObject();
        const auto amount = result.value("amount").toString();
        const QJsonObject body{{"contract", result.value("contract")}, {"amount", amount},
            {"activation_price", result.value("activation_price")}, {"is_gte", amount.startsWith('-')},
            {"reduce_only", true}, {"price_type", 3}, {"price_offset", "1%"},
            {"pos_margin_mode", "cross"}, {"position_mode", "dual_plus"}, {"text", "apiv4"}};
        try {
            const auto created = send(kCreatePath, body);
            const auto id = created.value("data").toObject().value("id").toString();
            result.insert("id", id);
            bool valid = false;
            if (id.toLongLong(&valid) <= 0 || !valid)
                throw Error("创建响应缺少有效订单 ID；请先核对 Gate 列表");
            saveManagedCloseOrderId(config.ordersPath, owner, id);
            trailing.append(QJsonObject{{"id", id}, {"contract", body.value("contract")},
                {"amount", amount}, {"activation_price", body.value("activation_price")},
                {"reduce_only", true}, {"original_status", 1},
                {"timestamp", QDateTime::currentMSecsSinceEpoch()}});
            saveTrailingOrders(config.ordersPath, trailing);
            result.insert("action", "created");
            results.append(result);
        } catch (const std::exception &error) {
            result.insert("action", "failed");
            result.insert("operation", "create");
            result.insert("error", QString::fromUtf8(error.what()));
            results.append(result);
            return results; // Do not retry an ambiguous POST in this batch.
        }
    }
    ensureNotCancelled(config);
    return results;
}

QJsonArray closePositionOrders() {
    return closePositionOrders(Config::load());
}

} // namespace orders
