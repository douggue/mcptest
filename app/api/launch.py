from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import AppContext, get_ctx, require_token
from app.engines.base import BrowserNotInstalled, EngineError
from app.models import RunningProfile, StartResponse
from app.services.launcher import LaunchRefused, NotRunning
from app.services.profiles import ProfileNotFound

router = APIRouter(prefix="/profiles", tags=["launch"], dependencies=[Depends(require_token)])


@router.get("/running", response_model=list[RunningProfile])
def running(ctx: AppContext = Depends(get_ctx)) -> list[RunningProfile]:
    return ctx.launcher.running()


@router.post("/{profile_id}/start", response_model=StartResponse)
async def start(
    profile_id: str,
    headless: bool | None = Query(default=None),
    ctx: AppContext = Depends(get_ctx),
) -> StartResponse:
    try:
        handle, already = await ctx.launcher.start(profile_id, headless=headless)
    except ProfileNotFound as exc:
        raise HTTPException(404, f"not found: {exc}") from exc
    except LaunchRefused as exc:
        raise HTTPException(409, str(exc)) from exc
    except BrowserNotInstalled as exc:
        raise HTTPException(
            503, f"browser not installed: {exc}. POST /engine/install first"
        ) from exc
    except EngineError as exc:
        raise HTTPException(500, str(exc)) from exc
    return StartResponse(
        profile_id=profile_id,
        ws_endpoint=handle.ws_endpoint,
        pid=handle.pid,
        already_running=already,
    )


@router.post("/{profile_id}/stop")
async def stop(profile_id: str, ctx: AppContext = Depends(get_ctx)) -> dict:
    try:
        await ctx.launcher.stop(profile_id)
    except NotRunning as exc:
        raise HTTPException(409, f"profile {exc} is not running") from exc
    return {"stopped": profile_id}


@router.post("/groups/{group}/start")
async def start_group(group: str, ctx: AppContext = Depends(get_ctx)) -> dict[str, str]:
    return await ctx.launcher.start_group(group)


@router.post("/groups/{group}/stop")
async def stop_group(group: str, ctx: AppContext = Depends(get_ctx)) -> dict[str, str]:
    return await ctx.launcher.stop_group(group)
