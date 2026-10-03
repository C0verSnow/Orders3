from contextlib import redirect_stderr, redirect_stdout
from http.server import ThreadingHTTPServer
from io import StringIO
from pathlib import Path
import tempfile
import json
import threading
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from urllib.request import urlopen

from orders_dashboard.cli import main
from orders_dashboard.config import ScheduleConfig
from orders_dashboard.server import LocalHTTPServer, make_handler
from orders_dashboard.dashboard import Dashboard


def wait_for_orders(address):
    deadline = time.monotonic() + 3
    while True:
        with urlopen(address + "/api/orders", timeout=2) as response:
            payload = json.load(response)
        if not payload["refreshing"]:
            return payload
        if time.monotonic() >= deadline:
            raise AssertionError("Background orders refresh did not finish")
        time.sleep(.01)


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
                                payload = wait_for_orders(address)
                                if "--cached" not in arguments:
                                    self.assertEqual(payload["orders"][0]["activation_price"], "100")
                            finally:
                                server.shutdown()
                                thread.join()

                        console = StringIO()
                        errors = StringIO()
                        with patch("orders_dashboard.cli.default_output", return_value=output), \
                                patch("orders_dashboard.trailing.default_orders_output", return_value=Path(directory) / "orders.db"), \
                                patch("orders_dashboard.trailing.fetch_orders", return_value=[
                                    ("123", "BTC_USDT", "38", "100", False, 2, 1790055122058)
                                ]) as fetch_orders, \
                                patch("orders_dashboard.cli.load_schedule", return_value=ScheduleConfig(False)), \
                                patch("orders_dashboard.dashboard.fetch_data", return_value=[]), \
                                patch.object(LocalHTTPServer, "serve_forever", serve), \
                                patch("orders_dashboard.cli.webbrowser.open") as browser, \
                                redirect_stdout(console), redirect_stderr(errors):
                            self.assertEqual(main(arguments), 0, errors.getvalue())
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
                    payload = wait_for_orders(f"http://127.0.0.1:{server.server_port}")
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

    def test_page_and_cache_are_available_while_network_is_blocked(self):
        release = threading.Event()
        sources_started = threading.Event()
        orders_started = threading.Event()
        sources_finished = threading.Event()
        orders_finished = threading.Event()

        def refresh(started, finished):
            started.set()
            release.wait(5)
            finished.set()

        def serve(server):
            self.assertTrue(sources_started.wait(1))
            self.assertTrue(orders_started.wait(1))
            thread = threading.Thread(target=ThreadingHTTPServer.serve_forever,
                                      args=(server,), daemon=True)
            thread.start()
            try:
                address = f"http://127.0.0.1:{server.server_port}"
                with urlopen(address, timeout=1) as response:
                    self.assertEqual(response.status, 200)
                with urlopen(address + "/api/data", timeout=1) as response:
                    self.assertEqual(json.load(response)["items"], [])
                self.assertFalse(release.is_set())
            finally:
                release.set()
                self.assertTrue(sources_finished.wait(1))
                self.assertTrue(orders_finished.wait(1))
                server.shutdown()
                thread.join()

        with tempfile.TemporaryDirectory() as directory, \
                patch("orders_dashboard.cli.default_output", return_value=Path(directory) / "data.db"), \
                patch("orders_dashboard.cli.os", SimpleNamespace(name="nt")), \
                patch("orders_dashboard.cli.load_schedule", return_value=ScheduleConfig(False)), \
                patch("orders_dashboard.cli.Dashboard.refresh", side_effect=lambda: refresh(sources_started, sources_finished)), \
                patch("orders_dashboard.cli.OrdersList.refresh", side_effect=lambda: refresh(orders_started, orders_finished)), \
                patch.object(LocalHTTPServer, "serve_forever", serve), redirect_stdout(StringIO()):
            self.assertEqual(main(["--no-browser"]), 0)

    def test_linux_keeps_sequential_fetch_and_browser_startup(self):
        events = []
        with tempfile.TemporaryDirectory() as directory, \
                patch("orders_dashboard.cli.os", SimpleNamespace(name="posix")), \
                patch("orders_dashboard.cli.default_output", return_value=Path(directory) / "data.db"), \
                patch("orders_dashboard.cli.load_schedule", return_value=ScheduleConfig(False)), \
                patch("orders_dashboard.cli.OrdersList.refresh", side_effect=lambda: events.append("orders")), \
                patch("orders_dashboard.cli.Dashboard.refresh", side_effect=lambda: events.append("sources")), \
                patch("orders_dashboard.cli.webbrowser.open", side_effect=lambda address: events.append("browser")), \
                patch.object(LocalHTTPServer, "serve_forever", lambda server: events.append("serve")), \
                redirect_stdout(StringIO()):
            self.assertEqual(main([]), 0)
        self.assertEqual(events, ["orders", "sources", "browser", "serve"])

    def test_linux_rejects_desktop_option(self):
        with patch("orders_dashboard.cli.os", SimpleNamespace(name="posix")), \
                redirect_stderr(StringIO()), self.assertRaises(SystemExit) as error:
            main(["--desktop"])
        self.assertEqual(error.exception.code, 2)

    def test_invalid_ports_are_rejected(self):
        for port in ("-1", "65536"):
            with self.subTest(port=port), redirect_stderr(StringIO()), \
                    self.assertRaises(SystemExit) as error:
                main(["--port", port])
            self.assertEqual(error.exception.code, 2)
