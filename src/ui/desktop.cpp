#include "ui/desktop.hpp"
#include <QApplication>
#include <QDesktopServices>
#include <QFileDialog>
#include <QFileInfo>
#include <QIcon>
#include <QMainWindow>
#include <QMessageBox>
#include <QPainter>
#include <QPropertyAnimation>
#include <QSplashScreen>
#include <QStandardPaths>
#include <QTimer>
#include <QWebEngineDownloadRequest>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineView>
#include <QWebEngineNewWindowRequest>

namespace orders {
namespace {
class DashboardPage : public QWebEnginePage {
public:
    using QWebEnginePage::QWebEnginePage;
protected:
    bool acceptNavigationRequest(const QUrl &url, NavigationType type, bool mainFrame) override {
        const QUrl current = this->url();
        if (type == NavigationTypeLinkClicked
            && (url.scheme() != current.scheme() || url.host() != current.host()
                || url.port() != current.port())) {
            if (url.scheme() == "http" || url.scheme() == "https")
                QDesktopServices::openUrl(url);
            return false;
        }
        return QWebEnginePage::acceptNavigationRequest(url, type, mainFrame);
    }
};

QPixmap splashImage() {
    QPixmap image(420, 300);
    image.fill(QColor("#f6f8f5"));
    QPainter painter(&image);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.setPen(Qt::NoPen);
    painter.setBrush(QColor("#182e26"));
    painter.drawRoundedRect(170, 62, 80, 80, 24, 24);
    painter.setBrush(QColor("#c5f47d"));
    for (int index = 0; index < 3; ++index) {
        const int x = 192 + index * 18;
        const int top = index == 1 ? 83 : index == 0 ? 91 : 93;
        painter.drawRoundedRect(x - 3, top, 6, index == 1 ? 38 : index == 0 ? 24 : 20, 3, 3);
        painter.drawEllipse(QPoint(x, index == 1 ? 96 : 104), 6, 6);
    }
    painter.setPen(QColor("#22352e"));
    QFont title("Segoe UI", 24, QFont::Bold);
    painter.setFont(title);
    painter.drawText(QRect(0, 161, 420, 46), Qt::AlignCenter, "orders.");
    painter.setFont(QFont("Segoe UI", 10));
    painter.setPen(QColor("#82927e"));
    painter.drawText(QRect(0, 214, 420, 30), Qt::AlignCenter, "你的数据工作台");
    return image;
}
} // namespace

int runDesktop(const QUrl &address) {
    const QIcon icon(":/web/logo.ico");
    QApplication::setWindowIcon(icon);
    QMainWindow window;
    window.setWindowIcon(icon);
    window.setWindowTitle("Orders · 本地订单看板");
    window.resize(1200, 820);
    window.setMinimumSize(720, 520);
    auto *profile = new QWebEngineProfile("OrdersDashboard", &window);
    auto *view = new QWebEngineView(&window);
    auto *page = new DashboardPage(profile, view);
    view->setPage(page);
    QObject::connect(page, &QWebEnginePage::newWindowRequested, &window,
                     [](const QWebEngineNewWindowRequest &request) {
        const QUrl url = request.requestedUrl();
        if (url.scheme() == "http" || url.scheme() == "https")
            QDesktopServices::openUrl(url);
    });
    window.setCentralWidget(view);
    QObject::connect(profile, &QWebEngineProfile::downloadRequested, &window,
                     [&window](QWebEngineDownloadRequest *download) {
        const QString filename = QFileDialog::getSaveFileName(
            &window, "保存 SQLite 数据库",
            QStandardPaths::writableLocation(QStandardPaths::DownloadLocation) + "/data.db",
            "SQLite 数据库 (*.db *.sqlite *.sqlite3)");
        if (filename.isEmpty()) {
            download->cancel();
            return;
        }
        const QFileInfo target(filename);
        download->setDownloadDirectory(target.absolutePath());
        download->setDownloadFileName(target.fileName());
        download->accept();
    });
    QSplashScreen splash(splashImage());
    splash.setWindowIcon(icon);
    splash.show();
    QPropertyAnimation fade(&splash, "windowOpacity");
    fade.setDuration(400);
    fade.setStartValue(1.0);
    fade.setEndValue(0.0);
    QObject::connect(&fade, &QPropertyAnimation::finished, &splash, &QSplashScreen::close);
    bool shown = false;
    auto showWindow = [&] {
        if (shown)
            return;
        shown = true;
        window.show();
        fade.start();
        QTimer::singleShot(440, page, [page] {
            page->runJavaScript("window.beginStartupTransition && window.beginStartupTransition()");
        });
    };
    QObject::connect(view, &QWebEngineView::loadFinished, &window, [&](bool loaded) {
        showWindow();
        if (!loaded)
            QMessageBox::warning(&window, "Orders", "看板加载失败，请关闭窗口后重新启动。");
    });
    QTimer::singleShot(15000, &window, showWindow);
    QUrl url = address;
    url.setQuery("desktop=1");
    view->load(url);
    const int result = QApplication::exec();
    // The page must be destroyed before its profile.
    delete view;
    delete profile;
    return result;
}
} // namespace orders
