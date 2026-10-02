"""Atomic SQLite persistence and legacy database reading."""
from contextlib import closing
import json
import sqlite3

from .config import validate_output
from .parser import parse_orders

RECORD_FIELDS = ("url", "created_at", "status_code", "error", "data")


def read_records(connection):
    connection.row_factory = sqlite3.Row
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(records)")}
    # Cached databases from the previous version remain readable.
    if "record_json" in columns:
        return [json.loads(row[0]) for row in connection.execute(
            "SELECT record_json FROM records ORDER BY position")]
    items = []
    for row in connection.execute("SELECT * FROM records ORDER BY position"):
        item = json.loads(row["extra_json"])
        for name in json.loads(row["present_fields"]):
            value = row[name]
            if name == "data" and row["data_format"] == "json":
                value = json.loads(value)
            item[name] = value
        items.append(item)
    return items


def save_data(output, results):
    output = validate_output(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    try:
        temporary.unlink(missing_ok=True)
        with closing(sqlite3.connect(temporary)) as connection:
            connection.execute("PRAGMA foreign_keys = ON")
            with connection:
                connection.execute("""CREATE TABLE records (
                    position INTEGER PRIMARY KEY,
                    url TEXT,
                    created_at TEXT,
                    status_code INTEGER,
                    error TEXT,
                    data TEXT,
                    data_format TEXT NOT NULL CHECK (data_format IN ('text', 'json')),
                    extra_json TEXT NOT NULL,
                    present_fields TEXT NOT NULL
                )""")
                connection.execute("""CREATE TABLE orders (
                    record_position INTEGER NOT NULL REFERENCES records(position),
                    order_index INTEGER NOT NULL,
                    symbol TEXT NOT NULL,
                    price TEXT,
                    side TEXT,
                    size TEXT,
                    value TEXT,
                    orders_time TEXT,
                    PRIMARY KEY (record_position, order_index)
                )""")
                for index, result in enumerate(results):
                    data = result.get("data")
                    is_text = isinstance(data, str)
                    connection.execute(
                        """INSERT INTO records
                        (position, url, created_at, status_code, error, data,
                         data_format, extra_json, present_fields)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (index, result.get("url"), result.get("created_at"),
                         result.get("status_code"), result.get("error"),
                         data if is_text else json.dumps(data, ensure_ascii=False),
                         "text" if is_text else "json",
                         json.dumps({key: value for key, value in result.items()
                                     if key not in RECORD_FIELDS}, ensure_ascii=False),
                         json.dumps([key for key in RECORD_FIELDS if key in result])),
                    )
                    connection.executemany(
                        """INSERT INTO orders
                        (record_position, order_index, symbol, price, side, size, value, orders_time)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        ((index, order_index, *order)
                         for order_index, order in enumerate(parse_orders(data))),
                    )
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
