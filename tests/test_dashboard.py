from contextlib import closing
import json
import sqlite3
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import requests

from orders_dashboard import dashboard as orders
from orders_dashboard.server import LocalHTTPServer, make_handler
from orders_dashboard.config import ScheduleConfig, load_schedule
from orders_dashboard.scheduler import RefreshScheduler
from orders_dashboard.trailing import OrdersList


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.output = Path(self.directory.name) / "custom data.db"
        self.dashboard = orders.Dashboard(self.output)
        self.orders_list = OrdersList(Path(self.directory.name) / "orderslist.db")
        self.server = LocalHTTPServer(("127.0.0.1", 0), make_handler(self.dashboard, self.orders_list))
        self.address = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def request(self, path, method="GET", origin=None, data=None):
        headers = {"Origin": origin} if origin else {}
        request = Request(self.address + path, method=method, headers=headers,
                          data=json.dumps(data).encode("utf-8") if data is not None else None)
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    def test_assets_and_private_paths(self):
        for path, content_type in [("/", "text/html"), ("/style.css", "text/css"),
                                   ("/app.js", "text/javascript"), ("/logo.svg", "image/svg+xml")]:
            status, headers, body = self.request(path)
            self.assertEqual(status, 200)
            self.assertTrue(headers["Content-Type"].startswith(content_type))
            self.assertTrue(body)
        for path in ["/.env", "/1.py", "/../1.py", "/%2e%2e/1.py", "/data.json", "/data.db"]:
            self.assertEqual(self.request(path)[0], 404)

    def test_missing_and_custom_output(self):
        status, _, body = self.request("/api/data")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["items"], [])
        records = [{"url": "https://example.com", "data": "中文数据", "status_code": 200}]
        orders.save_data(self.output, records)
        status, _, body = self.request("/api/data")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["items"], records)
        self.assertIsNotNone(json.loads(body)["updated_at"])

    def test_web_orders_refresh_persistence_failure_and_empty_list(self):
        self.assertEqual(json.loads(self.request("/api/orders")[2])["orders"], [])
        row = ("123", "BTC_USDT", "38", "", False, 2, 1790055122058)
        with patch("orders_dashboard.trailing.fetch_orders", return_value=[row]):
            status, _, body = self.request("/api/orders/refresh", "POST", self.address)
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertEqual(payload["orders"][0]["contract"], "BTC_USDT")
        self.assertIs(payload["orders"][0]["reduce_only"], False)
        self.assertIsNotNone(payload["updated_at"])
        self.assertFalse(self.output.exists())
        self.assertEqual(json.loads(self.request("/api/orders")[2])["orders"], payload["orders"])
        self.assertEqual(OrdersList(self.orders_list.output).snapshot()["orders"], payload["orders"])
        with patch("orders_dashboard.trailing.fetch_orders", side_effect=ValueError("offline")):
            status, _, body = self.request("/api/orders/refresh", "POST", self.address)
        self.assertEqual(status, 502)
        self.assertEqual(json.loads(body)["orders"], payload["orders"])
        self.assertIn("offline", json.loads(body)["error"])
        with patch("orders_dashboard.trailing.fetch_orders", return_value=[]):
            status, _, body = self.request("/api/orders/refresh", "POST", self.address)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["orders"], [])
        self.assertIsNone(json.loads(body)["error"])

    def test_web_orders_origin_and_busy(self):
        with patch("orders_dashboard.trailing.fetch_orders") as fetch:
            for origin in [None, "https://example.com"]:
                self.assertEqual(self.request("/api/orders/refresh", "POST", origin)[0], 403)
            fetch.assert_not_called()
            self.orders_list.lock.acquire()
            try:
                self.assertEqual(self.request("/api/orders/refresh", "POST", self.address)[0], 409)
                fetch.assert_not_called()
            finally:
                self.orders_list.lock.release()

    def test_refresh_updates_file_and_response(self):
        records = [{"url": "https://example.com", "data": {"value": 123}, "status_code": 200}]
        with patch.object(orders, "fetch_data", return_value=records):
            status, _, body = self.request("/api/refresh", "POST", self.address)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["items"], records)
        self.assertTrue(self.output.read_bytes().startswith(b"SQLite format 3\x00"))
        with closing(sqlite3.connect(self.output)) as connection:
            self.assertEqual(connection.execute(
                "SELECT url, status_code, data, data_format FROM records").fetchone(),
                ("https://example.com", 200, '{"value": 123}', "json"))
        self.assertFalse(self.output.with_name(self.output.name + ".tmp").exists())

    def test_download_database(self):
        self.assertEqual(self.request("/api/download")[0], 404)
        records = [{"data": {"nested": [None, True, "中文"]}}, {"error": "offline"}]
        orders.save_data(self.output, records)
        status, headers, body = self.request("/api/download")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/vnd.sqlite3")
        self.assertIn('filename="data.db"', headers["Content-Disposition"])
        self.assertEqual(body, self.output.read_bytes())
        downloaded = Path(self.directory.name) / "download.db"
        downloaded.write_bytes(body)
        self.assertEqual(orders.Dashboard(downloaded).snapshot()["items"], records)

    def test_order_columns_and_multiple_blocks(self):
        records = [{"url": "https://example.com", "created_at": "2026-10-02",
                    "status_code": 200, "source_id": 42,
                    "data": "🚀 Symbol : XAU_USDT\nPrice : 4067.50 USDT\n"
                            "Side : Open Long\nSize : 362 Contracts\nValue : 147.46 U\n"
                            "Orders Times: 1790943348949\n"
                            "Symbol : BTC_USDT\nSide : Close Short\n"},
                   {"url": "https://example.org", "data": "普通文本"},
                   {"data": None, "error": "offline"}]
        orders.save_data(self.output, records)
        self.assertEqual(self.dashboard.snapshot()["items"], records)
        status, _, body = self.request("/api/data")
        self.assertEqual(status, 200)
        self.assertEqual([(row["record_position"], row["symbol"], row["price"])
                          for row in json.loads(body)["orders"]],
                         [(0, "XAU_USDT", "4067.50 USDT"), (0, "BTC_USDT", None)])
        with closing(sqlite3.connect(self.output)) as connection:
            self.assertNotIn("record_json", [row[1] for row in connection.execute(
                "PRAGMA table_info(records)")])
            self.assertEqual(connection.execute(
                "SELECT * FROM orders ORDER BY record_position, order_index").fetchall(),
                [(0, 0, "XAU_USDT", "4067.50 USDT", "Open Long", "362 Contracts",
                  "147.46 U", "1790943348949"),
                 (0, 1, "BTC_USDT", None, "Close Short", None, None, None)])
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_legacy_database_can_be_read_and_rewritten(self):
        records = [{"url": "https://example.com", "data": "历史数据"}]
        with closing(sqlite3.connect(self.output)) as connection:
            connection.execute("CREATE TABLE records (position INTEGER PRIMARY KEY, record_json TEXT)")
            connection.execute("INSERT INTO records VALUES (?, ?)", (0, json.dumps(records[0])))
            connection.commit()
        self.assertEqual(self.dashboard.snapshot()["items"], records)
        orders.save_data(self.output, self.dashboard.snapshot()["items"])
        self.assertEqual(self.dashboard.snapshot()["items"], records)

    def test_data_types_and_extra_fields_are_preserved(self):
        records = [{"data": value, "extra": {"enabled": True}} for value in
                   [None, True, 42, 1.25, [1, "中文"], {"nested": [None]}, "null", ""]]
        records.append({})
        orders.save_data(self.output, records)
        self.assertEqual(self.dashboard.snapshot()["items"], records)

    def test_replacement_and_empty_database(self):
        orders.save_data(self.output, [{"data": "old"}, {"data": "old 2"}])
        orders.save_data(self.output, [{"data": "new"}])
        self.assertEqual(self.dashboard.snapshot()["items"], [{"data": "new"}])
        orders.save_data(self.output, [])
        self.assertEqual(self.dashboard.snapshot()["items"], [])

    def test_failed_save_preserves_database(self):
        records = [{"data": "previous"}]
        orders.save_data(self.output, records)
        with self.assertRaises(TypeError):
            orders.save_data(self.output, [{"data": object()}])
        self.assertEqual(self.dashboard.snapshot()["items"], records)
        self.assertFalse(self.output.with_name(self.output.name + ".tmp").exists())

    def test_refresh_failure_preserves_cache(self):
        records = [{"data": "previous result"}]
        orders.save_data(self.output, records)
        with patch.object(orders, "fetch_data", side_effect=requests.ConnectionError("offline")):
            status, _, body = self.request("/api/refresh", "POST", self.address)
        self.assertEqual(status, 502)
        payload = json.loads(body)
        self.assertEqual(payload["items"], records)
        self.assertIn("offline", payload["error"])

    def test_refresh_busy_and_origin_check(self):
        for origin in [None, "https://example.com"]:
            self.assertEqual(self.request("/api/refresh", "POST", origin)[0], 403)
        self.dashboard.lock.acquire()
        try:
            self.assertEqual(self.request("/api/refresh", "POST", self.address)[0], 409)
        finally:
            self.dashboard.lock.release()

    def test_invalid_cache_is_reported(self):
        self.output.write_text('{"wrong": "shape"}', encoding="utf-8")
        self.assertEqual(self.request("/api/data")[0], 500)
        self.output.write_text("not JSON", encoding="utf-8")
        self.assertEqual(self.request("/api/data")[0], 500)

    def test_port_cannot_be_bound_twice(self):
        with self.assertRaises(OSError):
            LocalHTTPServer(("127.0.0.1", self.server.server_port),
                                   make_handler(self.dashboard))

    def test_schedule_api_saves_and_exposes_live_configuration(self):
        path = Path(self.directory.name) / "config"
        self.dashboard.scheduler = RefreshScheduler(self.dashboard, ScheduleConfig(), config_path=path)
        payload = {"enabled": False, "cron": "0 9 * * 1-5"}
        status, _, body = self.request("/api/schedule", "POST", self.address, payload)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["cron"], payload["cron"])
        self.assertIsNone(json.loads(body)["next_run"])
        self.assertEqual(load_schedule(path), ScheduleConfig(False, payload["cron"]))
        for endpoint in ["/api/schedule", "/api/data"]:
            status, _, body = self.request(endpoint)
            self.assertEqual(status, 200)
            result = json.loads(body)
            schedule = result["schedule"] if endpoint == "/api/data" else result
            self.assertFalse(schedule["enabled"])
            self.assertEqual(schedule["cron"], payload["cron"])

    def test_schedule_api_origin_validation_and_invalid_expression(self):
        path = Path(self.directory.name) / "config"
        self.dashboard.scheduler = RefreshScheduler(self.dashboard, ScheduleConfig(), config_path=path)
        for origin in [None, "https://example.com"]:
            self.assertEqual(self.request("/api/schedule", "POST", origin,
                                         {"enabled": True, "cron": "* * * * *"})[0], 403)
        for payload in [{"enabled": True, "cron": "bad"}, {"enabled": "true", "cron": "* * * * *"},
                        [], {"enabled": True}]:
            self.assertEqual(self.request("/api/schedule", "POST", self.address, payload)[0], 400)
        self.assertFalse(path.exists())
        self.assertEqual(self.dashboard.scheduler.config, ScheduleConfig())


if __name__ == "__main__":
    unittest.main()
