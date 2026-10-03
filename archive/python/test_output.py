from contextlib import redirect_stderr
from importlib.resources import files
from io import StringIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from orders_dashboard.cli import main
from orders_dashboard.storage import save_data


class OutputTests(unittest.TestCase):
    def test_json_output_is_rejected_before_fetching(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "data.json"
            with patch("orders_dashboard.dashboard.fetch_data") as fetch:
                with redirect_stderr(StringIO()), self.assertRaises(SystemExit) as error:
                    main([str(output), "--fetch-only"])
            self.assertEqual(error.exception.code, 2)
            fetch.assert_not_called()
            self.assertFalse(output.exists())
            with self.assertRaises(ValueError):
                save_data(output, [{"data": "no JSON export"}])
            self.assertFalse(output.exists())

    def test_fetch_only_writes_only_sqlite(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "data.db"
            with patch("orders_dashboard.dashboard.fetch_data", return_value=[{"data": "ok"}]):
                self.assertEqual(main([str(output), "--fetch-only"]), 0)
            self.assertEqual([path.name for path in Path(directory).iterdir()], ["data.db"])
            self.assertTrue(output.read_bytes().startswith(b"SQLite format 3\x00"))

    def test_web_assets_do_not_reference_json_file(self):
        assets = files("orders_dashboard").joinpath("web")
        for name in ("app.js", "index.html"):
            self.assertNotIn("data.json", assets.joinpath(name).read_text(encoding="utf-8").lower())
        self.assertIn('/api/download', assets.joinpath("index.html").read_text(encoding="utf-8"))
