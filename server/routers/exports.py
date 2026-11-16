"""Rendered shorts ("exports"). Rows are written by the studio renderer.

Row shape:
  id, created, project_id, clip_id, title, file (/media/exports/x.mp4), cover (/media/... or ""),
  duration, width, height, fps, size, status (draft | approved | posted),
  source_origin (URL or filename of the long video), source_in, source_out (seconds in the source),
  meta {title, description, hashtags[]}, transcript_text
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..config import media_path
from ..store import Collection

router = APIRouter(prefix="/api/exports", tags=["exports"])
exports = Collection("exports")


@router.get("")
def list_exports() -> list[dict]:
    return sorted(exports.all(), key=lambda r: r.get("created", 0), reverse=True)


@router.patch("/{export_id}")
def patch_export(export_id: str, patch: dict) -> dict:
    allowed = {k: v for k, v in patch.items() if k in ("status", "title", "meta")}
    row = exports.update(export_id, allowed)
    if not row:
        raise HTTPException(404, "export not found")
    return row


@router.delete("/{export_id}")
def delete_export(export_id: str) -> dict:
    row = exports.get(export_id)
    if not row:
        raise HTTPException(404, "export not found")
    for key in ("file", "cover"):
        if row.get(key):
            try:
                media_path(row[key]).unlink(missing_ok=True)
            except ValueError:
                pass
    exports.delete(export_id)
    return {"ok": True}
