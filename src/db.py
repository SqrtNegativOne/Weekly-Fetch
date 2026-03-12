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

            CREATE TABLE IF NOT EXISTS usage_sessions (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at       TEXT NOT NULL,
                ended_at         TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                artifacts_viewed INTEGER NOT NULL DEFAULT 0,
                time_per_source  TEXT
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


def save_usage_session(db_path: Path, started_at: str, ended_at: str,
                       duration_seconds: int, artifacts_viewed: int,
                       time_per_source_json: str) -> None:
    """Insert one usage session row."""
    with _connect(db_path) as conn:
        conn.execute("""
            INSERT INTO usage_sessions
                (started_at, ended_at, duration_seconds, artifacts_viewed, time_per_source)
            VALUES (?, ?, ?, ?, ?)
        """, (started_at, ended_at, duration_seconds, artifacts_viewed, time_per_source_json))


def get_usage_stats(db_path: Path) -> dict:
    """Return aggregated usage statistics.

    Returns a dict with:
      total_time_seconds  — sum of all session durations
      total_sessions      — number of sessions
      total_artifacts_viewed — sum of artifacts viewed
      per_source          — list of {source, time_seconds, note_count, todo_count}
      recent_sessions     — last 20 sessions
    """
    if not db_path.exists():
        return {"total_time_seconds": 0, "total_sessions": 0,
                "total_artifacts_viewed": 0, "per_source": [],
                "recent_sessions": []}

    with _connect(db_path) as conn:
        # Totals
        agg = conn.execute("""
            SELECT COALESCE(SUM(duration_seconds), 0),
                   COUNT(*),
                   COALESCE(SUM(artifacts_viewed), 0)
            FROM usage_sessions
        """).fetchone()

        total_time = agg[0]
        total_sessions = agg[1]
        total_viewed = agg[2]

        # Aggregate time_per_source from all sessions
        source_time: dict[str, int] = {}
        rows = conn.execute("SELECT time_per_source FROM usage_sessions WHERE time_per_source IS NOT NULL").fetchall()
        for row in rows:
            try:
                blob = json.loads(row[0])
                for key, secs in blob.items():
                    source_time[key] = source_time.get(key, 0) + int(secs)
            except (json.JSONDecodeError, TypeError):
                pass

        # Note and todo counts per source (from artifacts table)
        source_notes: dict[str, int] = {}
        source_todos: dict[str, int] = {}
        note_rows = conn.execute("""
            SELECT a.platform || '/' || a.source_name AS src, COUNT(*) AS cnt
            FROM notes n JOIN artifacts a ON n.artifact_id = a.id
            GROUP BY src
        """).fetchall()
        for r in note_rows:
            source_notes[r[0]] = r[1]

        todo_rows = conn.execute("""
            SELECT a.platform || '/' || a.source_name AS src, COUNT(*) AS cnt
            FROM todos t JOIN artifacts a ON t.artifact_id = a.id
            GROUP BY src
        """).fetchall()
        for r in todo_rows:
            source_todos[r[0]] = r[1]

        # Merge into per_source list
        all_sources = set(source_time) | set(source_notes) | set(source_todos)
        per_source = []
        for src in sorted(all_sources):
            parts = src.split("/", 1)
            per_source.append({
                "platform": parts[0] if len(parts) > 1 else "",
                "source_name": parts[1] if len(parts) > 1 else src,
                "source": src,
                "time_seconds": source_time.get(src, 0),
                "note_count": source_notes.get(src, 0),
                "todo_count": source_todos.get(src, 0),
            })

        # Sort by time descending so the busiest sources appear first
        per_source.sort(key=lambda x: x["time_seconds"], reverse=True)

        # Recent sessions
        recent = conn.execute("""
            SELECT started_at, duration_seconds, artifacts_viewed
            FROM usage_sessions
            ORDER BY started_at DESC
            LIMIT 20
        """).fetchall()
        recent_sessions = [
            {"started_at": r[0], "duration_seconds": r[1], "artifacts_viewed": r[2]}
            for r in recent
        ]

    return {
        "total_time_seconds": total_time,
        "total_sessions": total_sessions,
        "total_artifacts_viewed": total_viewed,
        "per_source": per_source,
        "recent_sessions": recent_sessions,
    }


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
