from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import AppContext, get_ctx, require_token
from app.models import (
    BackupExportRequest,
    BackupExportResult,
    BackupImportRequest,
    BackupImportResult,
)
from app.services.backup import BackupError
from app.services.profiles import ProfileBusy, ProfileNotFound

router = APIRouter(prefix="/backup", tags=["backup"], dependencies=[Depends(require_token)])


@router.post("/export", response_model=BackupExportResult)
async def export_backup(
    req: BackupExportRequest, ctx: AppContext = Depends(get_ctx)
) -> BackupExportResult:
    dest = Path(req.destination_dir).expanduser() if req.destination_dir else None
    try:
        paths = await asyncio.to_thread(
            ctx.backup.export_many, req.profile_ids, req.passphrase, dest
        )
    except ProfileNotFound as exc:
        raise HTTPException(404, f"not found: {exc}") from exc
    except ProfileBusy as exc:
        raise HTTPException(409, str(exc)) from exc
    return BackupExportResult(files=[str(p) for p in paths])


@router.post("/import", response_model=BackupImportResult)
async def import_backup(
    req: BackupImportRequest, ctx: AppContext = Depends(get_ctx)
) -> BackupImportResult:
    try:
        return await asyncio.to_thread(
            ctx.backup.import_profile,
            Path(req.path).expanduser(),
            req.passphrase,
            new_id_always=req.new_id,
        )
    except BackupError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ProfileBusy as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/list")
def list_backups(ctx: AppContext = Depends(get_ctx)) -> list[dict]:
    out = []
    for p in sorted(ctx.settings.backups_dir.glob("*.mpbackup"), reverse=True):
        st = p.stat()
        out.append({"path": str(p), "name": p.name, "size": st.st_size, "mtime": st.st_mtime})
    return out
