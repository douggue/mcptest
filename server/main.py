"""Cutroom API. Run with:  python run.py"""
from __future__ import annotations

import importlib
import mimetypes
import pkgutil

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import jobs
from .config import DATA, WEB, ensure_dirs, get_settings, save_settings

ensure_dirs()
# Windows can map these wrongly through the registry (.js as text/plain stops the interface loading).
for _type, _ext in (("application/javascript", ".js"), ("text/css", ".css"), ("image/svg+xml", ".svg"),
                    ("font/woff2", ".woff2"), ("font/woff", ".woff"), ("application/json", ".json"),
                    ("video/mp4", ".mp4"), ("audio/mp4", ".m4a"), ("audio/wav", ".wav"), ("audio/mpeg", ".mp3")):
    mimetypes.add_type(_type, _ext)

app = FastAPI(title="Cutroom", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])

# Every module in server/routers that exposes `router` is mounted automatically.
from . import routers as _routers  # noqa: E402

for mod in pkgutil.iter_modules(_routers.__path__):
    module = importlib.import_module(f"{_routers.__name__}.{mod.name}")
    if hasattr(module, "router"):
        app.include_router(module.router)


@app.get("/api/health")
def health() -> dict:
    import shutil
    from .config import anthropic_key
    return {
        "ok": True,
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "ai": bool(anthropic_key()),
        "data": str(DATA),
    }


@app.get("/api/jobs")
def list_jobs() -> list[dict]:
    return [j.to_dict() for j in jobs.all_jobs()[:50]]


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return job.to_dict()


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    return {"ok": jobs.cancel(job_id)}


@app.get("/api/settings")
def read_settings() -> dict:
    s = get_settings()
    # never send secrets back to the browser; only whether they are set
    for key in ("anthropic_api_key", "pexels_api_key"):
        s[key + "_set"] = bool(s.get(key))
        s[key] = ""
    import os
    s["anthropic_api_key_set"] = s["anthropic_api_key_set"] or bool(os.environ.get("ANTHROPIC_API_KEY"))
    return s


@app.put("/api/settings")
def write_settings(patch: dict) -> dict:
    # an empty secret means "leave unchanged"
    for key in ("anthropic_api_key", "pexels_api_key"):
        if key in patch and not patch[key]:
            patch.pop(key)
    patch = {k: v for k, v in patch.items() if not k.endswith("_set")}
    save_settings(patch)
    return read_settings()


app.mount("/media", StaticFiles(directory=DATA), name="media")

_dist = WEB / "dist"
if _dist.exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = (_dist / path).resolve()
        if path and _dist.resolve() in f.parents and f.is_file():
            return FileResponse(f)
        return FileResponse(_dist / "index.html")
