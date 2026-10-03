from contextlib import redirect_stderr
from io import StringIO
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
from urllib.request import urlopen

from orders_dashboard.dashboard import Dashboard
from orders_dashboard.desktop import run_desktop
from orders_dashboard.server import LocalHTTPServer, make_handler


class DesktopTests(unittest.TestCase):
    def test_startup_animation_is_only_enabled_on_windows(self):
        with tempfile.TemporaryDirectory() as directory, \
                LocalHTTPServer(("127.0.0.1", 0), make_handler(Dashboard(Path(directory) / "cache.db"))) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for platform in ("nt", "posix"):
                    with self.subTest(platform=platform), \
                            patch("orders_dashboard.server.os", SimpleNamespace(name=platform)):
                        with urlopen(f"http://127.0.0.1:{server.server_port}", timeout=2) as response:
                            body = response.read()
                        self.assertEqual(b'<body class="startup-enabled">' in body, platform == "nt")
            finally:
                server.shutdown()
                thread.join()

    def test_window_loads_local_server_and_closing_stops_it(self):
        webview = MagicMock()
        webview.create_window.return_value = SimpleNamespace(
            events=SimpleNamespace(loaded=MagicMock(), closed=MagicMock()))
        with tempfile.TemporaryDirectory() as directory:
            with LocalHTTPServer(("127.0.0.1", 0), make_handler(Dashboard(Path(directory) / "cache.db"))) as server:
                address = f"http://127.0.0.1:{server.server_port}"

                def gui(**kwargs):
                    with urlopen(address + "/api/data", timeout=2) as response:
                        self.assertEqual(json.load(response)["items"], [])

                webview.start.side_effect = gui
                with patch.dict("sys.modules", {"webview": webview}), \
                        patch.dict("os.environ", {"LOCALAPPDATA": directory}):
                    self.assertEqual(run_desktop(server, address), 0)
                self.assertEqual(webview.create_window.call_args.args[1], address + "?desktop=1")
                self.assertNotIn("js_api", webview.create_window.call_args.kwargs)
                self.assertFalse(webview.start.call_args.kwargs["private_mode"])
                self.assertTrue(server._BaseServer__is_shut_down.is_set())

    def test_missing_dependency_reports_install_command(self):
        with patch.dict("sys.modules", {"webview": None}), redirect_stderr(StringIO()) as errors:
            self.assertEqual(run_desktop(MagicMock(), "http://127.0.0.1:1234"), 1)
        self.assertIn("[desktop]", errors.getvalue())
