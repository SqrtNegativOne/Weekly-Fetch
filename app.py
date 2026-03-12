"""Weekly Fetch — app entry point.

Double-click this file (or run `python app.py`) to open the app.

What happens step by step:
  1. We ask the OS for a free TCP port (bind to :0, read back the assigned port).
  2. We start a FastAPI/uvicorn server in a background daemon thread on that port.
     A daemon thread exits automatically when the main thread exits, so we don't
     need to explicitly stop the server.
  3. We wait briefly for uvicorn to start listening.
  4. We open a native pywebview window (Edge WebView2 on Windows) pointing at
     http://localhost:{port}.
  5. webview.start() blocks until the user closes the window.
  6. The main thread exits → the daemon server thread exits → process ends.
"""
import socket
import sys
import threading
import time
from pathlib import Path

# Make src/ importable so `from server import create_app` works
sys.path.insert(0, str(Path(__file__).parent / "src"))

import uvicorn
import webview

from server import create_app
from dwm import apply_titlebar_style


class WindowApi:
    """Python methods callable from JS via window.pywebview.api.*"""
    def __init__(self):
        self._win = None

    def set_window(self, win):
        self._win = win

    def minimize(self):
        if self._win: self._win.minimize()

    def toggle_maximize(self):
        if self._win:
            import ctypes
            hwnd = self._win.native.Handle.ToInt64()
            if hwnd and ctypes.windll.user32.IsZoomed(hwnd):
                self._win.restore()
            else:
                self._win.maximize()

    def close_window(self):
        if self._win: self._win.destroy()



def _find_free_port() -> int:
    """Ask the OS to give us a free TCP port.

    We bind to port 0, which tells the OS to pick any available port,
    then read back whichever port it chose.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _task_exists() -> bool:
    """Return True if the WeeklyFetchDigest scheduled task already exists."""
    import subprocess
    r = subprocess.run(
        ["schtasks", "/Query", "/TN", "WeeklyFetchDigest"],
        capture_output=True,
    )
    return r.returncode == 0


def _install_daily_task() -> None:
    """Register a DAILY Task Scheduler entry that runs --fetch at the configured time."""
    import subprocess
    from config import load_settings
    settings = load_settings()
    task_cmd = f'"{sys.executable}" --fetch'
    subprocess.run(
        ["schtasks", "/Create", "/F",
         "/SC", "DAILY",
         "/ST", settings.get("schedule_time", "09:00"),
         "/TN", "WeeklyFetchDigest",
         "/TR", task_cmd,
         "/RL", "LIMITED"],
        capture_output=True,
    )


def main():
    # Auto-register the daily task on first launch (frozen .exe only).
    # In dev mode sys.frozen is not set, so we skip this to avoid scheduling
    # a .py file as a task.
    if getattr(sys, "frozen", False):
        if not _task_exists():
            _install_daily_task()

    port = _find_free_port()
    app  = create_app()

    from config import load_settings, BUNDLE_DIR
    settings = load_settings()
    start_fullscreen = settings.get("start_fullscreen", True)
    icon_path = str(BUNDLE_DIR / "ui" / "logo.ico")

    # Start uvicorn in a daemon thread.
    # `daemon=True` means this thread is killed automatically when the
    # main thread (pywebview) exits — no explicit cleanup needed.
    server_thread = threading.Thread(
        target=uvicorn.run,
        kwargs={
            "app":       app,
            "host":      "127.0.0.1",
            "port":      port,
            "log_level": "warning",
        },
        daemon=True,
    )
    server_thread.start()

    # Give uvicorn a moment to bind and start accepting connections
    # before we tell pywebview to open the URL.
    time.sleep(0.8)

    api = WindowApi()
    win = webview.create_window(
        title="Weekly Fetch",
        url=f"http://127.0.0.1:{port}",
        width=1280,
        height=860,
        min_size=(800, 600),
        frameless=True,
        easy_drag=False,   # -webkit-app-region:drag handles this natively
        text_select=True,
        js_api=api,
    )
    api.set_window(win)

    win.events.shown += lambda: apply_titlebar_style(win.native.Handle.ToInt64(), icon_path=icon_path)

    if start_fullscreen:
        win.events.shown += lambda: win.maximize()

    webview.start(icon=icon_path)   # blocks until the window is closed


if __name__ == "__main__":
    if "--fetch" in sys.argv:
        # Headless fetch mode — used by Task Scheduler when running
        # the frozen .exe, e.g.: WeeklyFetch.exe --fetch
        # Optional --force flag skips schedule checks (used by Run Now).
        from main import main as fetch_main
        fetch_main(force="--force" in sys.argv)
    else:
        main()
