#include "services/dashboard.hpp"
#include "services/fetcher.hpp"
#include "infrastructure/storage.hpp"
#include <QJsonValue>
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

Dashboard::Dashboard(Config config) : config_(std::move(config)) {}

RefreshResult Dashboard::refreshSources() {
    if (sourcesBusy_.exchange(true))
        return {};
    BusyGuard guard(sourcesBusy_);
    try {
        const auto items = fetchSources(config_);
        std::lock_guard<std::mutex> lock(sourceMutex_);
        saveSources(config_.dataPath, items);
        sourceError_.clear();
        return {true, true};
    } catch (const std::exception &error) {
        std::lock_guard<std::mutex> lock(sourceMutex_);
        sourceError_ = "抓取失败，保留上次数据：" + QString::fromUtf8(error.what());
        return {true, false};
    }
}

RefreshResult Dashboard::refreshOrders() {
    if (ordersBusy_.exchange(true))
        return {};
    BusyGuard guard(ordersBusy_);
    try {
        const auto items = fetchTrailingOrders(config_);
        std::lock_guard<std::mutex> lock(ordersMutex_);
        saveTrailingOrders(config_.ordersPath, items);
        ordersError_.clear();
        return {true, true};
    } catch (const std::exception &error) {
        std::lock_guard<std::mutex> lock(ordersMutex_);
        ordersError_ = "获取订单失败，保留上次数据：" + QString::fromUtf8(error.what());
        return {true, false};
    }
}

QJsonObject Dashboard::sourceSnapshot() const {
    std::lock_guard<std::mutex> lock(sourceMutex_);
    const auto snapshot = readSources(config_.dataPath);
    return {{"items", snapshot.items}, {"orders", snapshot.orders},
            {"updated_at", nullable(snapshot.updatedAt)}, {"error", nullable(sourceError_)},
            {"refreshing", bool(sourcesBusy_)}};
}

QJsonObject Dashboard::ordersSnapshot() const {
    std::lock_guard<std::mutex> lock(ordersMutex_);
    const auto snapshot = readTrailingOrders(config_.ordersPath);
    return {{"orders", snapshot.orders}, {"updated_at", nullable(snapshot.updatedAt)},
            {"error", nullable(ordersError_)}, {"refreshing", bool(ordersBusy_)}};
}

QByteArray Dashboard::download() const {
    std::lock_guard<std::mutex> lock(sourceMutex_);
    return exportDatabase(config_.dataPath);
}
} // namespace orders
