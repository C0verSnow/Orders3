"""Command-line entry point."""
import argparse
import os
from pathlib import Path
import sys
import threading
from time import perf_counter
import webbrowser

from .config import default_output, load_schedule, validate_output
from .dashboard import Dashboard
from .server import LocalHTTPServer, make_handler
from .scheduler import RefreshScheduler
from .trailing import OrdersList


def main(argv=None):
    started = perf_counter()
    parser = argparse.ArgumentParser(description="抓取 URL 数据并启动本地展示网页")
    parser.add_argument("output", nargs="?", type=Path,
                        default=None)
    parser.add_argument("--list", action="store_true", help="获取 Gate 跟踪订单并保存到 data/orderslist.db")
    parser.add_argument("--port", type=int, default=0, help="本地网页端口，默认自动分配；0 表示自动分配")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址，默认仅本机；容器使用 0.0.0.0")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    parser.add_argument("--desktop", action="store_true", help="在独立软件窗口内打开网页（仅 Windows）")
    parser.add_argument("--browser", action="store_true", help="使用系统浏览器（覆盖启动器默认的独立窗口）")
    parser.add_argument("--cached", action="store_true", help="启动时直接展示已有数据")
    parser.add_argument("--fetch-only", action="store_true", help="仅抓取并保存 SQLite 数据库，不启动网页")
    args = parser.parse_args(argv)
    if args.desktop and os.name != "nt":
        parser.error("--desktop 仅支持 Windows；Linux 请使用默认的浏览器模式")
    if args.desktop and (args.browser or args.no_browser or args.fetch_only or args.list):
        parser.error("--desktop 不能与 --browser、--no-browser、--fetch-only 或 --list 同时使用")
    if not 0 <= args.port <= 65535:
        parser.error("端口必须在 0 到 65535 之间；0 表示自动分配")
    if args.cached and args.fetch_only:
        parser.error("--cached 与 --fetch-only 不能同时使用")
    if args.list:
        if args.cached:
            parser.error("--list 与 --cached 不能同时使用")
        from .trailing import main as list_orders
        return list_orders(args.output)
    try:
        output = validate_output(args.output if args.output is not None else default_output())
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
    orders_list = OrdersList()
    try:
        with LocalHTTPServer((args.host, args.port), make_handler(dashboard, orders_list)) as server:
            # Windows opens immediately; other platforms retain their startup flow.
            if not args.cached:
                if os.name == "nt":
                    for refresh, name in ((orders_list.refresh, "startup-orders"),
                                          (dashboard.refresh, "startup-sources")):
                        thread = threading.Thread(target=refresh, name=name, daemon=True)
                        thread.start()
                else:
                    orders_list.refresh()
                    dashboard.refresh()
            if schedule.enabled:
                scheduler.next_run = scheduler.next_after(schedule, scheduler.clock())
            scheduler.start()
            address = f"http://127.0.0.1:{server.server_port}"
            print(f"本地网页：{address}  （Ctrl+C 停止）", flush=True)
            if os.name == "nt":
                print(f"本地服务准备完成：{perf_counter() - started:.3f} 秒（不含 Python 进程启动）", flush=True)
            if args.desktop:
                from .desktop import run_desktop
                return run_desktop(server, address)
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
