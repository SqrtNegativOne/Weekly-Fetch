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


def _find_free_port() -> int:
    """Ask the OS to give us a free TCP port.

    We bind to port 0, which tells the OS to pick any available port,
    then read back whichever port it chose.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    port = _find_free_port()
    app  = create_app()

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

    webview.create_window(
        title="Weekly Fetch",
        url=f"http://127.0.0.1:{port}",
        width=1280,
        height=860,
        min_size=(800, 600),
    )
    webview.start()   # blocks until the window is closed


if __name__ == "__main__":
    main()
