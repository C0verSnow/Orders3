#include "core/config.hpp"
#include "core/cron.hpp"
#include "core/error.hpp"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QSaveFile>
#include <QStringList>
#include <QTextStream>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonParseError>

namespace orders {
namespace {
QString expandPath(QString path) {
    if (path == "~" || path.startsWith("~/") || path.startsWith("~\\"))
        path.replace(0, 1, QDir::homePath());
    return QDir::cleanPath(QFileInfo(path).absoluteFilePath());
}

void loadEnvironment(const QString &path) {
    QFile file(path);
    if (!file.exists())
        return;
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text))
        throw Error("无法读取 .env：" + file.errorString());
    QTextStream stream(&file);
    while (!stream.atEnd()) {
        QString line = stream.readLine().trimmed();
        if (line.startsWith(QChar(0xfeff)))
            line.remove(0, 1);
        if (line.startsWith("export "))
            line.remove(0, 7);
        if (line.isEmpty() || line.startsWith('#'))
            continue;
        const qsizetype separator = line.indexOf('=');
        if (separator < 1)
            throw Error(".env 配置行缺少等号");
        const QByteArray name = line.left(separator).trimmed().toUtf8();
        QString value = line.mid(separator + 1).trimmed();
        if (value.startsWith('"') || value.startsWith('\'')) {
            const QChar quote = value.front();
            const qsizetype end = value.indexOf(quote, 1);
            if (end < 0)
                throw Error(".env 配置值的引号没有闭合");
            value = value.mid(1, end - 1);
            if (quote == '"') {
                value.replace("\\n", "\n");
                value.replace("\\r", "\r");
            }
        } else {
            const qsizetype comment = value.indexOf(" #");
            if (comment >= 0)
                value = value.left(comment).trimmed();
        }
        if (!qEnvironmentVariableIsSet(name.constData()))
            qputenv(name.constData(), value.toUtf8());
    }
}

QString configRoot() {
    // Release configuration stays beside the program. A source checkout remains convenient.
    const QString executable = QCoreApplication::applicationDirPath();
    if (QFileInfo::exists(executable + "/.env"))
        return executable;
    QDir ancestor(executable);
    for (int depth = 0; depth < 5; ++depth) {
        if (QFileInfo::exists(ancestor.filePath("CMakeLists.txt"))
            && QDir(ancestor.filePath("src/core")).exists())
            return ancestor.absolutePath();
        if (!ancestor.cdUp())
            break;
    }
    return executable;
}
} // namespace

Config Config::load() {
    const QString root = configRoot();
    loadEnvironment(root + "/.env");
    const bool checkout = QFileInfo::exists(root + "/CMakeLists.txt");
    const QString defaultDataDirectory = expandPath(
        checkout ? root + "/data" : QDir::homePath() + "/.orders-dashboard");
    Config result;
    result.dataPath = defaultDataDirectory + "/data.db";
    result.ordersPath = defaultDataDirectory + "/orderslist.db";
    result.schedulePath = expandPath(qEnvironmentVariable(
        "ORDERS_CONFIG_PATH", checkout ? root + "/config" : QDir::homePath() + "/.orders-dashboard/config"));
    result.environment = loadEnvironmentSettings(result.schedulePath);
    const auto value = [&](const char *name) {
        if (!result.environment.contains(name))
            result.environment.insert(name, qEnvironmentVariable(name));
        return result.environment.value(name).toString();
    };
    result.supabaseUrl = value("SUPABASE_URL");
    result.supabaseKey = value("SUPABASE_ANON_KEY");
    result.gateKey = value("API_KEY").trimmed();
    result.gateSecret = value("API_SECRET").trimmed();
    result.allowedOrigin = value("ORDERS_ALLOWED_ORIGIN");
    const QString savedDataDirectory = value("ORDERS_DATA_DIR");
    if (!savedDataDirectory.isEmpty()) {
        result.dataPath = expandPath(savedDataDirectory) + "/data.db";
        result.ordersPath = expandPath(savedDataDirectory) + "/orderslist.db";
    }
    return result;
}

