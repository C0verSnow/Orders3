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
#include <QUuid>
#include <QScopeGuard>
#include <QTcpServer>
#include <QTcpSocket>
#include <QtTest>
#include <QtConcurrent/QtConcurrentRun>

namespace {
orders::HttpResult contractFixture(const QByteArray &path) {
    return {200, QJsonDocument(QJsonObject{{"name", QString::fromUtf8(path.mid(path.lastIndexOf('/') + 1))},
        {"quanto_multiplier", "1"}, {"order_price_round", "0.001"}}).toJson()};
}
QJsonArray closeOffline(const orders::Config &config, const orders::ClosePositionRequester &requester) {
    return orders::closePositionOrders(config, [&](const QByteArray &method, const QByteArray &path,
        const QByteArray &body, const orders::HttpHeaders &headers) {
        if (path.contains("/contracts/")) return contractFixture(path);
        if (path.contains("/my_trades_timerange")) return orders::HttpResult{200, "[]"};
        return requester(method, path, body, headers);
    });
}
QJsonArray openOffline(const orders::Config &config, const orders::TrailingOrderSender &sender = {}) {
    return orders::createTrailingOrders(config, sender,
        [](const QByteArray &, const QByteArray &, const QByteArray &, const orders::HttpHeaders &) {
            return orders::HttpResult{200, "[]"};
        });
}
QJsonArray fetchOffline(const orders::Config &config) {
    return orders::fetchSources(config,
        [](const QByteArray &, const QByteArray &path, const QByteArray &, const orders::HttpHeaders &) {
            return contractFixture(path);
        });
}
} // namespace

class CoreTests : public QObject {
    Q_OBJECT
private slots:
    void gateSignatureMatchesOfficialVector() {
        // Gate APIv4 documentation: fixed Unix timestamp and GET with query.
        const auto headers = orders::gate::signedHeaders("GET",
            "/api/v4/futures/orders?contract=BTC_USD&status=finished&limit=50",
            {}, "key", "secret", 1541993715);
        QMap<QByteArray, QByteArray> values;
        for (const auto &header : headers) values.insert(header.first, header.second);
        QCOMPARE(values.value("KEY"), QByteArray("key"));
        QCOMPARE(values.value("Timestamp"), QByteArray("1541993715"));
        QCOMPARE(values.value("SIGN"), QByteArray(
            "55f84ea195d6fe57ce62464daaa7c3c02fa9d1dde954e4c898289c9a2407a3d6fb3fa"
            "f24deff16790d726b66ac9f74526668b13bd01029199cc4fcc522418b8a"));
    }

    void gateAuthenticationErrors_data() {
        QTest::addColumn<QString>("label");
        QTest::addColumn<QString>("hint");
        QTest::newRow("ip") << QString("IP_FORBIDDEN") << QString("出口 IP");
        QTest::newRow("clock") << QString("REQUEST_EXPIRED") << QString("60 秒");
        QTest::newRow("signature") << QString("INVALID_SIGNATURE") << QString("签名不匹配");
        QTest::newRow("key") << QString("INVALID_KEY") << QString("密钥无效");
        QTest::newRow("credentials") << QString("INVALID_CREDENTIALS") << QString("密钥无效");
        QTest::newRow("read-only") << QString("READ_ONLY") << QString("写入权限");
        QTest::newRow("permission") << QString("FORBIDDEN") << QString("权限受限");
        QTest::newRow("locked") << QString("ACCOUNT_LOCKED") << QString("账户状态");
        QTest::newRow("header") << QString("MISSING_REQUIRED_HEADER") << QString("请求头");
    }

    void gateAuthenticationErrors() {
        QFETCH(QString, label);
        QFETCH(QString, hint);
        const auto body = QJsonDocument(QJsonObject{{"label", label},
            {"message", "do-not-expose-secret"}}).toJson();
        try {
            orders::gate::ensureSuccess({401, body});
            QFAIL("Expected Gate authentication error");
        } catch (const orders::Error &error) {
            const QString text = QString::fromUtf8(error.what());
            QVERIFY(text.contains("HTTP 401"));
            QVERIFY(text.contains(label));
            QVERIFY(text.contains(hint));
            QVERIFY(!text.contains("do-not-expose-secret"));
        }
    }

    void gateUnknownErrorsDoNotReflectUpstreamBody() {
        for (const QByteArray &body : {QByteArray("<html>do-not-expose-secret</html>"),
             QByteArray(R"({"label":"do-not-expose-secret","message":"do-not-expose-secret"})")}) {
            try {
                orders::gate::ensureSuccess({401, body});
                QFAIL("Expected Gate authentication error");
            } catch (const orders::Error &error) {
                const QString text = QString::fromUtf8(error.what());
                QVERIFY(text.contains("HTTP 401"));
                QVERIFY(!text.contains("do-not-expose-secret"));
            }
        }
        orders::gate::ensureSuccess({200, "[]"});
    }

    void gateAuthenticationFailureStopsBeforeTrading() {
        orders::Config config;
        config.gateKey = "offline-key";
        config.gateSecret = "offline-secret";
        int calls = 0;
        try {
            closeOffline(config, [&](const QByteArray &method,
                const QByteArray &path, const QByteArray &, const orders::HttpHeaders &) {
                ++calls;
                if (method != "GET" || path != "/api/v4/futures/usdt/positions")
                    return orders::HttpResult{500, "{}"};
                return orders::HttpResult{401, R"({"label":"IP_FORBIDDEN"})"};
            });
            QFAIL("Expected Gate authentication error");
        } catch (const orders::Error &error) {
            QVERIFY(QString::fromUtf8(error.what()).contains("IP_FORBIDDEN"));
        }
        QCOMPARE(calls, 1);
    }

    void gateCredentialsMatchEnvironmentSavedSettingsAndLiveUpdates() {
        QTemporaryDir directory;
        QVERIFY(directory.isValid());
        const QList<QByteArray> names{"ORDERS_CONFIG_PATH", "ORDERS_DATA_DIR", "API_KEY", "API_SECRET",
            "SUPABASE_URL", "SUPABASE_ANON_KEY", "ORDERS_ALLOWED_ORIGIN"};
        QList<QByteArray> previous;
        QList<bool> wasSet;
        for (const auto &name : names) {
            previous.append(qgetenv(name.constData()));
            wasSet.append(qEnvironmentVariableIsSet(name.constData()));
        }
        const auto restore = qScopeGuard([&] {
            for (qsizetype index = 0; index < names.size(); ++index) {
                if (wasSet[index]) qputenv(names[index].constData(), previous[index]);
                else qunsetenv(names[index].constData());
            }
        });
        for (const auto &name : names) qputenv(name.constData(), "");
        qputenv("ORDERS_CONFIG_PATH", directory.filePath("config").toUtf8());
        qputenv("ORDERS_DATA_DIR", directory.path().toUtf8());
        // Docker-style environment retains quotes; Windows legacy .env strips them.
        qputenv("API_KEY", "  \"fixture-key\"  ");
        qputenv("API_SECRET", " 'fixture-secret' ");
        const auto initial = orders::Config::load();
        QCOMPARE(initial.gateKey, QString("fixture-key"));
        QCOMPARE(initial.gateSecret, QString("fixture-secret"));
        orders::Dashboard dashboard(initial);
        dashboard.configureEnvironment({{"SUPABASE_URL", "https://example.supabase.co"}});
        QCOMPARE(dashboard.config().gateKey, initial.gateKey);
        QCOMPARE(dashboard.config().gateSecret, initial.gateSecret);
        QCOMPARE(orders::loadEnvironmentSettings(initial.schedulePath).value("API_SECRET").toString(),
            initial.gateSecret);
        qputenv("API_KEY", "stale-key");
        qputenv("API_SECRET", "stale-secret");
        // A Windows-written CRLF config must load identically in the Linux CI job.
        QFile persisted(initial.schedulePath);
        QVERIFY(persisted.open(QIODevice::ReadOnly));
        const auto crlf = persisted.readAll().replace("\n", "\r\n");
        persisted.close();
        QVERIFY(persisted.open(QIODevice::WriteOnly | QIODevice::Truncate));
        QCOMPARE(persisted.write(crlf), qint64(crlf.size()));
        persisted.close();
        const auto restarted = orders::Config::load();
        QCOMPARE(restarted.gateKey, initial.gateKey);
        QCOMPARE(restarted.gateSecret, initial.gateSecret);
        const QByteArray path = "/api/v4/futures/usdt/autoorder/v1/trail/create";
        const QByteArray body = R"({"contract":"BTC_USDT","amount":"1"})";
        QCOMPARE(orders::gate::signedHeaders("POST", path, body,
                     restarted.gateKey, restarted.gateSecret, 1541993715),
                 orders::gate::signedHeaders("POST", path, body,
                     "fixture-key", "fixture-secret", 1541993715));
        dashboard.configureEnvironment({{"API_KEY", " 'replacement-key' "},
            {"API_SECRET", " \"replacement-secret\" "}});
        const auto replacement = orders::Config::load();
        QCOMPARE(replacement.gateKey, QString("replacement-key"));
        QCOMPARE(replacement.gateSecret, QString("replacement-secret"));
        QCOMPARE(dashboard.config().gateKey, replacement.gateKey);
        QCOMPARE(dashboard.config().gateSecret, replacement.gateSecret);
        dashboard.configureEnvironment({{"API_KEY", ""}, {"API_SECRET", ""}});
        const auto cleared = orders::Config::load();
        QVERIFY(cleared.gateKey.isEmpty());
        QVERIFY(cleared.gateSecret.isEmpty());
    }

