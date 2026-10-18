#include "services/fetcher.hpp"

#include "core/error.hpp"
#include "core/decimal.hpp"
#include "infrastructure/gate_api.hpp"
#include "infrastructure/http_client.hpp"
#include "infrastructure/storage.hpp"
#include <QDateTime>
#include <QCryptographicHash>
#include <QRegularExpression>
#include <QMap>
#include <QSet>
#include <QMutexLocker>
#include <QRecursiveMutex>
#include <QStringList>
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
QRecursiveMutex tradingMutex;
const QByteArray kTrailingOrdersPath = "/api/v4/futures/usdt/autoorder/v1/trail/list";

void ensureNotCancelled(const Config &config) {
    if (config.cancelled && config.cancelled->load())
        throw Error("程序正在关闭");
}

void requireGateCredentials(const Config &config) {
    QStringList missing;
    if (normalizeGateCredential(config.gateKey).isEmpty()) missing.append("API_KEY");
    if (normalizeGateCredential(config.gateSecret).isEmpty()) missing.append("API_SECRET");
    if (!missing.isEmpty())
        throw Error("Gate 配置缺少 " + missing.join("、")
            + "：请填写连接配置或 Infisical 对应密钥");
}

// Legacy Gate responses use JSON integers; newer responses use decimal strings.
// Never round an unsafe JSON number or convert decimal text through a double.
decimal::Number fillQuantity(const QJsonValue &value, const QString &field) {
    QString text;
    if (value.isString()) text = value.toString();
    else if (value.isDouble()) {
        const double number = value.toDouble();
        if (std::isfinite(number) && std::floor(number) == number
            && std::abs(number) <= 9007199254740991.0)
            text = QString::number(qint64(number));
    }
    try {
        if (!text.isEmpty()) return decimal::parse(text);
    } catch (const Error &) {
        // Do not expose remote values (which may contain secrets) in diagnostics.
    }
    throw Error("成交历史 " + field + " 必须为有效十进制文本或安全整数");
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

QJsonObject contractParameters(const QString &contract, const ClosePositionRequester &requester,
                               const Config &config) {
    static const QRegularExpression pattern(R"(^[A-Z0-9]+_USDT$)");
    if (!pattern.match(contract).hasMatch()) throw Error("合约无效");
    const auto path = "/api/v4/futures/usdt/contracts/" + contract.toUtf8();
    ensureNotCancelled(config);
    const auto response = requester ? requester("GET", path, {}, {})
        : get(QUrl(kGateHost + QString::fromUtf8(path)), {}, false, config.cancelled);
    gate::ensureSuccess(response);
    QJsonParseError error;
    const auto document = QJsonDocument::fromJson(response.body, &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()
        || document.object().value("name").toString() != contract)
        throw Error("合约详情无效或合约名称不匹配");
    QJsonObject parameters;
    for (const QString &field : {"quanto_multiplier", "order_price_round"}) {
        const auto value = document.object().value(field);
        if (!value.isString()) throw Error("合约详情缺少十进制文本字段：" + field);
        const auto number = decimal::parse(value.toString());
        if (number.negative || number.digits == "0") throw Error("合约参数必须大于零：" + field);
        parameters.insert(field, value);
    }
    return parameters;
}

QString entryOwner(const Config &config) {
    return QString::fromLatin1(QCryptographicHash::hash(
        config.gateKey.toUtf8(), QCryptographicHash::Sha256).toHex());
}

// A fill confirms a real entry even if it was closed again between position polls.
// Scan a fixed window with an overlapping start second and persist atomically.
bool syncEntryHistory(const Config &config, const ClosePositionRequester &requester) {
    const auto owner = entryOwner(config);
    const auto previous = entryHistoryWatermark(config.dataPath, owner);
    const qint64 throughMs = QDateTime::currentMSecsSinceEpoch();
    const qint64 endSeconds = throughMs / 1000 + 1;
    if (previous >= throughMs) return false;
    const qint64 startSeconds = previous < 0 ? (throughMs - 7LL * 24 * 60 * 60 * 1000) / 1000
                                           : previous / 1000;
    QJsonArray events;
    QSet<QString> seen;
    for (qint64 offset = 0; ; ) {
        ensureNotCancelled(config);
        const auto path = QByteArray("/api/v4/futures/usdt/my_trades_timerange?from=")
            + QByteArray::number(startSeconds) + "&to=" + QByteArray::number(endSeconds)
            + "&limit=100&offset=" + QByteArray::number(offset);
        const auto headers = gate::signedGetHeaders(path, config.gateKey, config.gateSecret);
        const auto response = requester ? requester("GET", path, {}, headers)
            : get(QUrl(kGateHost + QString::fromUtf8(path)), headers, false, config.cancelled);
        gate::ensureSuccess(response);
        QJsonParseError error;
        const auto document = QJsonDocument::fromJson(response.body, &error);
        if (error.error != QJsonParseError::NoError || !document.isArray())
            throw Error("成交历史必须返回有效数组，暂停新开仓");
        const auto page = document.array();
        if (page.isEmpty()) break;
        for (const auto &value : page) {
            if (!value.isObject()) throw Error("成交历史记录无效");
            const auto fill = value.toObject();
            const auto id = fill.value("trade_id").toString();
            static const QRegularExpression idPattern(R"(^[0-9]+$)");
            if (!idPattern.match(id).hasMatch() || seen.contains(id))
                throw Error("成交历史 ID 无效或分页重复，暂停新开仓");
            seen.insert(id);
            const auto time = fill.value("create_time");
            if (!time.isDouble() || !std::isfinite(time.toDouble()) || time.toDouble() < 0
                || time.toDouble() > 9007199254740.0)
                throw Error("成交历史时间无效");
            const qint64 timeMs = qint64(std::floor(time.toDouble() * 1000));
            const auto size = fillQuantity(fill.value("size"), "size");
            const auto closed = fillQuantity(fill.value("close_size"), "close_size");
            const auto contract = fill.value("contract").toString();
            static const QRegularExpression contractPattern(R"(^[A-Z0-9]+_USDT$)");
            if (!contractPattern.match(contract).hasMatch())
                throw Error("成交历史 contract 必须为有效 USDT 合约");
            if (size.digits == "0") throw Error("成交历史 size 不能为零");
            if (closed.digits != "0" && closed.negative != size.negative)
                throw Error("成交历史 size 与 close_size 方向不一致");
            const int scale = std::max(size.scale, closed.scale);
            const bool opens = decimal::compare(decimal::scaled(size, scale),
                                                decimal::scaled(closed, scale)) > 0;
            if (opens && timeMs > previous && timeMs <= throughMs)
                events.append(QJsonObject{{"event_id", id}, {"entry_time", timeMs},
                    {"contract", contract}, {"side", size.negative ? -1 : 1}});
        }
        offset += page.size(); // Do not assume the server honors the requested page size.
        if (offset > (std::numeric_limits<int>::max)()) throw Error("成交历史分页数量过多");
    }
    ensureNotCancelled(config);
    if (!events.isEmpty()) {
        const QByteArray path = "/api/v4/futures/usdt/positions";
        const auto headers = gate::signedGetHeaders(path, config.gateKey, config.gateSecret);
        const auto response = requester ? requester("GET", path, {}, headers)
            : get(QUrl(kGateHost + QString::fromUtf8(path)), headers, false, config.cancelled);
        gate::ensureSuccess(response);
        QJsonParseError error;
        const auto positions = QJsonDocument::fromJson(response.body, &error);
        if (error.error != QJsonParseError::NoError || !positions.isArray())
            throw Error("入仓保证金持仓接口必须返回有效数组");
        QMap<QString, QString> margins;
        for (const auto &value : positions.array()) {
            const auto position = value.toObject();
            const auto size = fillQuantity(position.value("size"), "size");
            if (size.digits == "0") continue;
            const auto margin = position.value("initial_margin");
            if (!margin.isString() || decimal::parse(margin.toString()).negative)
                throw Error("入仓保证金必须为非负十进制文本");
            const auto key = position.value("contract").toString() + (size.negative ? ":short" : ":long");
            if (margins.contains(key)) throw Error("入仓保证金持仓方向重复");
            margins.insert(key, margin.toString());
        }
        // The API provides current aggregate margin, not historical per-fill margin.
        // Only the newest confirmed entry for each direction receives this observation.
        QMap<QString, qsizetype> latest;
        for (qsizetype i = 0; i < events.size(); ++i) {
            const auto event = events[i].toObject();
            const auto key = event.value("contract").toString()
                + (event.value("side").toInt() < 0 ? ":short" : ":long");
            const auto old = latest.contains(key) ? events[latest.value(key)].toObject() : QJsonObject{};
            if (old.isEmpty() || event.value("entry_time").toInteger() > old.value("entry_time").toInteger()
                || (event.value("entry_time") == old.value("entry_time")
                    && event.value("event_id").toString() > old.value("event_id").toString()))
                latest.insert(key, i);
        }
        for (auto it = latest.cbegin(); it != latest.cend(); ++it) {
            if (!margins.contains(it.key())) continue;
            auto event = events[it.value()].toObject();
            event.insert("initial_margin", margins.value(it.key()));
            events[it.value()] = event;
        }
    }
    ensureNotCancelled(config);
    saveEntryHistory(config.dataPath, owner, events, throughMs);
    return !events.isEmpty();
}

} // namespace

