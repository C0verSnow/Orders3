from contextlib import redirect_stderr, redirect_stdout
from http.server import ThreadingHTTPServer
from io import StringIO
from pathlib import Path
import tempfile
import json
import threading
import unittest
from unittest.mock import patch
from urllib.request import urlopen

from orders_dashboard.cli import main
from orders_dashboard.config import ScheduleConfig
from orders_dashboard.server import LocalHTTPServer, make_handler
from orders_dashboard.dashboard import Dashboard


class StartupTests(unittest.TestCase):
    def test_automatic_port_and_browser_address(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "data.db"
            # Keep another instance listening while starting the CLI.
            with LocalHTTPServer(("127.0.0.1", 0), make_handler(Dashboard(output))) as occupied:
                for arguments in ([], ["--port", "0"], ["--no-browser"], ["--cached"]):
                    with self.subTest(arguments=arguments):
                        addresses = []

                        def serve(server):
                            self.assertGreater(server.server_port, 0)
                            self.assertNotEqual(server.server_port, occupied.server_port)
                            address = f"http://127.0.0.1:{server.server_port}"
                            addresses.append(address)
                            thread = threading.Thread(
                                target=ThreadingHTTPServer.serve_forever,
                                args=(server,), daemon=True)
                            thread.start()
                            try:
                                with urlopen(address, timeout=5) as response:
                                    self.assertEqual(response.status, 200)
                                    self.assertIn(b"<html", response.read().lower())
                                with urlopen(address + "/api/orders", timeout=5) as response:
                                    payload = json.load(response)
                                    self.assertEqual(payload["orders"][0]["activation_price"], "100")
                            finally:
                                server.shutdown()
                                thread.join()

                        console = StringIO()
                        with patch("orders_dashboard.cli.default_output", return_value=output), \
                                patch("orders_dashboard.trailing.default_orders_output", return_value=Path(directory) / "orders.db"), \
                                patch("orders_dashboard.trailing.fetch_orders", return_value=[
                                    ("123", "BTC_USDT", "38", "100", False, 2, 1790055122058)
                                ]) as fetch_orders, \
                                patch("orders_dashboard.cli.load_schedule", return_value=ScheduleConfig(False)), \
                                patch("orders_dashboard.dashboard.fetch_data", return_value=[]), \
                                patch.object(LocalHTTPServer, "serve_forever", serve), \
                                patch("orders_dashboard.cli.webbrowser.open") as browser, \
                                redirect_stdout(console), redirect_stderr(StringIO()):
                            self.assertEqual(main(arguments), 0)
                        if "--cached" in arguments:
                            fetch_orders.assert_not_called()
                        else:
                            fetch_orders.assert_called_once_with()
                        self.assertEqual(len(addresses), 1)
                        self.assertIn(addresses[0], console.getvalue())
                        if "--no-browser" in arguments:
                            browser.assert_not_called()
                        else:
                            browser.assert_called_once_with(addresses[0])

    def test_explicit_occupied_port_reports_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "data.db"
            with LocalHTTPServer(("127.0.0.1", 0), make_handler(Dashboard(output))) as occupied, \
                    patch("orders_dashboard.cli.load_schedule", return_value=ScheduleConfig(False)), \
                    patch("orders_dashboard.cli.webbrowser.open") as browser, \
                    redirect_stderr(StringIO()):
                self.assertEqual(main([str(output), "--cached", "--port", str(occupied.server_port)]), 1)
                browser.assert_not_called()

    def test_orders_startup_failure_does_not_stop_server(self):
        with tempfile.TemporaryDirectory() as directory:
            def serve(server):
                thread = threading.Thread(target=ThreadingHTTPServer.serve_forever,
                                          args=(server,), daemon=True)
                thread.start()
                try:
                    with urlopen(f"http://127.0.0.1:{server.server_port}/api/orders", timeout=5) as response:
                        payload = json.load(response)
                    self.assertEqual(payload["orders"], [])
                    self.assertIn("offline", payload["error"])
                finally:
                    server.shutdown()
                    thread.join()

            with patch("orders_dashboard.cli.default_output", return_value=Path(directory) / "data.db"), \
                    patch("orders_dashboard.trailing.default_orders_output", return_value=Path(directory) / "orders.db"), \
                    patch("orders_dashboard.cli.load_schedule", return_value=ScheduleConfig(False)), \
                    patch("orders_dashboard.dashboard.fetch_data", return_value=[]), \
                    patch("orders_dashboard.trailing.fetch_orders", side_effect=ValueError("offline")), \
                    patch.object(LocalHTTPServer, "serve_forever", serve), redirect_stdout(StringIO()):
                self.assertEqual(main(["--no-browser"]), 0)

    def test_invalid_ports_are_rejected(self):
        for port in ("-1", "65536"):
            with self.subTest(port=port), redirect_stderr(StringIO()), \
                    self.assertRaises(SystemExit) as error:
                main(["--port", port])
            self.assertEqual(error.exception.code, 2)
