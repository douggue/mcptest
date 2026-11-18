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


def _style(pid: str) -> dict:
    """Any style, built-in or the person's own (references and memory can be kept for both)."""
    p = P.lookup(pid)
    if not p:
        raise HTTPException(404, "style not found")
    return p


def _own(pid: str) -> dict:
    p = P.profiles.get(pid)
    if not p:
        raise HTTPException(404 if not presets.get(pid) else 422, "Built-in styles cannot be changed; duplicate one to make it yours." if presets.get(pid) else "style not found")
    return p


@router.get("")
def list_profiles() -> list[dict]:
    mine = sorted(P.profiles.all(), key=lambda p: p.get("name", "").lower())
    return mine + [P.lookup(b["id"]) for b in presets.BUILTIN]


@router.post("")
def create_profile(body: dict) -> dict:
    name = safe_name(body.get("name", ""), "")
    if not name:
        raise HTTPException(422, "Give the style a name.")
    base = P.lookup(body.get("from", "")) or {}   # a built-in style with its saved references and memory
    row = {"name": name, "references": [], "rules": copy.deepcopy(base.get("rules", [])), "brief": base.get("brief", ""),
           "style": copy.deepcopy(base.get("style", {})), "elements": copy.deepcopy(base.get("elements", [])),
           "planner": base.get("planner", "speech"), "summary": base.get("summary", ""), "analysis": None, "note": "",
           # a copy of a built-in style keeps its limits and its steps
           "limits": copy.deepcopy(base.get("limits")), "workflow": copy.deepcopy(base.get("workflow")),
           "audio": copy.deepcopy(base.get("audio")), "reference_links": copy.deepcopy(base.get("reference_links") or []),
           "memory": list(base.get("memory") or []), "reviewed": base.get("reviewed"), "copied_from": base.get("id", ""),
           "memory_by": copy.deepcopy(base.get("memory_by") or {}), "memory_from": base.get("memory_from", ""),
           "review_engine": base.get("review_engine", ""), "review_note": base.get("review_note", ""),
           "analysis_by": copy.deepcopy(base.get("analysis_by") or {}), "analysis_from": base.get("analysis_from", ""),
           "make": copy.deepcopy(base.get("make"))}
    for r in row["rules"]:
        r["source"] = "copied"
    new = P.profiles.insert(row)
    # the copy keeps its own copies of the reference videos
    if base.get("references"):
        dest = P.folder(new["id"])
        dest.mkdir(parents=True, exist_ok=True)
        refs = []
        for r in base["references"]:
            src = P.folder(base["id"]) / r["file"]
            if src.is_file():
                shutil.copy2(src, dest / src.name)
                from ..config import media_url
                refs.append({**r, "url": media_url(dest / src.name)})
        new = P.profiles.update(new["id"], {"references": refs})
    return new


@router.put("/{pid}")
def update_profile(pid: str, body: dict) -> dict:
    _own(pid)
    patch = {k: body[k] for k in ("name", "rules", "brief", "style", "planner", "elements", "summary", "reference_links", "memory") if k in body}
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
    _style(pid)
    name = Path(file.filename or "reference.mp4").name
    ext = Path(name).suffix.lower()
    if ext not in VIDEO:
        raise HTTPException(422, f"References must be videos ({', '.join(sorted(VIDEO))}).")
    P.folder(pid).mkdir(parents=True, exist_ok=True)
    out = unique_path(P.folder(pid), safe_name(Path(name).stem, "reference"), ext.lstrip("."))
    with open(out, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return P.add_reference_file(pid, out, Path(name).stem)


@router.delete("/{pid}/references/{name}")
def remove_reference(pid: str, name: str) -> dict:
    profile = _style(pid)
    (P.folder(pid) / Path(name).name).unlink(missing_ok=True)
    return P.save(pid, {"references": [r for r in profile.get("references") or [] if r.get("file") != Path(name).name]})


@router.post("/{pid}/references/link")
def add_reference_link(pid: str, body: dict) -> dict:
    """Download a reference video from a link and keep it with the style; then review the references again."""
    _style(pid)
    url = str(body.get("url", "")).strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(422, "Paste a full link, starting with https://")
    name = str(body.get("name", "")).strip()

    def work(job: jobs.Job) -> dict:
        p = P.download_reference(pid, url, name, job)
        if not P.is_builtin(pid):   # keep the link, so the style lists it like the built-in ones do
            links = [l for l in p.get("reference_links") or [] if l["url"] != url]
            P.profiles.update(pid, {"reference_links": links + [{"title": name or p["references"][-1]["name"], "url": url}]})
        if P.ai.available("references"):
            P.review(pid, job, (0.7, 1.0))
        return P.lookup(pid)
    return {"job_id": jobs.submit("style", "Downloading a reference", work).id}


@router.post("/{pid}/references/download")
def download_references(pid: str) -> dict:
    """Download every reference link the style lists that is not saved yet, then review them."""
    p = _style(pid)
    if not p.get("reference_links"):
        raise HTTPException(422, "This style lists no reference links. Add videos or links first.")
    return {"job_id": jobs.submit("style", "Downloading references", lambda job: P.download_missing(pid, job)).id}


@router.post("/{pid}/review")
def review(pid: str, body: dict | None = None) -> dict:
    """Have an AI ({use}: claude_code | agy | anthropic | gemini; empty = the one set for references) look at the
    saved references again. Each AI keeps its own notes."""
    p = _style(pid)
    use = str((body or {}).get("use") or "")
    if not p.get("references"):
        raise HTTPException(422, "Save some reference videos first.")
    if use and not any(c["key"] == use and c["ready"] for c in P.ai.ai_choices()):
        raise HTTPException(422, f"{P.ai.label_for(use)} is not set up here.")
    if not use and not P.ai.available("references"):
        raise HTTPException(422, "Reviewing references needs the AI. " + P.ai.setup_hint())
    return {"job_id": jobs.submit("style", "Reviewing references", lambda job: P.review(pid, job, use=use)).id}


@router.post("/{pid}/memory/use")
def use_memory(pid: str, body: dict) -> dict:
    """Switch the style to the notes another AI made from its references."""
    _style(pid)
    try:
        return P.use_memory(pid, str(body.get("key") or ""))
    except MediaError as e:
        raise HTTPException(422, str(e))


@router.post("/{pid}/analysis/use")
def use_analysis(pid: str, body: dict) -> dict:
    """Switch the style to the study another AI made: its look, brief and learned rules."""
    _own(pid)
    try:
        return P.use_analysis(pid, str(body.get("key") or ""))
    except MediaError as e:
        raise HTTPException(422, str(e))


@router.post("/{pid}/analyse")
def analyse(pid: str, body: dict | None = None) -> dict:
    """Study the references and build the style from them, with a chosen AI ({use}); each AI's study is kept."""
    _own(pid)
    use = str((body or {}).get("use") or "")
    if use and not any(c["key"] == use and c["ready"] for c in P.ai.ai_choices()):
        raise HTTPException(422, f"{P.ai.label_for(use)} is not set up here.")
    return {"job_id": jobs.submit("style", "Studying references", lambda job: P.analyse(pid, job, use=use)).id}


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
