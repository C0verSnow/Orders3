import unittest
from unittest.mock import MagicMock, patch

from orders_dashboard.fetcher import fetch_data


class FetcherTests(unittest.TestCase):
    def test_pagination_and_credentials_are_separated(self):
        source = {"url": "https://example.com/order", "created_at": "2026-10-02"}
        page = MagicMock()
        page.json.return_value = [source]
        empty = MagicMock()
        empty.json.return_value = []
        content = MagicMock(status_code=200)
        content.json.side_effect = ValueError("text response")
        content.text = "Symbol: BTC_USDT\nPrice: 1.00 USDT"
        with patch("orders_dashboard.fetcher.requests.Session") as factory:
            session = factory.return_value.__enter__.return_value
            session.get.side_effect = [page, empty, content]
            records = fetch_data()
        calls = session.get.call_args_list
        self.assertEqual(calls[0].kwargs["params"]["offset"], 0)
        self.assertEqual(calls[1].kwargs["params"]["offset"], 1)
        self.assertIn("apikey", calls[0].kwargs["headers"])
        self.assertNotIn("headers", calls[2].kwargs)
        self.assertEqual(records[0]["data"], content.text)
        self.assertEqual(records[0]["status_code"], 200)
        self.assertNotIn("data", source)

    def test_invalid_source_is_reported_without_target_request(self):
        page = MagicMock()
        page.json.return_value = [{"url": "file:///private"}]
        empty = MagicMock()
        empty.json.return_value = []
        with patch("orders_dashboard.fetcher.requests.Session") as factory:
            session = factory.return_value.__enter__.return_value
            session.get.side_effect = [page, empty]
            records = fetch_data()
        self.assertEqual(session.get.call_count, 2)
        self.assertIn("error", records[0])
        self.assertIsNone(records[0]["data"])
