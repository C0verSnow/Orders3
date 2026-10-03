#pragma once
#include "services/dashboard.hpp"
#include "services/scheduler.hpp"
#include <QHttpServer>
#include <QUrl>

namespace orders {
class Server {
public:
    Server(Dashboard &dashboard, Scheduler &scheduler);
    QUrl listen(const QString &host, quint16 port);
private:
    bool authorized(const QHttpServerRequest &request) const;
    Dashboard &dashboard_;
    Scheduler &scheduler_;
    QHttpServer http_;
    QString origin_;
};
} // namespace orders
