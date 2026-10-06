#include "infrastructure/request_log.hpp"
#include "core/error.hpp"
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLockFile>
#include <QMutex>
#include <QMutexLocker>
#include <cstdio>

namespace orders {
namespace {
QMutex mutex;
QString logPath;
constexpr qint64 fileLimit = 10 * 1024 * 1024;
constexpr int backups = 4;
void warning() {
    std::fputs("请求日志写入失败，请检查日志目录的权限和剩余空间。\n", stderr);
}
}

void configureRequestLog(const QString &directory) {
    QMutexLocker locker(&mutex);
    if (!QDir().mkpath(directory))
        throw Error("无法创建请求日志目录");
    const QString path = QDir(directory).filePath("requests.jsonl");
    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Append))
        throw Error("无法打开请求日志文件");
    logPath = path;
}

void logRequest(const QString &direction, const QString &method, const QUrl &url,
                int status, qint64 elapsedMs) {
    QJsonObject entry{{"time", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
                      {"direction", direction}, {"method", method},
                      {"host", url.host().left(255)}, {"path", url.path().left(1024)},
                      {"status", status}, {"success", status >= 200 && status < 300}};
    if (elapsedMs >= 0) entry.insert("elapsed_ms", elapsedMs);
    const QByteArray line = QJsonDocument(entry).toJson(QJsonDocument::Compact) + '\n';
    QMutexLocker locker(&mutex);
    if (logPath.isEmpty()) return;
    QLockFile lock(logPath + ".lock");
    if (!lock.tryLock(1000)) { warning(); return; }
    if (QFileInfo(logPath).size() + line.size() > fileLimit) {
        const QString oldest = logPath + "." + QString::number(backups);
        if (QFile::exists(oldest) && !QFile::remove(oldest)) { warning(); return; }
        for (int index = backups - 1; index >= 0; --index) {
            const QString source = index == 0 ? logPath : logPath + "." + QString::number(index);
            if (QFile::exists(source) && !QFile::rename(source, logPath + "." + QString::number(index + 1))) {
                warning(); return;
            }
        }
    }
    QFile file(logPath);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Append)
        || file.write(line) != line.size() || !file.flush()) warning();
}
} // namespace orders
