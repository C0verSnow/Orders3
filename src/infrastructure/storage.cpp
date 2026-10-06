#include "infrastructure/storage.hpp"
#include "core/error.hpp"
#include "core/order_parser.hpp"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QPair>
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
    return value.isNull() || value.isUndefined() ? QVariant{} : value.toVariant();
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
        result.insert(record.fieldName(column), query.isNull(column)
                          ? QJsonValue(QJsonValue::Null)
                          : QJsonValue::fromVariant(query.value(column)));
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
    if (recordColumns.isEmpty())
        return snapshot;
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
                item.insert(name, query.isNull(name) ? QJsonValue(QJsonValue::Null)
                                  : name == "data" && query.value("data_format").toString() == "json"
                                      ? decode(stored.toString()) : QJsonValue::fromVariant(stored));
            }
        }
        snapshot.items.append(item);
    }
    if (!columns(db, "orders").isEmpty()) {
        execute(query, "SELECT * FROM orders ORDER BY record_position, order_index");
        while (query.next()) {
            auto order = rowObject(query);
            for (const auto &field : {qMakePair(QStringLiteral("symbol"), QStringLiteral("contract")),
                                      qMakePair(QStringLiteral("price"), QStringLiteral("activation_price")),
                                      qMakePair(QStringLiteral("size"), QStringLiteral("amount")),
                                      qMakePair(QStringLiteral("orders_time"), QStringLiteral("timestamp"))}) {
                if (!order.contains(field.second) && order.contains(field.first))
                    order.insert(field.second, order.value(field.first));
                order.remove(field.first);
            }
            order.remove("value");
            if (order.value("timestamp").isString()) {
                bool valid = false;
                const qint64 timestamp = order.value("timestamp").toString().toLongLong(&valid);
                order.insert("timestamp", valid ? QJsonValue(timestamp) : QJsonValue(QJsonValue::Null));
            }
            snapshot.orders.append(order);
        }
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
        order_index INTEGER NOT NULL, contract TEXT NOT NULL, activation_price TEXT, side TEXT,
        amount TEXT, timestamp INTEGER,
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
        const auto orders = item.contains("contract")
            ? QJsonArray{parseOrderRecord(item, int(index))}
            : data.isString() ? parseOrders(data.toString(), int(index)) : QJsonArray{};
        for (const auto &value : orders) {
            prepare(query, "INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?)");
            const auto order = value.toObject();
            for (const QString &field : {"record_position", "order_index", "contract", "activation_price",
                                         "side", "amount", "timestamp"})
                query.addBindValue(sqlValue(order.value(field)));
            prepared(query);
        }
    }
    transaction.commit();
}

TrailingSnapshot readTrailingOrders(const QString &path) {
    TrailingSnapshot snapshot;
    if (!QFileInfo::exists(path))
        return snapshot;
    Database database(path, true);
    if (columns(database.connection(), "orderslist").isEmpty())
        return snapshot;
    QSqlQuery query(database.connection());
    execute(query, "SELECT * FROM orderslist ORDER BY id");
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
    const auto existing = columns(db, "orderslist");
    if (existing.contains("trigger_price") && !existing.contains("activation_price"))
        execute(query, "ALTER TABLE orderslist RENAME COLUMN trigger_price TO activation_price");
    execute(query, R"(CREATE TABLE IF NOT EXISTS orderslist (
        id TEXT PRIMARY KEY NOT NULL, contract TEXT NOT NULL, amount TEXT NOT NULL,
        activation_price TEXT NOT NULL,
        reduce_only INTEGER NOT NULL CHECK (reduce_only IN (0, 1)),
        original_status INTEGER NOT NULL, timestamp INTEGER NOT NULL))");
    execute(query, "DELETE FROM orderslist");
    for (const auto &value : orders) {
        const auto order = value.toObject();
        prepare(query, R"(INSERT INTO orderslist
            (id, contract, amount, activation_price, reduce_only, original_status, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?))");
        for (const QString &field : {"id", "contract", "amount", "activation_price", "reduce_only",
                                     "original_status", "timestamp"})
            query.addBindValue(sqlValue(order.value(field)));
        prepared(query);
    }
    transaction.commit();
}

QJsonArray readPositions(const QString &path) {
    QJsonArray positions;
    if (!QFileInfo::exists(path))
        return positions;
    Database database(path, true);
    if (columns(database.connection(), "position").isEmpty())
        return positions;
    QSqlQuery query(database.connection());
    execute(query, "SELECT * FROM position ORDER BY contract, size");
    while (query.next())
        positions.append(rowObject(query));
    return positions;
}

void savePositions(const QString &path, const QJsonArray &positions) {
    ensureDirectory(path);
    Database database(path);
    auto &db = database.connection();
    Transaction transaction(db);
    QSqlQuery query(db);
    // Keep both sides of a contract and preserve decimal prices as text.
    execute(query, R"(CREATE TABLE IF NOT EXISTS position (
        contract TEXT NOT NULL, entry_price TEXT NOT NULL, value TEXT NOT NULL,
        leverage_max TEXT NOT NULL, unrealised_pnl TEXT NOT NULL, realised_pnl TEXT NOT NULL,
        size INTEGER NOT NULL, initial_margin TEXT NOT NULL, mark_price TEXT NOT NULL,
        close_price TEXT NOT NULL))");
    execute(query, "DELETE FROM position");
    for (const auto &value : positions) {
        if (!value.isObject())
            throw Error("持仓记录必须为对象");
        const auto position = value.toObject();
        prepare(query, R"(INSERT INTO position
            (contract, entry_price, value, leverage_max, unrealised_pnl, realised_pnl,
             size, initial_margin, mark_price, close_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?))");
        for (const QString &field : {"contract", "entry_price", "value", "leverage_max",
                                     "unrealised_pnl", "realised_pnl", "size", "initial_margin",
                                     "mark_price", "close_price"})
            query.addBindValue(sqlValue(position.value(field)));
        prepared(query);
    }
    transaction.commit();
}

QStringList readManagedCloseOrderIds(const QString &path, const QString &owner) {
    QStringList ids;
    if (!QFileInfo::exists(path))
        return ids;
    Database database(path, true);
    if (columns(database.connection(), "managed_close_orders").isEmpty())
        return ids;
    QSqlQuery query(database.connection());
    prepare(query, "SELECT id FROM managed_close_orders WHERE owner = ?");
    query.addBindValue(owner);
    prepared(query);
    while (query.next())
        ids.append(query.value(0).toString());
    return ids;
}

void saveManagedCloseOrderId(const QString &path, const QString &owner, const QString &id) {
    ensureDirectory(path);
    Database database(path);
    QSqlQuery query(database.connection());
    execute(query, R"(CREATE TABLE IF NOT EXISTS managed_close_orders (
        owner TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (owner, id)))");
    prepare(query, "INSERT OR IGNORE INTO managed_close_orders (owner, id) VALUES (?, ?)");
    query.addBindValue(owner);
    query.addBindValue(id);
    prepared(query);
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
