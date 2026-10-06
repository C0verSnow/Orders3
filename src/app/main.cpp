#include "app/server.hpp"
#include "core/config.hpp"
#include "core/error.hpp"
#include "infrastructure/request_log.hpp"
#include "services/dashboard.hpp"
#include "services/scheduler.hpp"
#ifdef Q_OS_WIN
#include "ui/desktop.hpp"
#include <QApplication>
#include <windows.h>
#include <cstdio>
#endif
#include <QCommandLineParser>
#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonObject>
#include <QProcess>
#include <QThreadPool>
#include <QTimer>
#include <QtConcurrent/QtConcurrentRun>
#include <atomic>
#include <csignal>
#include <iostream>
#include <memory>

namespace {
volatile std::sig_atomic_t interrupted = 0;
void stopSignal(int) { interrupted = 1; }

bool runningInContainer() {
#ifdef Q_OS_LINUX
    return QFileInfo::exists("/.dockerenv") || QFileInfo::exists("/run/.containerenv");
#else
    return false;
#endif
}

#ifdef Q_OS_WIN
std::atomic<bool> consoleStopped{false};
BOOL WINAPI stopConsole(DWORD event) {
    if (event == CTRL_C_EVENT || event == CTRL_BREAK_EVENT || event == CTRL_CLOSE_EVENT) {
        consoleStopped = true;
        return TRUE;
    }
    return FALSE;
}
void attachConsole() {
    if (AttachConsole(ATTACH_PARENT_PROCESS)) {
        FILE *stream = nullptr;
        freopen_s(&stream, "CONOUT$", "w", stdout);
        freopen_s(&stream, "CONOUT$", "w", stderr);
    }
    SetConsoleCtrlHandler(stopConsole, TRUE);
}
#endif

// Ensure background callbacks finish before the server, scheduler and dashboard are destroyed.
struct WorkerDrain {
    std::shared_ptr<std::atomic<bool>> cancelled;
    ~WorkerDrain() {
        cancelled->store(true);
        QThreadPool::globalInstance()->waitForDone();
    }
};
} // namespace

