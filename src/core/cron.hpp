#pragma once
#include <QDateTime>
#include <QString>
#include <array>
#include <set>

namespace orders {
// Five-field cron evaluated against the machine's local wall clock.
class Cron {
public:
    explicit Cron(const QString &expression);
    QDateTime nextAfter(const QDateTime &instant) const;
    bool matches(const QDateTime &instant) const;
private:
    std::array<std::set<int>, 5> fields_;
    bool anyDay_ = false;
    bool anyWeekday_ = false;
};
} // namespace orders
