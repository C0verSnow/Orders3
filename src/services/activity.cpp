#include "services/activity.hpp"
#include <QDateTime>

namespace orders {
void Activity::append(QJsonObject event) {
    event.insert("sequence", ++sequence_);
    event.insert("at", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));
    events_.append(event);
    while (events_.size() > 64) events_.removeAt(0);
}

void Activity::begin(const QString &job) {
    std::lock_guard<std::mutex> lock(mutex_);
    jobs_.insert(job, "running");
    append({{"type", "job-start"}, {"job", job}});
}

void Activity::finish(const QString &job, bool success) {
    std::lock_guard<std::mutex> lock(mutex_);
    jobs_.insert(job, success ? "completed" : "failed");
    append({{"type", "job-end"}, {"job", job}, {"success", success}});
}

HttpObserver Activity::observer(const QString &job) {
    return [this, job](const QUrl &url, bool write, bool started, int status) {
        // Classify by endpoint without retaining URLs or credentials in telemetry.
        const QString node = job == "sources" && !(url.host() == "api.gateio.ws"
            && url.path().startsWith("/api/v4/futures/"))
            ? "sources" : "gate";
        const QString key = job + ":" + node;
        std::lock_guard<std::mutex> lock(mutex_);
        auto request = requests_.value(key).toObject();
        request.insert("job", job);
        request.insert("node", node);
        request.insert("active", started ? 1 : 0);
        request.insert("write", write);
        if (!started) {
            const bool success = status >= 200 && status < 300;
            const QString counter = success ? "completed" : "failed";
            request.insert(counter, request.value(counter).toInt() + 1);
        }
        requests_.insert(key, request);
        append({{"type", started ? "request-start" : "request-end"}, {"job", job},
                {"node", node}, {"write", write}, {"status", status}});
    };
}

QJsonObject Activity::snapshot() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return {{"sequence", sequence_}, {"jobs", jobs_}, {"requests", requests_},
            {"events", events_}};
}
} // namespace orders
