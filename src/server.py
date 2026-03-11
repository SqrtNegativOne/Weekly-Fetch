"""FastAPI backend for the Weekly Fetch app.

Imported by app.py (at the project root) via `create_app()`.
Provides REST API routes and serves the UI static files.

Route summary:
  GET  /                           → serve ui/index.html
  GET  /static/{file}              → serve ui/ files

  GET  /api/reports                → list week tags from DB
  GET  /api/reports/{tag}          → all posts + notes for a week
  POST /api/reports/{tag}/notes/{id} → save a note

  GET  /api/accounts               → read accounts.json
  POST /api/accounts               → write accounts.json
  GET  /api/settings               → read settings.json
  POST /api/settings               → write settings.json

  POST /api/install-task           → (re)register Windows scheduled task
  POST /api/remove-task            → delete Windows scheduled task
  POST /api/run-now                → trigger a fetch in a background thread
"""
import json
import subprocess
import sys
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Resolve paths relative to this file (src/server.py)
_SRC = Path(__file__).parent   # …/src/

# Ensure src/ is importable — needed when this module is imported from app.py
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from config import ACCOUNTS_PATH, BASE_DIR, BUNDLE_DIR, load_settings, save_settings
from db import get_digest, init_db, list_tags, save_note
from log import logger

_UI = BUNDLE_DIR / "ui"


def _db_path() -> Path:
    """Resolve the SQLite database path from current settings."""
    settings = load_settings()
    p = Path(settings["data_dir"])
    if not p.is_absolute():
        p = BASE_DIR / p
    return p / "digests.db"


def create_app() -> FastAPI:
    """Build and return the FastAPI application instance."""
    app = FastAPI(title="Weekly Fetch", docs_url=None, redoc_url=None)

    # Serve everything in ui/ at /static/...
    app.mount("/static", StaticFiles(directory=str(_UI)), name="static")

    # ── Index ─────────────────────────────────────────────────────────────────
    @app.get("/", include_in_schema=False)
    def serve_index():
        return FileResponse(str(_UI / "index.html"))

    # ── Reports ───────────────────────────────────────────────────────────────
    @app.get("/api/reports")
    def list_reports() -> list:
        db = _db_path()
        init_db(db)
        return list_tags(db)

    @app.get("/api/reports/{tag}")
    def get_report(tag: str) -> list:
        db = _db_path()
        if not db.exists():
            return []
        return get_digest(db, tag)

    @app.post("/api/reports/{tag}/notes/{post_id}")
    async def update_note(tag: str, post_id: int, request: Request) -> dict:
        body = await request.json()
        save_note(_db_path(), post_id, tag, body.get("text", ""))
        return {"ok": True}

    # ── Accounts ──────────────────────────────────────────────────────────────
    @app.get("/api/accounts")
    def get_accounts() -> dict:
        if not ACCOUNTS_PATH.exists():
            return {}
        return json.loads(ACCOUNTS_PATH.read_text(encoding="utf-8"))

    @app.post("/api/accounts")
    async def post_accounts(request: Request) -> dict:
        logger.info("User saved sources")
        body = await request.json()
        ACCOUNTS_PATH.write_text(
            json.dumps(body, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        return {"ok": True}

    # ── Settings ──────────────────────────────────────────────────────────────
    @app.get("/api/settings")
    def get_settings() -> dict:
        return load_settings()

    @app.post("/api/settings")
    async def post_settings(request: Request) -> dict:
        logger.info("User saved settings")
        body = await request.json()
        save_settings(body)
        return {"ok": True}

    # ── Task management ───────────────────────────────────────────────────────

    _frozen = getattr(sys, "frozen", False)

    @app.post("/api/install-task")
    async def install_task(request: Request) -> dict:
        """Save settings (if a body is provided) then re-register the task."""
        logger.info("User clicked Install Task")
        body = await request.json()
        if body:
            save_settings(body)

        settings = load_settings()
        if _frozen:
            task_cmd = f'"{sys.executable}" --fetch'
        else:
            task_cmd = f'"{sys.executable}" "{BASE_DIR / "src" / "main.py"}"'
        result = subprocess.run(
            ["schtasks", "/Create", "/F",
             "/SC", "DAILY",
             "/ST", settings["schedule_time"],
             "/TN", "WeeklyFetchDigest",
             "/TR", task_cmd,
             "/RL", "LIMITED"],
            capture_output=True, text=True,
        )

        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=result.stderr or result.stdout or "schtasks failed",
            )
        return {"ok": True}

    @app.post("/api/remove-task")
    def remove_task() -> dict:
        logger.info("User clicked Remove Task")
        result = subprocess.run(
            ["schtasks", "/Delete", "/TN", "WeeklyFetchDigest", "/F"],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=result.stderr)
        return {"ok": True}

    @app.get("/api/fetch-status")
    def fetch_status() -> dict:
        """Return whether a fetch is currently running, plus progress info."""
        running = (BASE_DIR / "fetch.lock").exists()
        result: dict = {"running": running}
        if running:
            progress_path = BASE_DIR / "fetch_progress.json"
            if progress_path.exists():
                try:
                    result["progress"] = json.loads(
                        progress_path.read_text(encoding="utf-8"))
                except Exception:
                    pass
        return result

    @app.get("/api/fetch-errors")
    def fetch_errors() -> list:
        """Return any errors from the last fetch run, then clear them.

        main.py writes errors to fetch_errors.json while it runs.
        This endpoint reads that file and deletes it so each error is
        shown to the user exactly once.
        """
        errors_path = BASE_DIR / "fetch_errors.json"
        if not errors_path.exists():
            return []
        try:
            errors = json.loads(errors_path.read_text(encoding="utf-8"))
            errors_path.unlink(missing_ok=True)
            if errors:
                logger.info("Delivered {} fetch error(s) to UI", len(errors))
            return errors
        except Exception as exc:
            logger.error("Could not read fetch_errors.json: {}", exc)
            return []

    @app.post("/api/run-now")
    def run_now() -> dict:
        """Kick off a forced fetch in a daemon thread so the API responds immediately."""
        logger.info("User clicked Run Now / Generate Report")

        def _worker():
            if _frozen:
                subprocess.run([sys.executable, "--fetch", "--force"],
                               cwd=str(BASE_DIR))
            else:
                subprocess.run([sys.executable, str(_SRC / "main.py"), "--force"],
                               cwd=str(BASE_DIR))

        threading.Thread(target=_worker, daemon=True).start()
        return {"ok": True, "msg": "Fetch started — check back in a minute."}

    return app
