#include "infrastructure/request_log.hpp"
#include "core/error.hpp"
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLockFile>
#include <QMap>
#include <QMutex>
#include <QMutexLocker>
#include <cstdio>
#include <iterator>

namespace orders {
namespace {
QMutex mutex;
QString logPath;
constexpr qint64 fileLimit = requestLogLimitBytes / 5;
constexpr int backups = 4;
void warning() {
    std::fputs("请求日志写入失败，请检查日志目录的权限和剩余空间。\n", stderr);
}
bool trimLogs(const QString &path, qint64 incomingBytes) {
    // Include backups left by older versions. Remove the oldest files first;
    // database files and unrelated files are never deleted.
    QMap<qulonglong, QFileInfo> files;
    const QFileInfo active(path);
    qint64 total = active.size();
    for (const auto &file : active.absoluteDir().entryInfoList(QDir::Files)) {
        const QString prefix = active.fileName() + '.';
        if (!file.fileName().startsWith(prefix)) continue;
        bool valid = false;
        const auto index = file.fileName().mid(prefix.size()).toULongLong(&valid);
        if (!valid || index == 0) continue;
        // Only canonical backup names are managed by this program.
        if (file.fileName() != prefix + QString::number(index)) continue;
        total += file.size();
        files.insert(index, file);
    }
    while (!files.isEmpty()) {
        auto oldest = std::prev(files.end());
        if (oldest.key() <= backups && total <= requestLogLimitBytes - incomingBytes) break;
        if (!QFile::remove(oldest.value().absoluteFilePath())) return false;
        total -= oldest.value().size();
        files.erase(oldest);
    }
    if (total > requestLogLimitBytes - incomingBytes) {
        // An oversized active log from a previous version cannot fit even by itself.
        if (!QFile::remove(path)) return false;
    }
    return true;
}
}

void configureRequestLog(const QString &directory) {
    QMutexLocker locker(&mutex);
    if (!QDir().mkpath(directory))
        throw Error("无法创建请求日志目录");
    const QString path = QDir(directory).filePath("requests.jsonl");
    QLockFile lock(path + ".lock");
    if (!lock.tryLock(1000)) throw Error("请求日志正在写入，请稍后重试");
    if (!trimLogs(path, 0)) throw Error("无法清理超限请求日志");
    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Append))
        throw Error("无法打开请求日志文件");
    logPath = path;
}

void logRequest(const QString &direction, const QString &method, const QUrl &url,
                int status, qint64 elapsedMs) {
    QJsonObject entry{{"time", QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
                      {"direction", direction.left(32)}, {"method", method.left(64)},
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
    if (!trimLogs(logPath, line.size())) { warning(); return; }
    QFile file(logPath);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Append)
        || file.write(line) != line.size() || !file.flush()) warning();
}
} // namespace orders
