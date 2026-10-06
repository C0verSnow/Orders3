#include "core/error.hpp"
#include "infrastructure/storage.hpp"
#include "infrastructure/request_log.hpp"
#include "infrastructure/http_client.hpp"
#include <QFile>
#include <QFileInfo>
#include <QHostAddress>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QTemporaryDir>
#include <QTcpServer>
#include <QTcpSocket>
#include <QUuid>
#include <QtConcurrent/QtConcurrentRun>
#include <QtTest>

class StorageLoggingTests : public QObject {
    Q_OBJECT
private slots:
    void pageLimitRollsBack_data() {
        QTest::addColumn<int>("pageSize");
        QTest::newRow("default") << 4096;
        QTest::newRow("legacy-large-pages") << 8192;
    }
    void pageLimitRollsBack() {
        QFETCH(int, pageSize);
        QTemporaryDir directory;
        const QString name = QUuid::createUuid().toString();
        {
            auto db = QSqlDatabase::addDatabase("QSQLITE", name);
            db.setDatabaseName(directory.filePath("limit.db"));
            QVERIFY(db.open());
            QSqlQuery query(db);
            QVERIFY(query.exec("PRAGMA page_size = " + QString::number(pageSize)));
            QVERIFY(query.exec("CREATE TABLE snapshot (data BLOB)"));
            QVERIFY(query.exec("INSERT INTO snapshot VALUES ('old snapshot')"));
            orders::enforceDatabaseSizeLimit(db, 65536);
            QVERIFY(query.exec("PRAGMA max_page_count"));
            QVERIFY(query.next());
            QCOMPARE(query.value(0).toInt(), 65536 / pageSize);
            QVERIFY(db.transaction());
            QVERIFY(query.exec("DELETE FROM snapshot"));
            QVERIFY(!query.exec("INSERT INTO snapshot VALUES (zeroblob(131072))"));
            db.rollback(); // SQLITE_FULL may already have rolled back the transaction.
            QVERIFY(query.exec("SELECT data FROM snapshot"));
            QVERIFY(query.next());
            QCOMPARE(query.value(0).toString(), QString("old snapshot"));
            QVERIFY(QFileInfo(db.databaseName()).size() <= 65536);
        }
        QSqlDatabase::removeDatabase(name);
    }

    void oversizedDatabaseRejectsAllWritersAndRemainsReadable() {
        QTemporaryDir directory;
        const QString path = directory.filePath("old.db");
        orders::saveSources(path, {});
        orders::saveTrailingOrders(path, {});
        orders::savePositions(path, {});
        orders::saveManagedCloseOrderId(path, "account", "old-id");
        {
            QFile file(path);
            QVERIFY(file.open(QIODevice::ReadWrite));
            QVERIFY(file.resize(orders::databaseLimitBytes + 1));
        }
        QVERIFY_EXCEPTION_THROWN(orders::saveSources(path, {}), orders::Error);
        QVERIFY_EXCEPTION_THROWN(orders::saveTrailingOrders(path, {}), orders::Error);
        QVERIFY_EXCEPTION_THROWN(orders::savePositions(path, {}), orders::Error);
        QVERIFY_EXCEPTION_THROWN(orders::saveManagedCloseOrderId(path, "account", "new-id"), orders::Error);
        QCOMPARE(orders::readManagedCloseOrderIds(path, "account"), QStringList{"old-id"});
        QVERIFY(orders::readSources(path).items.isEmpty());
        QVERIFY(orders::readTrailingOrders(path).orders.isEmpty());
        QVERIFY(orders::readPositions(path).isEmpty());
        QVERIFY(!orders::exportDatabase(path).isEmpty());
        QCOMPARE(QFileInfo(path).size(), orders::databaseLimitBytes + 1);
    }

