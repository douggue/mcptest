from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.api.deps import AppContext, get_ctx, require_token
from app.models import (
    CloneRequest,
    Cookie,
    CookieImport,
    Profile,
    ProfileCreate,
    ProfileDetail,
    ProfileUpdate,
    RegenerateRequest,
)
from app.services import browser, cookies
from app.services.launcher import LaunchRefused
from app.services.profiles import ProfileBusy, ProfileNotFound
from app.services.proxies import ProxyNotFound

router = APIRouter(prefix="/profiles", tags=["profiles"], dependencies=[Depends(require_token)])


def _404(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"not found: {exc}")


@router.get("", response_model=list[Profile])
def list_profiles(
    group: str | None = None,
    tag: str | None = None,
    status_: str | None = Query(default=None, alias="status"),
    ctx: AppContext = Depends(get_ctx),
) -> list[Profile]:
    return ctx.profiles.list(
        group=group, tag=tag, status=status_, running=ctx.launcher.running_map()
    )


@router.get("/groups", response_model=list[str])
def list_groups(ctx: AppContext = Depends(get_ctx)) -> list[str]:
    return ctx.profiles.groups()


@router.post("", response_model=ProfileDetail, status_code=201)
def create_profile(data: ProfileCreate, ctx: AppContext = Depends(get_ctx)) -> ProfileDetail:
    try:
        profile = ctx.profiles.create(data)
    except ProxyNotFound as exc:
        raise HTTPException(400, f"unknown proxy {exc}") from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    ctx.schedule_selftest(profile.id)
    return profile


@router.get("/{profile_id}", response_model=ProfileDetail)
def get_profile(profile_id: str, ctx: AppContext = Depends(get_ctx)) -> ProfileDetail:
    try:
        return ctx.profiles.get(profile_id, running=ctx.launcher.running_map())
    except ProfileNotFound as exc:
        raise _404(exc) from exc


@router.patch("/{profile_id}", response_model=ProfileDetail)
def update_profile(
    profile_id: str, data: ProfileUpdate, ctx: AppContext = Depends(get_ctx)
) -> ProfileDetail:
    try:
        profile, proxy_changed = ctx.profiles.update(profile_id, data)
    except ProfileNotFound as exc:
        raise _404(exc) from exc
    except ProxyNotFound as exc:
        raise HTTPException(400, f"unknown proxy {exc}") from exc
    if proxy_changed:
        ctx.schedule_selftest(profile_id)
    return profile


@router.delete("/{profile_id}", status_code=204)
async def delete_profile(
    profile_id: str,
    confirm: bool = Query(default=False, description="must be true; profile data is deleted too"),
    keep_data: bool = False,
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    if not confirm:
        raise HTTPException(400, "pass ?confirm=true to delete the profile and its data")
    if ctx.launcher.is_running(profile_id):
        await ctx.launcher.stop(profile_id)
    try:
        ctx.profiles.delete(profile_id, delete_data=not keep_data)
    except ProfileNotFound as exc:
        raise _404(exc) from exc
    return Response(status_code=204)


@router.post("/{profile_id}/clone", response_model=ProfileDetail, status_code=201)
async def clone_profile(
    profile_id: str, req: CloneRequest, ctx: AppContext = Depends(get_ctx)
) -> ProfileDetail:
    try:
        new = ctx.profiles.clone(profile_id, req)
    except ProfileNotFound as exc:
        raise _404(exc) from exc
    if req.copy_cookies:
        try:
            raw = await _with_running(ctx, profile_id, browser.get_cookies)
            await _with_running(ctx, new.id, lambda ws: browser.add_cookies(ws, raw))
        except Exception as exc:  # noqa: BLE001
            ctx.db.record_event("profile.clone_cookie_copy_failed", new.id, error=str(exc))
            raise HTTPException(502, f"profile cloned but cookie copy failed: {exc}") from exc
    ctx.schedule_selftest(new.id)
    return new


@router.post("/{profile_id}/regenerate-fingerprint", response_model=ProfileDetail)
def regenerate(
    profile_id: str, req: RegenerateRequest | None = None, ctx: AppContext = Depends(get_ctx)
) -> ProfileDetail:
    if ctx.launcher.is_running(profile_id):
        raise HTTPException(409, "stop the profile before regenerating its fingerprint")
    try:
        profile = ctx.profiles.regenerate_fingerprint(profile_id, req or RegenerateRequest())
    except ProfileNotFound as exc:
        raise _404(exc) from exc
    ctx.schedule_selftest(profile_id)
    return profile


@router.get("/{profile_id}/events")
def profile_events(
    profile_id: str, limit: int = 100, ctx: AppContext = Depends(get_ctx)
) -> list[dict]:
    return ctx.db.events(profile_id, limit)


# -- cookies ---------------------------------------------------------------------------
async def _with_running(ctx: AppContext, profile_id: str, fn):  # type: ignore[no-untyped-def]
    """Run ``fn(ws_endpoint)`` against the profile, starting it briefly if needed."""
    try:
        handle, already = await ctx.launcher.start(profile_id)
    except ProfileNotFound as exc:
        raise _404(exc) from exc
    except LaunchRefused as exc:
        raise HTTPException(409, str(exc)) from exc
    try:
        return await fn(handle.ws_endpoint)
    finally:
        if not already:
            await ctx.launcher.stop(profile_id)


@router.get("/{profile_id}/cookies/export")
async def export_cookies(
    profile_id: str,
    format: str = Query(default="json", pattern="^(json|netscape)$"),
    ctx: AppContext = Depends(get_ctx),
):  # type: ignore[no-untyped-def]
    try:
        raw = await _with_running(ctx, profile_id, browser.get_cookies)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"could not read cookies: {exc}") from exc
    parsed = cookies.from_playwright(raw)
    if format == "netscape":
        return Response(cookies.to_netscape(parsed), media_type="text/plain")
    return {"cookies": [c.model_dump() for c in parsed]}


@router.post("/{profile_id}/cookies/import")
async def import_cookies(
    profile_id: str, data: CookieImport, ctx: AppContext = Depends(get_ctx)
) -> dict:
    try:
        parsed: list[Cookie] = cookies.from_request(data)
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, f"bad cookie payload: {exc}") from exc
    pw = cookies.to_playwright(parsed)
    try:
        n = await _with_running(ctx, profile_id, lambda ws: browser.add_cookies(ws, pw))
    except HTTPException:
        raise
    except ProfileBusy as exc:
        raise HTTPException(409, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"could not import cookies: {exc}") from exc
    ctx.db.record_event("cookies.imported", profile_id, count=n)
    return {"imported": n, "skipped_expired": len(parsed) - len(pw)}
