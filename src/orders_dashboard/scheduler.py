"""Run scheduled refreshes independently of the local HTTP server."""
from datetime import datetime
import threading
import time

from croniter import croniter

from .config import save_schedule, validate_schedule


class RefreshScheduler:
    def __init__(self, dashboard, config, clock=time.time, config_path=None):
        self.dashboard = dashboard
        self.config = config
        self.config_path = config_path
        self.clock = clock
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.thread = None
        self.next_run = self.next_after(config, clock()) if config.enabled else None
        self.last_run = None
        self.last_result = None

    @staticmethod
    def next_after(config, timestamp):
        # Cron follows the server's local wall clock; snapshots include a UTC offset.
        return croniter(config.cron, datetime.fromtimestamp(timestamp),
                        max_years_between_matches=8).get_next(datetime).timestamp()

    @staticmethod
    def date_text(timestamp):
        return datetime.fromtimestamp(timestamp).astimezone().isoformat() if timestamp is not None else None

    def snapshot(self):
        with self.lock:
            return {"enabled": self.config.enabled, "cron": self.config.cron,
                    "timezone": "服务器本地时间",
                    "next_run": self.date_text(self.next_run),
                    "last_run": self.date_text(self.last_run),
                    "last_result": self.last_result}

    def configure(self, enabled, expression):
        config = validate_schedule(enabled, expression)
        with self.lock:
            next_run = self.next_after(config, self.clock()) if config.enabled else None
            save_schedule(config, self.config_path)
            self.config = config
            self.next_run = next_run
        return self.snapshot()

    def run_due(self):
        now = self.clock()
        with self.lock:
            if self.next_run is None or now < self.next_run:
                return False
            config = self.config
            due = self.next_run
            self.next_run = self.next_after(config, max(due, now))
            self.last_run = now
        try:
            accepted = self.dashboard.refresh()
            result = "busy" if not accepted else "error" if self.dashboard.error else "completed"
        except Exception as error:
            self.dashboard.error = f"定时抓取失败：{error}"
            result = "error"
        finally:
            with self.lock:
                self.last_result = result
                # Skip missed occurrences after slow work; preserve live configuration changes.
                if self.config is config:
                    self.next_run = self.next_after(config, max(due, self.clock()))
        return True

    def start(self):
        if self.thread is None:
            self.thread = threading.Thread(target=self.run, name="orders-cron", daemon=True)
            self.thread.start()

    def run(self):
        while not self.stop_event.is_set():
            self.run_due()
            self.stop_event.wait(1)

    def stop(self):
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join()
