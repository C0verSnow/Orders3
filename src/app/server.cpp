#include "app/server.hpp"
#include "core/error.hpp"
#include <QFile>
#include <QFileInfo>
#include <QHostAddress>
#include <QHttpServerRequest>
#include <QHttpServerResponse>
#include <QJsonDocument>
#include <QJsonParseError>
#include <QTcpServer>
#include <QtConcurrent/QtConcurrentRun>
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
#include <QHttpHeaders>
#endif

namespace orders {
namespace {
using Status = QHttpServerResponse::StatusCode;

void header(QHttpServerResponse &response, const QByteArray &name, const QByteArray &value) {
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
    auto headers = response.headers();
    headers.append(name, value);
    response.setHeaders(std::move(headers));
#else
    response.setHeader(name, value);
#endif
}

QHttpServerResponse body(const QByteArray &type, const QByteArray &content, Status status = Status::Ok) {
    QHttpServerResponse response(type, content, status);
    header(response, "Cache-Control", "no-store");
    header(response, "X-Content-Type-Options", "nosniff");
    header(response, "Content-Security-Policy",
           "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; "
           "object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    return response;
}

QHttpServerResponse json(const QJsonObject &value, Status status = Status::Ok) {
    return body("application/json; charset=utf-8",
                QJsonDocument(value).toJson(QJsonDocument::Compact), status);
}

QHttpServerResponse error(const QString &message, Status status) {
    return json({{"error", message}}, status);
}

template <typename Function>
QHttpServerResponse guarded(Function function) {
    try {
        return function();
    } catch (const std::exception &exception) {
        return error(QString::fromUtf8(exception.what()), Status::InternalServerError);
    }
}
} // namespace

Server::Server(Dashboard &dashboard, Scheduler &scheduler)
    : dashboard_(dashboard), scheduler_(scheduler) {
    using Method = QHttpServerRequest::Method;
    const QList<QPair<QString, QByteArray>> assets{
        {"/", "text/html; charset=utf-8"}, {"/index.html", "text/html; charset=utf-8"},
        {"/app.js", "text/javascript; charset=utf-8"},
        {"/flow.js", "text/javascript; charset=utf-8"},
        {"/ui.js", "text/javascript; charset=utf-8"},
        {"/settings.js", "text/javascript; charset=utf-8"},
        {"/schedule.js", "text/javascript; charset=utf-8"},
        {"/startup.js", "text/javascript; charset=utf-8"}, {"/style.css", "text/css; charset=utf-8"},
        {"/logo.svg", "image/svg+xml"}};
    for (const auto &asset : assets) {
        http_.route(asset.first, Method::Get, [asset] {
            return guarded([&] {
                const QString filename = asset.first == "/" ? "/index.html" : asset.first;
                QFile file(":/web" + filename);
                if (!file.open(QIODevice::ReadOnly))
                    throw Error("无法读取网页资源");
                QByteArray content = file.readAll();
#ifdef Q_OS_WIN
                if (filename == "/index.html")
                    content.replace("<body>", "<body class=\"startup-enabled\">");
#endif
                return body(asset.second, content);
            });
        });
    }
    http_.route("/api/data", Method::Get, [this] {
        return guarded([&] {
            auto snapshot = dashboard_.sourceSnapshot();
            snapshot.insert("schedule", scheduler_.snapshot());
            return json(snapshot);
        });
    });
    http_.route("/api/orders", Method::Get, [this] {
        return guarded([&] { return json(dashboard_.ordersSnapshot()); });
    });
    http_.route("/api/schedule", Method::Get, [this] { return json(scheduler_.snapshot()); });
    http_.route("/api/settings", Method::Get, [this](const QHttpServerRequest &request) {
        const QString requestOrigin = QString::fromUtf8(request.value("Origin"));
        // Same-origin GETs omit Origin; reject explicit foreign origins.
        if (!requestOrigin.isEmpty() && !authorized(request))
            return error("请从本地页面读取配置", Status::Forbidden);
        return guarded([&] { return json(dashboard_.environmentSnapshot()); });
    });
    http_.route("/api/settings", Method::Post, [this](const QHttpServerRequest &request) {
        if (!authorized(request))
            return error("请从本地页面发起操作", Status::Forbidden);
        if (request.body().isEmpty() || request.body().size() > 32768)
            return error("配置请求大小必须在 1 到 32768 字节之间", Status::BadRequest);
        QJsonParseError parseError;
        const auto payload = QJsonDocument::fromJson(request.body(), &parseError);
        if (parseError.error != QJsonParseError::NoError || !payload.isObject())
            return error("配置必须为有效 JSON 对象", Status::BadRequest);
        try {
            return json(dashboard_.configureEnvironment(payload.object()));
        } catch (const std::exception &exception) {
            return error(QString::fromUtf8(exception.what()), Status::BadRequest);
        }
    });
    http_.route("/api/download", Method::Get, [this] {
        return guarded([&] {
            if (!QFileInfo::exists(dashboard_.config().dataPath))
                return error("尚未生成数据库，请先获取订单", Status::NotFound);
            auto response = body("application/vnd.sqlite3", dashboard_.download());
            header(response, "Content-Disposition", "attachment; filename=\"data.db\"");
            return response;
        });
    });
    http_.route("/api/schedule", Method::Post, [this](const QHttpServerRequest &request) {
        if (!authorized(request))
            return error("请从本地页面发起操作", Status::Forbidden);
        if (request.body().isEmpty() || request.body().size() > 4096)
            return error("配置请求大小必须在 1 到 4096 字节之间", Status::BadRequest);
        QJsonParseError parseError;
        const auto payload = QJsonDocument::fromJson(request.body(), &parseError);
        if (parseError.error != QJsonParseError::NoError || !payload.isObject())
            return error("配置必须为有效 JSON 对象", Status::BadRequest);
        try {
            return json(scheduler_.configure(payload.object()));
        } catch (const std::exception &exception) {
            return error(QString::fromUtf8(exception.what()), Status::BadRequest);
        }
    });
    for (const QString &path : {"/api/refresh", "/api/orders/refresh"}) {
        http_.route(path, Method::Post, [this, path](const QHttpServerRequest &request) {
            const bool permitted = authorized(request);
            // Async responses keep polling and the GUI responsive throughout remote fetches.
            return QtConcurrent::run([this, path, permitted] {
                return guarded([&] {
                    if (!permitted)
                        return error("请从本地页面发起操作", Status::Forbidden);
                    const bool trailing = path == "/api/orders/refresh";
                    const auto refresh = trailing ? dashboard_.refreshOrders()
                                                  : dashboard_.refreshSources();
                    if (!refresh.accepted)
                        return error("正在抓取，请稍后再试", Status::Conflict);
                    auto snapshot = trailing ? dashboard_.ordersSnapshot()
                                             : dashboard_.sourceSnapshot();
                    if (!trailing)
                        snapshot.insert("schedule", scheduler_.snapshot());
                    return json(snapshot, refresh.success ? Status::Ok : Status::BadGateway);
                });
            });
        });
    }
}

bool Server::authorized(const QHttpServerRequest &request) const {
    const auto config = dashboard_.config();
    const QString expected = config.allowedOrigin.isEmpty() ? origin_ : config.allowedOrigin;
    return QString::fromUtf8(request.value("Origin")) == expected;
}

QUrl Server::listen(const QString &host, quint16 port) {
    QHostAddress address;
    if (host == "localhost")
        address = QHostAddress::LocalHost;
    else if (!address.setAddress(host))
        throw Error("--host 必须为 IP 地址或 localhost");
    auto *tcp = new QTcpServer(&http_);
    if (!tcp->listen(address, port))
        throw Error("无法启动本地服务：" + tcp->errorString());
    // Qt 6.4 bind returns void, while newer Qt returns a success flag.
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
    if (!http_.bind(tcp))
        throw Error("无法绑定本地 HTTP 服务");
#else
    http_.bind(tcp);
#endif
    QUrl url;
    url.setScheme("http");
    url.setHost(address == QHostAddress::Any || address == QHostAddress::AnyIPv4
                    ? "127.0.0.1"
                    : address == QHostAddress::AnyIPv6 ? "::1" : address.toString());
    url.setPort(tcp->serverPort());
    origin_ = url.toString();
    url.setPath("/");
    return url;
}
} // namespace orders