namespace {
void saveSection(const QString &path, const QString &section, const QStringList &values) {
    QStringList lines;
    QFile input(path);
    if (input.exists()) {
        if (!input.open(QIODevice::ReadOnly | QIODevice::Text))
            throw Error("无法读取原配置：" + input.errorString());
        lines = QString::fromUtf8(input.readAll()).split('\n');
        input.close();
    }
    QStringList output;
    bool inSection = false;
    for (const QString &line : lines) {
        QString trimmed = line.trimmed();
        trimmed.remove(QChar(0xfeff));
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            inSection = trimmed == "[" + section + "]";
            if (inSection)
                continue;
        }
        if (!inSection)
            output.append(line);
    }
    output.append("[" + section + "]");
    output.append(values);
    output.append("");
    if (!QDir().mkpath(QFileInfo(path).absolutePath()))
        throw Error("无法创建配置目录");
    QSaveFile target(path);
    if (!target.open(QIODevice::WriteOnly))
        throw Error("无法保存配置：" + target.errorString());
    target.setPermissions(QFileDevice::ReadOwner | QFileDevice::WriteOwner);
    const QByteArray content = output.join('\n').toUtf8();
    if (target.write(content) != content.size() || !target.commit())
        throw Error("无法保存配置：" + target.errorString());
}
} // namespace

QJsonObject loadEnvironmentSettings(const QString &path) {
    QFile file(path);
    if (!file.exists())
        return {};
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text))
        throw Error("无法读取程序配置：" + file.errorString());
    QJsonObject result;
    bool inSection = false;
    QTextStream stream(&file);
    while (!stream.atEnd()) {
        QString line = stream.readLine().trimmed();
        line.remove(QChar(0xfeff));
        if (line.isEmpty() || line.startsWith('#') || line.startsWith(';'))
            continue;
        if (line.startsWith('[') && line.endsWith(']')) {
            inSection = line == "[environment]";
            continue;
        }
        if (!inSection)
            continue;
        const auto split = line.indexOf('=');
        QJsonParseError error;
        const auto value = QJsonDocument::fromJson(
            ("[" + line.mid(split + 1).trimmed() + "]").toUtf8(), &error);
        if (split < 1 || error.error != QJsonParseError::NoError || !value.isArray()
            || value.array().size() != 1 || !value.array().at(0).isString())
            throw Error("程序配置格式错误");
        result.insert(line.left(split).trimmed(), value.array().at(0));
    }
    return result;
}

void saveEnvironmentSettings(const QString &path, const QJsonObject &settings) {
    QStringList values;
    for (auto it = settings.begin(); it != settings.end(); ++it) {
        // JSON strings preserve quotes, equals signs and Windows backslashes in INI values.
        const QByteArray encoded = QJsonDocument(QJsonArray{it.value()}).toJson(QJsonDocument::Compact);
        values.append(it.key() + " = " + QString::fromUtf8(encoded.mid(1, encoded.size() - 2)));
    }
    saveSection(path, "environment", values);
}

QString validateOutput(const QString &path) {
    const QString resolved = expandPath(path);
    const QString extension = QFileInfo(resolved).suffix().toLower();
    if (extension != "db" && extension != "sqlite" && extension != "sqlite3")
        throw Error("输出文件必须使用 .db、.sqlite 或 .sqlite3 后缀");
    return resolved;
}

ScheduleConfig loadSchedule(const QString &path) {
    QFile file(path);
    if (!file.exists())
        return {};
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text))
        throw Error("无法读取定时配置：" + file.errorString());
    ScheduleConfig result;
    QString section;
    QTextStream stream(&file);
    while (!stream.atEnd()) {
        QString line = stream.readLine().trimmed();
        line.remove(QChar(0xfeff));
        if (line.isEmpty() || line.startsWith(';') || line.startsWith('#'))
            continue;
        if (line.startsWith('[') && line.endsWith(']')) {
            section = line.mid(1, line.size() - 2);
            continue;
        }
        if (section != "schedule")
            continue;
        const qsizetype split = line.indexOf('=');
        if (split < 1)
            throw Error("定时配置格式错误");
        const QString key = line.left(split).trimmed();
        const QString value = line.mid(split + 1).trimmed();
        if (key == "enabled") {
            const QString normalized = value.toLower();
            if (QStringList{"true", "yes", "on", "1"}.contains(normalized))
                result.enabled = true;
            else if (QStringList{"false", "no", "off", "0"}.contains(normalized))
                result.enabled = false;
            else
                throw Error("enabled 必须为 true 或 false");
        } else if (key == "cron") {
            result.cron = value;
        }
    }
    Cron(result.cron).nextAfter(QDateTime::currentDateTime());
    return result;
}

void saveSchedule(const QString &path, const ScheduleConfig &config) {
    Cron(config.cron).nextAfter(QDateTime::currentDateTime());
    saveSection(path, "schedule", {QString("enabled = %1").arg(config.enabled ? "true" : "false"),
                                   "cron = " + config.cron});
}
} // namespace orders
