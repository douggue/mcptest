from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from app.api.deps import AppContext, get_ctx, require_token
from app.models import Proxy, ProxyBulkImport, ProxyCheckResult, ProxyCreate, ProxyUpdate
from app.services.proxies import ProxyNotFound, parse_proxy

router = APIRouter(prefix="/proxies", tags=["proxies"], dependencies=[Depends(require_token)])


@router.get("", response_model=list[Proxy])
def list_proxies(ctx: AppContext = Depends(get_ctx)) -> list[Proxy]:
    return ctx.proxies.list()


@router.post("", response_model=Proxy, status_code=201)
def create_proxy(data: ProxyCreate, ctx: AppContext = Depends(get_ctx)) -> Proxy:
    return ctx.proxies.create(data)


@router.post("/parse", response_model=ProxyCreate)
def parse(body: dict, default_scheme: str = "http") -> ProxyCreate:
    """Preview how a pasted string would be parsed (no save)."""
    try:
        return parse_proxy(body.get("text", ""), default_scheme)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/bulk-import")
def bulk_import(data: ProxyBulkImport, ctx: AppContext = Depends(get_ctx)) -> dict:
    created, errors = ctx.proxies.bulk_import(data)
    return {"created": [p.model_dump() for p in created], "errors": errors}


@router.post("/check-all", response_model=list[ProxyCheckResult])
async def check_all(ctx: AppContext = Depends(get_ctx)) -> list[ProxyCheckResult]:
    return await ctx.proxies.check_all()


@router.get("/shared-exit-ips")
def shared_exit_ips(ctx: AppContext = Depends(get_ctx)) -> dict[str, list[str]]:
    return ctx.proxies.shared_exit_ips()


@router.get("/{proxy_id}", response_model=Proxy)
def get_proxy(proxy_id: str, ctx: AppContext = Depends(get_ctx)) -> Proxy:
    try:
        return ctx.proxies.get(proxy_id)
    except ProxyNotFound as exc:
        raise HTTPException(404, f"unknown proxy {exc}") from exc


@router.patch("/{proxy_id}", response_model=Proxy)
def update_proxy(proxy_id: str, data: ProxyUpdate, ctx: AppContext = Depends(get_ctx)) -> Proxy:
    try:
        return ctx.proxies.update(proxy_id, data)
    except ProxyNotFound as exc:
        raise HTTPException(404, f"unknown proxy {exc}") from exc


@router.delete("/{proxy_id}", status_code=204)
def delete_proxy(proxy_id: str, ctx: AppContext = Depends(get_ctx)) -> Response:
    try:
        ctx.proxies.delete(proxy_id)
    except ProxyNotFound as exc:
        raise HTTPException(404, f"unknown proxy {exc}") from exc
    return Response(status_code=204)


@router.post("/{proxy_id}/check", response_model=ProxyCheckResult)
async def check_proxy(proxy_id: str, ctx: AppContext = Depends(get_ctx)) -> ProxyCheckResult:
    try:
        return await ctx.proxies.check(proxy_id)
    except ProxyNotFound as exc:
        raise HTTPException(404, f"unknown proxy {exc}") from exc
