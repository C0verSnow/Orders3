"""Local HTTP API and allowlisted static assets."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
import json
import os
import socket
import sqlite3
from configparser import Error as ConfigError
from urllib.parse import urlparse
from .trailing import OrdersList


class LocalHTTPServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR can allow a second process to steal the same port.
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def make_handler(dashboard, orders_list=None):
    orders_list = orders_list if orders_list is not None else OrdersList()
    # Serve only named public assets; never expose source, credentials, or arbitrary files.
    assets = {"/": ("index.html", "text/html; charset=utf-8"),
              "/index.html": ("index.html", "text/html; charset=utf-8"),
              "/style.css": ("style.css", "text/css; charset=utf-8"),
              "/app.js": ("app.js", "text/javascript; charset=utf-8"),
              "/logo.svg": ("logo.svg", "image/svg+xml")}
    root = files("orders_dashboard").joinpath("web")

    class Handler(BaseHTTPRequestHandler):
        def send_body(self, status, content_type, body, download_name=None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            if download_name:
                self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

        def send_json(self, status, payload):
            self.send_body(status, "application/json; charset=utf-8",
                           json.dumps(payload, ensure_ascii=False).encode("utf-8"))

        def do_GET(self):
            path = urlparse(self.path).path
            try:
                if path == "/api/data":
                    self.send_json(200, dashboard.snapshot())
                elif path == "/api/orders":
                    self.send_json(200, orders_list.snapshot())
                elif path == "/api/schedule":
                    self.send_json(200, dashboard.scheduler.snapshot() if dashboard.scheduler else None)
                elif path == "/api/download":
                    if not dashboard.output.exists():
                        self.send_json(404, {"error": "尚未生成数据库，请先重新抓取"})
                    else:
                        self.send_body(200, "application/vnd.sqlite3", dashboard.output.read_bytes(), "data.db")
                elif path in assets:
                    filename, content_type = assets[path]
                    body = (root / filename).read_bytes()
                    if filename == "index.html" and os.name == "nt":
                        body = body.replace(b"<body>", b'<body class="startup-enabled">')
                    self.send_body(200, content_type, body)
                else:
                    self.send_json(404, {"error": "未找到资源"})
            except (OSError, ValueError, sqlite3.Error) as error:
                self.send_json(500, {"error": f"读取失败：{error}"})

        def do_POST(self):
            path = urlparse(self.path).path
            if path not in {"/api/refresh", "/api/schedule", "/api/orders/refresh"}:
                self.send_json(404, {"error": "未找到资源"})
                return
            # Browser mutations must originate from this local page.
            expected_origin = os.environ.get("ORDERS_ALLOWED_ORIGIN") or f"http://127.0.0.1:{self.server.server_port}"
            if self.headers.get("Origin") != expected_origin:
                self.send_json(403, {"error": "请从本地页面发起操作"})
                return
            if path == "/api/orders/refresh":
                if not orders_list.refresh():
                    self.send_json(409, {"error": "正在获取订单，请稍后再试"})
                    return
                try:
                    self.send_json(502 if orders_list.error else 200, orders_list.snapshot())
                except (OSError, ValueError, sqlite3.Error) as error:
                    self.send_json(500, {"error": f"读取订单失败：{error}"})
                return
            if path == "/api/schedule":
                if dashboard.scheduler is None:
                    self.send_json(503, {"error": "定时服务尚未启动"})
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 4096:
                        raise ValueError("配置请求大小必须在 1 到 4096 字节之间")
                    self.connection.settimeout(5)
                    payload = json.loads(self.rfile.read(length))
                    if not isinstance(payload, dict) or set(payload) != {"enabled", "cron"}:
                        raise ValueError("请提供 enabled 和 cron 两个配置字段")
                    self.send_json(200, dashboard.scheduler.configure(payload["enabled"], payload["cron"]))
                except (ValueError, UnicodeError) as error:
                    self.send_json(400, {"error": str(error)})
                except (OSError, ConfigError) as error:
                    self.send_json(500, {"error": f"保存配置失败：{error}"})
                return
            if not dashboard.refresh():
                self.send_json(409, {"error": "正在抓取，请稍后再试"})
                return
            try:
                self.send_json(502 if dashboard.error else 200, dashboard.snapshot())
            except (OSError, ValueError, sqlite3.Error) as error:
                self.send_json(500, {"error": str(error)})

    return Handler
