#include "infrastructure/storage.hpp"
#include "core/error.hpp"
#include "core/parser.hpp"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>
#include <QSqlRecord>
#include <QTemporaryDir>
#include <QUuid>
#include <QVariant>

namespace orders {
namespace {
// Connections belong to the calling thread and are removed after all queries are destroyed.
class Database {
public:
    explicit Database(const QString &path, bool readOnly = false)
        : name_(QUuid::createUuid().toString(QUuid::WithoutBraces)),
          db_(QSqlDatabase::addDatabase("QSQLITE", name_)) {
        db_.setDatabaseName(path);
        db_.setConnectOptions(readOnly ? "QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=5000"
                                       : "QSQLITE_BUSY_TIMEOUT=5000");
        if (!db_.open()) {
            const QString message = db_.lastError().text();
            db_ = {};
            QSqlDatabase::removeDatabase(name_);
            throw Error("无法打开数据库：" + message);
        }
    }
    ~Database() {
        db_.close();
        db_ = {};
        QSqlDatabase::removeDatabase(name_);
    }
    Database(const Database &) = delete;
    Database &operator=(const Database &) = delete;
    QSqlDatabase &connection() { return db_; }

private:
    QString name_;
    QSqlDatabase db_;
};

void execute(QSqlQuery &query, const QString &sql) {
    if (!query.exec(sql))
        throw Error("数据库操作失败：" + query.lastError().text());
}

void prepared(QSqlQuery &query) {
    if (!query.exec())
        throw Error("数据库写入失败：" + query.lastError().text());
}

void prepare(QSqlQuery &query, const QString &sql) {
    if (!query.prepare(sql))
        throw Error("数据库语句无效：" + query.lastError().text());
}

class Transaction {
public:
    explicit Transaction(QSqlDatabase &db) : db_(db) {
        if (!db_.transaction())
            throw Error("无法开始事务：" + db_.lastError().text());
    }
    ~Transaction() {
        if (!committed_)
            db_.rollback();
    }
    void commit() {
        if (!db_.commit())
            throw Error("无法提交事务：" + db_.lastError().text());
        committed_ = true;
    }
private:
    QSqlDatabase &db_;
    bool committed_ = false;
};

QJsonValue decode(const QString &text) {
    QJsonParseError error;
    const auto wrapper = QJsonDocument::fromJson(("[" + text + "]").toUtf8(), &error);
    if (error.error != QJsonParseError::NoError || !wrapper.isArray() || wrapper.array().size() != 1)
        throw Error("缓存包含无效 JSON");
    return wrapper.array().first();
}

QString encode(const QJsonValue &value) {
    const auto wrapper = QJsonDocument(QJsonArray{value}).toJson(QJsonDocument::Compact);
    return QString::fromUtf8(wrapper.mid(1, wrapper.size() - 2));
}

QVariant sqlValue(const QJsonValue &value) {
    if (value.isNull() || value.isUndefined())
        return QVariant(QMetaType::fromType<QString>());
    return value.toVariant();
}

QStringList columns(QSqlDatabase &db, const QString &table) {
    QSqlQuery query(db);
    execute(query, "PRAGMA table_info(" + table + ")");
    QStringList result;
    while (query.next())
        result.append(query.value(1).toString());
    return result;
}

QJsonObject rowObject(const QSqlQuery &query) {
    QJsonObject result;
    const auto record = query.record();
    for (int column = 0; column < record.count(); ++column)
        result.insert(record.fieldName(column), QJsonValue::fromVariant(query.value(column)));
    return result;
}

void ensureDirectory(const QString &path) {
    if (!QDir().mkpath(QFileInfo(path).absolutePath()))
        throw Error("无法创建数据库目录");
}

QString updatedAt(const QString &path) {
    return QFileInfo(path).lastModified().toUTC().toString(Qt::ISODateWithMs);
}

const QStringList recordFields{"url", "created_at", "status_code", "error", "data"};
} // namespace

SourceSnapshot readSources(const QString &path) {
    SourceSnapshot snapshot;
    if (!QFileInfo::exists(path))
        return snapshot;
    Database database(path, true);
    auto &db = database.connection();
    const auto recordColumns = columns(db, "records");
    QSqlQuery query(db);
    execute(query, "SELECT * FROM records ORDER BY position");
    while (query.next()) {
        QJsonObject item;
        if (recordColumns.contains("record_json")) {
            const auto value = decode(query.value("record_json").toString());
            if (!value.isObject())
                throw Error("缓存记录应为对象");
            item = value.toObject();
        } else {
            const auto extra = decode(query.value("extra_json").toString());
            const auto present = decode(query.value("present_fields").toString());
            if (!extra.isObject() || !present.isArray())
                throw Error("缓存记录字段无效");
            item = extra.toObject();
            for (const auto &field : present.toArray()) {
                const QString name = field.toString();
                if (!recordFields.contains(name))
                    throw Error("缓存记录包含未知字段");
                const QVariant stored = query.value(name);
                // SQL NULL must round-trip as JSON null; some Qt SQLite drivers return a null
                // QString for NULL TEXT columns, which fromVariant would turn into "".
                if (query.isNull(name))
                    item.insert(name, QJsonValue::Null);
                else
                    item.insert(name, name == "data" && query.value("data_format").toString() == "json"
                                          ? decode(stored.toString())
                                          : QJsonValue::fromVariant(stored));
            }
        }
        snapshot.items.append(item);
    }
    if (!columns(db, "orders").isEmpty()) {
        execute(query, "SELECT * FROM orders ORDER BY record_position, order_index");
        while (query.next())
            snapshot.orders.append(rowObject(query));
    } else {
        for (qsizetype position = 0; position < snapshot.items.size(); ++position) {
            const auto data = snapshot.items[position].toObject().value("data");
            if (data.isString()) {
                for (const auto &order : parseOrders(data.toString(), int(position)))
                    snapshot.orders.append(order);
            }
        }
    }
    snapshot.updatedAt = updatedAt(path);
    return snapshot;
}

void saveSources(const QString &path, const QJsonArray &items) {
    ensureDirectory(path);
    Database database(path);
    auto &db = database.connection();
    Transaction transaction(db);
    QSqlQuery query(db);
    // A single SQLite transaction preserves the complete previous snapshot on failure.
    execute(query, "DROP TABLE IF EXISTS orders");
    execute(query, "DROP TABLE IF EXISTS records");
    execute(query, R"(CREATE TABLE records (
        position INTEGER PRIMARY KEY, url TEXT, created_at TEXT, status_code INTEGER,
        error TEXT, data TEXT,
        data_format TEXT NOT NULL CHECK (data_format IN ('text', 'json')),
        extra_json TEXT NOT NULL, present_fields TEXT NOT NULL))");
    execute(query, R"(CREATE TABLE orders (
        record_position INTEGER NOT NULL REFERENCES records(position),
        order_index INTEGER NOT NULL, symbol TEXT NOT NULL, price TEXT, side TEXT,
        size TEXT, value TEXT, orders_time TEXT,
        PRIMARY KEY (record_position, order_index)))");
    for (qsizetype index = 0; index < items.size(); ++index) {
        if (!items[index].isObject())
            throw Error("来源记录必须为对象");
        const auto item = items[index].toObject();
        const auto data = item.value("data");
        QJsonObject extra = item;
        QJsonArray present;
        for (const auto &field : recordFields) {
            extra.remove(field);
            if (item.contains(field))
                present.append(field);
        }
        prepare(query, "INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        query.addBindValue(int(index));
        for (const QString &field : {"url", "created_at", "status_code", "error"})
            query.addBindValue(sqlValue(item.value(field)));
        query.addBindValue(data.isString() ? data.toString()
                                          : encode(data.isUndefined()
                                                       ? QJsonValue(QJsonValue::Null) : data));
        query.addBindValue(data.isString() ? QStringLiteral("text") : QStringLiteral("json"));
        query.addBindValue(encode(extra));
        query.addBindValue(encode(present));
        prepared(query);
        if (data.isString()) {
            for (const auto &value : parseOrders(data.toString(), int(index))) {
                prepare(query, "INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
                const auto order = value.toObject();
                for (const QString &field : {"record_position", "order_index", "symbol", "price",
                                             "side", "size", "value", "orders_time"})
                    query.addBindValue(sqlValue(order.value(field)));
                prepared(query);
            }
        }
    }
    transaction.commit();
}

TrailingSnapshot readTrailingOrders(const QString &path) {
    TrailingSnapshot snapshot;
    if (!QFileInfo::exists(path))
        return snapshot;
    Database database(path, true);
    QSqlQuery query(database.connection());
    execute(query, "SELECT * FROM orders ORDER BY id");
    while (query.next()) {
        auto order = rowObject(query);
        if (!order.contains("activation_price"))
            order.insert("activation_price", QJsonValue::Null);
        order.remove("trigger_price");
        order.insert("reduce_only", query.value("reduce_only").toBool());
        snapshot.orders.append(order);
    }
    snapshot.updatedAt = updatedAt(path);
    return snapshot;
}

void saveTrailingOrders(const QString &path, const QJsonArray &orders) {
    ensureDirectory(path);
    Database database(path);
    auto &db = database.connection();
    Transaction transaction(db);
    QSqlQuery query(db);
    const auto existing = columns(db, "orders");
    if (existing.contains("trigger_price") && !existing.contains("activation_price"))
        execute(query, "ALTER TABLE orders RENAME COLUMN trigger_price TO activation_price");
    execute(query, R"(CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY NOT NULL, contract TEXT NOT NULL, amount TEXT NOT NULL,
        activation_price TEXT NOT NULL,
        reduce_only INTEGER NOT NULL CHECK (reduce_only IN (0, 1)),
        original_status INTEGER NOT NULL, timestamp INTEGER NOT NULL))");
    execute(query, "DELETE FROM orders");
    for (const auto &value : orders) {
        const auto order = value.toObject();
        prepare(query, R"(INSERT INTO orders
            (id, contract, amount, activation_price, reduce_only, original_status, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?))");
        for (const QString &field : {"id", "contract", "amount", "activation_price", "reduce_only",
                                     "original_status", "timestamp"})
            query.addBindValue(sqlValue(order.value(field)));
        prepared(query);
    }
    transaction.commit();
}

QByteArray exportDatabase(const QString &path) {
    QTemporaryDir directory;
    if (!directory.isValid())
        throw Error("无法创建数据库下载快照");
    const QString snapshot = directory.filePath("data.db");
    Database database(path, true);
    QSqlQuery query(database.connection());
    // VACUUM INTO includes committed WAL pages in a standalone consistent database.
    prepare(query, "VACUUM INTO ?");
    query.addBindValue(snapshot);
    prepared(query);
    QFile file(snapshot);
    if (!file.open(QIODevice::ReadOnly))
        throw Error("无法读取数据库下载快照");
    return file.readAll();
}
} // namespace orders
