"""Frozen executables must not write data to their temporary extraction tree."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from orders_dashboard.config import default_output, runtime_root, save_schedule, load_schedule, ScheduleConfig
from orders_dashboard.trailing import default_orders_output


class ReleaseRuntimeTests(unittest.TestCase):
    def test_frozen_runtime_uses_executable_location_and_persistent_user_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch("sys.frozen", True, create=True), \
                    patch("sys.executable", str(root / "orders.exe")), \
                    patch("orders_dashboard.config.Path.home", return_value=root), \
                    patch.dict("os.environ", {"ORDERS_DATA_DIR": ""}):
                self.assertEqual(runtime_root(), root)
                self.assertEqual(default_output(), root / ".orders-dashboard" / "data.db")
                self.assertEqual(default_orders_output(), root / ".orders-dashboard" / "orderslist.db")

    def test_volume_override_applies_to_both_databases(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.dict("os.environ", {"ORDERS_DATA_DIR": directory}):
            root = Path(directory).resolve()
            self.assertEqual(default_output(), root / "data.db")
            self.assertEqual(default_orders_output(), root / "orderslist.db")

    def test_schedule_can_be_saved_into_new_persistent_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "new-user-directory" / "config"
            schedule = ScheduleConfig(False)
            save_schedule(schedule, path)
            self.assertEqual(load_schedule(path), schedule)


if __name__ == "__main__":
    unittest.main()
