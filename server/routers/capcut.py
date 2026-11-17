"""CapCut project export: a clip's timeline written as a CapCut draft (see server/studio/capcut.py)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import jobs
from ..studio import capcut
from . import projects

router = APIRouter(prefix="/api/capcut", tags=["capcut"])


@router.get("/state")
def get_state() -> dict:
    """{available, folder, saved, detected, direct, server_edition}: where an export would go and why."""
    return capcut.state()


@router.post("/export")
def export(body: dict) -> dict:
    """{project_id, clip_id, zip?: bool} -> job -> {where: 'capcut'|'zip', name, folder, file, size, notes[], tracks{}, seconds}"""
    if not capcut.available():
        raise HTTPException(422, "CapCut export needs the 'pycapcut' package: pip install pycapcut==0.0.4")
    project = projects.load(str(body.get("project_id") or ""))
    clip = next((c for c in project.get("clips", []) if c["id"] == body.get("clip_id")), None)
    if not clip:
        raise HTTPException(404, "That clip no longer exists.")
    as_zip = bool(body.get("zip"))
    return {"job_id": jobs.submit("capcut", f"CapCut project for {clip.get('title') or 'clip'}",
                                  lambda job: capcut.export(project, clip, job, as_zip), {"project_id": project["id"], "clip_id": clip["id"]}).id}
