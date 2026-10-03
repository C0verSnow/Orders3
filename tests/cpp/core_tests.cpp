#include "core/config.hpp"
#include "core/cron.hpp"
#include "core/error.hpp"
#include "core/parser.hpp"
#include "infrastructure/storage.hpp"
#include "infrastructure/http_client.hpp"
#include "services/dashboard.hpp"
#include "services/fetcher.hpp"
#include "services/scheduler.hpp"
#include <QFile>
#include <QHostAddress>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QTemporaryDir>
#include <QTcpServer>
#include <QTcpSocket>
#include <QtTest>
#include <QtConcurrent/QtConcurrentRun>

class CoreTests : public QObject {
    Q_OBJECT
private slots:
    void sourcePagingDoesNotLeakCredentialsToTargets() {
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost, 0));
        const QString base = QString("http://127.0.0.1:%1").arg(server.serverPort());
        QList<QByteArray> requests;
        connect(&server, &QTcpServer::newConnection, &server, [&] {
            while (server.hasPendingConnections()) {
                auto *socket = server.nextPendingConnection();
                auto buffer = std::make_shared<QByteArray>();
                connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
                connect(socket, &QTcpSocket::readyRead, socket, [&, socket, buffer] {
                    buffer->append(socket->readAll());
                    if (!buffer->contains("\r\n\r\n"))
                        return;
                    requests.append(*buffer);
                    QByteArray body;
                    if (buffer->startsWith("GET /target ")) {
                        body = "Symbol: BTC\nPrice: 1.2300";
                    } else if (buffer->contains("offset=0")) {
                        body = QJsonDocument(QJsonArray{QJsonObject{{"url", base + "/target"}}})
                                   .toJson(QJsonDocument::Compact);
                    } else {
                        body = "[]";
                    }
                    socket->write("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: "
                                  + QByteArray::number(body.size()) + "\r\n\r\n" + body);
                    socket->disconnectFromHost();
                });
            }
        });
        orders::Config config;
        config.supabaseUrl = base;
        config.supabaseKey = "fixture-secret";
        auto future = QtConcurrent::run([config] { return orders::fetchSources(config); });
        QTRY_VERIFY_WITH_TIMEOUT(future.isFinished(), 5000);
        const auto items = future.result();
        QCOMPARE(items.size(), 1);
        QCOMPARE(items[0].toObject().value("data").toString(), QString("Symbol: BTC\nPrice: 1.2300"));
        QCOMPARE(requests.size(), 3);
        QVERIFY(requests[0].contains("fixture-secret"));
        QVERIFY(requests[1].contains("offset=1"));
        QVERIFY(!requests[2].contains("fixture-secret"));
    }

    void cancelledNetworkRequestNeverStarts() {
        auto cancelled = std::make_shared<std::atomic<bool>>(true);
        QVERIFY_EXCEPTION_THROWN(orders::get(QUrl("http://127.0.0.1:1"), {}, true, cancelled),
                                 orders::Error);
    }

    void invalidRefreshKeepsCachesAndReleasesBusyState() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = directory.filePath("data.db");
        config.ordersPath = directory.filePath("orders.db");
        const QJsonArray items{QJsonObject{{"data", "previous"}}};
        orders::saveSources(config.dataPath, items);
        orders::Dashboard dashboard(config);
        const auto refresh = dashboard.refreshSources();
        QVERIFY(refresh.accepted);
        QVERIFY(!refresh.success);
        QCOMPARE(dashboard.sourceSnapshot().value("items").toArray(), items);
        QVERIFY(!dashboard.sourceSnapshot().value("refreshing").toBool());
        QVERIFY(!dashboard.sourceSnapshot().value("error").isNull());
    }

    void failedConfigurationDoesNotChangeLiveSchedule() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = directory.filePath("data.db");
        config.ordersPath = directory.filePath("orders.db");
        orders::Dashboard dashboard(config);
        // A directory cannot be replaced by a configuration file.
        orders::Scheduler scheduler(dashboard, {}, directory.path());
        const auto original = scheduler.snapshot();
        const QJsonObject payload{{"enabled", false}, {"cron", "0 9 * * 1-5"}};
        QVERIFY_EXCEPTION_THROWN(scheduler.configure(payload), orders::Error);
        QCOMPARE(scheduler.snapshot(), original);
        QVERIFY_EXCEPTION_THROWN(scheduler.configure({{"enabled", "true"},
                                                      {"cron", "* * * * *"}}), orders::Error);
        QCOMPARE(scheduler.snapshot(), original);
    }

    void parserPreservesPrecision() {
        const auto rows = orders::parseOrders(
            "Symbol: BTC_USDT\nPrice: 0.0000000123\nSize: 3 contracts\n"
            "Orders Times: 1720000000123\nSymbol: ETH_USDT\nSide: buy", 7);
        QCOMPARE(rows.size(), 2);
        QCOMPARE(rows[0].toObject().value("price").toString(), QString("0.0000000123"));
        QCOMPARE(rows[0].toObject().value("size").toString(), QString("3 contracts"));
        QVERIFY(rows[1].toObject().value("price").isNull());
        QCOMPARE(rows[1].toObject().value("record_position").toInt(), 7);
    }

    void cronCalendarAndDayOrSemantics() {
        const QDateTime friday(QDate(2026, 10, 2), QTime(10, 0));
        QCOMPARE(orders::Cron("0 9 * * 1-5").nextAfter(friday),
                 QDateTime(QDate(2026, 10, 5), QTime(9, 0)));
        QCOMPARE(orders::Cron("0 9 1 * 1").nextAfter(friday),
                 QDateTime(QDate(2026, 10, 5), QTime(9, 0)));
        QVERIFY_EXCEPTION_THROWN(orders::Cron("*/0 * * * *"), orders::Error);
        QVERIFY_EXCEPTION_THROWN(orders::Cron("0 0 31 2 *").nextAfter(friday), orders::Error);
        const auto next = orders::Cron("*/15 * * * *").nextAfter(friday.addSecs(30));
        QCOMPARE(next.time(), QTime(10, 15));
    }

    void settingsPreserveOtherSections() {
        QTemporaryDir directory;
        const QString path = directory.filePath("config");
        QFile file(path);
        QVERIFY(file.open(QIODevice::WriteOnly));
        file.write("[other]\nvalue = 100%\n[schedule]\nenabled = true\ncron = */15 * * * *\n");
        file.close();
        orders::saveSchedule(path, {false, "0 9 * * 1-5"});
        const auto config = orders::loadSchedule(path);
        QVERIFY(!config.enabled);
        QCOMPARE(config.cron, QString("0 9 * * 1-5"));
        QVERIFY(file.open(QIODevice::ReadOnly));
        QVERIFY(file.readAll().contains("value = 100%"));
    }

    void recordsRoundTripAndFailedWriteRollsBack() {
        QTemporaryDir directory;
        const QString path = directory.filePath("data.db");
        const QJsonArray items{QJsonObject{{"data", "Symbol: BTC\nPrice: 1.2300"},
                                           {"status_code", 200}, {"extra", QJsonArray{1, 2}}},
                               QJsonObject{{"data", QJsonObject{{"ok", true}}}},
                               QJsonObject{{"url", QJsonValue::Null}}};
        orders::saveSources(path, items);
        QCOMPARE(orders::readSources(path).items, items);
        QCOMPARE(orders::readSources(path).orders.size(), 1);
        QVERIFY_EXCEPTION_THROWN(orders::saveSources(path, QJsonArray{12}), orders::Error);
        QCOMPARE(orders::readSources(path).items, items);
        const QByteArray exported = orders::exportDatabase(path);
        QVERIFY(exported.startsWith("SQLite format 3"));
    }

    void duplicateOrdersPreservePreviousSnapshot() {
        QTemporaryDir directory;
        const QString path = directory.filePath("orders.db");
        const QJsonObject order{{"id", "001"}, {"contract", "BTC_USDT"}, {"amount", "1.000"},
                                {"activation_price", "0.00001"}, {"reduce_only", false},
                                {"original_status", 0}, {"timestamp", 1720000000123.0}};
        orders::saveTrailingOrders(path, QJsonArray{order});
        QVERIFY_EXCEPTION_THROWN(orders::saveTrailingOrders(path, QJsonArray{order, order}),
                                 orders::Error);
        QCOMPARE(orders::readTrailingOrders(path).orders, QJsonArray{order});
    }

    void legacyRecordsAndTrailingMigration() {
        QTemporaryDir directory;
        const QString source = directory.filePath("old.db");
        {
            auto db = QSqlDatabase::addDatabase("QSQLITE", "legacy-test");
            db.setDatabaseName(source);
            QVERIFY(db.open());
            QSqlQuery query(db);
            QVERIFY(query.exec("CREATE TABLE records (position INTEGER PRIMARY KEY, record_json TEXT)"));
            QVERIFY(query.exec(R"(INSERT INTO records VALUES (0, '{"data":"Symbol: BTC\nPrice: 1"}'))"));
        }
        QSqlDatabase::removeDatabase("legacy-test");
        QCOMPARE(orders::readSources(source).orders.size(), 1);
        const QString trailing = directory.filePath("trailing.db");
        {
            auto db = QSqlDatabase::addDatabase("QSQLITE", "trailing-test");
            db.setDatabaseName(trailing);
            QVERIFY(db.open());
            QSqlQuery query(db);
            QVERIFY(query.exec("CREATE TABLE orders (id TEXT PRIMARY KEY, contract TEXT, amount TEXT,"
                               "trigger_price TEXT, reduce_only INTEGER, original_status INTEGER,"
                               "timestamp INTEGER)"));
            QVERIFY(query.exec("INSERT INTO orders VALUES ('1','BTC','1','10',0,0,1000)"));
        }
        QSqlDatabase::removeDatabase("trailing-test");
        QVERIFY(orders::readTrailingOrders(trailing).orders[0].toObject()
                    .value("activation_price").isNull());
        const QJsonObject row{{"id", "1"}, {"contract", "BTC"}, {"amount", "1"},
                              {"activation_price", "12"}, {"reduce_only", false},
                              {"original_status", 0}, {"timestamp", 2000}};
        orders::saveTrailingOrders(trailing, QJsonArray{row});
        QCOMPARE(orders::readTrailingOrders(trailing).orders[0].toObject()
                     .value("activation_price").toString(), QString("12"));
    }
};
QTEST_GUILESS_MAIN(CoreTests)
#include "core_tests.moc"
