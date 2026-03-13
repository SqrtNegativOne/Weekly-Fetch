"""FastAPI backend for the Weekly Fetch app.

Imported by app.py (at the project root) via `create_app()`.
Provides REST API routes and serves the UI static files.

Route summary:
  GET  /                           → serve ui/index.html
  GET  /static/{file}              → serve ui/ files

  GET  /api/artifacts/pending      → all pending artifacts
  GET  /api/artifacts/archived     → paginated archived artifacts
  GET  /api/artifacts/{id}         → single artifact
  POST /api/artifacts/{id}/archive → archive an artifact
  POST /api/artifacts/{id}/unarchive → unarchive an artifact
  POST /api/artifacts/{id}/note    → save note text
  POST /api/artifacts/{id}/todo    → save todo text

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
from db import (archive_artifact, get_archived, get_artifact, get_pending,
                get_usage_stats, init_db, save_note, save_todo,
                save_usage_session, unarchive_artifact,
                archive_note, unarchive_note, archive_todo, unarchive_todo,
                archive_all_notes, archive_all_todos,
                get_pending_notes_todos, count_pending_notes_todos,
                get_archived_notes, get_archived_todos)
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

    # ── Artifacts ──────────────────────────────────────────────────────────────
    @app.get("/api/artifacts/pending")
    def list_pending() -> dict:
        db = _db_path()
        init_db(db)
        counts = count_pending_notes_todos(db)
        return {
            "artifacts": get_pending(db),
            "pending_notes": counts["notes"],
            "pending_todos": counts["todos"],
        }

    @app.get("/api/artifacts/archived")
    def list_archived(search: str = "", platform: str = "",
                      source: str = "", limit: int = 50,
                      offset: int = 0) -> list:
        db = _db_path()
        init_db(db)
        return get_archived(db,
                            search=search or None,
                            platform=platform or None,
                            source=source or None,
                            limit=limit, offset=offset)

    @app.get("/api/artifacts/{artifact_id}")
    def read_artifact(artifact_id: int) -> dict:
        db = _db_path()
        result = get_artifact(db, artifact_id)
        if not result:
            raise HTTPException(status_code=404, detail="Artifact not found")
        return result

    @app.post("/api/artifacts/{artifact_id}/archive")
    def do_archive(artifact_id: int) -> dict:
        archive_artifact(_db_path(), artifact_id)
        return {"ok": True}

    @app.post("/api/artifacts/{artifact_id}/unarchive")
    def do_unarchive(artifact_id: int) -> dict:
        unarchive_artifact(_db_path(), artifact_id)
        return {"ok": True}

    @app.post("/api/artifacts/{artifact_id}/note")
    async def update_note(artifact_id: int, request: Request) -> dict:
        body = await request.json()
        save_note(_db_path(), artifact_id, body.get("text", ""))
        return {"ok": True}

    @app.post("/api/artifacts/{artifact_id}/todo")
    async def update_todo(artifact_id: int, request: Request) -> dict:
        body = await request.json()
        save_todo(_db_path(), artifact_id, body.get("text", ""))
        return {"ok": True}

    # ── Notes / Todos — independent status ──────────────────────────────────
    @app.post("/api/notes/{artifact_id}/archive")
    def do_archive_note(artifact_id: int) -> dict:
        if not archive_note(_db_path(), artifact_id):
            raise HTTPException(
                status_code=400,
                detail="Cannot archive note — the parent artifact has not been archived yet.",
            )
        return {"ok": True}

    @app.post("/api/notes/{artifact_id}/unarchive")
    def do_unarchive_note(artifact_id: int) -> dict:
        unarchive_note(_db_path(), artifact_id)
        return {"ok": True}

    @app.post("/api/todos/{artifact_id}/archive")
    def do_archive_todo(artifact_id: int) -> dict:
        if not archive_todo(_db_path(), artifact_id):
            raise HTTPException(
                status_code=400,
                detail="Cannot archive todo — the parent artifact has not been archived yet.",
            )
        return {"ok": True}

    @app.post("/api/todos/{artifact_id}/unarchive")
    def do_unarchive_todo(artifact_id: int) -> dict:
        unarchive_todo(_db_path(), artifact_id)
        return {"ok": True}

    @app.post("/api/notes/archive-all")
    def do_archive_all_notes() -> dict:
        count = archive_all_notes(_db_path())
        return {"ok": True, "count": count}

    @app.post("/api/todos/archive-all")
    def do_archive_all_todos() -> dict:
        count = archive_all_todos(_db_path())
        return {"ok": True, "count": count}

    @app.get("/api/pending-review")
    def pending_review() -> dict:
        db = _db_path()
        init_db(db)
        return get_pending_notes_todos(db)

    @app.get("/api/notes/archived")
    def list_archived_notes(search: str = "", platform: str = "",
                            limit: int = 50, offset: int = 0) -> list:
        db = _db_path()
        init_db(db)
        return get_archived_notes(db,
                                  search=search or None,
                                  platform=platform or None,
                                  limit=limit, offset=offset)

    @app.get("/api/todos/archived")
    def list_archived_todos(search: str = "", platform: str = "",
                            limit: int = 50, offset: int = 0) -> list:
        db = _db_path()
        init_db(db)
        return get_archived_todos(db,
                                  search=search or None,
                                  platform=platform or None,
                                  limit=limit, offset=offset)

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
        """Return any errors from the last fetch run, then clear them."""
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

    # ── Usage tracking ───────────────────────────────────────────────────
    @app.post("/api/usage/session")
    async def post_usage_session(request: Request) -> dict:
        body = await request.json()
        db = _db_path()
        init_db(db)
        save_usage_session(
            db,
            started_at=body.get("started_at", ""),
            ended_at=body.get("ended_at", ""),
            duration_seconds=int(body.get("duration_seconds", 0)),
            artifacts_viewed=int(body.get("artifacts_viewed", 0)),
            time_per_source_json=json.dumps(body.get("time_per_source", {})),
        )
        return {"ok": True}

    @app.get("/api/usage/stats")
    def usage_stats() -> dict:
        db = _db_path()
        init_db(db)
        return get_usage_stats(db)

    return app
