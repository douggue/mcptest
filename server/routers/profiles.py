"""Styles: the built-in presets and the person's own profiles learned from reference videos."""
from __future__ import annotations

import copy
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from .. import jobs
from ..media import MediaError, safe_name, unique_path
from ..studio import presets, profiles as P

router = APIRouter(prefix="/api/profiles", tags=["styles"])
VIDEO = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}


def _own(pid: str) -> dict:
    p = P.profiles.get(pid)
    if not p:
        raise HTTPException(404 if not presets.get(pid) else 422, "Built-in styles cannot be changed; duplicate one to make it yours." if presets.get(pid) else "style not found")
    return p


@router.get("")
def list_profiles() -> list[dict]:
    mine = sorted(P.profiles.all(), key=lambda p: p.get("name", "").lower())
    return mine + presets.BUILTIN


@router.post("")
def create_profile(body: dict) -> dict:
    name = safe_name(body.get("name", ""), "")
    if not name:
        raise HTTPException(422, "Give the style a name.")
    base = presets.get(body.get("from", "")) or P.profiles.get(body.get("from", "")) or {}
    row = {"name": name, "references": [], "rules": copy.deepcopy(base.get("rules", [])), "brief": base.get("brief", ""),
           "style": copy.deepcopy(base.get("style", {})), "elements": copy.deepcopy(base.get("elements", [])),
           "planner": base.get("planner", "speech"), "summary": base.get("summary", ""), "analysis": None, "note": "",
           # a copy of a built-in style keeps its limits and its steps
           "limits": copy.deepcopy(base.get("limits")), "workflow": copy.deepcopy(base.get("workflow")),
           "audio": copy.deepcopy(base.get("audio"))}
    for r in row["rules"]:
        r["source"] = "copied"
    return P.profiles.insert(row)


@router.put("/{pid}")
def update_profile(pid: str, body: dict) -> dict:
    _own(pid)
    patch = {k: body[k] for k in ("name", "rules", "brief", "style", "planner", "elements", "summary") if k in body}
    if "rules" in patch:
        patch["rules"] = [{"id": r.get("id") or f"u{int(time.time() * 1000)}{i}", "kind": r.get("kind", "editing"), "text": str(r.get("text", "")).strip(),
                           "source": r.get("source", "you"), "on": bool(r.get("on", True))} for i, r in enumerate(patch["rules"]) if str(r.get("text", "")).strip()]
    return P.profiles.update(pid, patch)


@router.delete("/{pid}")
def delete_profile(pid: str) -> dict:
    _own(pid)
    shutil.rmtree(P.folder(pid), ignore_errors=True)
    return {"ok": P.profiles.delete(pid)}


@router.post("/{pid}/references")
def add_reference(pid: str, file: UploadFile = File(...)) -> dict:
    profile = _own(pid)
    name = Path(file.filename or "reference.mp4").name
    ext = Path(name).suffix.lower()
    if ext not in VIDEO:
        raise HTTPException(422, f"References must be videos ({', '.join(sorted(VIDEO))}).")
    out = unique_path(P.folder(pid), safe_name(Path(name).stem, "reference"), ext.lstrip("."))
    with open(out, "wb") as f:
        shutil.copyfileobj(file.file, f)
    from ..config import media_url
    refs = [r for r in profile.get("references", []) if r.get("file") != out.name] + [{"name": out.name, "file": out.name, "url": media_url(out)}]
    return P.profiles.update(pid, {"references": refs})


@router.delete("/{pid}/references/{name}")
def remove_reference(pid: str, name: str) -> dict:
    profile = _own(pid)
    (P.folder(pid) / Path(name).name).unlink(missing_ok=True)
    return P.profiles.update(pid, {"references": [r for r in profile.get("references", []) if r.get("file") != Path(name).name]})


@router.post("/{pid}/analyse")
def analyse(pid: str) -> dict:
    _own(pid)
    return {"job_id": jobs.submit("style", "Studying references", lambda job: P.analyse(pid, job)).id}


@router.post("/{pid}/feedback")
def feedback(pid: str, body: dict) -> dict:
    """Turn a correction in the person's own words into a standing rule."""
    profile = _own(pid)
    note = str(body.get("note", "")).strip()
    if not note:
        raise HTTPException(422, "Say what should be different.")
    rule = P.rule_from_note(profile, note)
    rules = profile.get("rules", []) + [{"id": f"f{int(time.time() * 1000)}", "kind": rule["kind"], "text": rule["text"], "source": "your feedback", "on": True}]
    return P.profiles.update(pid, {"rules": rules})


@router.post("/{pid}/differences")
def differences(pid: str, body: dict) -> list[dict]:
    """What a finished clip does differently from the style: candidates to become the new defaults."""
    return P.differences(_own(pid), body.get("spec") or {})


@router.post("/{pid}/accept")
def accept(pid: str, body: dict) -> dict:
    try:
        return P.accept(pid, body.get("changes") or [])
    except MediaError as e:
        raise HTTPException(404, str(e))