int main(int argc, char *argv[]) {
    bool desktop = false;
#ifdef Q_OS_WIN
    desktop = true;
#endif
    bool explicitDesktop = false;
    for (int index = 1; index < argc; ++index) {
        const QString argument = QString::fromLocal8Bit(argv[index]);
        explicitDesktop = explicitDesktop || argument == "--desktop";
        if (argument == "--browser" || argument == "--no-browser" || argument == "--fetch-only"
            || argument == "--list" || argument == "--help" || argument == "-h"
            || argument == "--version" || argument == "-v")
            desktop = false;
    }
    desktop = desktop || explicitDesktop;
    std::unique_ptr<QCoreApplication> application;
#ifdef Q_OS_WIN
    if (desktop)
        application = std::make_unique<QApplication>(argc, argv);
    else {
        attachConsole();
        application = std::make_unique<QCoreApplication>(argc, argv);
    }
#else
    application = std::make_unique<QCoreApplication>(argc, argv);
#endif
    QCoreApplication::setApplicationName("特洛伊资本");
    QCoreApplication::setApplicationVersion("0.2.0");
    QCoreApplication::setOrganizationName("OrdersDashboard");
    // Manual shell launches must remain reachable through Docker's published port,
    // even when the image's service environment variables are absent.
    const bool container = runningInContainer();
    QCommandLineParser parser;
    parser.setApplicationDescription("特洛伊资本 · 实盘订单看板");
    parser.addHelpOption();
    parser.addVersionOption();
    parser.addPositionalArgument("output", "SQLite 输出文件路径", "[output]");
    parser.addOptions({
        {"port", "监听端口，默认读取 ORDERS_PORT；容器 8090，宿主机 0（自动分配）", "port",
         qEnvironmentVariable("ORDERS_PORT", container ? "8090" : "0")},
        {"host", "监听 IP，默认读取 ORDERS_HOST；容器 0.0.0.0，宿主机 127.0.0.1", "host",
         qEnvironmentVariable("ORDERS_HOST", container ? "0.0.0.0" : "127.0.0.1")},
        {"cached", "启动时展示缓存，跳过远程抓取"},
        {"fetch-only", "抓取来源一次，保存数据库并自动处理开仓追踪单"},
        {"list", "只获取 Gate 跟踪订单"},
        {"browser", "使用系统浏览器"},
        {"no-browser", "只启动服务"},
        {"desktop", "使用 Windows 独立窗口"}
    });
    parser.process(*application);
    const bool openBrowser = !parser.isSet("no-browser")
        && (parser.isSet("browser")
            || qEnvironmentVariable("ORDERS_NO_BROWSER", container ? "1" : "0") != "1");
    try {
        const auto positional = parser.positionalArguments();
        if (positional.size() > 1)
            throw orders::Error("最多提供一个数据库路径");
        bool validPort = false;
        const int port = parser.value("port").toInt(&validPort);
        if (!validPort || port < 0 || port > 65535)
            throw orders::Error("端口必须在 0 到 65535 之间");
        if (parser.isSet("cached") && (parser.isSet("fetch-only") || parser.isSet("list")))
            throw orders::Error("--cached 不能与 --fetch-only 或 --list 同时使用");
        if (explicitDesktop && (parser.isSet("browser") || parser.isSet("no-browser")
                                || parser.isSet("fetch-only") || parser.isSet("list")))
            throw orders::Error("--desktop 不能与浏览器模式或单次抓取同时使用");
#ifndef Q_OS_WIN
        if (explicitDesktop)
            throw orders::Error("--desktop 仅支持 Windows；Linux 请使用浏览器模式");
#endif
        auto config = orders::Config::load();
        if (!positional.isEmpty()) {
            config.dataPath = orders::validateOutput(positional.first());
            config.ordersPath = config.dataPath;
        }
        orders::configureRequestLog(QFileInfo(config.dataPath).absoluteDir().filePath("logs"));
        orders::Dashboard dashboard(config);
        if (parser.isSet("list")) {
            const auto result = dashboard.refreshOrders(false);
            if (!result.success)
                throw orders::Error(dashboard.ordersSnapshot().value("error").toString());
            std::cout << "已保存订单：" << config.ordersPath.toUtf8().constData()
                      << "（orderslist 表）\n";
            return 0;
        }
        if (parser.isSet("fetch-only")) {
            const auto result = dashboard.refreshSources();
            const auto snapshot = dashboard.sourceSnapshot();
            if (!result.success)
                throw orders::Error(snapshot.value("error").toString());
            for (const auto &item : snapshot.value("items").toArray()) {
                if (item.toObject().contains("error"))
                    return 1;
            }
            return 0;
        }
        orders::Scheduler scheduler(dashboard, orders::loadSchedule(config.schedulePath),
                                    config.schedulePath);
        orders::Server server(dashboard, scheduler);
        WorkerDrain drain{config.cancelled};
        QObject::connect(application.get(), &QCoreApplication::aboutToQuit, application.get(),
                         [cancelled = config.cancelled] { cancelled->store(true); });
        const QUrl address = server.listen(parser.value("host"), quint16(port));
        std::cout << "本地看板：" << address.toString().toUtf8().constData() << std::endl;
        if (container) {
            std::cout << "容器内服务已启动；Mac 浏览器访问需要 Docker 发布端口。"
                      << "同端口映射：-p 127.0.0.1:" << address.port() << ':' << address.port()
                      << "；若宿主机端口不同，请访问宿主机端口并设置 ORDERS_ALLOWED_ORIGIN。"
                      << std::endl;
        }
        if (!parser.isSet("cached")) {
            auto sources = QtConcurrent::run([&dashboard] { dashboard.refreshSources(); });
            auto trailing = QtConcurrent::run([&dashboard] { dashboard.refreshOrders(); });
            Q_UNUSED(sources);
            Q_UNUSED(trailing);
        }
        scheduler.start();
        std::signal(SIGINT, stopSignal);
        std::signal(SIGTERM, stopSignal);
        QTimer signalPoll;
        QObject::connect(&signalPoll, &QTimer::timeout, application.get(), [&] {
            bool stopped = interrupted != 0;
#ifdef Q_OS_WIN
            stopped = stopped || consoleStopped.load();
#endif
            if (stopped)
                application->quit();
        });
        signalPoll.start(100);
        int result;
#ifdef Q_OS_WIN
        if (desktop) {
            result = orders::runDesktop(address);
        } else {
            if (openBrowser) {
                // QCoreApplication keeps service mode free of GUI initialization.
                QProcess::startDetached("rundll32.exe",
                                        {"url.dll,FileProtocolHandler", address.toString()});
            }
            result = application->exec();
        }
#else
        if (openBrowser)
#ifdef Q_OS_MACOS
            QProcess::startDetached("open", {address.toString()});
#else
            QProcess::startDetached("xdg-open", {address.toString()});
#endif
        result = application->exec();
#endif
        scheduler.stop();
        return result;
    } catch (const std::exception &exception) {
        std::cerr << "启动失败：" << exception.what() << std::endl;
        return 1;
    }
}
