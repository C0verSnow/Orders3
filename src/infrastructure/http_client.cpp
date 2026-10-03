#include "infrastructure/http_client.hpp"
#include "core/error.hpp"
#include <QEventLoop>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>
#include <memory>
#include <utility>

namespace orders {
namespace {
thread_local HttpObserver httpObserver;

class RequestActivity {
public:
    RequestActivity(const QUrl &url, bool write) : url_(url), write_(write) {
        if (httpObserver) httpObserver(url_, write_, true, 0);
    }
    ~RequestActivity() {
        if (httpObserver) httpObserver(url_, write_, false, status_);
    }
    void complete(int status) { status_ = status; }
private:
    QUrl url_;
    bool write_;
    int status_ = 0;
};

HttpResult request(const QUrl &url, const HttpHeaders &headers, bool redirects,
                   const std::shared_ptr<std::atomic<bool>> &cancelled,
                   const QByteArray *body) {
    RequestActivity activity(url, body != nullptr);
    if (cancelled && cancelled->load())
        throw Error("程序正在关闭");
    if (!url.isValid() || url.host().isEmpty()
        || (url.scheme() != "http" && url.scheme() != "https"))
        throw Error("URL 必须是有效的 HTTP/HTTPS 地址");
    QNetworkAccessManager manager;
    QNetworkRequest request(url);
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                         redirects ? QNetworkRequest::NoLessSafeRedirectPolicy
                                   : QNetworkRequest::ManualRedirectPolicy);
    request.setTransferTimeout(30000);
    for (const auto &header : headers)
        request.setRawHeader(header.first, header.second);
    std::unique_ptr<QNetworkReply> reply(body ? manager.post(request, *body) : manager.get(request));
    QEventLoop loop;
    QTimer deadline;
    QTimer cancellation;
    QObject::connect(&cancellation, &QTimer::timeout, &loop, [&] {
        if (cancelled && cancelled->load()) {
            reply->abort();
            loop.quit();
        }
    });
    cancellation.start(100);
    deadline.setSingleShot(true);
    QObject::connect(reply.get(), &QNetworkReply::finished, &loop, &QEventLoop::quit);
    QObject::connect(&deadline, &QTimer::timeout, &loop, [&] {
        reply->abort();
        loop.quit();
    });
    deadline.start(30000);
    if (!reply->isFinished())
        loop.exec();
    if (cancelled && cancelled->load())
        throw Error("程序正在关闭");
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    if (reply->error() != QNetworkReply::NoError && status < 400)
        throw Error("网络请求失败：" + reply->errorString());
    activity.complete(status);
    if (!redirects && status >= 300 && status < 400)
        throw Error("接口返回重定向，已停止请求");
    return {status, reply->readAll()};
}
} // namespace

ScopedHttpObserver::ScopedHttpObserver(HttpObserver observer)
    : previous_(std::move(httpObserver)) {
    httpObserver = std::move(observer);
}

ScopedHttpObserver::~ScopedHttpObserver() {
    httpObserver = std::move(previous_);
}

HttpResult get(const QUrl &url, const HttpHeaders &headers, bool redirects,
               const std::shared_ptr<std::atomic<bool>> &cancelled) {
    return request(url, headers, redirects, cancelled, nullptr);
}

HttpResult post(const QUrl &url, const QByteArray &body, const HttpHeaders &headers,
                const std::shared_ptr<std::atomic<bool>> &cancelled) {
    return request(url, headers, false, cancelled, &body);
}
} // namespace orders
