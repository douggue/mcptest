from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import AppContext, get_ctx, require_token
from app.models import SelfTestReport
from app.services.profiles import ProfileNotFound

router = APIRouter(prefix="/profiles", tags=["selftest"], dependencies=[Depends(require_token)])


@router.post("/{profile_id}/selftest", response_model=SelfTestReport)
async def run_selftest(
    profile_id: str,
    external: bool = Query(default=False, description="also visit public leak-test pages"),
    ctx: AppContext = Depends(get_ctx),
) -> SelfTestReport:
    try:
        ctx.profiles.get(profile_id)
    except ProfileNotFound as exc:
        raise HTTPException(404, f"not found: {exc}") from exc
    return await ctx.selftest.run(profile_id, external=external)


@router.get("/{profile_id}/selftest", response_model=list[SelfTestReport])
def selftest_history(
    profile_id: str, limit: int = 20, ctx: AppContext = Depends(get_ctx)
) -> list[SelfTestReport]:
    return ctx.selftest.history(profile_id, limit)


@router.get("/{profile_id}/selftest/latest", response_model=SelfTestReport | None)
def selftest_latest(profile_id: str, ctx: AppContext = Depends(get_ctx)) -> SelfTestReport | None:
    return ctx.selftest.latest(profile_id)
