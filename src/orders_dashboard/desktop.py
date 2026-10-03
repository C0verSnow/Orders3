"""Host the local dashboard in a native window; no Python API is exposed to JS."""
import os
from pathlib import Path
import sys
import threading
from time import perf_counter


def signal_launcher_ready(event_variable="ORDERS_READY_EVENT"):
    name = os.environ.get(event_variable)
    if os.name != "nt" or not name:
        return
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenEventW.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR)
    kernel.OpenEventW.restype = wintypes.HANDLE
    kernel.SetEvent.argtypes = (wintypes.HANDLE,)
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    event = kernel.OpenEventW(0x0002, False, name)
    if event:
        try:
            kernel.SetEvent(event)
        finally:
            kernel.CloseHandle(event)


def run_desktop(server, address):
    try:
        import webview
    except ImportError:
        print('独立窗口依赖尚未安装，请执行：python -m pip install -e ".[desktop]"',
              file=sys.stderr)
        return 1

    thread = threading.Thread(target=server.serve_forever, name="desktop-http", daemon=True)
    thread.start()
    started = perf_counter()
    try:
        # Preserve the existing database export button inside WebView2.
        webview.settings["ALLOW_DOWNLOADS"] = True
        window = webview.create_window(
            "Orders · 本地订单看板", address + "?desktop=1", width=1200, height=820,
            min_size=(720, 520), background_color="#f6f8f5",
            hidden=bool(os.environ.get("ORDERS_READY_EVENT")),
        )

        def loaded():
            window.show()
            signal_launcher_ready()
            # Start the page handoff after the native splash has faded away.
            def transition():
                window.evaluate_js("window.beginStartupTransition && window.beginStartupTransition()")
            timer = threading.Timer(0.44, transition)
            timer.daemon = True
            timer.start()
            print(f"独立窗口网页加载完成：{perf_counter() - started:.3f} 秒", flush=True)

        window.events.loaded += loaded
        window.events.closed += lambda: signal_launcher_ready("ORDERS_CLOSED_EVENT")
        # Keep the engine profile between launches instead of recreating it each time.
        profile = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "OrdersDashboard" / "WebView"
        profile.mkdir(parents=True, exist_ok=True)
        webview.start(gui="edgechromium" if os.name == "nt" else None,
                      private_mode=False, storage_path=str(profile))
        return 0
    except Exception as error:
        print(f"无法打开独立窗口：{error}。Windows 需要 Microsoft Edge WebView2 Runtime；"
              "也可使用 --browser 打开系统浏览器。", file=sys.stderr)
        return 1
    finally:
        # Returning from the GUI loop means its last window was closed.
        server.shutdown()
        thread.join(timeout=2)
