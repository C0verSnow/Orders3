"""Read Gate trailing orders and transactionally replace their local snapshot."""
from contextlib import closing
import hashlib
import hmac
import os
from pathlib import Path
import sqlite3
import time
import sys
import threading
from datetime import datetime, timezone

import requests

from .config import validate_output

HOST = "https://api.gateio.ws"
API_PATH = "/api/v4/futures/usdt/autoorder/v1/trail/list"
FIELDS = ("id", "contract", "amount", "activation_price", "reduce_only", "original_status")

def default_orders_output():
    return Path(__file__).resolve().parents[2] / "data" / "orderslist.db"


def fetch_orders():
    key = os.environ.get("API_KEY", "").strip()
    secret = os.environ.get("API_SECRET", "").strip()
    if not key or not secret:
        raise ValueError("请在项目根目录 .env 或环境变量中设置 API_KEY 和 API_SECRET")
    timestamp = str(int(time.time()))
    message = "\n".join(("GET", API_PATH, "", hashlib.sha512(b"").hexdigest(), timestamp))
    signature = hmac.new(secret.encode(), message.encode(), hashlib.sha512).hexdigest()
    with requests.get(HOST + API_PATH, headers={
        "KEY": key, "Timestamp": timestamp, "SIGN": signature,
        "Accept": "application/json",
    }, timeout=30, allow_redirects=False) as response:
        if 300 <= response.status_code < 400:
            raise ValueError("订单接口返回重定向，已停止请求")
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, dict) or payload.get("code") != 0:
        raise ValueError("订单接口返回业务错误或无效响应")
    data = payload.get("data")
    orders = data.get("orders") if isinstance(data, dict) else None
    timestamp = payload.get("timestamp")
    if not isinstance(orders, list) or type(timestamp) is not int:
        raise ValueError("订单响应缺少有效的 data.orders 或 timestamp")
    rows = []
    for order in orders:
        if not isinstance(order, dict) or any(field not in order for field in FIELDS):
            raise ValueError("订单响应缺少必需字段")
        if any(not isinstance(order[field], str) for field in FIELDS[:4]):
            raise ValueError("订单 ID、合约、数量和激活价格必须为字符串")
        if not order["id"] or not order["contract"]:
            raise ValueError("订单 ID 和合约不能为空")
        if type(order["reduce_only"]) is not bool or type(order["original_status"]) is not int:
            raise ValueError("订单 reduce_only 或 original_status 类型无效")
        rows.append(tuple(order[field] for field in FIELDS) + (timestamp,))
    return rows


def refresh_orders(output=None):
    output = validate_output(output if output is not None else
                             default_orders_output())
    rows = fetch_orders()
    output.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(output)) as connection:
        with connection:
            # Include the legacy schema migration in the snapshot transaction.
            connection.execute("BEGIN")
            columns = {row[1] for row in connection.execute("PRAGMA table_info(orders)")}
            if "trigger_price" in columns and "activation_price" not in columns:
                connection.execute("ALTER TABLE orders RENAME COLUMN trigger_price TO activation_price")
            connection.execute("""CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY NOT NULL,
                contract TEXT NOT NULL,
                amount TEXT NOT NULL,
                activation_price TEXT NOT NULL,
                reduce_only INTEGER NOT NULL CHECK (reduce_only IN (0, 1)),
                original_status INTEGER NOT NULL,
                timestamp INTEGER NOT NULL
            )""")
            connection.execute("DELETE FROM orders")
            connection.executemany("INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    return output, len(rows)


def main(output=None):
    try:
        output, count = refresh_orders(output)
    except (ValueError, OSError, requests.RequestException, sqlite3.Error) as error:
        print(f"获取订单列表失败：{error}", file=sys.stderr)
        return 1
    print(f"已保存 {count} 条订单：{output}")
    return 0


class OrdersList:
    """Share the list operation with the webpage, without CLI argument parsing."""

    def __init__(self, output=None):
        self.output = validate_output(output if output is not None else default_orders_output())
        self.lock = threading.Lock()
        self.error = None

    def snapshot(self):
        orders = []
        updated_at = None
        if self.output.exists():
            with closing(sqlite3.connect(self.output.as_uri() + "?mode=ro", uri=True)) as connection:
                connection.row_factory = sqlite3.Row
                orders = [dict(row) for row in connection.execute("SELECT * FROM orders ORDER BY id")]
            for order in orders:
                # A cached trigger price cannot be interpreted as an activation price.
                order.setdefault("activation_price", None)
                order.pop("trigger_price", None)
                order["reduce_only"] = bool(order["reduce_only"])
            updated_at = datetime.fromtimestamp(self.output.stat().st_mtime, timezone.utc).isoformat()
        return {"orders": orders, "updated_at": updated_at,
                "error": self.error, "refreshing": self.lock.locked()}

    def refresh(self):
        if not self.lock.acquire(blocking=False):
            return False
        try:
            refresh_orders(self.output)
            self.error = None
        except (ValueError, OSError, requests.RequestException, sqlite3.Error) as error:
            self.error = f"获取订单列表失败，保留上次数据：{error}"
        finally:
            self.lock.release()
        return True
