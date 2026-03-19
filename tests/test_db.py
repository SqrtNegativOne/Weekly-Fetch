"""Tests for db.py — init, deduplication, archive lifecycle, notes/todos."""
import pytest
from pathlib import Path

from db import (
    archive_artifact,
    count_pending,
    get_artifact,
    get_pending,
    init_db,
    save_artifacts,
    save_note,
    save_todo,
    unarchive_artifact,
)


@pytest.fixture
def db(tmp_path) -> Path:
    path = tmp_path / "test.db"
    init_db(path)
    return path


def make_post(link: str, score: int = 10, title: str = "Test") -> dict:
    return {
        "title":    title,
        "link":     link,
        "score":    score,
        "type":     "text",
        "content":  {"text": "body"},
        "comments": [],
    }


# ── init_db ───────────────────────────────────────────────────────────────────

def test_init_creates_tables(db):
    import sqlite3
    with sqlite3.connect(db) as conn:
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
    assert {"artifacts", "notes", "todos", "usage_sessions"} <= tables

def test_init_is_idempotent(db):
    """Calling init_db twice on the same file should not raise."""
    init_db(db)


# ── save_artifacts / deduplication ───────────────────────────────────────────

def test_save_returns_count_of_new(db):
    n = save_artifacts(db, "reddit", "test", [make_post("https://a"), make_post("https://b")])
    assert n == 2

def test_duplicate_link_is_ignored(db):
    save_artifacts(db, "reddit", "test", [make_post("https://a")])
    n = save_artifacts(db, "reddit", "test", [make_post("https://a")])
    assert n == 0
    assert count_pending(db) == 1

def test_save_empty_list(db):
    assert save_artifacts(db, "reddit", "test", []) == 0


# ── get_pending / count_pending ───────────────────────────────────────────────

def test_get_pending_returns_all_pending(db):
    save_artifacts(db, "reddit", "sub", [make_post("https://x"), make_post("https://y")])
    rows = get_pending(db)
    assert len(rows) == 2
    assert all(r["type"] == "text" for r in rows)

def test_count_pending_matches_get_pending(db):
    save_artifacts(db, "reddit", "sub", [make_post(f"https://{i}") for i in range(5)])
    assert count_pending(db) == len(get_pending(db)) == 5

def test_get_pending_on_missing_db(tmp_path):
    assert get_pending(tmp_path / "nope.db") == []


# ── archive / unarchive ───────────────────────────────────────────────────────

def test_archive_removes_from_pending(db):
    save_artifacts(db, "reddit", "sub", [make_post("https://z")])
    artifact_id = get_pending(db)[0]["id"]
    archive_artifact(db, artifact_id)
    assert count_pending(db) == 0

def test_unarchive_restores_to_pending(db):
    save_artifacts(db, "reddit", "sub", [make_post("https://z")])
    artifact_id = get_pending(db)[0]["id"]
    archive_artifact(db, artifact_id)
    unarchive_artifact(db, artifact_id)
    assert count_pending(db) == 1

def test_get_artifact_returns_status(db):
    save_artifacts(db, "reddit", "sub", [make_post("https://z")])
    artifact_id = get_pending(db)[0]["id"]
    archive_artifact(db, artifact_id)
    row = get_artifact(db, artifact_id)
    assert row["status"] == "archived"
    assert row["archived_at"] is not None


# ── notes ─────────────────────────────────────────────────────────────────────

def test_save_note_upsert(db):
    save_artifacts(db, "reddit", "sub", [make_post("https://n")])
    aid = get_pending(db)[0]["id"]

    save_note(db, aid, "first note")
    assert get_pending(db)[0]["note"] == "first note"

    save_note(db, aid, "updated note")
    assert get_pending(db)[0]["note"] == "updated note"

def test_save_note_blank_deletes(db):
    save_artifacts(db, "reddit", "sub", [make_post("https://n")])
    aid = get_pending(db)[0]["id"]
    save_note(db, aid, "some text")
    save_note(db, aid, "")
    assert get_pending(db)[0]["note"] == ""

def test_save_note_whitespace_only_deletes(db):
    save_artifacts(db, "reddit", "sub", [make_post("https://n")])
    aid = get_pending(db)[0]["id"]
    save_note(db, aid, "text")
    save_note(db, aid, "   ")
    assert get_pending(db)[0]["note"] == ""


# ── todos ─────────────────────────────────────────────────────────────────────

def test_save_todo_upsert(db):
    save_artifacts(db, "reddit", "sub", [make_post("https://t")])
    aid = get_pending(db)[0]["id"]

    save_todo(db, aid, "do this")
    assert get_pending(db)[0]["todo"] == "do this"

    save_todo(db, aid, "do that instead")
    assert get_pending(db)[0]["todo"] == "do that instead"

def test_save_todo_blank_deletes(db):
    save_artifacts(db, "reddit", "sub", [make_post("https://t")])
    aid = get_pending(db)[0]["id"]
    save_todo(db, aid, "task")
    save_todo(db, aid, "")
    assert get_pending(db)[0]["todo"] == ""
