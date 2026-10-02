"""Local HTTP API and allowlisted static assets."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
import json
import os
import socket
import sqlite3
from urllib.parse import urlparse


class LocalHTTPServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR can allow a second process to steal the same port.
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def make_handler(dashboard):
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
                elif path == "/api/download":
                    if not dashboard.output.exists():
                        self.send_json(404, {"error": "尚未生成数据库，请先重新抓取"})
                    else:
                        self.send_body(200, "application/vnd.sqlite3", dashboard.output.read_bytes(), "data.db")
                elif path in assets:
                    filename, content_type = assets[path]
                    self.send_body(200, content_type, (root / filename).read_bytes())
                else:
                    self.send_json(404, {"error": "未找到资源"})
            except (OSError, ValueError, sqlite3.Error) as error:
                self.send_json(500, {"error": f"读取失败：{error}"})

        def do_POST(self):
            if urlparse(self.path).path != "/api/refresh":
                self.send_json(404, {"error": "未找到资源"})
                return
            # Browser mutations must originate from this local page.
            expected_origin = f"http://127.0.0.1:{self.server.server_port}"
            if self.headers.get("Origin") != expected_origin:
                self.send_json(403, {"error": "请从本地页面发起刷新"})
                return
            if not dashboard.refresh():
                self.send_json(409, {"error": "正在抓取，请稍后再试"})
                return
            try:
                self.send_json(502 if dashboard.error else 200, dashboard.snapshot())
            except (OSError, ValueError, sqlite3.Error) as error:
                self.send_json(500, {"error": str(error)})

    return Handler
