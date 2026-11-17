"""Cutroom API. Run with:  python run.py"""
from __future__ import annotations

import importlib
import mimetypes
import pkgutil

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import auth, jobs
from .config import DATA, WEB, ensure_dirs, get_settings, save_settings

ensure_dirs()
# Windows can map these wrongly through the registry (.js as text/plain stops the interface loading).
for _type, _ext in (("application/javascript", ".js"), ("text/css", ".css"), ("image/svg+xml", ".svg"),
                    ("font/woff2", ".woff2"), ("font/woff", ".woff"), ("application/json", ".json"),
                    ("video/mp4", ".mp4"), ("audio/mp4", ".m4a"), ("audio/wav", ".wav"), ("audio/mpeg", ".mp3")):
    mimetypes.add_type(_type, _ext)

app = FastAPI(title="Cutroom", version="0.1.0")
app.add_middleware(auth.Gate)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])

# Every module in server/routers that exposes `router` is mounted automatically.
from . import routers as _routers  # noqa: E402

for mod in pkgutil.iter_modules(_routers.__path__):
    module = importlib.import_module(f"{_routers.__name__}.{mod.name}")
    if hasattr(module, "router"):
        app.include_router(module.router)


@app.get("/api/health")
def health(request: Request) -> dict:
    import shutil
    from .studio import ai
    locked = auth.enabled() and not auth.valid(request.cookies.get(auth.COOKIE))
    if locked:   # tell a visitor nothing but that a login is needed
        return {"ok": True, "auth": True, "signed_in": False}
    return {
        "ok": True,
        "auth": auth.enabled(),
        "signed_in": True,
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "ai": ai.available(),
        "ai_provider": ai.provider_label(),
        "data": str(DATA),
    }


@app.post("/api/login")
def login(body: dict, request: Request, response: Response) -> dict:
    ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "?"))
    if auth.throttled(ip):
        raise HTTPException(429, "Too many attempts. Wait a few minutes and try again.")
    token = auth.login(str(body.get("password", "")), ip)
    if not token:
        raise HTTPException(401, "That password is not right.")
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(auth.COOKIE, token, max_age=auth.SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=secure, path="/")
    return {"ok": True}


@app.post("/api/logout")
def logout(request: Request, response: Response) -> dict:
    auth.logout(request.cookies.get(auth.COOKIE))
    response.delete_cookie(auth.COOKIE, path="/")
    return {"ok": True}


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


SECRETS = ("anthropic_api_key", "gemini_api_key", "pexels_api_key")


@app.get("/api/settings")
def read_settings() -> dict:
    import os
    s = get_settings()
    # never send secrets back to the browser; only whether they are set
    for key in SECRETS:
        s[key + "_set"] = bool(s.get(key))
        s[key] = ""
    s["anthropic_api_key_set"] = s["anthropic_api_key_set"] or bool(os.environ.get("ANTHROPIC_API_KEY"))
    s["gemini_api_key_set"] = s["gemini_api_key_set"] or bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    return s


@app.put("/api/settings")
def write_settings(patch: dict) -> dict:
    # an empty secret means "leave unchanged"
    for key in SECRETS:
        if key in patch and not patch[key]:
            patch.pop(key)
    patch = {k: v for k, v in patch.items() if not k.endswith("_set")}
    save_settings(patch)
    return read_settings()


@app.get("/api/ai/models")
def ai_models(provider: str = "anthropic") -> list[dict]:
    """Model choices for Settings. Gemini's come live from Google when a key is set."""
    from .studio import ai
    if provider != "gemini":
        return ai.CLAUDE_MODELS
    try:
        live = ai.gemini_models()
    except ai.AIUnavailable as e:
        raise HTTPException(422, str(e))
    known = {m["id"] for m in ai.GEMINI_MODELS}
    return ai.GEMINI_MODELS + [m for m in live if m["id"] not in known]


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