    void gateCredentialPlaceholdersAreNotConfigured() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.schedulePath = directory.filePath("config");
        config.environment = {{"API_KEY", "已配置；留空保留，输入可替换"},
                              {"API_SECRET", "\"\"(已配置；留空保留，输入可替换)"}};
        config.applyConnectionSettings();
        QVERIFY(config.gateKey.isEmpty());
        QVERIFY(config.gateSecret.isEmpty());
        orders::Dashboard dashboard(config);
        const auto values = dashboard.environmentSnapshot().value("values").toObject();
        QVERIFY(!values.value("API_KEY_SET").toBool());
        QVERIFY(!values.value("API_SECRET_SET").toBool());
        QVERIFY_EXCEPTION_THROWN(dashboard.configureEnvironment({{"API_KEY", "已配置"}}), orders::Error);
        QVERIFY(!QFile::exists(config.schedulePath));
    }

    void supabaseGateCredentials_data() {
        QTest::addColumn<QByteArray>("body");
        QTest::addColumn<int>("status");
        QTest::addColumn<QString>("configuredKey");
        QTest::addColumn<QString>("configuredSecret");
        QTest::addColumn<QString>("expectedKey");
        QTest::addColumn<QString>("expectedSecret");
        QTest::addColumn<bool>("failure");
        const QByteArray valid = "[{\"API_KEY=\":\"backup-key\",\"API_SECRET=\":\"backup-secret\"}]";
        QTest::newRow("quoted-backup")
            << QByteArray("[{\"API_KEY=\":\" 'backup-key' \",\"API_SECRET=\":\" \\\"backup-secret\\\" \"}]")
            << 200 << QString() << QString()
            << QString("backup-key") << QString("backup-secret") << false;
        QTest::newRow("both-backup") << valid << 200 << QString() << QString()
            << QString("backup-key") << QString("backup-secret") << false;
        QTest::newRow("both-configured") << valid << 200 << QString("env-key") << QString("env-secret")
            << QString("env-key") << QString("env-secret") << false;
        QTest::newRow("key-configured") << valid << 200 << QString("env-key") << QString()
            << QString("env-key") << QString("backup-secret") << false;
        QTest::newRow("secret-configured") << valid << 200 << QString() << QString("env-secret")
            << QString("backup-key") << QString("env-secret") << false;
        QTest::newRow("blank-env") << valid << 200 << QString("  ") << QString(" '' ")
            << QString("backup-key") << QString("backup-secret") << false;
        for (const QByteArray &body : {QByteArray("[]"), QByteArray("[{},{}]"),
                 QByteArray("{}"), QByteArray("[null]"), QByteArray("do-not-expose-secret")}) {
            QTest::newRow(body.constData()) << body << 200 << QString("env-key") << QString("env-secret")
                << QString("env-key") << QString("env-secret") << true;
        }
        QTest::newRow("http-error") << QByteArray("do-not-expose-secret") << 403
            << QString("env-key") << QString("env-secret")
            << QString("env-key") << QString("env-secret") << true;
        QTest::newRow("missing-secret") << QByteArray("[{\"API_KEY=\":\"backup-key\",\"API_SECRET=\":null}]")
            << 200 << QString() << QString() << QString("backup-key") << QString() << true;
        QTest::newRow("invalid-type") << QByteArray("[{\"API_KEY=\":123,\"API_SECRET=\":\"backup-secret\"}]")
            << 200 << QString() << QString() << QString() << QString("backup-secret") << true;
    }

    void supabaseGateCredentials() {
        QFETCH(QByteArray, body);
        QFETCH(int, status);
        QFETCH(QString, configuredKey);
        QFETCH(QString, configuredSecret);
        QFETCH(QString, expectedKey);
        QFETCH(QString, expectedSecret);
        QFETCH(bool, failure);
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost, 0));
        QList<QByteArray> requests;
        connect(&server, &QTcpServer::newConnection, &server, [&] {
            while (server.hasPendingConnections()) {
                auto *socket = server.nextPendingConnection();
                auto buffer = std::make_shared<QByteArray>();
                connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
                connect(socket, &QTcpSocket::readyRead, socket, [&, socket, buffer] {
                    buffer->append(socket->readAll());
                    if (!buffer->contains("\r\n\r\n")) return;
                    requests.append(*buffer);
                    socket->write("HTTP/1.1 " + QByteArray::number(status)
                        + " Test\r\nConnection: close\r\nContent-Length: "
                        + QByteArray::number(body.size()) + "\r\n\r\n" + body);
                    socket->disconnectFromHost();
                });
            }
        });
        orders::Config config;
        config.supabaseUrl = QString("http://127.0.0.1:%1/").arg(server.serverPort());
        const bool legacy = configuredKey == "env-key";
        config.supabaseKey = legacy ? "eyJ.fixture.jwt" : "sb_publishable_fixture";
        config.environment = {{"SUPABASE_URL", config.supabaseUrl},
            {"SUPABASE_ANON_KEY", config.supabaseKey},
            {"API_KEY", configuredKey}, {"API_SECRET", configuredSecret}};
        auto future = QtConcurrent::run([config]() mutable {
            QString error;
            try { orders::loadGateCredentials(config); }
            catch (const orders::Error &exception) { error = QString::fromUtf8(exception.what()); }
            return qMakePair(config, error);
        });
        QTRY_VERIFY_WITH_TIMEOUT(future.isFinished(), 5000);
        const auto result = future.result();
        QCOMPARE(!result.second.isEmpty(), failure);
        QCOMPARE(result.first.gateKey, expectedKey);
        QCOMPARE(result.first.gateSecret, expectedSecret);
        QVERIFY(!result.second.contains("do-not-expose-secret"));
        QVERIFY(!result.second.contains("backup-secret"));
        QVERIFY(!result.second.contains("env-secret"));
        QCOMPARE(requests.size(), 1);
        QVERIFY(requests.first().startsWith("GET /rest/v1/secret?select=* HTTP/1.1"));
        const auto request = requests.first().toLower();
        QCOMPARE(request.contains("authorization: bearer "), legacy);
        QVERIFY(request.contains("apikey: " + config.supabaseKey.toUtf8().toLower()));
        QTemporaryDir directory;
        auto resolved = result.first;
        resolved.schedulePath = directory.filePath("config");
        orders::Dashboard dashboard(resolved);
        const auto snapshot = dashboard.environmentSnapshot();
        QVERIFY(!QJsonDocument(snapshot).toJson().contains("backup-secret"));
        QCOMPARE(snapshot.value("values").toObject().value("API_KEY_SET").toBool(), !expectedKey.isEmpty());
        QCOMPARE(snapshot.value("values").toObject().value("API_SECRET_SET").toBool(), !expectedSecret.isEmpty());
        dashboard.configureEnvironment({{"ORDERS_ALLOWED_ORIGIN", "http://localhost"}});
        QCOMPARE(dashboard.config().gateKey, expectedKey);
        QCOMPARE(dashboard.config().gateSecret, expectedSecret);
        const auto persisted = orders::loadEnvironmentSettings(resolved.schedulePath);
        QVERIFY(!QJsonDocument(persisted).toJson().contains("backup-secret"));
        dashboard.configureEnvironment({{"API_KEY", "replacement-key"}, {"API_SECRET", "replacement-secret"}});
        QCOMPARE(dashboard.config().gateKey, QString("replacement-key"));
        dashboard.configureEnvironment({{"API_KEY", ""}, {"API_SECRET", ""}});
        QCOMPARE(dashboard.config().gateKey, resolved.supabaseGateKey);
        QCOMPARE(dashboard.config().gateSecret, resolved.supabaseGateSecret);
    }

    void savedSupabaseSettingsReloadAndRetryWithoutRestart() {
        QTemporaryDir directory;
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost, 0));
        int requests = 0;
        QElapsedTimer sinceFailure;
        qint64 retryDelay = 0;
        connect(&server, &QTcpServer::newConnection, &server, [&] {
            while (server.hasPendingConnections()) {
                auto *socket = server.nextPendingConnection();
                connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
                auto buffer = std::make_shared<QByteArray>();
                connect(socket, &QTcpSocket::readyRead, socket, [&, socket, buffer] {
                    buffer->append(socket->readAll());
                    if (!buffer->contains("\r\n\r\n")) return;
                    ++requests;
                    const bool fail = requests == 1;
                    if (fail) sinceFailure.start();
                    else retryDelay = sinceFailure.elapsed();
                    const QByteArray body = fail ? QByteArray("private-error-body")
                        : QByteArray(R"([{"API_KEY=":"reloaded-key","API_SECRET=":"reloaded-secret"}])");
                    socket->write(QByteArray("HTTP/1.1 ") + (fail ? "503 Failed" : "200 OK")
                        + "\r\nConnection: close\r\nContent-Length: "
                        + QByteArray::number(body.size()) + "\r\n\r\n" + body);
                    socket->disconnectFromHost();
                });
            }
        });
        orders::Config config;
        config.schedulePath = directory.filePath("config");
        orders::Dashboard dashboard(config);
        QElapsedTimer saveTime;
        saveTime.start();
        dashboard.configureEnvironment({
            {"SUPABASE_URL", QString("http://127.0.0.1:%1").arg(server.serverPort())},
            {"SUPABASE_ANON_KEY", "sb_publishable_fixture"}});
        QVERIFY(saveTime.elapsed() < 1000); // The save does not wait for network/retries.
        QTRY_COMPARE_WITH_TIMEOUT(requests, 1, 2000);
        QVERIFY(dashboard.config().gateKey.isEmpty());
        QTRY_COMPARE_WITH_TIMEOUT(dashboard.config().gateSecret, QString("reloaded-secret"), 8000);
        QCOMPARE(dashboard.config().gateKey, QString("reloaded-key"));
        QCOMPARE(requests, 2);
        QVERIFY(retryDelay >= 4900);
        const auto snapshot = QJsonDocument(dashboard.environmentSnapshot()).toJson();
        QVERIFY(!snapshot.contains("reloaded-secret"));
        QVERIFY(!snapshot.contains("private-error-body"));
        QVERIFY(!QJsonDocument(orders::loadEnvironmentSettings(config.schedulePath)).toJson()
            .contains("reloaded-secret"));
        QTest::qWait(5500);
        QCOMPARE(requests, 2); // Success stops retries.
        // Saving again (even the same URL) must request the latest remote values.
        dashboard.configureEnvironment({{"SUPABASE_URL", dashboard.config().supabaseUrl}});
        QTRY_COMPARE_WITH_TIMEOUT(requests, 3, 2000);
    }

    void changedSupabaseSettingsDiscardOldRequestAndFallback() {
        QTemporaryDir directory;
        QTcpServer oldServer, newServer;
        QVERIFY(oldServer.listen(QHostAddress::LocalHost, 0));
        QVERIFY(newServer.listen(QHostAddress::LocalHost, 0));
        int oldRequests = 0, newRequests = 0;
        const auto serve = [&](QTcpServer &server, int &count, const QByteArray &body, bool delay) {
            connect(&server, &QTcpServer::newConnection, &server, [&, body, delay, serverPtr = &server, countPtr = &count] {
                while (serverPtr->hasPendingConnections()) {
                    auto *socket = serverPtr->nextPendingConnection();
                    auto buffer = std::make_shared<QByteArray>();
                    connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
                    connect(socket, &QTcpSocket::readyRead, socket, [socket, buffer, body, delay, countPtr] {
                        buffer->append(socket->readAll());
                        if (!buffer->contains("\r\n\r\n")) return;
                        ++*countPtr;
                        const auto respond = [socket, body] {
                            socket->write("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: "
                                + QByteArray::number(body.size()) + "\r\n\r\n" + body);
                            socket->disconnectFromHost();
                        };
                        QTimer::singleShot(delay ? 1000 : 0, socket, respond);
                    });
                }
            });
        };
        serve(oldServer, oldRequests, R"([{"API_KEY=":"stale-key","API_SECRET=":"stale-secret"}])", true);
        serve(newServer, newRequests, R"([{"API_KEY=":"latest-key","API_SECRET=":"latest-secret"}])", false);
        orders::Config config;
        config.schedulePath = directory.filePath("config");
        config.supabaseGateKey = "previous-key";
        config.supabaseGateSecret = "previous-secret";
        config.applyConnectionSettings();
        orders::Dashboard dashboard(config);
        dashboard.configureEnvironment({
            {"SUPABASE_URL", QString("http://127.0.0.1:%1").arg(oldServer.serverPort())},
            {"SUPABASE_ANON_KEY", "sb_publishable_old"}});
        QVERIFY(dashboard.config().supabaseGateKey.isEmpty());
        QTRY_COMPARE_WITH_TIMEOUT(oldRequests, 1, 2000);
        dashboard.configureEnvironment({
            {"SUPABASE_URL", QString("http://127.0.0.1:%1").arg(newServer.serverPort())},
            {"SUPABASE_ANON_KEY", "sb_publishable_new"}, {"API_KEY", "manual-key"}});
        QTRY_COMPARE_WITH_TIMEOUT(dashboard.config().gateSecret, QString("latest-secret"), 3000);
        QCOMPARE(dashboard.config().gateKey, QString("manual-key"));
        QCOMPARE(newRequests, 1);
        QTest::qWait(1200);
        QCOMPARE(dashboard.config().supabaseGateKey, QString("latest-key"));
        QCOMPARE(dashboard.config().gateSecret, QString("latest-secret"));
    }

    void credentialRetryStopsOnDestruction() {
        QTemporaryDir directory;
        orders::Config config;
        config.schedulePath = directory.filePath("config");
        QElapsedTimer elapsed;
        elapsed.start();
        {
            orders::Dashboard dashboard(config);
            dashboard.reloadGateCredentials(); // Missing startup configuration starts retries.
            QTest::qWait(100);
        }
        QVERIFY(elapsed.elapsed() < 1000); // Does not wait for the five-second retry delay.
    }

    void missingGateCredentialsNeverAuthenticate() {
        orders::Config config;
        try {
            orders::loadGateCredentials(config);
            QFAIL("Expected missing credential error");
        } catch (const orders::Error &error) {
            const auto text = QString::fromUtf8(error.what());
            QVERIFY(text.contains("API_KEY"));
            QVERIFY(text.contains("API_SECRET"));
        }
        int calls = 0;
        QVERIFY_EXCEPTION_THROWN(closeOffline(config,
            [&](const QByteArray &, const QByteArray &, const QByteArray &, const orders::HttpHeaders &) {
                ++calls;
                return orders::HttpResult{200, "[]"};
            }), orders::Error);
        QCOMPARE(calls, 0);
    }

    void closePricesUseExactDecimalArithmetic() {
        using orders::decimal::closePrice;
        QCOMPARE(closePrice("100", "2", "10", "0.1", "0.5"), QString("255.0"));
        QCOMPARE(closePrice("100", "-2", "1", "0.1", "0.5"), QString("84.5"));
        QCOMPARE(closePrice("100", "1", "10", "1", "0.001"), QString("131.000"));
        QCOMPARE(closePrice("100", "-1", "10", "1", "0.001"), QString("69.000"));
        QCOMPARE(closePrice("1.25", "1", "0", "1", "0.5"), QString("1.0"));
        QCOMPARE(closePrice("1.75", "1", "0", "1", "0.5"), QString("2.0"));
        QCOMPARE(orders::decimal::product("-37", "88.077351351351"),
                 QString("-3258.861999999987"));
        QCOMPARE(orders::decimal::product("9007199254740993", "0.0000000000000001"),
                 QString("0.9007199254740993"));
        QVERIFY_EXCEPTION_THROWN(closePrice("100", "1", "10", "0", "0.1"), orders::Error);
        QCOMPARE(orders::decimal::sum("-18.409900000001", "0.0660018163"),
                 QString("-18.343898183701"));
        QVERIFY_EXCEPTION_THROWN(closePrice("100", "0", "1", "1", "0.1"), orders::Error);
        QVERIFY_EXCEPTION_THROWN(closePrice("100", "-1", "100", "1", "0.1"), orders::Error);
    }

    void closePositionsReconcileAllActiveOrdersAndPersistDirections() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = "offline-key";
        config.gateSecret = "offline-secret";
        const auto position = [](qint64 size) {
            return QJsonObject{{"contract", "HYPE_USDT"}, {"size", size},
                {"entry_price", "88.077351351351"}, {"value", size ? "344.2961" : "0"},
                {"leverage_max", "75"}, {"unrealised_pnl", "-18.409900000001"},
                {"realised_pnl", "0.0660018163"}, {"initial_margin", "4.852279702667"},
                {"mark_price", "93.053"}, {"ignored_field", "not stored"}};
        };
        QJsonArray exchangePositions{position(-37), position(37), position(0)};
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
        const auto results = closeOffline(config,
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
                        return orders::HttpResult{200, QJsonDocument(exchangePositions).toJson()};
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
        QCOMPARE(results.size(), 4);
        QCOMPARE(listPages, 3); // Includes our order on page 2 even when the server caps pages.
        QCOMPARE(writes.size(), 4);
        for (int index : {0, 1}) QVERIFY(writes[index].endsWith("/stop"));
        QCOMPARE(bodies[0].value("id").toInteger(), qint64(20));
        QCOMPARE(bodies[1].value("id").toInteger(), qint64(22));
        QCOMPARE(bodies[2].value("amount").toString(), QString("37"));
        QCOMPARE(bodies[2].value("activation_price").toString(), QString("87.671"));
        QVERIFY(!bodies[2].value("is_gte").toBool());
        QCOMPARE(bodies[3].value("amount").toString(), QString("-37"));
        QVERIFY(bodies[3].value("is_gte").toBool());
        QCOMPARE(bodies[3].value("activation_price").toString(), QString("88.484"));
        for (int index : {2, 3}) {
            QVERIFY(bodies[index].value("reduce_only").toBool());
            QCOMPARE(bodies[index].value("price_offset").toString(), QString("1%"));
            QCOMPARE(bodies[index].value("price_type").toInt(), 3);
            QCOMPARE(bodies[index].value("position_mode").toString(), QString("dual_plus"));
        }
        const auto saved = orders::readPositions(config.dataPath);
        QCOMPARE(saved.size(), 2);
        QCOMPARE(saved[0].toObject().value("size").toInteger(), qint64(-37));
        QCOMPARE(saved[1].toObject().value("size").toInteger(), qint64(37));
        QCOMPARE(saved[0].toObject().value("value").toString(), QString("-3258.861999999987"));
        QCOMPARE(saved[1].toObject().value("value").toString(), QString("3258.861999999987"));
        QCOMPARE(saved[0].toObject().size(), 12);
        QVERIFY(!saved[0].toObject().contains("ignored_field"));
        QCOMPARE(saved[0].toObject().value("close_price").toString(), QString("87.671"));
        const auto trailing = orders::readTrailingOrders(config.ordersPath).orders;
        for (const auto &value : trailing) {
            const auto row = value.toObject();
            if (row.value("id").toString() == "20") QCOMPARE(row.value("original_status").toInt(), 5);
            if (row.value("id").toString() == "9007199254740993")
                QCOMPARE(row.value("original_status").toInt(), 2);
        }
    }

    void closePositionsDeriveValueWithoutExchangeValue() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = config.gateSecret = "offline";
        const QJsonObject position{{"contract", "BTC_USDT"}, {"size", "-2"},
            {"entry_price", "100"}, {"leverage_max", "75"}, {"unrealised_pnl", "0"},
            {"realised_pnl", "0"}, {"initial_margin", "10"}, {"mark_price", "100.000"}};
        QJsonArray positions;
        int writes = 0;
        QJsonObject created;
        const auto requester = [&](const QByteArray &method, const QByteArray &path,
                                   const QByteArray &body, const orders::HttpHeaders &) {
            if (path.endsWith("/positions"))
                return orders::HttpResult{200, QJsonDocument(positions).toJson()};
            if (method == "GET")
                return orders::HttpResult{200, R"({"code":0,"timestamp":123,"data":{"orders":[]}})"};
            ++writes;
            created = QJsonDocument::fromJson(body).object();
            return orders::HttpResult{200, R"({"code":0,"data":{"id":"1"}})"};
        };
        // A missing, zero, negative or invalid exchange value cannot change the derived value.
        for (const auto &exchangeValue : QJsonArray{QJsonValue(), "0", "-9999", "invalid"}) {
            auto row = position;
            if (!exchangeValue.isNull()) row.insert("value", exchangeValue);
            positions = QJsonArray{row, QJsonObject{{"size", 0}}};
            closeOffline(config, requester);
            const auto saved = orders::readPositions(config.dataPath);
            QCOMPARE(saved.size(), 1);
            QCOMPARE(saved[0].toObject().value("value").toString(), QString("-200"));
            QCOMPARE(created.value("activation_price").toString(), QString("84.500"));
            QCOMPARE(created.value("amount").toString(), QString("2"));
        }
        const int before = writes;
        for (const auto &invalidSize : QJsonArray{1.5, "no", "-9223372036854775808"}) {
            auto row = position;
            row.insert("size", invalidSize);
            positions = QJsonArray{row};
            QVERIFY_EXCEPTION_THROWN(closeOffline(config, requester), orders::Error);
            QCOMPARE(writes, before);
            QCOMPARE(orders::readPositions(config.dataPath)[0].toObject().value("value").toString(),
                     QString("-200"));
        }
    }

    void closePositionsEmptySnapshotStillStopsLegacyOrders_data() {
        QTest::addColumn<int>("status");
        QTest::newRow("pending") << 1;
        QTest::newRow("ongoing") << 2;
        QTest::newRow("partial") << 3;
        QTest::newRow("completed") << 4;
        QTest::newRow("cancelled") << 5;
    }

    void closePositionsEmptySnapshotStillStopsLegacyOrders() {
        QFETCH(int, status);
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = "key";
        config.gateSecret = "secret";
        const QJsonObject old{{"id", "1"}, {"contract", "BTC_USDT"}, {"amount", "-1"},
            {"activation_price", "100"}, {"reduce_only", true}, {"original_status", status}};
        int stops = 0, creates = 0;
        const auto results = closeOffline(config,
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
        QCOMPARE(stops, status == 1 ? 1 : 0);
        QCOMPARE(creates, 0);
        QCOMPARE(results.size(), status == 1 ? 1 : 0);
        QVERIFY(orders::readPositions(config.dataPath).isEmpty());
        const auto saved = orders::readTrailingOrders(config.ordersPath).orders;
        QCOMPARE(saved.size(), 1);
        QCOMPARE(saved[0].toObject().value("original_status").toInt(), status == 1 ? 5 : status);
    }

    void closePositionsFailuresStopTheBatch() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = "key";
        config.gateSecret = "secret";
        const QJsonObject position{{"contract", "BTC_USDT"}, {"size", 1}, {"entry_price", "100"},
            {"value", "100"}, {"leverage_max", "75"}, {"unrealised_pnl", "0"},
            {"realised_pnl", "0"}, {"initial_margin", "10"}, {"mark_price", "100.0"}};
        const QJsonObject old{{"id", "1"}, {"contract", "BTC_USDT"}, {"amount", "-1"},
            {"activation_price", "100"}, {"reduce_only", true}, {"original_status", 1}};
        int writes = 0;
        bool invalidEntry = true;
        bool duplicatePosition = false;
        bool stopFails = true;
        const auto requester = [&](const QByteArray &method, const QByteArray &path,
                                   const QByteArray &, const orders::HttpHeaders &) {
            if (path.endsWith("/positions")) {
                auto row = position;
                if (invalidEntry) row.insert("entry_price", "invalid");
                return orders::HttpResult{200, QJsonDocument(duplicatePosition ? QJsonArray{row, row} : QJsonArray{row}).toJson()};
            }
            if (method == "GET") return orders::HttpResult{200, QJsonDocument(QJsonObject{
                {"code", 0}, {"timestamp", 123}, {"data", QJsonObject{{"orders",
                    path.contains("page_num=1&") ? QJsonArray{old} : QJsonArray{}}}}}).toJson()};
            ++writes;
            if (path.endsWith("/stop") && !stopFails) return orders::HttpResult{200, R"({"code":0})"};
            return orders::HttpResult{500, "{}"};
        };
        QVERIFY_EXCEPTION_THROWN(closeOffline(config, requester), orders::Error);
        QCOMPARE(writes, 0);
        invalidEntry = false;
        duplicatePosition = true;
        QVERIFY_EXCEPTION_THROWN(closeOffline(config, requester), orders::Error);
        QCOMPARE(writes, 0); // Reject duplicate position directions before any stop/create.
        duplicatePosition = false;
        auto results = closeOffline(config, requester);
        QCOMPARE(writes, 1);
        QCOMPARE(results.last().toObject().value("operation").toString(), QString("stop"));
        writes = 0;
        stopFails = false;
        results = closeOffline(config, requester);
        QCOMPARE(writes, 2); // One stop, one failed create; no immediate retry.
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
        const auto results = openOffline(config,
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
        QCOMPARE(results.size(), 3);
        QCOMPARE(paths.size(), 3);
        QVERIFY(paths[0].endsWith("/stop"));
        QVERIFY(paths[1].endsWith("/create"));
        QCOMPARE(bodies[0].value("id").toInteger(), qint64(9007199254740993));
        QCOMPARE(bodies[1].value("amount").toString(), QString("371"));
        QCOMPARE(bodies[1].value("activation_price").toString(), QString("4071.29"));
        QVERIFY(!bodies[1].value("reduce_only").toBool());
        QVERIFY(!bodies[1].value("is_gte").toBool());
        QVERIFY(bodies[2].value("is_gte").toBool());
        QCOMPARE(bodies[1].value("price_type").toInt(), 3);
        QCOMPARE(bodies[1].value("price_offset").toString(), QString("1%"));
        QCOMPARE(bodies[1].value("position_mode").toString(), QString("dual_plus"));
        const auto saved = orders::readTrailingOrders(config.ordersPath).orders;
        QCOMPARE(saved.size(), 7);
        for (const auto &value : saved) {
            const auto row = value.toObject();
            if (row.value("id").toString() == "2")
                QCOMPARE(row, old("2", false, 2));
        }
        QCOMPARE(saved[0].toObject().value("id").toString(), QString("100"));
    }

    void entryHistoryBoundariesAndRetention() {
        QTemporaryDir directory;
        const auto path = directory.filePath("data.db");
        const auto now = QDateTime::currentMSecsSinceEpoch();
        constexpr qint64 week = 7LL * 24 * 60 * 60 * 1000;
        const auto event = [](QString id, QString contract, int side, qint64 time) {
            return QJsonObject{{"event_id", id}, {"contract", contract}, {"side", side}, {"entry_time", time}};
        };
        orders::saveEntryHistory(path, "owner", QJsonArray{
            event("1", "BTC_USDT", 1, now - week), event("2", "ETH_USDT", -1, now - week - 1)}, now);
        QVERIFY(orders::hasRecentEntry(path, "BTC_USDT", 1, now));
        QVERIFY(!orders::hasRecentEntry(path, "BTC_USDT", -1, now));
        QVERIFY(!orders::hasRecentEntry(path, "ETH_USDT", -1, now));
        QVERIFY(!orders::hasRecentEntry(path, "BTC_USDT", 1, now + 1));
        QJsonArray events;
        for (int index = 0; index < 101; ++index)
            events.append(event(QString::number(100 + index), "SOL_USDT", 1, now + 1 + index));
        orders::saveEntryHistory(path, "owner", events, now + 101);
        QVERIFY(!orders::hasRecentEntry(path, "BTC_USDT", 1, now + 101));
        orders::saveEntryHistory(path, "owner", events, now + 102); // Restart/overlap cannot replay pruned rows.
        const auto name = QUuid::createUuid().toString();
        {
            auto db = QSqlDatabase::addDatabase("QSQLITE", name);
            db.setDatabaseName(path);
            QVERIFY(db.open());
            QSqlQuery query(db);
            QVERIFY(query.exec("SELECT COUNT(*) FROM position_entry_history"));
            QVERIFY(query.next());
            QCOMPARE(query.value(0).toInt(), 100);
            QVERIFY(query.exec("SELECT name FROM sqlite_master WHERE name='managed_close_orders'"));
            QVERIFY(!query.next());
        }
        QSqlDatabase::removeDatabase(name);
    }

    void openingUsesConfirmedFillsAndRejectsUnavailableHistory() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = config.gateSecret = "offline";
        orders::saveSources(config.dataPath, QJsonArray{QJsonObject{{"data",
            "contract: BTC_USDT\nactivation_price: 100\namount: 1\nTimestamp: 1\n"
            "contract: ETH_USDT\nactivation_price: 100\namount: -1\nTimestamp: 1\n"
            "contract: SOL_USDT\nactivation_price: 100\namount: 1\nTimestamp: 1"}}});
        const double time = double(QDateTime::currentMSecsSinceEpoch() - 10000) / 1000;
        const auto fill = [&](QString id, QString contract, QString size, QString closed) {
            return QJsonObject{{"trade_id", id}, {"contract", contract}, {"size", size},
                {"close_size", closed}, {"create_time", time}};
        };
        QJsonArray fills{QJsonObject{{"trade_id", "9007199254740993"}, {"contract", "BTC_USDT"},
                {"size", 1}, {"close_size", 0}, {"create_time", time}}, // Opening.
            fill("2", "BTC_USDT", "2", "0"), // Adding is a separate real fill.
            fill("3", "ETH_USDT", "-5", "-2"), // Reverse opens a short.
            fill("4", "SOL_USDT", "1", "1"), // Pure close.
            fill("5", "SOL_USDT", "-1", "-2")}; // Partial close.
        bool unavailable = true;
        QStringList submitted;
        const auto sender = [&](const QByteArray &, const QByteArray &body, const orders::HttpHeaders &) {
            submitted.append(QJsonDocument::fromJson(body).object().value("contract").toString());
            return orders::HttpResult{200, R"({"code":0,"data":{"id":"100"}})"};
        };
        const auto reader = [&](const QByteArray &, const QByteArray &path, const QByteArray &,
                                const orders::HttpHeaders &) {
            if (unavailable) return orders::HttpResult{503, "unavailable"};
            // Server caps the page at one row: continue until empty, not until a short page.
            const auto offset = path.mid(path.indexOf("offset=") + 7).toInt();
            const auto page = offset < fills.size() ? QJsonArray{fills[offset]} : QJsonArray{};
            return orders::HttpResult{200, QJsonDocument(page).toJson()};
        };
        QVERIFY_EXCEPTION_THROWN(orders::createTrailingOrders(config, sender, reader), orders::Error);
        QVERIFY(submitted.isEmpty());
        unavailable = false;
        const auto results = orders::createTrailingOrders(config, sender, reader);
        QCOMPARE(results.size(), 3);
        QCOMPARE(results[0].toObject().value("action").toString(), QString("skipped"));
        QCOMPARE(results[1].toObject().value("action").toString(), QString("skipped"));
        QCOMPARE(submitted, QStringList{"SOL_USDT"});
        QVERIFY(orders::hasRecentEntry(config.dataPath, "BTC_USDT", 1, QDateTime::currentMSecsSinceEpoch()));
        QVERIFY(orders::hasRecentEntry(config.dataPath, "ETH_USDT", -1, QDateTime::currentMSecsSinceEpoch()));
        QVERIFY(!orders::hasRecentEntry(config.dataPath, "SOL_USDT", 1, QDateTime::currentMSecsSinceEpoch()));
        QVERIFY(!orders::hasRecentEntry(config.dataPath, "SOL_USDT", -1, QDateTime::currentMSecsSinceEpoch()));
        const auto name = QUuid::createUuid().toString();
        {
            auto db = QSqlDatabase::addDatabase("QSQLITE", name);
            db.setDatabaseName(config.dataPath);
            QVERIFY(db.open());
            QSqlQuery query(db);
            QVERIFY(query.exec("SELECT COUNT(*) FROM position_entry_history"));
            QVERIFY(query.next());
            QCOMPARE(query.value(0).toInt(), 3);
        }
        QSqlDatabase::removeDatabase(name);
        submitted.clear();
        orders::createTrailingOrders(config, sender, reader); // Restart/unchanged polling: no replay.
        QVERIFY(submitted.isEmpty());
    }

    void closeRejectsMissingContractParametersBeforeExchangeWrites() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = config.gateSecret = "offline";
        int writes = 0;
        const auto reader = [&](const QByteArray &method, const QByteArray &path, const QByteArray &,
                                const orders::HttpHeaders &) {
            if (method == "POST") ++writes;
            if (path.contains("my_trades_timerange")) return orders::HttpResult{200, "[]"};
            if (path.endsWith("/positions")) return orders::HttpResult{200,
                R"([{"contract":"BTC_USDT","size":1,"entry_price":"100","initial_margin":"1","leverage_max":"75","unrealised_pnl":"0","realised_pnl":"0","mark_price":"100"}])"};
            return orders::HttpResult{200, R"({"name":"BTC_USDT","quanto_multiplier":"0.1"})"};
        };
        QVERIFY_EXCEPTION_THROWN(orders::closePositionOrders(config, reader), orders::Error);
        QCOMPARE(writes, 0);
        QVERIFY(orders::readPositions(config.dataPath).isEmpty());
    }

    void activeOrderMatching_data() {
        QTest::addColumn<QString>("contract");
        QTest::addColumn<QString>("amount");
        QTest::addColumn<QString>("price");
        QTest::addColumn<int>("status");
        QTest::addColumn<bool>("unchanged");
        QTest::newRow("same") << QString("XAU_USDT") << QString("371") << QString("4071.29") << 1 << true;
        QTest::newRow("equivalent-format") << QString("XAU_USDT") << QString("+0371.00 Contracts") << QString("04071.2900") << 2 << true;
        QTest::newRow("contract-changed") << QString("SOL_USDT") << QString("371") << QString("4071.29") << 1 << false;
        QTest::newRow("amount-changed") << QString("XAU_USDT") << QString("372") << QString("4071.29") << 1 << false;
        QTest::newRow("opposite-direction") << QString("XAU_USDT") << QString("-371") << QString("4071.29") << 1 << false;
        QTest::newRow("price-changed") << QString("XAU_USDT") << QString("371") << QString("4071.2900000000000001") << 1 << false;
        QTest::newRow("ongoing-price-changed") << QString("XAU_USDT") << QString("371") << QString("4072") << 2 << false;
        QTest::newRow("cancelled") << QString("XAU_USDT") << QString("371") << QString("4071.29") << 5 << false;
    }

    void activeOrderMatching() {
        QFETCH(QString, contract);
        QFETCH(QString, amount);
        QFETCH(QString, price);
        QFETCH(int, status);
        QFETCH(bool, unchanged);
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = config.gateSecret = "offline";
        orders::saveSources(config.dataPath, QJsonArray{QJsonObject{{"data",
            "contract: XAU_USDT\nactivation_price: 4071.29 USDT\namount: 371 Contracts\nTimestamp: 1791011512347\n"
            "contract: BTC_USDT\nactivation_price: 100 USDT\namount: -2 Contracts\nTimestamp: 1791011512347"}}});
        orders::saveTrailingOrders(config.ordersPath, QJsonArray{
            QJsonObject{{"id", "1"}, {"contract", contract}, {"amount", amount},
                {"activation_price", price}, {"reduce_only", false},
                {"original_status", status}, {"timestamp", qint64(1791011512347)}},
            QJsonObject{{"id", "2"}, {"contract", "BTC_USDT"}, {"amount", "-2"},
                {"activation_price", "100"}, {"reduce_only", false},
                {"original_status", 1}, {"timestamp", qint64(1791011512347)}},
            // A matching close order must never suppress an opening order.
            QJsonObject{{"id", "3"}, {"contract", "XAU_USDT"}, {"amount", "371"},
                {"activation_price", "4071.29"}, {"reduce_only", true},
                {"original_status", 4}, {"timestamp", qint64(1791011512347)}}});
        QList<QByteArray> paths;
        const auto sender = [&](const QByteArray &path, const QByteArray &body, const orders::HttpHeaders &) {
            paths.append(path);
            const auto payload = QJsonDocument::fromJson(body).object();
            if (path.endsWith("/stop")) {
                if (payload.value("id").toInteger() != 1) return orders::HttpResult{400, "{}"};
                return orders::HttpResult{200, R"({"code":0})"};
            }
            if (payload.value("contract").toString() != "XAU_USDT") return orders::HttpResult{400, "{}"};
            return orders::HttpResult{200, R"({"code":0,"data":{"id":"100"}})"};
        };
        const auto results = openOffline(config, sender);
        QCOMPARE(paths.size(), unchanged ? 0 : status == 1 ? 2 : 1);
        int skipped = 0, created = 0;
        for (const auto &value : results) {
            const auto action = value.toObject().value("action").toString();
            QVERIFY(action != "failed");
            skipped += action == "skipped";
            created += action == "created";
        }
        QCOMPARE(skipped, unchanged ? 2 : 1);
        QCOMPARE(created, unchanged ? 0 : 1);
        // A refreshed source timestamp alone must not recreate an active order.
        orders::saveSources(config.dataPath, QJsonArray{QJsonObject{{"data",
            "contract: XAU_USDT\nactivation_price: 4071.2900 USDT\namount: 371 Contracts\nTimestamp: 1791011572347\n"
            "contract: BTC_USDT\nactivation_price: 100.00 USDT\namount: -2 Contracts\nTimestamp: 1791011572347"}}});
        paths.clear();
        const auto repeated = openOffline(config, sender);
        QVERIFY(paths.isEmpty());
        QCOMPARE(repeated.size(), 2);
        for (const auto &value : repeated)
            QCOMPARE(value.toObject().value("action").toString(), QString("skipped"));
    }

    void closeOrdersRetainUnchangedAndReplaceChangedAcrossPolls() {
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = config.gateSecret = "offline";
        const auto position = [](QString contract, qint64 size) {
            return QJsonObject{{"contract", contract}, {"size", size}, {"entry_price", "100"},
                {"value", "100"}, {"leverage_max", "75"}, {"unrealised_pnl", "0"},
                {"realised_pnl", "0"}, {"initial_margin", "10"}, {"mark_price", "100.000"}};
        };
        QJsonArray positions{position("BTC_USDT", 1), position("BTC_USDT", -1)};
        const auto old = [](QString id, QString amount, QString price, int status = 1) {
            return QJsonObject{{"id", id}, {"contract", "BTC_USDT"}, {"amount", amount},
                {"activation_price", price}, {"reduce_only", true}, {"original_status", status}};
        };
        QJsonArray exchange{old("1", "-1", "0131.0000", 2), old("2", "1", "69.000"),
            old("3", "-1", "162.000"), old("4", "-1", "131.000"),
            old("5", "-1", "131.000", 4), old("6", "-1", "131.000", 5)}; // Legacy duplicates and inactive orders.
        int gets = 0, stops = 0, creates = 0;
        QList<qint64> stoppedIds;
        const auto requester = [&](const QByteArray &method, const QByteArray &path,
                                   const QByteArray &body, const orders::HttpHeaders &) {
            if (method == "GET") {
                ++gets;
                if (path.endsWith("/positions")) return orders::HttpResult{200, QJsonDocument(positions).toJson()};
                return orders::HttpResult{200, QJsonDocument(QJsonObject{{"code", 0}, {"timestamp", 123},
                    {"data", QJsonObject{{"orders", path.contains("page_num=1&") ? exchange : QJsonArray{}}}}}).toJson()};
            }
            const auto payload = QJsonDocument::fromJson(body).object();
            if (path.endsWith("/stop")) {
                ++stops;
                const auto id = payload.value("id").toInteger();
                stoppedIds.append(id);
                for (qsizetype index = 0; index < exchange.size(); ++index) {
                    auto row = exchange[index].toObject();
                    if (row.value("id").toString() == QString::number(id)) {
                        row.insert("original_status", 5);
                        exchange[index] = row;
                    }
                }
                return orders::HttpResult{200, R"({"code":0})"};
            }
            ++creates;
            const auto id = QString::number(99 + creates);
            auto saved = payload;
            saved.insert("id", id);
            saved.insert("original_status", 1);
            exchange.append(saved);
            return orders::HttpResult{200, QJsonDocument(QJsonObject{{"code", 0},
                {"data", QJsonObject{{"id", id}}}}).toJson()};
        };
        auto results = closeOffline(config, requester);
        QCOMPARE(gets, 3);
        QCOMPARE(stops, 2);
        QCOMPARE(creates, 0);
        QCOMPARE(results.size(), 4);
        QCOMPARE(stoppedIds, QList<qint64>({3, 4}));
        results = closeOffline(config, requester);
        QCOMPARE(stops, 2);
        QCOMPARE(creates, 0);
        QCOMPARE(results.size(), 2);
        for (const auto &value : results)
            QCOMPARE(value.toObject().value("action").toString(), QString("skipped"));
        // Short quantity changes while the long protection stays unchanged.
        positions = QJsonArray{position("BTC_USDT", 1), position("BTC_USDT", -2)};
        results = closeOffline(config, requester);
        QCOMPARE(stops, 3);
        QCOMPARE(creates, 1);
        QCOMPARE(stoppedIds[2], qint64(2));
        QCOMPARE(results.size(), 3);
        QCOMPARE(results[0].toObject().value("id").toString(), QString("1"));
        QCOMPARE(results[0].toObject().value("action").toString(), QString("skipped"));
        QCOMPARE(results.last().toObject().value("amount").toString(), QString("2"));
        results = closeOffline(config, requester);
        QCOMPARE(gets, 12); // Each poll still obtains fresh positions and the exchange list.
        QCOMPARE(stops, 3);
        QCOMPARE(creates, 1);
        for (const auto &value : results)
            QCOMPARE(value.toObject().value("action").toString(), QString("skipped"));
        // A changed close price creates a new long order without stopping the ongoing one.
        auto changed = position("BTC_USDT", 1);
        changed.insert("initial_margin", "20");
        positions = QJsonArray{changed, position("BTC_USDT", -2)};
        results = closeOffline(config, requester);
        QCOMPARE(stops, 3);
        QCOMPARE(creates, 2);
        QVERIFY(!stoppedIds.contains(1));
        QCOMPARE(results.size(), 2);
        QCOMPARE(results[0].toObject().value("id").toString(), QString("100"));
        QCOMPARE(results.last().toObject().value("activation_price").toString(), QString("162.000"));
        results = closeOffline(config, requester);
        QCOMPARE(gets, 18);
        QCOMPARE(stops, 3);
        QCOMPARE(creates, 2);
        for (const auto &value : results)
            QCOMPARE(value.toObject().value("action").toString(), QString("skipped"));
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
        const auto result = openOffline(config,
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
        QVERIFY_EXCEPTION_THROWN(openOffline(config, sender), orders::Error);
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
        const auto results = openOffline(config,
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
                    if (buffer->contains("offset=0"))
                        body = "[{\"id\":6,\"contract\":\"XAU_USDT\",\"activation_price\":4071.29,\"amount\":371,\"side\":\"Open Long\",\"timestamp\":1791011512347}]";
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
        orders::Dashboard dashboard(config,
            [](const QByteArray &, const QByteArray &path, const QByteArray &, const orders::HttpHeaders &) {
                return contractFixture(path);
            });
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

    void directOrdersPreservePrecisionAndRoundTrip() {
        const auto items = orders::parseSupabaseOrders("[{\"id\":9007199254740993,\n"
            "            \"created_at\":\"2026-10-05T10:02:45Z\",\"contract\":\"XAU_USDT\",\n"
            "            \"activation_price\":4082.430000000000000001,\"amount\":-350,\"side\":\"Open Short\",\n"
            "            \"timestamp\":1791194547002,\"value\":143.080000000000000001,\n"
            "            \"note\":\"escaped \\\"amount\\\":123 and unicode \\u4e2d\"}]");
        const auto item = items.first().toObject();
        QCOMPARE(item.value("id").toString(), QString("9007199254740993"));
        QCOMPARE(item.value("activation_price").toString(), QString("4082.430000000000000001"));
        QCOMPARE(item.value("value").toString(), QString("143.080000000000000001"));
        QCOMPARE(item.value("note").toString(), QString::fromUtf8("escaped \"amount\":123 and unicode 中"));
        QTemporaryDir directory;
        const auto path = directory.filePath("data.db");
        orders::saveSources(path, items);
        const auto snapshot = orders::readSources(path);
        QCOMPARE(snapshot.items, items);
        QCOMPARE(snapshot.orders.size(), 1);
        const auto order = snapshot.orders.first().toObject();
        QCOMPARE(order.value("amount").toString(), QString("-350"));
        QCOMPARE(order.value("activation_price"), item.value("activation_price"));
        QCOMPARE(order.value("timestamp").toInteger(), 1791194547002LL);
        QVERIFY_EXCEPTION_THROWN(orders::saveSources(path, QJsonArray{QJsonObject{
            {"contract", "XAU_USDT"}, {"activation_price", "1"}, {"amount", "0"},
            {"timestamp", 1791194547002LL}}}), orders::Error);
        QCOMPARE(orders::readSources(path).items, items);
        QCOMPARE(orders::readSources(path).orders, snapshot.orders);
    }

    void directOrdersRejectInvalidPages_data() {
        QTest::addColumn<QByteArray>("body");
        QTest::newRow("partial-null") << QByteArray("[{\"contract\":null,\"activation_price\":1,\"amount\":null,\"side\":null,\"timestamp\":123}]");
        QTest::newRow("null-missing-time") << QByteArray("[{\"contract\":null,\"activation_price\":null,\"amount\":null,\"side\":null}]");
        QTest::newRow("invalid-json") << QByteArray("broken");
        QTest::newRow("object") << QByteArray("{}");
        QTest::newRow("null-row") << QByteArray("[null]");
        QTest::newRow("legacy-url") << QByteArray("[{\"url\":\"https://example.com\"}]");
        QTest::newRow("invalid-number") << QByteArray("[{\"amount\":01}]");
        QTest::newRow("missing-time") << QByteArray("[{\"contract\":\"XAU_USDT\",\"activation_price\":1,\"amount\":1}]");
        QTest::newRow("fractional-amount") << QByteArray("[{\"contract\":\"XAU_USDT\",\"activation_price\":1,\"amount\":1.5,\"timestamp\":123}]");
        QTest::newRow("negative-price") << QByteArray("[{\"contract\":\"XAU_USDT\",\"activation_price\":-1,\"amount\":1,\"timestamp\":123}]");
        QTest::newRow("unsafe-time") << QByteArray("[{\"contract\":\"XAU_USDT\",\"activation_price\":1,\"amount\":1,\"timestamp\":9007199254740993}]");
    }

    void directOrdersRejectInvalidPages() {
        QFETCH(QByteArray, body);
        QVERIFY_EXCEPTION_THROWN(orders::parseSupabaseOrders(body), orders::Error);
    }

    void nullOrderSnapshotClearsSourcesAndStopsOnlyOpeningOrders_data() {
        QTest::addColumn<QByteArray>("body");
        QTest::newRow("empty-table") << QByteArray("[]");
        QTest::newRow("null-marker") << QByteArray(
            "[{\"id\":1,\"contract\":null,\"activation_price\":null,"
            "\"amount\":null,\"side\":null,\"timestamp\":123}]");
    }

    void nullOrderSnapshotClearsSourcesAndStopsOnlyOpeningOrders() {
        QFETCH(QByteArray, body);
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        config.gateKey = config.gateSecret = "offline";
        orders::saveSources(config.dataPath, orders::parseSupabaseOrders(
            "[{\"contract\":\"BTC_USDT\",\"activation_price\":1,\"amount\":1,\"timestamp\":123}]"));
        const auto rows = orders::parseSupabaseOrders(body);
        orders::saveSources(config.dataPath, rows);
        QCOMPARE(orders::readSources(config.dataPath).items, rows);
        QVERIFY(orders::readSources(config.dataPath).orders.isEmpty());
        QJsonArray old;
        for (int id = 1; id <= 4; ++id) {
            old.append(QJsonObject{{"id", QString::number(id)}, {"contract", "BTC_USDT"},
                {"amount", "1"}, {"activation_price", "1"}, {"timestamp", 123},
                {"reduce_only", id == 3}, {"original_status", id == 4 ? 4 : id == 2 ? 2 : 1}});
        }
        orders::saveTrailingOrders(config.ordersPath, old);
        int stops = 0;
        const auto results = openOffline(config,
            [&](const QByteArray &path, const QByteArray &, const orders::HttpHeaders &) {
                if (!path.endsWith("/stop")) return orders::HttpResult{500, "{}"};
                ++stops;
                return orders::HttpResult{200, R"({"code":0})"};
            });
        QCOMPARE(stops, 1);
        QCOMPARE(results.size(), 1);
        const auto saved = orders::readTrailingOrders(config.ordersPath).orders;
        QCOMPARE(saved[0].toObject().value("original_status").toInt(), 5);
        QCOMPARE(saved[1], old[1]);
        QCOMPARE(saved[2], old[2]);
        QCOMPARE(saved[3], old[3]);
        config.gateKey.clear();
        config.gateSecret.clear();
        QVERIFY(openOffline(config).isEmpty());
    }

    void directOrdersAcceptEmptyAndScientificNotation() {
        QVERIFY(orders::parseSupabaseOrders("[]").isEmpty());
        const auto rows = orders::parseSupabaseOrders("[{\"contract\":\"XAU_USDT\",\n"
            "            \"activation_price\":1.23e-8,\"amount\":-3.5e2,\"timestamp\":\"1791194547002\"}]");
        QCOMPARE(rows.first().toObject().value("activation_price").toString(), QString("0.0000000123"));
        QCOMPARE(rows.first().toObject().value("amount").toString(), QString("-350"));
    }

    void sourcePagingReadsOnlyOrdersTable_data() {
        QTest::addColumn<QByteArray>("key");
        QTest::addColumn<bool>("bearer");
        QTest::addColumn<bool>("counted");
        QTest::addColumn<bool>("nullFirstPage");
        QTest::newRow("publishable") << QByteArray("sb_publishable_fixture") << false << false << false;
        QTest::newRow("legacy-jwt") << QByteArray("header.payload.signature") << true << false << false;
        QTest::newRow("exact-count") << QByteArray("sb_secret_fixture") << false << true << false;
        QTest::newRow("null-page-counted") << QByteArray("offline") << false << true << true;
        QTest::newRow("null-page-uncounted") << QByteArray("offline") << false << false << true;
    }

    void sourcePagingReadsOnlyOrdersTable() {
        QFETCH(QByteArray, key);
        QFETCH(bool, bearer);
        QFETCH(bool, counted);
        QFETCH(bool, nullFirstPage);
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
                    if (!buffer->contains("\r\n\r\n")) return;
                    requests.append(*buffer);
                    QByteArray body = "[]";
                    if (buffer->contains("offset=0"))
                        body = "[{\"id\":1,\"contract\":\"XAU_USDT\",\"activation_price\":1.2300,\"amount\":350,\"timestamp\":1791194547002,\"url\":\"http://127.0.0.1:1/never-fetch\"}]";
                    else if (buffer->contains("offset=1"))
                        body = "[{\"id\":2,\"contract\":\"BTC_USDT\",\"activation_price\":\"2.5000\",\"amount\":\"-1\",\"timestamp\":1791194547003}]";
                    if (nullFirstPage && buffer->contains("offset=0"))
                        body = "[{\"id\":1,\"contract\":null,\"activation_price\":null,\"amount\":null,\"side\":null,\"timestamp\":123}]";
                    const QByteArray range = counted
                        ? (requests.size() == 1 ? "Content-Range: 0-0/2\r\n" : "Content-Range: 1-1/2\r\n") : "";
                    socket->write("HTTP/1.1 200 OK\r\n" + range + "Connection: close\r\nContent-Length: "
                                  + QByteArray::number(body.size()) + "\r\n\r\n" + body);
                    socket->disconnectFromHost();
                });
            }
        });
        orders::Config config;
        config.supabaseUrl = base + "/";
        config.supabaseKey = QString::fromUtf8(key);
        auto future = QtConcurrent::run([config] { return fetchOffline(config); });
        QTRY_VERIFY_WITH_TIMEOUT(future.isFinished(), 5000);
        const auto items = future.result();
        QCOMPARE(items.size(), 2);
        if (nullFirstPage) QVERIFY(items[0].toObject().value("contract").isNull());
        else QCOMPARE(items[0].toObject().value("activation_price").toString(), QString("1.2300"));
        QTemporaryDir directory;
        const auto path = directory.filePath("data.db");
        orders::saveSources(path, items);
        QCOMPARE(orders::readSources(path).orders.size(), nullFirstPage ? 1 : 2);
        QCOMPARE(items[1].toObject().value("amount").toString(), QString("-1"));
        const auto stored = orders::readSources(path).orders;
        QCOMPARE(stored.last().toObject().value("quanto_multiplier").toString(), QString("1"));
        QCOMPARE(stored.last().toObject().value("order_price_round").toString(), QString("0.001"));
        QCOMPARE(requests.size(), counted ? 2 : 3);
        for (int index = 0; index < requests.size(); ++index) {
            const auto request = requests[index];
            QVERIFY(request.startsWith("GET /rest/v1/orders?"));
            QVERIFY(request.contains("order=id.asc"));
            QVERIFY(request.contains("limit=1000"));
            QVERIFY(request.toLower().contains("prefer: count=exact"));
            QVERIFY(request.contains("offset=" + QByteArray::number(index)));
            QVERIFY(request.contains("apikey: " + key));
            QCOMPARE(request.toLower().contains("authorization: bearer " + key.toLower()), bearer);
        }
    }

    void failedSecondOrderPageKeepsPreviousSnapshot_data() {
        QTest::addColumn<int>("status");
        QTest::addColumn<QByteArray>("body");
        QTest::addColumn<QByteArray>("range");
        QTest::newRow("http-failure") << 503 << QByteArray("unavailable") << QByteArray();
        QTest::newRow("invalid-row") << 200 << QByteArray("[{}]") << QByteArray();
        QTest::newRow("redirect") << 302 << QByteArray("[]") << QByteArray();
        QTest::newRow("changed-count") << 200 << QByteArray("[]") << QByteArray("*/3");
        QTest::newRow("early-end") << 200 << QByteArray("[]") << QByteArray("*/2");
    }

    void failedSecondOrderPageKeepsPreviousSnapshot() {
        QFETCH(int, status);
        QFETCH(QByteArray, body);
        QFETCH(QByteArray, range);
        QTemporaryDir directory;
        orders::Config config;
        config.dataPath = config.ordersPath = directory.filePath("data.db");
        const auto previous = orders::parseSupabaseOrders("[{\"contract\":\"BTC_USDT\",\n"
            "            \"activation_price\":100,\"amount\":1,\"timestamp\":123}]");
        orders::saveSources(config.dataPath, previous);
        const auto previousOrders = orders::readSources(config.dataPath).orders;
        QTcpServer server;
        QVERIFY(server.listen(QHostAddress::LocalHost, 0));
        config.supabaseUrl = QString("http://127.0.0.1:%1").arg(server.serverPort());
        config.supabaseKey = "offline";
        int requests = 0;
        connect(&server, &QTcpServer::newConnection, &server, [&] {
            while (server.hasPendingConnections()) {
                auto *socket = server.nextPendingConnection();
                auto buffer = std::make_shared<QByteArray>();
                connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
                connect(socket, &QTcpSocket::readyRead, socket, [&, socket, buffer] {
                    buffer->append(socket->readAll());
                    if (!buffer->contains("\r\n\r\n")) return;
                    const bool first = ++requests == 1;
                    const QByteArray responseBody = first
                        ? QByteArray("[{\"contract\":\"XAU_USDT\",\"activation_price\":1,\"amount\":2,\"timestamp\":124}]") : body;
                    const QByteArray rangeHeader = range.isEmpty() ? QByteArray{}
                        : "Content-Range: " + (first ? QByteArray("0-0/2") : range) + "\r\n";
                    socket->write("HTTP/1.1 " + QByteArray::number(first ? 200 : status)
                        + " Response\r\n" + rangeHeader + "Connection: close\r\nLocation: /never-fetch\r\nContent-Length: "
                        + QByteArray::number(responseBody.size()) + "\r\n\r\n" + responseBody);
                    socket->disconnectFromHost();
                });
            }
        });
        orders::Dashboard dashboard(config);
        auto future = QtConcurrent::run([&] { return dashboard.refreshSources(); });
        QTRY_VERIFY_WITH_TIMEOUT(future.isFinished(), 5000);
        QVERIFY(!future.result().success);
        QCOMPARE(requests, 2);
        const auto snapshot = dashboard.sourceSnapshot();
        QCOMPARE(snapshot.value("items").toArray(), previous);
        QCOMPARE(snapshot.value("orders").toArray(), previousOrders);
        QVERIFY(!snapshot.value("refreshing").toBool());
        QVERIFY(snapshot.value("execution").toArray().isEmpty());
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
        verifyCancellation(fetchOffline, config);
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
