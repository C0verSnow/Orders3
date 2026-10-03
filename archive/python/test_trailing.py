from contextlib import closing
import hashlib
import hmac
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from orders_dashboard.trailing import API_PATH, OrdersList, fetch_orders, refresh_orders


class TrailingTests(unittest.TestCase):
    def test_signature_and_response_fields(self):
        order = dict(id="123", contract="BTC_USDT", amount="38", activation_price="100", trigger_price="",
                     reduce_only=False, original_status=2, ignored="unused")
        response = MagicMock(status_code=200)
        response.json.return_value = dict(code=0, data={"orders": [order]}, timestamp=1790055122058)
        with patch.dict(os.environ, {"API_KEY": "test-key", "API_SECRET": "test-secret"}), \
                patch("orders_dashboard.trailing.time.time", return_value=1790055122), \
                patch("orders_dashboard.trailing.requests.get") as get:
            get.return_value.__enter__.return_value = response
            rows = fetch_orders()
        message = "\n".join(("GET", API_PATH, "", hashlib.sha512(b"").hexdigest(), "1790055122"))
        expected = hmac.new(b"test-secret", message.encode(), hashlib.sha512).hexdigest()
        self.assertEqual(get.call_args.kwargs["headers"]["SIGN"], expected)
        self.assertFalse(get.call_args.kwargs["allow_redirects"])
        self.assertEqual(rows, [("123", "BTC_USDT", "38", "100", False, 2, 1790055122058)])

    def test_legacy_snapshot_migration_is_atomic(self):
        old_row = ("123", "BTC_USDT", "38", "90", False, 2, 1790055122058)
        new_row = ("123", "BTC_USDT", "38", "100", False, 2, 1790055122058)
        with tempfile.TemporaryDirectory() as directory:
            output = (Path(directory) / "orders.db").resolve()
            with closing(sqlite3.connect(output)) as connection:
                connection.execute("CREATE TABLE orders (id TEXT PRIMARY KEY, contract TEXT, "
                                   "amount TEXT, trigger_price TEXT, reduce_only INTEGER, "
                                   "original_status INTEGER, timestamp INTEGER)")
                connection.execute("INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?)", old_row)
                connection.commit()
            cached = OrdersList(output).snapshot()["orders"][0]
            self.assertIsNone(cached["activation_price"])
            self.assertNotIn("trigger_price", cached)
            with patch("orders_dashboard.trailing.fetch_orders", return_value=[new_row, new_row]):
                with self.assertRaises(sqlite3.IntegrityError):
                    refresh_orders(output)
            with closing(sqlite3.connect(output)) as connection:
                self.assertIn("trigger_price", [row[1] for row in connection.execute("PRAGMA table_info(orders)")])
                self.assertEqual(connection.execute("SELECT * FROM orders").fetchall(), [old_row])
            with patch("orders_dashboard.trailing.fetch_orders", return_value=[new_row]):
                refresh_orders(output)
            updated = OrdersList(output).snapshot()["orders"][0]
            self.assertEqual(updated["activation_price"], "100")
            self.assertNotIn("trigger_price", updated)

    def test_missing_credentials_do_not_send_request(self):
        with patch.dict(os.environ, {"API_KEY": "", "API_SECRET": ""}), \
                patch("orders_dashboard.trailing.requests.get") as get:
            with self.assertRaises(ValueError):
                fetch_orders()
            get.assert_not_called()

    def test_failed_write_preserves_snapshot_and_empty_list_clears_it(self):
        row = ("123", "BTC_USDT", "38", "0.1", False, 2, 1790055122058)
        with tempfile.TemporaryDirectory() as directory:
            output = (Path(directory) / "orders.db").resolve()
            with patch("orders_dashboard.trailing.fetch_orders", return_value=[row]):
                self.assertEqual(refresh_orders(output), (output, 1))
            with patch("orders_dashboard.trailing.fetch_orders", return_value=[row, row]):
                with self.assertRaises(sqlite3.IntegrityError):
                    refresh_orders(output)
            with closing(sqlite3.connect(output)) as connection:
                self.assertEqual(connection.execute("SELECT * FROM orders").fetchall(), [row])
            with patch("orders_dashboard.trailing.fetch_orders", side_effect=ValueError("invalid")):
                with self.assertRaises(ValueError):
                    refresh_orders(output)
            with closing(sqlite3.connect(output)) as connection:
                self.assertEqual(connection.execute("SELECT count(*) FROM orders").fetchone()[0], 1)
            with patch("orders_dashboard.trailing.fetch_orders", return_value=[]):
                self.assertEqual(refresh_orders(output), (output, 0))
            with closing(sqlite3.connect(output)) as connection:
                self.assertEqual(connection.execute("SELECT count(*) FROM orders").fetchone()[0], 0)

    def test_malformed_or_error_response_is_rejected(self):
        for payload in ({"code": 1}, {"code": 0, "data": {"orders": []}},
                        {"code": 0, "data": {"orders": [{}]}, "timestamp": 123}):
            with self.subTest(payload=payload), \
                    patch.dict(os.environ, {"API_KEY": "test", "API_SECRET": "test"}), \
                    patch("orders_dashboard.trailing.requests.get") as get:
                response = get.return_value.__enter__.return_value
                response.status_code = 200
                response.json.return_value = payload
                with self.assertRaises(ValueError):
                    fetch_orders()
