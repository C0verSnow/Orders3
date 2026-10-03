"""Verify a frozen release serves bundled pages and APIs outside the checkout."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import urlopen


def main():
    executable = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        config = root / "config"
        config.write_text("[schedule]\nenabled = false\n", encoding="utf-8")
        environment = {**os.environ, "ORDERS_DATA_DIR": str(root / "data"),
                       "ORDERS_CONFIG_PATH": str(config)}
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        with (root / "process.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen([str(executable), "--cached", "--no-browser", "--port", str(port)],
                                       cwd=root, env=environment, stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 60
                while True:
                    try:
                        with urlopen(f"http://127.0.0.1:{port}/", timeout=2) as response:
                            assert b"<html" in response.read().lower()
                        break
                    except (URLError, TimeoutError):
                        if process.poll() is not None or time.monotonic() >= deadline:
                            raise RuntimeError("Frozen executable did not start")
                        time.sleep(0.25)
                for route in ("/style.css", "/app.js", "/logo.svg", "/api/data", "/api/orders"):
                    with urlopen(f"http://127.0.0.1:{port}{route}", timeout=5) as response:
                        body = response.read()
                        assert response.status == 200 and body, route
                        if route.startswith("/api/"):
                            assert isinstance(json.loads(body), dict), route
                print("Standalone pages and APIs passed")
            except Exception:
                log.flush()
                print((root / "process.log").read_text(encoding="utf-8", errors="replace"), file=sys.stderr)
                raise
            finally:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)


if __name__ == "__main__":
    main()
