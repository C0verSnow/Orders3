#include "services/dashboard.hpp"
#include "services/fetcher.hpp"
#include "core/error.hpp"
#include "core/decimal.hpp"
#include "infrastructure/storage.hpp"
#include <QJsonValue>
#include <QStringList>
#include <QUrl>
#include <utility>

namespace orders {
namespace {
class BusyGuard {
public:
    explicit BusyGuard(std::atomic<bool> &busy) : busy_(busy) {}
    ~BusyGuard() { busy_ = false; }
private:
    std::atomic<bool> &busy_;
};
QJsonValue nullable(const QString &text) {
    return text.isEmpty() ? QJsonValue(QJsonValue::Null) : QJsonValue(text);
}
} // namespace

Dashboard::Dashboard(Config config) : config_(std::move(config)) {
    uptime_.start();
}

Config Dashboard::config() const {
    std::lock_guard<std::mutex> lock(configMutex_);
    return config_;
}

QJsonObject Dashboard::environmentSnapshot() const {
    const auto current = config();
    QJsonObject values;
    for (const QString &name : {"SUPABASE_URL", "SUPABASE_ANON_KEY", "API_KEY", "API_SECRET",
                                "ORDERS_DATA_DIR", "ORDERS_ALLOWED_ORIGIN"})
        values.insert(name, current.environment.value(name));
    for (const QString &name : {"SUPABASE_ANON_KEY", "API_KEY", "API_SECRET"}) {
        values.insert(name + "_SET", !values.value(name).toString().isEmpty());
        values.remove(name);
    }
    return {{"values", values}, {"config_path", current.schedulePath},
            {"data_path", current.dataPath}};
}

QJsonObject Dashboard::configureEnvironment(const QJsonObject &payload) {
    const QStringList names{"SUPABASE_URL", "SUPABASE_ANON_KEY", "API_KEY", "API_SECRET",
                            "ORDERS_DATA_DIR", "ORDERS_ALLOWED_ORIGIN"};
    {
        std::lock_guard<std::mutex> lock(configMutex_);
        Config next = config_;
        for (auto it = payload.begin(); it != payload.end(); ++it) {
            if (!names.contains(it.key()) || !it.value().isString())
                throw Error("配置字段不支持或不是文本");
            const QString value = it.value().toString().trimmed();
            if (value.size() > 4096 || value.contains('\n') || value.contains('\r')
                || value.contains(QChar(0)))
                throw Error("配置内容过长或包含换行等无效字符");
            if ((it.key() == "SUPABASE_URL" || it.key() == "ORDERS_ALLOWED_ORIGIN")
                && !value.isEmpty()) {
                const QUrl url(value);
                if (!url.isValid() || url.host().isEmpty() || !url.userInfo().isEmpty()
                    || (url.scheme() != "https" && url.scheme() != "http")
                    || url.hasQuery() || url.hasFragment()
                    || (it.key() == "ORDERS_ALLOWED_ORIGIN" && !url.path().isEmpty()))
                    throw Error("请填写有效的 HTTP/HTTPS 地址；允许的网页来源不带路径");
            }
            next.environment.insert(it.key(), value);
        }
        next.supabaseUrl = next.environment.value("SUPABASE_URL").toString();
        next.supabaseKey = next.environment.value("SUPABASE_ANON_KEY").toString();
        next.gateKey = next.environment.value("API_KEY").toString();
        next.gateSecret = next.environment.value("API_SECRET").toString();
        next.allowedOrigin = next.environment.value("ORDERS_ALLOWED_ORIGIN").toString();
        saveEnvironmentSettings(next.schedulePath, next.environment);
        config_ = std::move(next);
    }
    return environmentSnapshot();
}

RefreshResult Dashboard::refreshSources() {
    if (sourcesBusy_.exchange(true))
        return {};
    BusyGuard guard(sourcesBusy_);
    activity_.begin("sources");
    ScopedHttpObserver observer(activity_.observer("sources"));
    bool saved = false;
    try {
        {
            std::lock_guard<std::mutex> lock(sourceMutex_);
            sourcePhase_ = "fetching";
            sourceError_.clear();
            executionResults_ = {};
        }
        const auto current = config();
        const auto items = fetchSources(current);
        {
            std::lock_guard<std::mutex> lock(sourceMutex_);
            saveSources(current.dataPath, items);
            saved = true;
            sourcePhase_ = "trading";
            sourceError_.clear();
            executionResults_ = {};
        }
        // Only orders from successful sources are parsed into the orders table.
        std::lock_guard<std::mutex> trading(gateMutex_);
        ordersBusy_ = true;
        BusyGuard ordersGuard(ordersBusy_);
        const auto execution = createTrailingOrders(current);
        bool success = true;
        {
            std::lock_guard<std::mutex> lock(sourceMutex_);
            executionResults_ = execution;
            for (const auto &value : execution) {
                const auto result = value.toObject();
                if (result.value("action").toString() == "failed") {
                    success = false;
                    sourceError_ = "来源已保存，但交易执行失败：" + result.value("error").toString();
                    break;
                }
            }
            sourcePhase_ = success ? "completed" : "failed";
        }
        activity_.finish("sources", success);
        return {true, success};
    } catch (const std::exception &error) {
        std::lock_guard<std::mutex> lock(sourceMutex_);
        sourcePhase_ = "failed";
        sourceError_ = (saved ? "来源已保存，但自动下单失败：" : "抓取失败，保留上次数据：")
                       + QString::fromUtf8(error.what());
        activity_.finish("sources", false);
        return {true, false};
    }
}

RefreshResult Dashboard::refreshOrders(bool executeCloseOrders) {
    std::unique_lock<std::mutex> trading(gateMutex_, std::try_to_lock);
    if (!trading.owns_lock())
        return {};
    if (ordersBusy_.exchange(true))
        return {};
    BusyGuard guard(ordersBusy_);
    activity_.begin("orders");
    ScopedHttpObserver observer(activity_.observer("orders"));
    try {
        const auto current = config();
        if (!executeCloseOrders) {
            const auto items = fetchTrailingOrders(current);
            std::lock_guard<std::mutex> lock(ordersMutex_);
            saveTrailingOrders(current.ordersPath, items);
            ordersError_.clear();
            activity_.finish("orders", true);
            return {true, true};
        }
        // Refresh positions/list, retain unchanged closing orders, and replace only
        // unmatched orders under the same trading lock as opening orders.
        const auto execution = closePositionOrders(current);
        std::lock_guard<std::mutex> lock(ordersMutex_);
        closeExecutionResults_ = execution;
        ordersError_.clear();
        for (const auto &value : execution) {
            const auto result = value.toObject();
            if (result.value("action").toString() == "failed") {
                ordersError_ = "持仓已更新，但自动平仓下单失败：" + result.value("error").toString();
                activity_.finish("orders", false);
                return {true, false};
            }
        }
        activity_.finish("orders", true);
        return {true, true};
    } catch (const std::exception &error) {
        std::lock_guard<std::mutex> lock(ordersMutex_);
        closeExecutionResults_ = {};
        ordersError_ = "更新持仓或平仓订单失败：" + QString::fromUtf8(error.what());
        activity_.finish("orders", false);
        return {true, false};
    }
}

QJsonObject Dashboard::sourceSnapshot() const {
    std::lock_guard<std::mutex> lock(sourceMutex_);
    const auto snapshot = readSources(config().dataPath);
    return {{"items", snapshot.items}, {"orders", snapshot.orders},
            {"execution", executionResults_},
            {"phase", sourcePhase_},
            {"updated_at", nullable(snapshot.updatedAt)}, {"error", nullable(sourceError_)},
            {"refreshing", bool(sourcesBusy_)}};
}

QJsonObject Dashboard::ordersSnapshot() const {
    std::lock_guard<std::mutex> lock(ordersMutex_);
    const auto snapshot = readTrailingOrders(config().ordersPath);
    const auto positions = readPositions(config().dataPath);
    QString unrealised = "0", realised = "0";
    for (const auto &value : positions) {
        const auto position = value.toObject();
        unrealised = decimal::sum(unrealised, position.value("unrealised_pnl").toString());
        realised = decimal::sum(realised, position.value("realised_pnl").toString());
    }
    return {{"orders", snapshot.orders}, {"updated_at", nullable(snapshot.updatedAt)},
            {"positions", positions}, {"close_execution", closeExecutionResults_},
            {"unrealised_pnl", unrealised}, {"realised_pnl", realised},
            {"uptime_ms", uptime_.elapsed()},
            {"error", nullable(ordersError_)}, {"refreshing", bool(ordersBusy_)}};
}

QByteArray Dashboard::download() const {
    std::lock_guard<std::mutex> lock(sourceMutex_);
    return exportDatabase(config().dataPath);
}
} // namespace orders