void loadGateCredentials(Config &config) {
    config.infisicalGateKey.clear();
    config.infisicalGateSecret.clear();
    QString problem;
    try {
        ensureNotCancelled(config);
        const QUrl base(config.infisicalUrl);
        // Plain HTTP is only allowed for loopback regression servers/local instances.
        const bool loopback = base.host() == "127.0.0.1" || base.host() == "::1"
            || base.host() == "localhost";
        if (!base.isValid() || base.host().isEmpty() || !base.userInfo().isEmpty()
            || base.hasQuery() || base.hasFragment()
            || (!base.path().isEmpty() && base.path() != "/")
            || (base.scheme() != "https" && !(base.scheme() == "http" && loopback)))
            throw Error("Infisical 服务地址必须为 HTTPS，且不带路径、查询参数或用户信息");
        if (config.infisicalClientId.trimmed().isEmpty()
            || config.infisicalClientSecret.trimmed().isEmpty()
            || config.infisicalProjectId.trimmed().isEmpty()
            || config.infisicalEnvironment.trimmed().isEmpty()
            || !config.infisicalSecretPath.startsWith('/'))
            throw Error("Infisical 配置不完整");
        const auto object = [](const HttpResult &response) {
            ensureHttpSuccess(response);
            QJsonParseError error;
            const auto document = QJsonDocument::fromJson(response.body, &error);
            if (error.error != QJsonParseError::NoError || !document.isObject())
                throw Error("Infisical 响应格式无效");
            return document.object();
        };
        const QByteArray body = QJsonDocument(QJsonObject{
            {"clientId", config.infisicalClientId},
            {"clientSecret", config.infisicalClientSecret}}).toJson(QJsonDocument::Compact);
        const auto login = object(post(base.resolved(QUrl("/api/v1/auth/universal-auth/login")),
            body, {{"Content-Type", "application/json"}, {"Accept", "application/json"}}, config.cancelled));
        const auto token = normalizeGateCredential(login.value("accessToken").toString());
        if (token.isEmpty()) throw Error("Infisical 认证响应缺少令牌");
        const auto credential = [&](const QString &name) {
            ensureNotCancelled(config);
            QUrl url = base.resolved(QUrl("/api/v4/secrets/" + name));
            QUrlQuery query;
            query.addQueryItem("projectId", config.infisicalProjectId);
            query.addQueryItem("environment", config.infisicalEnvironment);
            query.addQueryItem("secretPath", config.infisicalSecretPath);
            query.addQueryItem("type", "shared");
            url.setQuery(query);
            const auto result = object(get(url, {{"Authorization", "Bearer " + token.toUtf8()},
                {"Accept", "application/json"}}, false, config.cancelled));
            const auto secret = result.value("secret").toObject();
            if (secret.value("secretKey").toString() != name
                || secret.value("secretValueHidden").toBool())
                throw Error("Infisical 密钥响应无效");
            return normalizeGateCredential(secret.value("secretValue").toString());
        };
        config.infisicalGateKey = credential("GATE_API_KEY");
        config.infisicalGateSecret = credential("GATE_API_SECRET");
        if (config.infisicalGateKey.isEmpty() || config.infisicalGateSecret.isEmpty())
            throw Error("Infisical 缺少有效 Gate 备用凭证");
    } catch (const std::exception &) {
        // Never reflect remote text, tokens, authentication input or secret values.
        problem = "Infisical 备用凭证获取失败，请检查机器认证、项目、环境、路径和读取权限";
    }
    config.applyConnectionSettings();
    QStringList missing;
    if (config.gateKey.isEmpty()) missing.append("API_KEY");
    if (config.gateSecret.isEmpty()) missing.append("API_SECRET");
    if (!missing.isEmpty())
        throw Error("Gate 配置缺少 " + missing.join("、")
            + "：请填写原有配置或 Infisical 对应密钥"
            + (problem.isEmpty() ? QString() : "；" + problem));
    if (!problem.isEmpty())
        throw Error(problem + "；继续使用原有 Gate 配置");
}

