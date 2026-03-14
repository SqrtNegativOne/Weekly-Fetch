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
import ctypes
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

# Make src/ importable so `from server import create_app` works
sys.path.insert(0, str(Path(__file__).parent / "src"))

import uvicorn
import webview

from server import create_app
from dwm import apply_titlebar_style


_MUTEX_NAME = "Global\\WeeklyFetchSingleInstance"
_ERROR_ALREADY_EXISTS = 183  # Windows error code


def _acquire_single_instance():
    """Try to create a named mutex. If another instance holds it, show a
    message box and exit. The mutex is automatically released when the
    process terminates — no cleanup needed.
    """
    handle = ctypes.windll.kernel32.CreateMutexW(None, True, _MUTEX_NAME)
    if ctypes.windll.kernel32.GetLastError() == _ERROR_ALREADY_EXISTS:
        ctypes.windll.user32.MessageBoxW(
            0,
            "Weekly Fetch is already running.\n\n"
            "Check your taskbar — the existing window may be minimized.",
            "Weekly Fetch",
            0x40,  # MB_ICONINFORMATION
        )
        sys.exit(0)
    # Keep a reference so the mutex isn't garbage-collected while the app runs
    return handle


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

    def open_in_browser(self, url):
        """Open a URL in the user's default browser instead of the webview."""
        if url and (url.startswith("http://") or url.startswith("https://")):
            webbrowser.open(url)


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
    # Block second instance — shows a message box and exits if already running
    _mutex = _acquire_single_instance()  # noqa: F841 — prevent GC

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
    assert win is not None
    api.set_window(win)

    def _on_shown():
        native = win.native
        if native is not None:
            apply_titlebar_style(native.Handle.ToInt64(), icon_path=icon_path)
    win.events.shown += _on_shown

    if start_fullscreen:
        win.events.shown += lambda: win.maximize()

    webview.start(debug=False, icon=icon_path)  # blocks until the window is closed


if __name__ == "__main__":
    if "--fetch" in sys.argv:
        # Headless fetch mode — used by Task Scheduler when running
        # the frozen .exe, e.g.: WeeklyFetch.exe --fetch
        # Optional --force flag skips schedule checks (used by Run Now).
        from main import main as fetch_main
        fetch_main(force="--force" in sys.argv)
    else:
        main()
