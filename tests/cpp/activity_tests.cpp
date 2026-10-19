#include "services/activity.hpp"
#include "core/error.hpp"
#include <QJsonDocument>
#include <QtTest>
#include <QtConcurrent/QtConcurrentRun>

class ActivityTests : public QObject {
    Q_OBJECT
private slots:
    void requestLifecycleAndPrivacy() {
        orders::Activity activity;
        activity.begin("sources");
        auto observe = activity.observer("sources");
        const QUrl source("https://example.com/private?token=secret");
        observe(source, false, true, 0);
        auto snapshot = activity.snapshot();
        QCOMPARE(snapshot.value("requests").toObject().value("sources:sources").toObject()
                     .value("active").toInt(), 1);
        observe(source, false, false, 200);
        const QUrl gate("https://api.gateio.ws/api/v4/futures/usdt/autoorder/v1/trail/create");
        observe(gate, true, true, 0);
        observe(gate, true, false, 502);
        activity.finish("sources", false);
        snapshot = activity.snapshot();
        QCOMPARE(snapshot.value("jobs").toObject().value("sources").toString(), QString("failed"));
        const auto requests = snapshot.value("requests").toObject();
        QCOMPARE(requests.value("sources:sources").toObject().value("completed").toInt(), 1);
        QCOMPARE(requests.value("sources:gate").toObject().value("failed").toInt(), 1);
        QCOMPARE(requests.value("sources:gate").toObject().value("active").toInt(), 0);
        const auto json = QJsonDocument(snapshot).toJson();
        QVERIFY(!json.contains("secret"));
        QVERIFY(!json.contains("example.com"));
        QVERIFY(!json.contains("private"));
    }

    void scopedObserversRestoreAndReportExceptions() {
        int outer = 0, inner = 0;
        orders::ScopedHttpObserver first([&](const QUrl &, bool, bool, int) { ++outer; });
        {
            orders::ScopedHttpObserver second([&](const QUrl &, bool, bool, int) { ++inner; });
            QVERIFY_EXCEPTION_THROWN(orders::get(QUrl("invalid")), orders::Error);
        }
        QVERIFY_EXCEPTION_THROWN(orders::get(QUrl("invalid")), orders::Error);
        QCOMPARE(inner, 2);
        QCOMPARE(outer, 2);
    }

    void concurrentWorkersAndBoundedHistory() {
        orders::Activity activity;
        const auto work = [&activity](const QString &job) {
            activity.begin(job);
            const auto observe = activity.observer(job);
            for (int i = 0; i < 50; ++i) {
                observe(QUrl("https://example.com/"), false, true, 0);
                observe(QUrl("https://example.com/"), false, false, 200);
            }
            activity.finish(job, true);
        };
        auto sources = QtConcurrent::run([&] { work("sources"); });
        auto gate = QtConcurrent::run([&] { work("orders"); });
        sources.waitForFinished();
        gate.waitForFinished();
        const auto snapshot = activity.snapshot();
        QCOMPARE(snapshot.value("events").toArray().size(), 64);
        QCOMPARE(snapshot.value("sequence").toInteger(), qint64(204));
        const auto rows = snapshot.value("requests").toObject();
        QCOMPARE(rows.value("sources:sources").toObject().value("completed").toInt(), 50);
        QCOMPARE(rows.value("orders:gate").toObject().value("completed").toInt(), 50);
    }
};

QTEST_GUILESS_MAIN(ActivityTests)
#include "activity_tests.moc"
