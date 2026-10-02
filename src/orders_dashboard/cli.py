"""Command-line entry point."""
import argparse
from pathlib import Path
import sys
import webbrowser

from .config import default_output, load_schedule, validate_output
from .dashboard import Dashboard
from .server import LocalHTTPServer, make_handler
from .scheduler import RefreshScheduler


def main(argv=None):
    parser = argparse.ArgumentParser(description="抓取 URL 数据并启动本地展示网页")
    parser.add_argument("output", nargs="?", type=Path,
                        default=default_output())
    parser.add_argument("--port", type=int, default=8080, help="本地网页端口，默认 8080")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    parser.add_argument("--cached", action="store_true", help="启动时直接展示已有数据")
    parser.add_argument("--fetch-only", action="store_true", help="仅抓取并保存 SQLite 数据库，不启动网页")
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("端口必须在 1 到 65535 之间")
    if args.cached and args.fetch_only:
        parser.error("--cached 与 --fetch-only 不能同时使用")
    try:
        output = validate_output(args.output)
        schedule = load_schedule()
    except ValueError as error:
        parser.error(str(error))
    dashboard = Dashboard(output)
    if args.fetch_only:
        dashboard.refresh()
        if dashboard.error:
            return 1
        return 1 if any("error" in item for item in dashboard.snapshot()["items"]) else 0
    scheduler = RefreshScheduler(dashboard, schedule)
    dashboard.scheduler = scheduler
    try:
        with LocalHTTPServer(("127.0.0.1", args.port), make_handler(dashboard)) as server:
            if not args.cached:
                dashboard.refresh()
            if schedule.enabled:
                scheduler.next_run = scheduler.next_after(schedule, scheduler.clock())
            scheduler.start()
            address = f"http://127.0.0.1:{server.server_port}"
            print(f"本地网页：{address}  （Ctrl+C 停止）", flush=True)
            if not args.no_browser:
                try:
                    webbrowser.open(address)
                except webbrowser.Error as error:
                    print(f"请手动打开网页：{error}", file=sys.stderr)
            server.serve_forever()
    except OSError as error:
        print(f"无法启动本地服务：{error}。如端口被占用，请使用 --port 更换端口。", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n本地服务已停止")
    finally:
        scheduler.stop()
    return 0