    void logsArePrivateConcurrentAndRotated() {
        QTemporaryDir directory;
        orders::configureRequestLog(directory.path());
        const QString path = directory.filePath("requests.jsonl");
        {
            QFile file(path);
            QVERIFY(file.open(QIODevice::ReadWrite));
            QVERIFY(file.resize(10 * 1024 * 1024));
        }
        const auto write = [] {
            for (int i = 0; i < 20; ++i)
                orders::logRequest("outbound", "GET",
                    QUrl("https://user:secret@example.com/api/orders?token=hidden#private"), 200, 7);
        };
        auto first = QtConcurrent::run(write);
        auto second = QtConcurrent::run(write);
        first.waitForFinished();
        second.waitForFinished();
        QVERIFY(QFileInfo::exists(path + ".1"));
        QVERIFY(QFileInfo(path).size() < 10 * 1024 * 1024);
        QFile file(path);
        QVERIFY(file.open(QIODevice::ReadOnly));
        int count = 0;
        while (!file.atEnd()) {
            const QByteArray line = file.readLine();
            QVERIFY(!line.contains("secret"));
            QVERIFY(!line.contains("hidden"));
            QVERIFY(!line.contains("private"));
            const auto value = QJsonDocument::fromJson(line).object();
            QCOMPARE(value.value("path").toString(), QString("/api/orders"));
            QCOMPARE(value.value("status").toInt(), 200);
            QCOMPARE(value.value("elapsed_ms").toInt(), 7);
            ++count;
        }
        QCOMPARE(count, 40);
    }

    void failedHttpRequestsAreLogged() {
        QTemporaryDir directory;
        orders::configureRequestLog(directory.path());
        QVERIFY_EXCEPTION_THROWN(orders::get(QUrl("invalid")), orders::Error);
        auto cancelled = std::make_shared<std::atomic<bool>>(true);
        QVERIFY_EXCEPTION_THROWN(orders::post(QUrl("https://example.com/api"), "secret-body",
                                            {{"KEY", "secret-key"}}, cancelled), orders::Error);
        QFile file(directory.filePath("requests.jsonl"));
        QVERIFY(file.open(QIODevice::ReadOnly));
        const QByteArray contents = file.readAll();
        QVERIFY(!contents.contains("secret"));
        const auto lines = contents.trimmed().split('\n');
        QCOMPARE(lines.size(), 2);
        for (const auto &line : lines) {
            const auto entry = QJsonDocument::fromJson(line).object();
            QCOMPARE(entry.value("status").toInt(), 0);
            QVERIFY(!entry.value("success").toBool());
            QVERIFY(entry.contains("elapsed_ms"));
        }
    }

    void httpResponsesAreLogged() {
        QTemporaryDir directory;
        orders::configureRequestLog(directory.path());
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost, 0));
        connect(&server, &QTcpServer::newConnection, &server, [&] {
            while (server.hasPendingConnections()) {
                auto *socket = server.nextPendingConnection();
                auto buffer = std::make_shared<QByteArray>();
                connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
                connect(socket, &QTcpSocket::readyRead, socket, [socket, buffer] {
                    buffer->append(socket->readAll());
                    if (!buffer->contains("\r\n\r\n")) return;
                    const QByteArray status = buffer->startsWith("GET /ok") ? "200 OK" : "401 Unauthorized";
                    socket->write("HTTP/1.1 " + status + "\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
                    socket->disconnectFromHost();
                });
            }
        });
        const QString base = QString("http://127.0.0.1:%1").arg(server.serverPort());
        auto future = QtConcurrent::run([base] {
            orders::get(QUrl(base + "/ok?token=hidden"), {{"KEY", "private-key"}});
            orders::post(QUrl(base + "/failed"), "private-body", {{"KEY", "private-key"}});
        });
        QTRY_VERIFY_WITH_TIMEOUT(future.isFinished(), 5000);
        future.waitForFinished();
        QFile file(directory.filePath("requests.jsonl"));
        QVERIFY(file.open(QIODevice::ReadOnly));
        const QByteArray contents = file.readAll();
        QVERIFY(!contents.contains("hidden"));
        QVERIFY(!contents.contains("private"));
        const auto lines = contents.trimmed().split('\n');
        QCOMPARE(lines.size(), 2);
        const auto first = QJsonDocument::fromJson(lines[0]).object();
        const auto second = QJsonDocument::fromJson(lines[1]).object();
        QCOMPARE(first.value("status").toInt(), 200);
        QVERIFY(first.value("success").toBool());
        QCOMPARE(second.value("status").toInt(), 401);
        QCOMPARE(second.value("method").toString(), QString("POST"));
        QVERIFY(!second.value("success").toBool());
    }
};
QTEST_GUILESS_MAIN(StorageLoggingTests)
#include "storage_logging_tests.moc"
