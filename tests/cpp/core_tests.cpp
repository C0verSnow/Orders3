#include "core/config.hpp"
#include "core/cron.hpp"
#include "core/error.hpp"
#include "core/decimal.hpp"
#include "core/order_parser.hpp"
#include "infrastructure/storage.hpp"
#include "infrastructure/gate_api.hpp"
#include <QCryptographicHash>
#include <QMessageAuthenticationCode>
#include <QRegularExpression>
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
    void closePricesUseExactDecimalArithmetic() {
        using orders::decimal::closePrice;
        QCOMPARE(closePrice("88.077351351351", "344.2961", "4.852279702667", "93.053", true),
                 QString("84.229"));
        QCOMPARE(closePrice("100", "100", "10", "93.053", false), QString("131.000"));
        QCOMPARE(closePrice("100", "100", "10", "93.053", true), QString("69.000"));
        QCOMPARE(closePrice("1.005", "100", "0", "1.00", false), QString("1.00"));
        QCOMPARE(closePrice("1.015", "100", "0", "1.00", false), QString("1.02"));
        QCOMPARE(orders::decimal::sum("-18.409900000001", "0.0660018163"),
                 QString("-18.343898183701"));
        QVERIFY_EXCEPTION_THROWN(closePrice("100", "0", "1", "10", false), orders::Error);
        QVERIFY_EXCEPTION_THROWN(closePrice("100", "10", "10", "10", true), orders::Error);
    }

    void closePositionsRespectOwnershipDirectionAndPersistence() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = "offline-key";
        config.gateSecret = "offline-secret";
        const auto owner = QString::fromLatin1(QCryptographicHash::hash(
            config.gateKey.toUtf8(), QCryptographicHash::Sha256).toHex());
        orders::saveManagedCloseOrderId(config.ordersPath, owner, "9007199254740993");
        orders::saveManagedCloseOrderId(config.ordersPath, "another-account", "22");
        const auto position = [](qint64 size) {
            return QJsonObject{{"contract", "HYPE_USDT"}, {"size", size},
                {"entry_price", "88.077351351351"}, {"value", size ? "344.2961" : "0"},
                {"leverage_max", "75"}, {"unrealised_pnl", "-18.409900000001"},
                {"realised_pnl", "0.0660018163"}, {"initial_margin", "4.852279702667"},
                {"mark_price", "93.053"}, {"ignored_field", "not stored"}};
        };
        const auto old = [](QString id, bool reduce, int status) {
            return QJsonObject{{"id", id}, {"contract", "HYPE_USDT"}, {"amount", "37"},
                {"activation_price", "84.229"}, {"reduce_only", reduce}, {"original_status", status}};
        };
        const QJsonArray exchangeOrders{old("9007199254740993", true, 2), old("20", true, 1),
            old("21", false, 1), old("22", true, 1)};
        QList<QByteArray> writes;
        QList<QJsonObject> bodies;
        int nextId = 100;
        int listPages = 0;
        const auto results = orders::closePositionOrders(config,
            [&](const QByteArray &method, const QByteArray &path, const QByteArray &body,
                const orders::HttpHeaders &headers) {
                QMap<QByteArray, QByteArray> map;
                for (const auto &header : headers) map.insert(header.first, header.second);
                const auto separator = path.indexOf('?');
                const auto requestPath = separator < 0 ? path : path.left(separator);
                const auto query = separator < 0 ? QByteArray{} : path.mid(separator + 1);
                const auto message = method + "\n" + requestPath + "\n" + query + "\n"
                    + QCryptographicHash::hash(body, QCryptographicHash::Sha512).toHex()
                    + "\n" + map.value("Timestamp");
                if (map.value("SIGN") != QMessageAuthenticationCode::hash(
                    message, config.gateSecret.toUtf8(), QCryptographicHash::Sha512).toHex())
                    return orders::HttpResult{401, "{}"};
                if (method == "GET") {
                    if (path.endsWith("/positions"))
                        return orders::HttpResult{200, QJsonDocument(QJsonArray{
                            position(-37), position(37), position(0)}).toJson()};
                    ++listPages;
                    const QJsonArray page = path.contains("page_num=1&")
                        ? QJsonArray{exchangeOrders[1], exchangeOrders[2], exchangeOrders[3]}
                        : path.contains("page_num=2&") ? QJsonArray{exchangeOrders[0]} : QJsonArray{};
                    return orders::HttpResult{200, QJsonDocument(QJsonObject{{"code", 0},
                        {"timestamp", qint64(1791011512347)},
                        {"data", QJsonObject{{"orders", page}}}}).toJson()};
                }
                writes.append(path);
                bodies.append(QJsonDocument::fromJson(body).object());
                if (path.endsWith("/stop")) return orders::HttpResult{200, R"({"code":0})"};
                return orders::HttpResult{200, QJsonDocument(QJsonObject{{"code", 0},
                    {"data", QJsonObject{{"id", QString::number(nextId++)}}}}).toJson()};
            });
        QCOMPARE(results.size(), 3);
        QCOMPARE(listPages, 3); // Includes our order on page 2 even when the server caps pages.
        QCOMPARE(writes.size(), 3);
        QVERIFY(writes[0].endsWith("/stop"));
        QCOMPARE(bodies[0].value("id").toInteger(), qint64(9007199254740993));
        QCOMPARE(bodies[1].value("amount").toString(), QString("37"));
        QCOMPARE(bodies[1].value("activation_price").toString(), QString("84.229"));
        QVERIFY(!bodies[1].value("is_gte").toBool());
        QCOMPARE(bodies[2].value("amount").toString(), QString("-37"));
        QVERIFY(bodies[2].value("is_gte").toBool());
        for (int index : {1, 2}) {
            QVERIFY(bodies[index].value("reduce_only").toBool());
            QCOMPARE(bodies[index].value("price_offset").toString(), QString("1%"));
            QCOMPARE(bodies[index].value("price_type").toInt(), 3);
            QCOMPARE(bodies[index].value("position_mode").toString(), QString("dual_plus"));
        }
        const auto saved = orders::readPositions(config.dataPath);
        QCOMPARE(saved.size(), 3);
        QCOMPARE(saved[0].toObject().size(), 10);
        QVERIFY(!saved[0].toObject().contains("ignored_field"));
        QCOMPARE(saved[0].toObject().value("close_price").toString(), QString("84.229"));
        const auto ids = orders::readManagedCloseOrderIds(config.ordersPath, owner);
        QVERIFY(ids.contains("100") && ids.contains("101"));
        QVERIFY(!ids.contains("20") && !ids.contains("22"));
        const auto trailing = orders::readTrailingOrders(config.ordersPath).orders;
        for (const auto &value : trailing) {
            const auto row = value.toObject();
            if (row.value("id").toString() == "20") QCOMPARE(row.value("original_status").toInt(), 1);
            if (row.value("id").toString() == "9007199254740993")
                QCOMPARE(row.value("original_status").toInt(), 5);
        }
    }

    void closePositionsEmptySnapshotStillStopsOwnedOrders() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = "key";
        config.gateSecret = "secret";
        const auto owner = QString::fromLatin1(QCryptographicHash::hash(
            config.gateKey.toUtf8(), QCryptographicHash::Sha256).toHex());
        orders::saveManagedCloseOrderId(config.ordersPath, owner, "1");
        const QJsonObject old{{"id", "1"}, {"contract", "BTC_USDT"}, {"amount", "-1"},
            {"activation_price", "100"}, {"reduce_only", true}, {"original_status", 1}};
        int stops = 0, creates = 0;
        const auto results = orders::closePositionOrders(config,
            [&](const QByteArray &method, const QByteArray &path, const QByteArray &,
                const orders::HttpHeaders &) {
                if (path.endsWith("/positions")) return orders::HttpResult{200, "[]"};
                if (method == "GET") return orders::HttpResult{200, QJsonDocument(QJsonObject{
                    {"code", 0}, {"timestamp", 123}, {"data", QJsonObject{{"orders",
                        path.contains("page_num=1&") ? QJsonArray{old} : QJsonArray{}}}}}).toJson()};
                if (path.endsWith("/stop")) ++stops;
                else ++creates;
                return orders::HttpResult{200, R"({"code":0})"};
            });
        QCOMPARE(stops, 1);
        QCOMPARE(creates, 0);
        QCOMPARE(results.size(), 1);
        QVERIFY(orders::readPositions(config.dataPath).isEmpty());
    }

    void closePositionsFailuresStopTheBatch() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = "key";
        config.gateSecret = "secret";
        const auto owner = QString::fromLatin1(QCryptographicHash::hash(
            config.gateKey.toUtf8(), QCryptographicHash::Sha256).toHex());
        orders::saveManagedCloseOrderId(config.ordersPath, owner, "1");
        const QJsonObject position{{"contract", "BTC_USDT"}, {"size", 1}, {"entry_price", "100"},
            {"value", "100"}, {"leverage_max", "75"}, {"unrealised_pnl", "0"},
            {"realised_pnl", "0"}, {"initial_margin", "10"}, {"mark_price", "100.0"}};
        const QJsonObject old{{"id", "1"}, {"contract", "BTC_USDT"}, {"amount", "-1"},
            {"activation_price", "100"}, {"reduce_only", true}, {"original_status", 1}};
        int writes = 0;
        bool invalidValue = true;
        bool stopFails = true;
        const auto requester = [&](const QByteArray &method, const QByteArray &path,
                                   const QByteArray &, const orders::HttpHeaders &) {
            if (path.endsWith("/positions")) {
                auto row = position;
                if (invalidValue) row.insert("value", "0");
                return orders::HttpResult{200, QJsonDocument(QJsonArray{row, row}).toJson()};
            }
            if (method == "GET") return orders::HttpResult{200, QJsonDocument(QJsonObject{
                {"code", 0}, {"timestamp", 123}, {"data", QJsonObject{{"orders",
                    path.contains("page_num=1&") ? QJsonArray{old} : QJsonArray{}}}}}).toJson()};
            ++writes;
            if (path.endsWith("/stop") && !stopFails) return orders::HttpResult{200, R"({"code":0})"};
            return orders::HttpResult{500, "{}"};
        };
        QVERIFY_EXCEPTION_THROWN(orders::closePositionOrders(config, requester), orders::Error);
        QCOMPARE(writes, 0);
        invalidValue = false;
        auto results = orders::closePositionOrders(config, requester);
        QCOMPARE(writes, 1);
        QCOMPARE(results.last().toObject().value("operation").toString(), QString("stop"));
        writes = 0;
        stopFails = false;
        results = orders::closePositionOrders(config, requester);
        QCOMPARE(writes, 2); // One stop, one failed create; no second create or retry.
        QCOMPARE(results.last().toObject().value("operation").toString(), QString("create"));
    }

    void trailingOrdersStopThenCreateAndSign() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = "offline-key";
        config.gateSecret = "offline-secret";
        orders::saveSources(config.dataPath, QJsonArray{QJsonObject{{"data",
            "contract: XAU_USDT\nactivation_price: 4071.29 USDT\namount: 371 Contracts\nTimestamp: 1791011512347\n"
            "contract: BTC_USDT\nactivation_price: 100 USDT\namount: -2 contracts\nTimestamp: 1791011512347"}}});
        const auto old = [](QString id, bool reduce, int status) {
            return QJsonObject{{"id", id}, {"contract", "SOL_USDT"}, {"amount", "1"},
                {"activation_price", "100"}, {"reduce_only", reduce},
                {"original_status", status}, {"timestamp", qint64(1791011512341)}};
        };
        orders::saveTrailingOrders(config.ordersPath, QJsonArray{
            old("9007199254740993", false, 1), old("2", false, 2),
            old("3", true, 1), old("4", true, 2), old("5", false, 4)});
        QList<QByteArray> paths;
        QList<QJsonObject> bodies;
        int nextId = 100;
        const auto results = orders::createTrailingOrders(config,
            [&](const QByteArray &path, const QByteArray &body, const orders::HttpHeaders &headers) {
                paths.append(path);
                bodies.append(QJsonDocument::fromJson(body).object());
                QMap<QByteArray, QByteArray> map;
                for (const auto &header : headers) map.insert(header.first, header.second);
                if (map.value("KEY") != "offline-key") return orders::HttpResult{401, "{}"};
                const auto message = "POST\n" + path + "\n\n"
                    + QCryptographicHash::hash(body, QCryptographicHash::Sha512).toHex()
                    + "\n" + map.value("Timestamp");
                const auto expected = QMessageAuthenticationCode::hash(message,
                    config.gateSecret.toUtf8(), QCryptographicHash::Sha512).toHex();
                if (map.value("SIGN") != expected)
                    return orders::HttpResult{401, "{}"};
                if (path.endsWith("/stop")) return orders::HttpResult{200, R"({"code":0})"};
                return orders::HttpResult{200, QJsonDocument(QJsonObject{{"code", 0},
                    {"data", QJsonObject{{"id", QString::number(nextId++)}}}}).toJson()};
            });
        QCOMPARE(results.size(), 4);
        QCOMPARE(paths.size(), 4);
        QVERIFY(paths[0].endsWith("/stop"));
        QVERIFY(paths[1].endsWith("/stop"));
        QVERIFY(paths[2].endsWith("/create"));
        QCOMPARE(bodies[1].value("id").toInteger(), qint64(9007199254740993));
        QCOMPARE(bodies[2].value("amount").toString(), QString("371"));
        QCOMPARE(bodies[2].value("activation_price").toString(), QString("4071.29"));
        QVERIFY(!bodies[2].value("reduce_only").toBool());
        QVERIFY(!bodies[2].value("is_gte").toBool());
        QVERIFY(bodies[3].value("is_gte").toBool());
        QCOMPARE(bodies[2].value("price_type").toInt(), 3);
        QCOMPARE(bodies[2].value("price_offset").toString(), QString("1%"));
        QCOMPARE(bodies[2].value("position_mode").toString(), QString("dual_plus"));
        const auto saved = orders::readTrailingOrders(config.ordersPath).orders;
        QCOMPARE(saved.size(), 7);
        QCOMPARE(saved[0].toObject().value("id").toString(), QString("100"));
    }

    void trailingDuplicateTimeBoundary_data() {
        QTest::addColumn<qint64>("difference");
        QTest::addColumn<QString>("oldAmount");
        QTest::addColumn<int>("status");
        QTest::addColumn<bool>("skip");
        constexpr qint64 week = 7LL * 24 * 60 * 60 * 1000;
        QTest::newRow("same-time") << qint64(0) << QString("1") << 4 << true;
        QTest::newRow("before-week") << week - 1 << QString("1") << 4 << true;
        QTest::newRow("reverse-order") << -week + 1 << QString("1") << 4 << true;
        QTest::newRow("exact-week") << week << QString("1") << 4 << false;
        QTest::newRow("opposite-sign") << qint64(0) << QString("-1") << 4 << false;
        QTest::newRow("other-status") << qint64(0) << QString("1") << 5 << false;
    }

    void trailingDuplicateTimeBoundary() {
        QFETCH(qint64, difference);
        QFETCH(QString, oldAmount);
        QFETCH(int, status);
        QFETCH(bool, skip);
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = config.gateSecret = "offline";
        constexpr qint64 time = 1791011512347;
        orders::saveSources(config.dataPath, QJsonArray{QJsonObject{{"data",
            "contract: XAU_USDT\nactivation_price: 4071.29 USDT\namount: 371 Contracts\nTimestamp: 1791011512347"}}});
        orders::saveTrailingOrders(config.ordersPath, QJsonArray{QJsonObject{
            {"id", "1"}, {"contract", "XAU_USDT"}, {"amount", oldAmount},
            {"activation_price", "100"}, {"reduce_only", false},
            {"original_status", status}, {"timestamp", time - difference}}});
        int requests = 0;
        const auto results = orders::createTrailingOrders(config,
            [&](const QByteArray &, const QByteArray &, const orders::HttpHeaders &) {
                ++requests;
                return orders::HttpResult{200, R"({"code":0,"data":{"id":"200"}})"};
            });
        QCOMPARE(requests, skip ? 0 : 1);
        QCOMPARE(results[0].toObject().value("action").toString(),
                 skip ? QString("skipped") : QString("created"));
    }

    void trailingStopFailurePreventsCreation() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = config.gateSecret = "offline";
        orders::saveSources(config.dataPath, QJsonArray{QJsonObject{{"data",
            "contract: XAU_USDT\nactivation_price: 4071.29 USDT\namount: 371 Contracts\nTimestamp: 1791011512347"}}});
        const QJsonArray old{QJsonObject{{"id", "1"}, {"contract", "BTC_USDT"}, {"amount", "1"},
            {"activation_price", "100"}, {"reduce_only", false},
            {"original_status", 1}, {"timestamp", qint64(1791011512347)}}};
        orders::saveTrailingOrders(config.ordersPath, old);
        int requests = 0;
        const auto result = orders::createTrailingOrders(config,
            [&](const QByteArray &path, const QByteArray &, const orders::HttpHeaders &) {
                ++requests;
                if (!path.endsWith("/stop")) return orders::HttpResult{500, "{}"};
                return orders::HttpResult{200, R"({"code":-1,"message":"Failed to terminate"})"};
            });
        QCOMPARE(requests, 1);
        QCOMPARE(result[0].toObject().value("action").toString(), QString("failed"));
        QCOMPARE(orders::readTrailingOrders(config.ordersPath).orders, old);
    }

    void trailingInvalidBatchDoesNotSendRequests() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        orders::saveSources(config.dataPath, QJsonArray{QJsonObject{{"data",
            "contract: XAU_USDT\nactivation_price: 4071.29 USDT\namount: 371 Contracts\nTimestamp: 1791011512347\n"
            "contract: BTC_USDT\nactivation_price: 100\namount: 0.01 BTC\nTimestamp: 1791011512347"}}});
        int requests = 0;
        const auto sender = [&](const QByteArray &, const QByteArray &, const orders::HttpHeaders &) {
            ++requests;
            return orders::HttpResult{200, "{}"};
        };
        QVERIFY_EXCEPTION_THROWN(orders::createTrailingOrders(config, sender), orders::Error);
        QCOMPARE(requests, 0);
    }

    void trailingPartialCreationIsSavedWithoutRetry() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = config.gateSecret = "offline";
        orders::saveSources(config.dataPath, QJsonArray{QJsonObject{{"data",
            "contract: XAU_USDT\nactivation_price: 4071.29 USDT\namount: 371 Contracts\nTimestamp: 1791011512347\n"
            "contract: BTC_USDT\nactivation_price: 100\namount: -2 Contracts\nTimestamp: 1791011512347"}}});
        int requests = 0;
        const auto results = orders::createTrailingOrders(config,
            [&](const QByteArray &, const QByteArray &, const orders::HttpHeaders &) {
                ++requests;
                return requests == 1 ? orders::HttpResult{200, R"({"code":0,"data":{"id":"200"}})"}
                    : orders::HttpResult{503, "unavailable"};
            });
        QCOMPARE(requests, 2);
        QCOMPARE(results[0].toObject().value("action").toString(), QString("created"));
        QCOMPARE(results[1].toObject().value("action").toString(), QString("failed"));
        const auto saved = orders::readTrailingOrders(config.ordersPath).orders;
        QCOMPARE(saved.size(), 1);
        QCOMPARE(saved[0].toObject().value("id").toString(), QString("200"));
    }

    void postSendsExactBodyAndRejectsRedirects() {
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost, 0));
        const auto base = QString("http://127.0.0.1:%1").arg(server.serverPort());
        QList<QByteArray> requests;
        connect(&server, &QTcpServer::newConnection, &server, [&] {
            while (server.hasPendingConnections()) {
                auto *socket = server.nextPendingConnection();
                auto buffer = std::make_shared<QByteArray>();
                connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
                connect(socket, &QTcpSocket::readyRead, socket, [&, socket, buffer] {
                    buffer->append(socket->readAll());
                    const int end = buffer->indexOf("\r\n\r\n");
                    if (end < 0) return;
                    const auto headers = QString::fromLatin1(buffer->left(end));
                    const auto match = QRegularExpression("Content-Length: (\\d+)",
                        QRegularExpression::CaseInsensitiveOption).match(headers);
                    if (!match.hasMatch() || buffer->size() < end + 4 + match.captured(1).toInt()) return;
                    requests.append(*buffer);
                    if (buffer->startsWith("POST /redirect "))
                        socket->write("HTTP/1.1 307 Temporary Redirect\r\nLocation: /target\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
                    else
                        socket->write("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 10\r\n\r\n{\"code\":0}");
                    socket->disconnectFromHost();
                });
            }
        });
        const QByteArray body = R"({"id":9007199254740993})";
        auto future = QtConcurrent::run([&] {
            return orders::post(QUrl(base + "/post"), body, {{"KEY", "offline"}});
        });
        QTRY_VERIFY_WITH_TIMEOUT(future.isFinished(), 5000);
        QCOMPARE(future.result().status, 200);
        QVERIFY(requests[0].endsWith(body));
        auto redirect = QtConcurrent::run([&] {
            try { orders::post(QUrl(base + "/redirect"), body, {{"KEY", "offline"}}); }
            catch (const orders::Error &) { return true; }
            return false;
        });
        QTRY_VERIFY_WITH_TIMEOUT(redirect.isFinished(), 5000);
        QVERIFY(redirect.result());
        QCOMPARE(requests.size(), 2);
    }

    void minutePollingContinuesWithSourceScheduleDisabled() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        orders::Dashboard dashboard(config);
        orders::Scheduler scheduler(dashboard, {false, "*/15 * * * *"}, directory.filePath("config"));
        scheduler.start();
        QVERIFY(dashboard.ordersSnapshot().value("error").isNull());
        QTRY_VERIFY_WITH_TIMEOUT(!dashboard.ordersSnapshot().value("error").isNull(), 65000);
        scheduler.stop();
        QVERIFY(dashboard.sourceSnapshot().value("error").isNull());
        QVERIFY(!dashboard.ordersSnapshot().value("refreshing").toBool());
        QVERIFY(!scheduler.snapshot().value("enabled").toBool());
    }

    void successfulSourceSaveAutomaticallyAttemptsTrading() {
        QTemporaryDir directory;
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost, 0));
        const auto base = QString("http://127.0.0.1:%1").arg(server.serverPort());
        connect(&server, &QTcpServer::newConnection, &server, [&] {
            while (server.hasPendingConnections()) {
                auto *socket = server.nextPendingConnection();
                auto buffer = std::make_shared<QByteArray>();
                connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
                connect(socket, &QTcpSocket::readyRead, socket, [&, socket, buffer] {
                    buffer->append(socket->readAll());
                    if (!buffer->contains("\r\n\r\n")) return;
                    QByteArray body = "[]";
                    if (buffer->startsWith("GET /target "))
                        body = "contract: XAU_USDT\nactivation_price: 4071.29 USDT\namount: 371 Contracts\nTimestamp: 1791011512347";
                    else if (buffer->contains("offset=0"))
                        body = QJsonDocument(QJsonArray{QJsonObject{{"url", base + "/target"}}})
                            .toJson(QJsonDocument::Compact);
                    socket->write("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: "
                        + QByteArray::number(body.size()) + "\r\n\r\n" + body);
                    socket->disconnectFromHost();
                });
            }
        });
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.supabaseUrl = base;
        config.supabaseKey = "offline";
        // Missing Gate credentials prove the automatic invocation without contacting Gate.
        orders::Dashboard dashboard(config);
        auto future = QtConcurrent::run([&] { return dashboard.refreshSources(); });
        QTRY_VERIFY_WITH_TIMEOUT(future.isFinished(), 5000);
        QVERIFY(future.result().accepted);
        QVERIFY(!future.result().success);
        const auto snapshot = dashboard.sourceSnapshot();
        QCOMPARE(snapshot.value("orders").toArray().size(), 1);
        QCOMPARE(snapshot.value("phase").toString(), QString("failed"));
        QVERIFY(snapshot.value("error").toString().contains("Gate API Key"));
        QVERIFY(snapshot.value("error").toString().contains("来源已保存"));
        QVERIFY(!snapshot.value("refreshing").toBool());
        QVERIFY(!dashboard.ordersSnapshot().value("refreshing").toBool());
    }

    void sourceContentHandlesJsonAndFailures_data() {
        QTest::addColumn<QByteArray>("body");
        QTest::addColumn<int>("status");
        QTest::addColumn<QJsonValue>("expected");
        QTest::newRow("object") << QByteArray("{\"ok\":true}") << 200
                                << QJsonValue(QJsonObject{{"ok", true}});
        QTest::newRow("array") << QByteArray("[1,2]") << 200
                               << QJsonValue(QJsonArray{1, 2});
        QTest::newRow("string") << QByteArray("\"hello\"") << 200 << QJsonValue("hello");
        QTest::newRow("number") << QByteArray("42") << 200 << QJsonValue(42);
        QTest::newRow("boolean") << QByteArray("true") << 200 << QJsonValue(true);
        QTest::newRow("null") << QByteArray("null") << 200 << QJsonValue(QJsonValue::Null);
        QTest::newRow("text") << QByteArray("order alert") << 200 << QJsonValue("order alert");
        QTest::newRow("empty") << QByteArray() << 200 << QJsonValue("");
        QTest::newRow("multiple-values") << QByteArray("1,2") << 200 << QJsonValue("1,2");
        QTest::newRow("http-failure") << QByteArray("unavailable") << 503
                                      << QJsonValue(QJsonValue::Null);
    }

    void sourceContentHandlesJsonAndFailures() {
        QFETCH(QByteArray, body);
        QFETCH(int, status);
        QFETCH(QJsonValue, expected);
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost, 0));
        const QString base = QString("http://127.0.0.1:%1").arg(server.serverPort());
        connect(&server, &QTcpServer::newConnection, &server, [&] {
            while (server.hasPendingConnections()) {
                auto *socket = server.nextPendingConnection();
                auto buffer = std::make_shared<QByteArray>();
                connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
                connect(socket, &QTcpSocket::readyRead, socket, [&, socket, buffer] {
                    buffer->append(socket->readAll());
                    if (!buffer->contains("\r\n\r\n"))
                        return;
                    const bool target = buffer->startsWith("GET /target ");
                    QByteArray responseBody = "[]";
                    if (target) {
                        responseBody = body;
                    } else if (buffer->contains("offset=0")) {
                        const QJsonObject source{{"url", base + "/target"},
                                                 {"error", "stale error"},
                                                 {"status_code", 500}, {"extra", "keep"}};
                        responseBody = QJsonDocument(QJsonArray{source})
                                           .toJson(QJsonDocument::Compact);
                    }
                    const int responseStatus = target ? status : 200;
                    socket->write("HTTP/1.1 " + QByteArray::number(responseStatus)
                                  + " Response\r\nConnection: close\r\nContent-Length: "
                                  + QByteArray::number(responseBody.size()) + "\r\n\r\n"
                                  + responseBody);
                    socket->disconnectFromHost();
                });
            }
        });
        orders::Config config;
        config.supabaseUrl = base + "///";
        config.supabaseKey = "fixture-secret";
        config.cancelled.reset(); // A cancellation token is optional.
        auto future = QtConcurrent::run([config] { return orders::fetchSources(config); });
        QTRY_VERIFY_WITH_TIMEOUT(future.isFinished(), 5000);
        const auto items = future.result();
        QCOMPARE(items.size(), 1);
        const auto source = items.first().toObject();
        QCOMPARE(source.value("data"), expected);
        QCOMPARE(source.value("status_code").toInt(), status);
        QCOMPARE(source.value("extra").toString(), QString("keep"));
        if (status >= 400)
            QCOMPARE(source.value("error").toString(), QString("接口返回 HTTP %1").arg(status));
        else
            QVERIFY(!source.contains("error"));
    }

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

    void cancelledFetchAbortsBeforeConfigurationChecks() {
        orders::Config config;
        config.cancelled->store(true);
        const auto verifyCancellation = [](auto fetch, const orders::Config &settings) {
            try {
                fetch(settings);
                QFAIL("Cancelled fetch must abort");
            } catch (const orders::Error &error) {
                QCOMPARE(QString::fromUtf8(error.what()), QString("程序正在关闭"));
            }
        };
        verifyCancellation(orders::fetchSources, config);
        verifyCancellation(orders::fetchTrailingOrders, config);
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
        QCOMPARE(rows[0].toObject().value("activation_price").toString(), QString("0.0000000123"));
        QCOMPARE(rows[0].toObject().value("amount").toString(), QString("3 contracts"));
        QVERIFY(rows[1].toObject().value("activation_price").isNull());
        QCOMPARE(rows[1].toObject().value("record_position").toInt(), 7);
    }

    void parserReadsOrderAlerts() {
        const QString alert = QString::fromUtf8(
            "🚀 ====== Order Alert ====== \r\n"
            "✨  contract            : XAU_USDT \r\n"
            "💰  activation_price    : 4071.29 USDT \r\n"
            "📈  side                : Open Long \r\n"
            "📦  amount              : 371 Contracts \r\n"
            "📦  value               : 151.21 U \r\n"
            "   ====================== \r\n\r\n\r\n"
            "Timestamp: 1791011512347 \r\n");
        const auto rows = orders::parseOrders(
            alert + "contract: BTC_USDT\nactivation_price: 0.0000000123 USDT\n"
                    "side: Open Short\namount: 2 Contracts\nvalue: 0.10 U\n", 7);
        QCOMPARE(rows.size(), 2);
        const auto first = rows[0].toObject();
        QCOMPARE(first.value("contract").toString(), QString("XAU_USDT"));
        QCOMPARE(first.value("activation_price").toString(), QString("4071.29 USDT"));
        QCOMPARE(first.value("side").toString(), QString("Open Long"));
        QCOMPARE(first.value("amount").toString(), QString("371 Contracts"));
        QVERIFY(!first.contains("value"));
        QCOMPARE(first.value("timestamp").toInteger(), qint64(1791011512347));
        QCOMPARE(first.value("record_position").toInt(), 7);
        QCOMPARE(first.value("order_index").toInt(), 0);
        const auto second = rows[1].toObject();
        QCOMPARE(second.value("contract").toString(), QString("BTC_USDT"));
        QCOMPARE(second.value("activation_price").toString(), QString("0.0000000123 USDT"));
        QVERIFY(second.value("timestamp").isNull());
        QCOMPARE(second.value("order_index").toInt(), 1);
    }

    void parserHandlesAliasesAndInvalidTimestamps() {
        QVERIFY(orders::parseOrders("unrelated text", 0).isEmpty());
        const auto rows = orders::parseOrders(
            "sYmBoL:\tBTC_USDT\r\npRiCe: 1.2300\r\nSize: -3 Contracts\r\n"
            "Timestamp: invalid\r\ncontract: ETH_USDT\nTimestamp: 9223372036854775808\n"
            "contract: SOL_USDT\nOrders Times: 1791011512347", 4);
        QCOMPARE(rows.size(), 3);
        const auto first = rows.first().toObject();
        QCOMPARE(first.value("activation_price").toString(), QString("1.2300"));
        QCOMPARE(first.value("amount").toString(), QString("-3 Contracts"));
        QVERIFY(first.value("timestamp").isNull());
        QVERIFY(first.value("side").isNull());
        QVERIFY(rows[1].toObject().value("timestamp").isNull());
        const auto last = rows.last().toObject();
        QCOMPARE(last.value("timestamp").toInteger(), qint64(1791011512347));
        QCOMPARE(last.value("record_position").toInt(), 4);
        QCOMPARE(last.value("order_index").toInt(), 2);
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

    void connectionSettingsPersistWithoutOverwritingScheduleOrExposingSecrets() {
        QTemporaryDir directory;
        orders::Config config;
        config.schedulePath = directory.filePath("config");
        config.dataPath = directory.filePath("data.db");
        config.ordersPath = directory.filePath("orders.db");
        orders::saveSchedule(config.schedulePath, {false, "0 9 * * 1-5"});
        orders::Dashboard dashboard(config);
        const QJsonObject payload{{"SUPABASE_URL", "https://example.supabase.co"},
                                  {"SUPABASE_ANON_KEY", "secret=with\"quotes"},
                                  {"API_KEY", "gate-key"}, {"API_SECRET", "gate-secret"},
                                  {"ORDERS_DATA_DIR", "C:\\orders data"}};
        const auto values = dashboard.configureEnvironment(payload).value("values").toObject();
        QVERIFY(!values.contains("SUPABASE_ANON_KEY"));
        QVERIFY(!values.contains("API_KEY"));
        QVERIFY(!values.contains("API_SECRET"));
        QVERIFY(values.value("SUPABASE_ANON_KEY_SET").toBool());
        QCOMPARE(dashboard.config().supabaseKey, payload.value("SUPABASE_ANON_KEY").toString());
        QCOMPARE(dashboard.config().dataPath, config.dataPath); // A data directory change needs restart.
        QCOMPARE(orders::loadEnvironmentSettings(config.schedulePath), payload);
        QVERIFY(!orders::loadSchedule(config.schedulePath).enabled);
        orders::saveSchedule(config.schedulePath, {true, "*/5 * * * *"});
        QCOMPARE(orders::loadEnvironmentSettings(config.schedulePath), payload);
        dashboard.configureEnvironment({{"SUPABASE_URL", "https://other.supabase.co"}});
        QCOMPARE(dashboard.config().gateSecret, QString("gate-secret"));
        dashboard.configureEnvironment({{"API_SECRET", ""}});
        QVERIFY(dashboard.config().gateSecret.isEmpty());
        const auto original = dashboard.config().environment;
        QVERIFY_EXCEPTION_THROWN(dashboard.configureEnvironment({{"API_KEY", 42}}), orders::Error);
        QVERIFY_EXCEPTION_THROWN(dashboard.configureEnvironment({{"SUPABASE_URL", "file:///tmp"}}), orders::Error);
        QCOMPARE(dashboard.config().environment, original);
    }

    void failedConnectionSettingsSaveKeepsLiveCredentials() {
        QTemporaryDir directory;
        orders::Config config;
        config.schedulePath = directory.path(); // A directory cannot be replaced by a file.
        config.supabaseKey = "original-secret";
        config.environment = {{"SUPABASE_ANON_KEY", "original-secret"}};
        orders::Dashboard dashboard(config);
        QVERIFY_EXCEPTION_THROWN(dashboard.configureEnvironment({{"SUPABASE_ANON_KEY", "new-secret"}}), orders::Error);
        QCOMPARE(dashboard.config().supabaseKey, QString("original-secret"));
    }

    void recordsRoundTripAndFailedWriteRollsBack() {
        QTemporaryDir directory;
        const QString path = directory.filePath("data.db");
        const QJsonArray items{QJsonObject{{"data", "Symbol: BTC\nPrice: 1.2300"},
                                           {"status_code", 200}, {"extra", QJsonArray{1, 2}}},
                               QJsonObject{{"data", QJsonObject{{"ok", true}}}},
                               QJsonObject{{"url", QJsonValue::Null},
                                           {"created_at", QJsonValue::Null},
                                           {"status_code", QJsonValue::Null},
                                           {"error", QJsonValue::Null},
                                           {"data", QJsonValue::Null}},
                               QJsonObject{{"url", ""}, {"created_at", ""},
                                           {"status_code", 0}, {"error", ""}, {"data", ""}},
                               QJsonObject{}};
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

    void sourcesAndTrailingOrdersShareDatabase() {
        QTemporaryDir directory;
        const QString path = directory.filePath("data.db");
        const QJsonArray items{QJsonObject{{"data", "Symbol: BTC\nPrice: 1.2300"}}};
        const QJsonObject order{{"id", "001"}, {"contract", "BTC_USDT"}, {"amount", "1.000"},
                                {"activation_price", "0.00001"}, {"reduce_only", false},
                                {"original_status", 0}, {"timestamp", 1720000000123.0}};
        orders::saveTrailingOrders(path, QJsonArray{order});
        QVERIFY(orders::readSources(path).items.isEmpty());
        orders::saveSources(path, items);
        QCOMPARE(orders::readTrailingOrders(path).orders, QJsonArray{order});
        orders::saveTrailingOrders(path, {});
        QCOMPARE(orders::readSources(path).items, items);
        QCOMPARE(orders::readSources(path).orders.size(), 1);
        orders::saveTrailingOrders(path, QJsonArray{order});
        QVERIFY_EXCEPTION_THROWN(orders::saveSources(path, QJsonArray{12}), orders::Error);
        QVERIFY_EXCEPTION_THROWN(orders::saveTrailingOrders(path, QJsonArray{order, order}),
                                 orders::Error);
        QCOMPARE(orders::readSources(path).items, items);
        QCOMPARE(orders::readTrailingOrders(path).orders, QJsonArray{order});
        QFile exported(directory.filePath("export.db"));
        QVERIFY(exported.open(QIODevice::WriteOnly));
        exported.write(orders::exportDatabase(path));
        exported.close();
        QCOMPARE(orders::readSources(exported.fileName()).items, items);
        QCOMPARE(orders::readTrailingOrders(exported.fileName()).orders, QJsonArray{order});
    }

    void sourcesWithoutTrailingTableHaveEmptyTrailingSnapshot() {
        QTemporaryDir directory;
        const QString path = directory.filePath("data.db");
        orders::saveSources(path, {});
        const auto snapshot = orders::readTrailingOrders(path);
        QVERIFY(snapshot.orders.isEmpty());
        QVERIFY(snapshot.updatedAt.isEmpty());
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
            QVERIFY(query.exec("CREATE TABLE orderslist (id TEXT PRIMARY KEY, contract TEXT, amount TEXT,"
                               "trigger_price TEXT, reduce_only INTEGER, original_status INTEGER,"
                               "timestamp INTEGER)"));
            QVERIFY(query.exec("INSERT INTO orderslist VALUES ('1','BTC','1','10',0,0,1000)"));
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
