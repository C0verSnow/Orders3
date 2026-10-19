#include "core/cron.hpp"
#include "core/error.hpp"
#include <QRegularExpression>
#include <QStringList>

namespace orders {
namespace {
int integer(const QString &text) {
    if (!QRegularExpression("^[0-9]+$").match(text).hasMatch())
        throw Error("Cron 只能使用数字、*、/、- 和逗号");
    bool valid = false;
    const int value = text.toInt(&valid);
    if (!valid)
        throw Error("Cron 数字超出范围");
    return value;
}

std::set<int> parseField(const QString &text, int minimum, int maximum, bool weekday) {
    std::set<int> values;
    for (const QString &item : text.split(',')) {
        const QStringList stepped = item.split('/');
        if (stepped.size() > 2 || stepped.front().isEmpty())
            throw Error("Cron 步长格式错误");
        const int step = stepped.size() == 2 ? integer(stepped[1]) : 1;
        if (step < 1 || step > maximum + 1)
            throw Error("Cron 步长超出范围");
        int first = minimum;
        int last = maximum;
        if (stepped.front() != "*") {
            const QStringList range = stepped.front().split('-');
            if (range.size() > 2)
                throw Error("Cron 范围格式错误");
            first = integer(range[0]);
            last = range.size() == 2 ? integer(range[1])
                                    : stepped.size() == 2 ? maximum : first;
        }
        if (first < minimum || last > maximum || first > last)
            throw Error("Cron 数字或范围无效");
        for (int value = first; value <= last; value += step)
            values.insert(weekday && value == 7 ? 0 : value);
    }
    return values;
}
} // namespace

Cron::Cron(const QString &expression) {
    const QStringList parts = expression.trimmed().split(QRegularExpression("\\s+"));
    if (parts.size() != 5)
        throw Error("Cron 必须包含五段：分 时 日 月 星期");
    const std::array<int, 5> minimum{0, 0, 1, 1, 0};
    const std::array<int, 5> maximum{59, 23, 31, 12, 7};
    for (std::size_t index = 0; index < fields_.size(); ++index)
        fields_[index] = parseField(parts[static_cast<qsizetype>(index)], minimum[index],
                                   maximum[index], index == 4);
    anyDay_ = fields_[2].size() == 31;
    anyWeekday_ = fields_[4].size() == 7;
}

bool Cron::matches(const QDateTime &instant) const {
    const QDate date = instant.date();
    const QTime time = instant.time();
    const bool day = fields_[2].count(date.day()) != 0;
    const bool weekday = fields_[4].count(date.dayOfWeek() % 7) != 0;
    const bool dateMatches = anyDay_ || anyWeekday_ ? day && weekday : day || weekday;
    return fields_[0].count(time.minute()) && fields_[1].count(time.hour())
           && fields_[3].count(date.month()) && dateMatches;
}

QDateTime Cron::nextAfter(const QDateTime &instant) const {
    const qint64 seconds = instant.toSecsSinceEpoch();
    QDateTime candidate = QDateTime::fromSecsSinceEpoch(seconds - seconds % 60 + 60).toLocalTime();
    const QDate limit = instant.date().addYears(8);
    while (candidate.isValid() && candidate.date() <= limit) {
        if (matches(candidate))
            return candidate;
        const QDate date = candidate.date();
        const bool day = fields_[2].count(date.day()) != 0;
        const bool weekday = fields_[4].count(date.dayOfWeek() % 7) != 0;
        const bool dateMatches = anyDay_ || anyWeekday_ ? day && weekday : day || weekday;
        if (!fields_[3].count(date.month()) || !dateMatches)
            candidate = date.addDays(1).startOfDay();
        else if (!fields_[1].count(candidate.time().hour()))
            candidate = candidate.addSecs((60 - candidate.time().minute()) * 60);
        else
            candidate = candidate.addSecs(60);
    }
    throw Error("Cron 在未来八年内没有可执行的时间");
}
} // namespace orders
