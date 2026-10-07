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
const QString kSourcePath = QStringLiteral("/rest/v1/orders");
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

QUrl sourcePageUrl(const QString &base, qsizetype offset) {
    QUrl url(base + kSourcePath);
    QUrlQuery query;
    query.addQueryItem("select", "*");
    query.addQueryItem("order", "id.asc");
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
    HttpHeaders headers{{"apikey", key}, {"Accept", "application/json"}, {"Prefer", "count=exact"}};
    // Publishable/secret sb_* keys belong only in apikey; legacy JWT keys also use Bearer.
    if (key.split('.').size() == 3)
        headers.append({"Authorization", "Bearer " + key});

    QJsonArray sources;
    qint64 total = -1;
    while (true) {
        ensureNotCancelled(config);
        const auto response = get(sourcePageUrl(base, sources.size()), headers, false,
                                  config.cancelled);
        ensureHttpSuccess(response);
        const auto page = parseSupabaseOrders(response.body);
        for (const auto &header : response.headers) {
            if (header.first.toLower() != "content-range") continue;
            const auto count = header.second.mid(header.second.lastIndexOf('/') + 1);
            if (count == "*") continue;
            bool valid = false;
            const auto currentTotal = count.toLongLong(&valid);
            if (!valid || currentTotal < 0 || (total >= 0 && total != currentTotal))
                throw Error("读取期间订单总数发生变化或统计无效，请重新获取");
            total = currentTotal;
        }
        // Short pages do not end pagination; use the exact total or an empty page.
        if (page.isEmpty()) {
            if (total >= 0 && sources.size() != total)
                throw Error("orders 表分页提前结束，保留上次数据");
            return sources;
        }
        for (const auto &row : page)
            sources.append(row);
        if (total >= 0 && sources.size() > total)
            throw Error("orders 表订单数量与统计不一致，保留上次数据");
        if (sources.size() == total) return sources;
    }
}

} // namespace

QJsonArray fetchSources(const Config &config) {
    ensureNotCancelled(config);
    if (config.supabaseUrl.isEmpty() || config.supabaseKey.isEmpty())
        throw Error("请在程序的「连接与存储配置」中填写 Supabase 地址和密钥");

    const auto orders = fetchSourceRecords(config);
    ensureNotCancelled(config);
    return orders;
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
    gate::ensureSuccess(response);
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
    gate::ensureSuccess(response);
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
    gate::ensureSuccess(response);
    QJsonParseError error;
    const auto document = QJsonDocument::fromJson(response.body, &error);
    if (error.error != QJsonParseError::NoError || !document.isArray())
        throw Error("持仓接口必须返回有效的 JSON 数组");

    QJsonArray positions;
    QSet<QString> positionDirections;
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
        if (size != 0) {
            const auto direction = contract + (size > 0 ? ":long" : ":short");
            if (positionDirections.contains(direction))
                throw Error("持仓接口返回重复的合约方向：" + contract);
            positionDirections.insert(direction);
        }
        QJsonObject position{{"contract", contract}, {"size", size}};
        /*
        随笔: 需要修改的地方: 原先close price的计算公式=entry_price × (1 ± initial_margin × 3.1 / value)
        这里的value修改为value = size * entry_price
        size可以为正整数和负整数.不能为0
        并且原先Value = - value (if size:)的判断逻辑也进行删除
        */
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
        gate::ensureSuccess(listResponse);
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
    QJsonArray results;
    QJsonArray candidates;
    QSet<qsizetype> retained;
    // Retain exactly one matching active close order per position direction, including legacy/manual orders.
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
        if (retained.contains(index) || !old.value("reduce_only").toBool() || (status != 1 && status != 2)) continue;
        bool valid = false;
        const auto id = old.value("id").toString().toLongLong(&valid);
        if (!valid || id <= 0) throw Error("旧平仓订单 ID 无效");
    }
    for (qsizetype index = 0; index < trailing.size(); ++index) {
        auto old = trailing[index].toObject();
        const int status = old.value("original_status").toInt();
        if (retained.contains(index) || !old.value("reduce_only").toBool() || (status != 1 && status != 2)) continue;
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
