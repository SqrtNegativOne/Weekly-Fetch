"""SQLite persistence layer for Weekly Fetch.

Tables:
  artifacts — one row per fetched post (deduplicated by link URL)
  notes     — one row per artifact with user note text
  todos     — one row per artifact with user todo text
"""
import json
import sqlite3
from datetime import datetime
from pathlib import Path


def _connect(db_path: Path) -> sqlite3.Connection:
    """Open a connection. `row_factory = sqlite3.Row` gives dict-like row access."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: Path) -> None:
    """Create tables if they don't exist. Safe to call on every app startup."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with _connect(db_path) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS artifacts (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                platform      TEXT NOT NULL,
                source_name   TEXT NOT NULL,
                fetched_at    TEXT NOT NULL,
                title         TEXT,
                link          TEXT UNIQUE,
                score         INTEGER,
                post_type     TEXT,
                content_json  TEXT,
                comments_json TEXT,
                status        TEXT NOT NULL DEFAULT 'pending',
                archived_at   TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_artifacts_status ON artifacts(status);

            CREATE TABLE IF NOT EXISTS notes (
                artifact_id INTEGER PRIMARY KEY REFERENCES artifacts(id),
                note_text   TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS todos (
                artifact_id INTEGER PRIMARY KEY REFERENCES artifacts(id),
                todo_text   TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
        """)


def save_artifacts(db_path: Path, platform: str,
                   source_name: str, artifacts: list) -> int:
    """Insert new artifacts, skipping any whose link already exists.

    Returns the number of newly inserted rows.
    """
    fetched_at = datetime.now().isoformat()
    inserted = 0
    with _connect(db_path) as conn:
        for p in artifacts:
            try:
                conn.execute("""
                    INSERT OR IGNORE INTO artifacts
                        (platform, source_name, fetched_at,
                         title, link, score, post_type, content_json, comments_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    platform, source_name, fetched_at,
                    p.get("title"), p.get("link"), p.get("score"), p.get("type"),
                    json.dumps(p.get("content")),
                    json.dumps(p.get("comments")),
                ))
                if conn.execute("SELECT changes()").fetchone()[0] > 0:
                    inserted += 1
            except sqlite3.IntegrityError:
                pass
    return inserted


def get_pending(db_path: Path) -> list[dict]:
    """Return all pending artifacts with notes+todos joined, ordered by source then score."""
    if not db_path.exists():
        return []
    with _connect(db_path) as conn:
        rows = conn.execute("""
            SELECT a.id, a.platform, a.source_name, a.title, a.link,
                   a.score, a.post_type, a.content_json, a.comments_json,
                   COALESCE(n.note_text, '') AS note_text,
                   COALESCE(t.todo_text, '') AS todo_text
            FROM   artifacts a
            LEFT JOIN notes n ON n.artifact_id = a.id
            LEFT JOIN todos t ON t.artifact_id = a.id
            WHERE  a.status = 'pending'
            ORDER  BY a.source_name, a.score DESC
        """).fetchall()

    return [_row_to_dict(r) for r in rows]


def get_archived(db_path: Path, search: str | None = None,
                 platform: str | None = None, source: str | None = None,
                 limit: int = 50, offset: int = 0) -> list[dict]:
    """Return archived artifacts with optional filtering and pagination."""
    if not db_path.exists():
        return []

    conditions = ["a.status = 'archived'"]
    params: list = []

    if search:
        conditions.append("a.title LIKE ?")
        params.append(f"%{search}%")
    if platform:
        conditions.append("a.platform = ?")
        params.append(platform)
    if source:
        conditions.append("a.source_name = ?")
        params.append(source)

    where = " AND ".join(conditions)
    params.extend([limit, offset])

    with _connect(db_path) as conn:
        rows = conn.execute(f"""
            SELECT a.id, a.platform, a.source_name, a.title, a.link,
                   a.score, a.post_type, a.content_json, a.comments_json,
                   a.archived_at,
                   COALESCE(n.note_text, '') AS note_text,
                   COALESCE(t.todo_text, '') AS todo_text
            FROM   artifacts a
            LEFT JOIN notes n ON n.artifact_id = a.id
            LEFT JOIN todos t ON t.artifact_id = a.id
            WHERE  {where}
            ORDER  BY a.archived_at DESC
            LIMIT ? OFFSET ?
        """, params).fetchall()

    return [_row_to_dict(r) for r in rows]


def get_artifact(db_path: Path, artifact_id: int) -> dict | None:
    """Return a single artifact with notes+todos, or None."""
    with _connect(db_path) as conn:
        row = conn.execute("""
            SELECT a.id, a.platform, a.source_name, a.title, a.link,
                   a.score, a.post_type, a.content_json, a.comments_json,
                   a.status, a.archived_at,
                   COALESCE(n.note_text, '') AS note_text,
                   COALESCE(t.todo_text, '') AS todo_text
            FROM   artifacts a
            LEFT JOIN notes n ON n.artifact_id = a.id
            LEFT JOIN todos t ON t.artifact_id = a.id
            WHERE  a.id = ?
        """, (artifact_id,)).fetchone()

    if not row:
        return None
    return _row_to_dict(row)


def archive_artifact(db_path: Path, artifact_id: int) -> None:
    """Set status='archived' and archived_at=now."""
    with _connect(db_path) as conn:
        conn.execute("""
            UPDATE artifacts SET status = 'archived', archived_at = ?
            WHERE id = ?
        """, (datetime.now().isoformat(), artifact_id))


def unarchive_artifact(db_path: Path, artifact_id: int) -> None:
    """Set status='pending' and archived_at=NULL."""
    with _connect(db_path) as conn:
        conn.execute("""
            UPDATE artifacts SET status = 'pending', archived_at = NULL
            WHERE id = ?
        """, (artifact_id,))


def save_note(db_path: Path, artifact_id: int, text: str) -> None:
    """Upsert a note. Deletes the row when text is blank."""
    updated_at = datetime.now().isoformat()
    with _connect(db_path) as conn:
        if text.strip():
            conn.execute("""
                INSERT INTO notes (artifact_id, note_text, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(artifact_id) DO UPDATE SET
                    note_text  = excluded.note_text,
                    updated_at = excluded.updated_at
            """, (artifact_id, text, updated_at))
        else:
            conn.execute("DELETE FROM notes WHERE artifact_id = ?", (artifact_id,))


def save_todo(db_path: Path, artifact_id: int, text: str) -> None:
    """Upsert a todo. Deletes the row when text is blank."""
    updated_at = datetime.now().isoformat()
    with _connect(db_path) as conn:
        if text.strip():
            conn.execute("""
                INSERT INTO todos (artifact_id, todo_text, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(artifact_id) DO UPDATE SET
                    todo_text  = excluded.todo_text,
                    updated_at = excluded.updated_at
            """, (artifact_id, text, updated_at))
        else:
            conn.execute("DELETE FROM todos WHERE artifact_id = ?", (artifact_id,))


def count_pending(db_path: Path) -> int:
    """Count pending artifacts."""
    if not db_path.exists():
        return 0
    with _connect(db_path) as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM artifacts WHERE status = 'pending'"
        ).fetchone()
    return row[0]


def _row_to_dict(r) -> dict:
    """Convert a sqlite3.Row to the dict format the UI expects."""
    d = {
        "id":          r["id"],
        "platform":    r["platform"],
        "source_name": r["source_name"],
        "title":       r["title"],
        "link":        r["link"],
        "score":       r["score"] or 0,
        "type":        r["post_type"],
        "content":     json.loads(r["content_json"] or "null"),
        "comments":    json.loads(r["comments_json"] or "[]"),
        "note":        r["note_text"],
        "todo":        r["todo_text"],
    }
    if "archived_at" in r.keys():
        d["archived_at"] = r["archived_at"]
    if "status" in r.keys():
        d["status"] = r["status"]
    return d
