"""Health, engine install, events, settings and shutdown."""

from __future__ import annotations

import asyncio
import os

from fastapi import APIRouter, Depends, HTTPException

from app import __version__
from app.api.deps import AppContext, get_ctx, require_token
from app.models import EngineStatus, Health

router = APIRouter(tags=["system"])


@router.get("/health", response_model=Health)
def health(ctx: AppContext = Depends(get_ctx)) -> Health:
    """Unauthenticated liveness probe used by the desktop app."""
    return Health(
        version=__version__,
        pid=os.getpid(),
        data_dir=str(ctx.settings.data_dir),
        running_profiles=len(ctx.launcher.running_map()),
    )


@router.get("/engine/status", response_model=EngineStatus, dependencies=[Depends(require_token)])
def engine_status(ctx: AppContext = Depends(get_ctx)) -> EngineStatus:
    st = ctx.install_state
    return EngineStatus(
        engine=ctx.engine.name,
        browser_installed=ctx.engine.installed(),
        browser_version=ctx.engine.version(),
        install_in_progress=st["in_progress"],
        install_progress=st["progress"],
        install_error=st["error"],
    )


@router.post("/engine/install", response_model=EngineStatus, dependencies=[Depends(require_token)])
async def engine_install(ctx: AppContext = Depends(get_ctx)) -> EngineStatus:
    """Download the browser build into the local cache (first run). Runs in the background."""
    st = ctx.install_state
    if st["in_progress"]:
        return engine_status(ctx)
    st.update(in_progress=True, progress=0.0, error=None)

    def progress(done: int, total: int) -> None:
        st["progress"] = (done / total) if total else None

    async def _run() -> None:
        try:
            await asyncio.to_thread(ctx.engine.install, progress)
            ctx.db.record_event("engine.installed", version=ctx.engine.version())
        except Exception as exc:  # noqa: BLE001
            st["error"] = str(exc)
            ctx.db.record_event("engine.install_failed", error=str(exc))
        finally:
            st["in_progress"] = False
            st["progress"] = 1.0 if not st["error"] else st["progress"]

    ctx.spawn(_run())
    return engine_status(ctx)


@router.get("/events", dependencies=[Depends(require_token)])
def events(limit: int = 200, ctx: AppContext = Depends(get_ctx)) -> list[dict]:
    return ctx.db.events(None, limit)


@router.get("/settings", dependencies=[Depends(require_token)])
def get_settings(ctx: AppContext = Depends(get_ctx)) -> dict:
    s = ctx.settings
    return {
        "data_dir": str(s.data_dir),
        "profiles_dir": str(s.profiles_dir),
        "backups_dir": str(s.backups_dir),
        "token_path": str(s.token_path),
        "api_base": f"http://{s.host}:{s.port}",
        "engine": s.engine,
        "headless": s.headless,
        "auto_selftest": s.auto_selftest,
        "require_proxy": s.require_proxy,
        "geoip_db": s.geoip_db,
    }


@router.get("/token", dependencies=[Depends(require_token)])
def get_token(ctx: AppContext = Depends(get_ctx)) -> dict:
    """Echo the token so the UI can show a copy button (caller already has it)."""
    return {"token": ctx.token}


@router.post("/shutdown", dependencies=[Depends(require_token)])
async def shutdown(stop_profiles: bool = True, ctx: AppContext = Depends(get_ctx)) -> dict:
    """Clean shutdown requested by the desktop app."""
    if not stop_profiles and ctx.launcher.running_map():
        raise HTTPException(409, "profiles are still running")
    if ctx.shutdown_event is None:
        raise HTTPException(500, "shutdown not wired")
    ctx.shutdown_event.set()
    return {"shutting_down": True}
