from datetime import datetime
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from orders_dashboard.config import ScheduleConfig, load_schedule, validate_schedule
from orders_dashboard.dashboard import Dashboard
from orders_dashboard.scheduler import RefreshScheduler


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "config"
        self.now = datetime(2026, 10, 2, 10, 0, 30).timestamp()
        self.dashboard = Dashboard(Path(self.directory.name) / "data.db")
        self.scheduler = RefreshScheduler(self.dashboard, ScheduleConfig(True, "* * * * *"),
                                          clock=lambda: self.now, config_path=self.path)
        self.dashboard.scheduler = self.scheduler

    def test_config_defaults_example_and_bom(self):
        self.assertEqual(load_schedule(self.path), ScheduleConfig())
        example = Path(__file__).resolve().parents[1] / "example.config"
        self.assertEqual(load_schedule(example), ScheduleConfig())
        self.path.write_text("[schedule]\nenabled = false\ncron = 0 9 * * 1-5\n", encoding="utf-8-sig")
        self.assertEqual(load_schedule(self.path), ScheduleConfig(False, "0 9 * * 1-5"))

    def test_invalid_configs(self):
        for enabled, expression in [(True, "bad"), (True, "60 * * * *"), (True, "0 0 31 2 *"),
                                    (True, "* * * * * *"), (True, "*/0 * * * *"),
                                    ("true", "* * * * *"), (True, None)]:
            with self.subTest(expression=expression), self.assertRaises(ValueError):
                validate_schedule(enabled, expression)
        self.path.write_text("[schedule]\nenabled = maybe", encoding="utf-8")
        with self.assertRaises(ValueError):
            load_schedule(self.path)

    def test_save_preserves_other_sections_and_roundtrips(self):
        self.path.write_text("[other]\nvalue = 100%\n", encoding="utf-8")
        self.scheduler.configure(False, "0 9 * * 1-5")
        self.assertEqual(load_schedule(self.path), ScheduleConfig(False, "0 9 * * 1-5"))
        self.assertIn("value = 100%", self.path.read_text(encoding="utf-8"))
        self.assertIsNone(self.scheduler.snapshot()["next_run"])
        self.assertEqual(list(Path(self.directory.name).glob("*.tmp")), [])

    def test_invalid_or_failed_save_does_not_change_active_schedule(self):
        original = self.scheduler.snapshot()
        with self.assertRaises(ValueError):
            self.scheduler.configure(True, "bad")
        with patch("orders_dashboard.config.os.replace", side_effect=OSError("denied")):
            with self.assertRaises(OSError):
                self.scheduler.configure(False, "0 * * * *")
        self.assertEqual(self.scheduler.snapshot(), original)
        self.assertFalse(self.path.exists())
        self.assertEqual(list(Path(self.directory.name).glob("*.tmp")), [])

    def test_due_occurrence_executes_once_and_persists_data(self):
        records = [{"data": "scheduled", "status_code": 200}]
        with patch("orders_dashboard.dashboard.fetch_data", return_value=records) as fetch:
            self.assertFalse(self.scheduler.run_due())
            self.now = self.scheduler.next_run
            self.assertTrue(self.scheduler.run_due())
            self.assertFalse(self.scheduler.run_due())
            fetch.assert_called_once()
        snapshot = self.dashboard.snapshot()
        self.assertEqual(snapshot["items"], records)
        self.assertEqual(snapshot["schedule"]["last_result"], "completed")
        self.assertGreater(self.scheduler.next_run, self.now)

    def test_busy_manual_refresh_is_skipped(self):
        self.now = self.scheduler.next_run
        with self.dashboard.lock, patch("orders_dashboard.dashboard.fetch_data") as fetch:
            self.scheduler.run_due()
            fetch.assert_not_called()
        self.assertEqual(self.scheduler.snapshot()["last_result"], "busy")

    def test_error_keeps_scheduler_alive(self):
        with patch.object(self.dashboard, "refresh", side_effect=RuntimeError("unexpected")):
            self.now = self.scheduler.next_run
            self.assertTrue(self.scheduler.run_due())
        self.assertEqual(self.scheduler.snapshot()["last_result"], "error")
        self.assertGreater(self.scheduler.next_run, self.now)
        self.assertIn("unexpected", self.dashboard.error)

    def test_missed_runs_are_coalesced(self):
        self.now += 3600
        with patch.object(self.dashboard, "refresh", return_value=True) as refresh:
            self.scheduler.run_due()
            refresh.assert_called_once()
        self.assertGreater(self.scheduler.next_run, self.now)

    def test_live_disable_during_fetch_is_preserved(self):
        self.now = self.scheduler.next_run
        with patch.object(self.dashboard, "refresh", side_effect=lambda: self.scheduler.configure(False, "0 * * * *")):
            self.scheduler.run_due()
        self.assertIsNone(self.scheduler.next_run)
        self.assertFalse(self.scheduler.run_due())

    def test_enable_and_stop_background_thread(self):
        self.scheduler.configure(False, "* * * * *")
        self.scheduler.start()
        self.scheduler.configure(True, "* * * * *")
        self.assertIsNotNone(self.scheduler.next_run)
        self.scheduler.stop()
        self.assertFalse(self.scheduler.thread.is_alive())

    def test_weekday_range_and_day_or_semantics(self):
        start = datetime(2026, 10, 2, 10).timestamp()  # Friday after 09:00.
        next_run = RefreshScheduler.next_after(ScheduleConfig(True, "0 9 * * 1-5"), start)
        self.assertEqual(datetime.fromtimestamp(next_run), datetime(2026, 10, 5, 9))
        next_run = RefreshScheduler.next_after(ScheduleConfig(True, "0 9 1 * 1"), start)
        self.assertEqual(datetime.fromtimestamp(next_run), datetime(2026, 10, 5, 9))
