"""Optional flow-mcp connector (desktop edition). Everything answers 403 with the reason while it is unavailable."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import jobs
from ..media import MediaError
from ..studio import flow

router = APIRouter(prefix="/api/flow", tags=["flow"])


def _need(import_only: bool = False) -> None:
    reason = flow.why_not_import() if import_only else flow.why()
    if reason:
        raise HTTPException(403, reason)


def _job(kind: str, title: str, fn) -> dict:
    def work(job: jobs.Job):
        try:
            return fn(job)
        except flow.FlowError as e:
            raise MediaError(str(e)) from e   # shown to the user as the job's error
    return {"job_id": jobs.submit(kind, title, work).id}


@router.get("/state")
def state() -> dict:
    """{enabled, available, why, can_import, server_edition, tools[], path, out_dir, out_dir_exists}"""
    return flow.state()


@router.post("/status")
def status() -> dict:
    """job -> {signed_in, in_project, ready, plan, credits, hint, output_root, queued, tools[], voices[]}"""
    _need()
    return _job("flow", "Checking the Flow session", flow.status)


@router.post("/images")
def images(body: dict) -> dict:
    """{prompts[], aspect, exact?} -> job -> {items[], failed[], credits, mode}"""
    _need()
    prompts = body.get("prompts") or []
    aspect = str(body.get("aspect") or "9:16")
    if not isinstance(prompts, list) or not any(str(p).strip() for p in prompts):
        raise HTTPException(422, "Write at least one description.")
    if aspect not in flow.IMAGE_ASPECTS:
        raise HTTPException(422, f"Stills can be {', '.join(flow.IMAGE_ASPECTS)}.")
    exact = bool(body.get("exact"))
    return _job("flow", "Generating stills in Flow", lambda job: flow.images(prompts, aspect, job, exact))


@router.post("/clips")
def clips(body: dict) -> dict:
    """{scenes[], aspect, seconds?, max_credits, confirm, resolution?, model?} -> job -> {items[], failed[], credits}"""
    _need()
    scenes = body.get("scenes") or []
    if not isinstance(scenes, list) or not any(str(p).strip() for p in scenes):
        raise HTTPException(422, "Write at least one scene.")
    if body.get("confirm") is not True:
        raise HTTPException(422, "Generating clips spends Flow credits. Confirm the spend first.")
    aspect = str(body.get("aspect") or "9:16")
    if aspect not in flow.VIDEO_ASPECTS:
        raise HTTPException(422, "Flow clips can be 16:9 or 9:16.")
    seconds = body.get("seconds")
    if seconds not in (None, "", *flow.DURATIONS):
        raise HTTPException(422, "Clip length can be 4, 6, 8 or 10 seconds.")
    try:
        cap = int(body.get("max_credits"))
    except (TypeError, ValueError):
        raise HTTPException(422, "Set a credit cap per clip.")
    if not 1 <= cap <= 200:
        raise HTTPException(422, "Set a credit cap between 1 and 200 per clip.")
    return _job("flow", "Generating clips in Flow", lambda job: flow.clips(
        scenes, aspect, int(seconds) if seconds else None, cap, job, True, body.get("resolution"), body.get("model")))


@router.post("/narrate")
def narrate(body: dict) -> dict:
    """{text, voice?, engine?, speed?} -> job -> {items[], voice, engine}"""
    _need()
    text = str(body.get("text") or "").strip()
    if not text:
        raise HTTPException(422, "Write the narration first.")
    return _job("flow", "Recording narration with flow-mcp", lambda job: flow.narrate(
        text, body.get("voice"), job, str(body.get("engine") or "kokoro"), body.get("speed")))


@router.post("/import")
def import_folder() -> dict:
    """job -> {items[], skipped, busy, folder}. Works without flow-mcp running: it only copies files."""
    _need(import_only=True)
    return _job("flow", "Importing from the Flow output folder", flow.import_folder)
