"""Tiny JSON-file collections. Fine for one person; not a database."""
from __future__ import annotations

import json
import threading
import time
import uuid
from typing import Any, Callable

from .config import DATA

_locks: dict[str, threading.RLock] = {}


def new_id(prefix: str = "") -> str:
    return prefix + uuid.uuid4().hex[:10]


class Collection:
    def __init__(self, name: str):
        self.name = name
        self.path = DATA / "db" / f"{name}.json"
        self.lock = _locks.setdefault(name, threading.RLock())

    def _read(self) -> list[dict]:
        if not self.path.exists():
            return []
        try:
            return json.loads(self.path.read_text("utf-8"))
        except json.JSONDecodeError:
            return []

    def _write(self, rows: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(rows, indent=1), "utf-8")
        tmp.replace(self.path)

    def all(self, where: Callable[[dict], bool] | None = None) -> list[dict]:
        with self.lock:
            rows = self._read()
        return [r for r in rows if where(r)] if where else rows

    def get(self, id: str) -> dict | None:
        return next((r for r in self.all() if r.get("id") == id), None)

    def insert(self, row: dict[str, Any]) -> dict:
        with self.lock:
            rows = self._read()
            row = {"id": new_id(), "created": time.time(), **row}
            rows.append(row)
            self._write(rows)
            return row

    def update(self, id: str, patch: dict[str, Any]) -> dict | None:
        with self.lock:
            rows = self._read()
            for r in rows:
                if r.get("id") == id:
                    r.update(patch)
                    r["updated"] = time.time()
                    self._write(rows)
                    return r
        return None

    def delete(self, id: str) -> bool:
        with self.lock:
            rows = self._read()
            kept = [r for r in rows if r.get("id") != id]
            self._write(kept)
            return len(kept) != len(rows)