QJsonArray fetchSources(const Config &config, const ClosePositionRequester &requester) {
    ensureNotCancelled(config);
    if (config.supabaseUrl.isEmpty() || config.supabaseKey.isEmpty())
        throw Error("请在程序的「连接与存储配置」中填写 Supabase 地址和密钥");

    auto orders = fetchSourceRecords(config);
    QMap<QString, QJsonObject> contracts;
    for (qsizetype index = 0; index < orders.size(); ++index) {
        auto order = orders[index].toObject();
        if (parseOrderRecord(order, int(index)).isEmpty()) continue;
        const auto contract = order.value("contract").toString();
        if (!contracts.contains(contract))
            contracts.insert(contract, contractParameters(contract, requester, config));
        const auto parameters = contracts.value(contract);
        for (auto field = parameters.begin(); field != parameters.end(); ++field)
            order.insert(field.key(), field.value());
        orders[index] = order;
    }
    ensureNotCancelled(config);
    return orders;
}

QJsonArray fetchTrailingOrders(const Config &config) {
    // Scheduler runs this one-shot operation independently every minute.
    ensureNotCancelled(config);
    requireGateCredentials(config);

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

QJsonArray createTrailingOrders(const Config &config, const TrailingOrderSender &sender,
                                const ClosePositionRequester &requester) {
    QMutexLocker<QRecursiveMutex> tradingLock(&tradingMutex);
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
        QJsonObject entry{{"contract", contract}, {"amount", amount},
                          {"activation_price", price}, {"timestamp", timestamp},
                          {"record_position", source.value("record_position")},
                          {"order_index", source.value("order_index")}};
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
    const bool hasPendingOpeningOrders = std::any_of(trailing.begin(), trailing.end(),
        [](const QJsonValue &value) {
            const auto order = value.toObject();
            const int status = order.value("original_status").toInt();
            return !order.value("reduce_only").toBool() && status == 1;
        });
    if (candidates.isEmpty() && retained.isEmpty()
        && (!sources.isEmpty() || !hasPendingOpeningOrders))
        return results;
    requireGateCredentials(config);
    if (!candidates.isEmpty()) syncEntryHistory(config, requester);
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
            || status != 1)
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
            syncEntryHistory(config, requester);
            if (hasRecentEntry(config.dataPath, result.value("contract").toString(),
                               amount.startsWith('-') ? -1 : 1, QDateTime::currentMSecsSinceEpoch())) {
                result.insert("action", "skipped");
                result.insert("message", "最近7天已有同合约、同方向的实际入仓或加仓");
                results.append(result);
                continue;
            }
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
    QMutexLocker<QRecursiveMutex> tradingLock(&tradingMutex);
    ensureNotCancelled(config);
    requireGateCredentials(config);
    const auto request = [&](const QByteArray &method, const QByteArray &path,
                             const QByteArray &body = QByteArray{}) {
        ensureNotCancelled(config);
        const auto headers = gate::signedHeaders(method, path, body, config.gateKey, config.gateSecret);
        if (requester) return requester(method, path, body, headers);
        const QUrl url(kGateHost + QString::fromUtf8(path));
        return method == "GET" ? get(url, headers, false, config.cancelled)
                               : post(url, body, headers, config.cancelled);
    };
    auto response = request("GET", "/api/v4/futures/usdt/positions");
    gate::ensureSuccess(response);
    QJsonParseError error;
    auto document = QJsonDocument::fromJson(response.body, &error);
    if (error.error != QJsonParseError::NoError || !document.isArray())
        throw Error("持仓接口必须返回有效的 JSON 数组");

    if (syncEntryHistory(config, requester)) {
        response = request("GET", "/api/v4/futures/usdt/positions");
        gate::ensureSuccess(response);
        document = QJsonDocument::fromJson(response.body, &error);
        if (error.error != QJsonParseError::NoError || !document.isArray())
            throw Error("持仓接口必须返回有效的 JSON 数组");
    }
    QJsonArray positions;
    QMap<QString, QJsonObject> contracts;
    QSet<QString> positionDirections;
    // Validate the complete snapshot before cancelling any protection orders.
    for (const auto &value : document.array()) {
        if (!value.isObject()) throw Error("持仓列表包含无效记录");
        const auto source = value.toObject();
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
        if (size == 0) continue;
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
        for (const QString &field : {"entry_price", "leverage_max", "unrealised_pnl",
                                     "realised_pnl", "initial_margin", "mark_price"}) {
            if (!source.value(field).isString()) throw Error("持仓缺少十进制文本字段：" + field);
            decimal::parse(source.value(field).toString());
            position.insert(field, source.value(field));
        }
        if (!contracts.contains(contract))
            contracts.insert(contract, contractParameters(contract, requester, config));
        const auto parameters = contracts.value(contract);
        for (auto field = parameters.begin(); field != parameters.end(); ++field)
            position.insert(field.key(), field.value());
        position.insert("value", decimal::product(decimal::product(QString::number(size),
            position.value("quanto_multiplier").toString()), position.value("entry_price").toString()));
        positions.append(position);
    }
    for (qsizetype index = 0; index < positions.size(); ++index) {
        auto position = positions[index].toObject();
        const auto size = position.value("size").toInteger();
        position.insert("initial_margin", fixedEntryMargin(config.dataPath, entryOwner(config),
            position.value("contract").toString(), size > 0 ? 1 : -1,
            position.value("initial_margin").toString()));
        position.insert("close_price", decimal::closePrice(
            position.value("entry_price").toString(), QString::number(size),
            position.value("initial_margin").toString(), position.value("quanto_multiplier").toString(),
            position.value("order_price_round").toString()));
        positions[index] = position;
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
        if (retained.contains(index) || !old.value("reduce_only").toBool() || status != 1) continue;
        bool valid = false;
        const auto id = old.value("id").toString().toLongLong(&valid);
        if (!valid || id <= 0) throw Error("旧平仓订单 ID 无效");
    }
    for (qsizetype index = 0; index < trailing.size(); ++index) {
        auto old = trailing[index].toObject();
        const int status = old.value("original_status").toInt();
        if (retained.contains(index) || !old.value("reduce_only").toBool() || status != 1) continue;
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
