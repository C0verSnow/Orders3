"""Coordinate refreshes and read dashboard snapshots."""
from contextlib import closing
from datetime import datetime, timezone
import sqlite3
import sys
import threading

import requests

from .config import validate_output
from .fetcher import fetch_data
from .parser import parse_orders
from .storage import read_records, save_data


class Dashboard:
    def __init__(self, output):
        self.output = validate_output(output)
        self.lock = threading.Lock()
        self.error = None

    def snapshot(self):
        items = []
        order_rows = []
        updated_at = None
        if self.output.exists():
            with closing(sqlite3.connect(self.output.as_uri() + "?mode=ro", uri=True)) as connection:
                items = read_records(connection)
                has_orders = connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='orders'").fetchone()
                if has_orders:
                    order_rows = [dict(row) for row in connection.execute(
                        "SELECT * FROM orders ORDER BY record_position, order_index")]
                else:
                    names = ("symbol", "price", "side", "size", "value", "orders_time")
                    for position, item in enumerate(items):
                        for index, order in enumerate(parse_orders(item.get("data"))):
                            order_rows.append(dict(zip(names, order),
                                                   record_position=position, order_index=index))
            if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
                raise ValueError("数据文件应为对象数组")
            updated_at = datetime.fromtimestamp(self.output.stat().st_mtime, timezone.utc).isoformat()
        return {"items": items, "orders": order_rows, "updated_at": updated_at, "error": self.error}

    def refresh(self):
        if not self.lock.acquire(blocking=False):
            return False
        try:
            results = fetch_data()
            save_data(self.output, results)
            self.error = None
            failed = sum("error" in result for result in results)
            print(f"已保存 {len(results)} 条结果到 {self.output}，失败 {failed} 条", flush=True)
        except (requests.RequestException, ValueError, OSError, sqlite3.Error) as error:
            self.error = f"抓取失败，保留上次数据：{error}"
            print(self.error, file=sys.stderr, flush=True)
        finally:
            self.lock.release()
        return True
