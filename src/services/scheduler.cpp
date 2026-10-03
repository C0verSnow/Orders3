#include "services/scheduler.hpp"
#include "core/cron.hpp"
#include "core/error.hpp"
#include <QtConcurrent/QtConcurrentRun>
#include <utility>

namespace orders {
namespace {
QJsonValue dateText(const QDateTime &date) {
    return date.isValid() ? QJsonValue(date.toUTC().toString(Qt::ISODateWithMs))
                          : QJsonValue(QJsonValue::Null);
}
} // namespace

Scheduler::Scheduler(Dashboard &dashboard, ScheduleConfig config, QString path)
    : dashboard_(dashboard), path_(std::move(path)), config_(std::move(config)) {
    if (config_.enabled)
        next_ = Cron(config_.cron).nextAfter(QDateTime::currentDateTime());
    QObject::connect(&timer_, &QTimer::timeout, this, [this] { runDue(); });
}

Scheduler::~Scheduler() { stop(); }

QJsonObject Scheduler::snapshot() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return {{"enabled", config_.enabled}, {"cron", config_.cron},
            {"timezone", "服务器本地时间"}, {"next_run", dateText(next_)},
            {"last_run", dateText(last_)},
            {"last_result", result_.isEmpty() ? QJsonValue(QJsonValue::Null) : QJsonValue(result_)}};
}

QJsonObject Scheduler::configure(const QJsonObject &payload) {
    if (payload.size() != 2 || !payload.value("enabled").isBool()
        || !payload.value("cron").isString())
        throw Error("请提供 enabled（布尔值）和 cron（字符串）两个字段");
    ScheduleConfig nextConfig{payload.value("enabled").toBool(),
                              payload.value("cron").toString().trimmed()};
    const auto nextDate = Cron(nextConfig.cron).nextAfter(QDateTime::currentDateTime());
    {
        std::lock_guard<std::mutex> lock(mutex_);
        saveSchedule(path_, nextConfig);
        config_ = std::move(nextConfig);
        next_ = config_.enabled ? nextDate : QDateTime{};
        ++generation_;
    }
    return snapshot();
}

void Scheduler::start() { timer_.start(1000); }

void Scheduler::stop() {
    timer_.stop();
    task_.waitForFinished();
}

void Scheduler::runDue() {
    quint64 generation;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto now = QDateTime::currentDateTime();
        if (!next_.isValid() || next_ > now)
            return;
        next_ = Cron(config_.cron).nextAfter(now);
        last_ = now;
        generation = generation_;
        if (!task_.isFinished() || dashboard_.sourcesBusy()) {
            result_ = "busy";
            return;
        }
    }
    task_ = QtConcurrent::run([this, generation] {
        QString result;
        try {
            const auto refresh = dashboard_.refreshSources();
            result = !refresh.accepted ? "busy" : refresh.success ? "completed" : "error";
        } catch (const std::exception &) {
            result = "error";
        }
        std::lock_guard<std::mutex> lock(mutex_);
        result_ = result;
        // Do not replay missed occurrences or overwrite settings saved during a slow fetch.
        if (generation_ == generation && config_.enabled)
            next_ = Cron(config_.cron).nextAfter(QDateTime::currentDateTime());
    });
}
} // namespace orders
