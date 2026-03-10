"""SQLite persistence layer for Weekly Fetch.

Why SQLite?
  - Zero setup: a single file, no server process.
  - Python's built-in `sqlite3` module handles everything.
  - Syncthing can sync the .db file across machines transparently.

Tables:
  posts  — one row per fetched post (deduplicated by link URL)
  notes  — one row per (post_id, week_tag) with user note text
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
            CREATE TABLE IF NOT EXISTS posts (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                week_tag      TEXT NOT NULL,
                platform      TEXT NOT NULL,
                source_name   TEXT NOT NULL,
                fetched_at    TEXT NOT NULL,
                title         TEXT,
                link          TEXT UNIQUE,
                score         INTEGER,
                post_type     TEXT,
                content_json  TEXT,
                comments_json TEXT
            );
            CREATE TABLE IF NOT EXISTS notes (
                post_id    INTEGER NOT NULL,
                week_tag   TEXT NOT NULL,
                note_text  TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (post_id, week_tag)
            );
            CREATE INDEX IF NOT EXISTS idx_posts_week ON posts(week_tag);
        """)


def save_posts(db_path: Path, week_tag: str, platform: str,
               source_name: str, posts: list) -> None:
    """Upsert a batch of posts.

    Posts are deduplicated by `link` URL — if a post already exists
    (e.g. the fetcher ran twice) its score and comments are updated.
    """
    fetched_at = datetime.now().isoformat()
    with _connect(db_path) as conn:
        for p in posts:
            conn.execute("""
                INSERT INTO posts
                    (week_tag, platform, source_name, fetched_at,
                     title, link, score, post_type, content_json, comments_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(link) DO UPDATE SET
                    score         = excluded.score,
                    comments_json = excluded.comments_json,
                    fetched_at    = excluded.fetched_at
            """, (
                week_tag, platform, source_name, fetched_at,
                p.get("title"), p.get("link"), p.get("score"), p.get("type"),
                json.dumps(p.get("content")),
                json.dumps(p.get("comments")),
            ))


def list_week_tags(db_path: Path) -> list[str]:
    """Return distinct week tags that have posts, newest first."""
    if not db_path.exists():
        return []
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT DISTINCT week_tag FROM posts ORDER BY week_tag DESC"
        ).fetchall()
    return [r["week_tag"] for r in rows]


def get_digest(db_path: Path, week_tag: str) -> list[dict]:
    """Return all posts for a given week, with note_text joined in.

    The LEFT JOIN means posts with no note still appear (note_text = '').
    """
    with _connect(db_path) as conn:
        rows = conn.execute("""
            SELECT p.id, p.platform, p.source_name, p.title, p.link,
                   p.score, p.post_type, p.content_json, p.comments_json,
                   COALESCE(n.note_text, '') AS note_text
            FROM   posts p
            LEFT JOIN notes n
                   ON n.post_id = p.id AND n.week_tag = p.week_tag
            WHERE  p.week_tag = ?
            ORDER  BY p.source_name, p.score DESC
        """, (week_tag,)).fetchall()

    return [{
        "id":        r["id"],
        "platform":  r["platform"],
        "subreddit": r["source_name"],
        "title":     r["title"],
        "link":      r["link"],
        "score":     r["score"] or 0,
        "type":      r["post_type"],
        "content":   json.loads(r["content_json"] or "null"),
        "comments":  json.loads(r["comments_json"] or "[]"),
        "note":      r["note_text"],
    } for r in rows]


def save_note(db_path: Path, post_id: int, week_tag: str, text: str) -> None:
    """Upsert a note. Deletes the row when text is blank (clean DB)."""
    updated_at = datetime.now().isoformat()
    with _connect(db_path) as conn:
        if text.strip():
            conn.execute("""
                INSERT INTO notes (post_id, week_tag, note_text, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(post_id, week_tag) DO UPDATE SET
                    note_text  = excluded.note_text,
                    updated_at = excluded.updated_at
            """, (post_id, week_tag, text, updated_at))
        else:
            conn.execute(
                "DELETE FROM notes WHERE post_id = ? AND week_tag = ?",
                (post_id, week_tag)
            )


def get_notes_summary(db_path: Path) -> list[dict]:
    """Return all non-empty notes with their post context, newest first."""
    if not db_path.exists():
        return []
    with _connect(db_path) as conn:
        rows = conn.execute("""
            SELECT n.post_id, n.week_tag, n.note_text,
                   p.title, p.link, p.source_name, p.platform
            FROM   notes n
            JOIN   posts p ON p.id = n.post_id
            WHERE  n.note_text != ''
            ORDER  BY n.updated_at DESC
        """).fetchall()
    return [dict(r) for r in rows]
