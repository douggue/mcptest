"""SQLite storage with a tiny migration runner.

One file, WAL mode, a process-wide lock around access. Rows come back as
``sqlite3.Row`` so services can do ``row["name"]``.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

MIGRATIONS: list[tuple[int, str]] = [
    (
        1,
        """
        CREATE TABLE proxies (
            id TEXT PRIMARY KEY,
            label TEXT,
            scheme TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            username TEXT,
            password_enc BLOB,
            sticky INTEGER NOT NULL DEFAULT 1,
            last_exit_ip TEXT,
            last_geo TEXT,
            last_latency_ms REAL,
            last_checked_at TEXT,
            last_error TEXT,
            healthy INTEGER,
            created_at TEXT NOT NULL
        );
        CREATE TABLE profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            group_name TEXT,
            tags TEXT NOT NULL DEFAULT '[]',
            notes TEXT,
            engine TEXT NOT NULL DEFAULT 'camoufox',
            os TEXT NOT NULL DEFAULT 'windows',
            fingerprint TEXT NOT NULL,
            proxy_id TEXT REFERENCES proxies(id) ON DELETE SET NULL,
            geo_override TEXT,
            launch_options TEXT NOT NULL DEFAULT '{}',
            engine_version TEXT,
            created_at TEXT NOT NULL,
            last_used_at TEXT,
            status TEXT NOT NULL DEFAULT 'stopped'
        );
        CREATE TABLE selftests (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            ran_at TEXT NOT NULL,
            passed INTEGER NOT NULL,
            report TEXT NOT NULL
        );
        CREATE TABLE events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id TEXT,
            ts TEXT NOT NULL,
            kind TEXT NOT NULL,
            detail TEXT
        );
        CREATE INDEX idx_events_profile ON events(profile_id, ts);
        CREATE INDEX idx_selftests_profile ON selftests(profile_id, ran_at);
        """,
    ),
]


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def new_id() -> str:
    return uuid.uuid4().hex[:12]


class Database:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(
            str(self.path), check_same_thread=False, isolation_level=None, timeout=30
        )
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self.migrate()

    # -- lifecycle --------------------------------------------------------
    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def migrate(self) -> None:
        with self._lock:
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)"
            )
            row = self._conn.execute("SELECT MAX(version) AS v FROM schema_version").fetchone()
            current = row["v"] or 0
            for version, sql in MIGRATIONS:
                if version > current:
                    # executescript() manages its own transaction.
                    self._conn.executescript(f"BEGIN;{sql}COMMIT;")
                    self._conn.execute("INSERT INTO schema_version(version) VALUES (?)", (version,))

    # -- access -------------------------------------------------------------
    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Cursor]:
        with self._lock:
            cur = self._conn.cursor()
            try:
                cur.execute("BEGIN")
                yield cur
                cur.execute("COMMIT")
            except BaseException:
                cur.execute("ROLLBACK")
                raise
            finally:
                cur.close()

    def execute(self, sql: str, params: tuple | dict = ()) -> None:
        with self.transaction() as cur:
            cur.execute(sql, params)

    def fetchone(self, sql: str, params: tuple | dict = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, params).fetchone()

    def fetchall(self, sql: str, params: tuple | dict = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, params).fetchall()

    # -- events ---------------------------------------------------------------
    def record_event(self, kind: str, profile_id: str | None = None, **detail: Any) -> None:
        self.execute(
            "INSERT INTO events(profile_id, ts, kind, detail) VALUES (?, ?, ?, ?)",
            (profile_id, now_iso(), kind, json.dumps(detail, default=str)),
        )

    def events(self, profile_id: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        if profile_id:
            rows = self.fetchall(
                "SELECT * FROM events WHERE profile_id=? ORDER BY id DESC LIMIT ?",
                (profile_id, limit),
            )
        else:
            rows = self.fetchall("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))
        return [
            {
                "id": r["id"],
                "profile_id": r["profile_id"],
                "ts": r["ts"],
                "kind": r["kind"],
                "detail": json.loads(r["detail"] or "{}"),
            }
            for r in rows
        ]
