"""In-process background jobs with progress, for long ffmpeg / download / AI work."""
from __future__ import annotations

import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="job")
_jobs: dict[str, "Job"] = {}
_lock = threading.Lock()


class Cancelled(Exception):
    pass


class Job:
    def __init__(self, kind: str, title: str, meta: dict | None = None):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind
        self.title = title
        self.meta = meta or {}
        self.status = "queued"          # queued | running | done | error | cancelled
        self.progress = 0.0
        self.message = ""
        self.result: Any = None
        self.error = ""
        self.created = time.time()
        self.finished: float | None = None
        self.cancelled = False

    def update(self, progress: float | None = None, message: str | None = None) -> None:
        """Report progress (0..1). Raises Cancelled if the user cancelled the job."""
        if self.cancelled:
            raise Cancelled()
        if progress is not None:
            self.progress = max(0.0, min(1.0, float(progress)))
        if message is not None:
            self.message = message

    def sub(self, lo: float, hi: float) -> Callable[[float, str | None], None]:
        """A progress callback mapped onto the [lo, hi] slice of this job."""
        def cb(p: float, message: str | None = None) -> None:
            self.update(lo + (hi - lo) * max(0.0, min(1.0, p)), message)
        return cb

    def to_dict(self) -> dict:
        return {
            "id": self.id, "kind": self.kind, "title": self.title, "meta": self.meta,
            "status": self.status, "progress": round(self.progress, 4), "message": self.message,
            "result": self.result, "error": self.error, "created": self.created, "finished": self.finished,
        }


def submit(kind: str, title: str, fn: Callable[[Job], Any], meta: dict | None = None) -> Job:
    job = Job(kind, title, meta)
    with _lock:
        _jobs[job.id] = job
        # keep the registry small
        if len(_jobs) > 200:
            for old in sorted(_jobs.values(), key=lambda j: j.created)[:50]:
                if old.status in ("done", "error", "cancelled"):
                    _jobs.pop(old.id, None)

    def run() -> None:
        if job.cancelled:
            job.status = "cancelled"
            return
        job.status = "running"
        try:
            job.result = fn(job)
            job.progress = 1.0
            job.status = "done"
        except Cancelled:
            job.status = "cancelled"
        except Exception as e:  # surfaced to the UI
            traceback.print_exc()
            job.error = str(e) or e.__class__.__name__
            job.status = "error"
        finally:
            job.finished = time.time()

    _pool.submit(run)
    return job


def get(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def all_jobs() -> list[Job]:
    return sorted(_jobs.values(), key=lambda j: j.created, reverse=True)


def cancel(job_id: str) -> bool:
    job = _jobs.get(job_id)
    if not job:
        return False
    job.cancelled = True
    if job.status == "queued":
        job.status = "cancelled"
    return True
