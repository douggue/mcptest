"""Assets (music, b-roll, sound effects, brand images, voiceovers), templates, voiceover and stock search."""
from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from .. import jobs
from ..config import DATA, media_url
from ..media import MediaError, ffmpeg, safe_name, unique_path
from ..store import Collection
from ..studio import extras
from ..studio.sfx import NAMES as SFX_NAMES, ensure_sfx

router = APIRouter(prefix="/api", tags=["library"])
templates = Collection("templates")

KINDS = {
    "music": {".mp3", ".m4a", ".wav", ".ogg", ".aac", ".flac"},
    "broll": {".mp4", ".mov", ".webm", ".jpg", ".jpeg", ".png", ".webp", ".gif"},
    "brand": {".png", ".jpg", ".jpeg", ".webp", ".svg"},
    "voice": {".mp3", ".m4a", ".wav", ".ogg"},
    "sfx": {".wav"},
}

ensure_sfx()


def _folder(kind: str) -> Path:
    if kind not in KINDS:
        raise HTTPException(404, "unknown asset kind")
    return DATA / "assets" / kind


def _media_type(p: Path) -> str:
    ext = p.suffix.lower()
    if ext == ".gif":
        return "gif"
    if ext in (".mp4", ".mov", ".webm"):
        return "video"
    if ext in (".jpg", ".jpeg", ".png", ".webp", ".svg"):
        return "image"
    return "audio"


def _row(kind: str, p: Path) -> dict:
    return {"name": p.name, "label": SFX_NAMES.get(p.stem, p.stem) if kind == "sfx" else p.stem,
            "url": media_url(p), "size": p.stat().st_size, "type": _media_type(p), "id": p.stem}


@router.get("/assets/{kind}")
def list_assets(kind: str) -> list[dict]:
    folder = _folder(kind)
    return [_row(kind, p) for p in sorted(folder.iterdir(), key=lambda p: p.name.lower())
            if p.is_file() and p.suffix.lower() in KINDS[kind]]


@router.post("/assets/{kind}")
def upload_asset(kind: str, file: UploadFile = File(...)) -> dict:
    folder = _folder(kind)
    name = Path(file.filename or "file").name
    ext = Path(name).suffix.lower()
    if ext not in KINDS[kind]:
        raise HTTPException(422, f"{ext or 'That file type'} is not accepted here. Use: {', '.join(sorted(KINDS[kind]))}")
    out = unique_path(folder, safe_name(Path(name).stem, "file"), ext.lstrip("."))
    with open(out, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return _row(kind, out)


@router.post("/assets/sfx/camera")
def upload_camera(file: UploadFile = File(...), start: float = Form(0.0), end: float = Form(0.0), gain: float = Form(1.0)) -> dict:
    """The person's own camera-flash sound, which styles play on their flashes or spotlights. Any audio file;
    `start`/`end` (seconds) cut the part with the shutter out of a longer recording, `gain` makes it louder or softer."""
    folder = _folder("sfx")
    ext = Path(file.filename or "f.wav").suffix.lower()
    if ext not in KINDS["music"] | {".mp4", ".mov", ".webm"}:
        raise HTTPException(422, "Use an audio file (mp3, wav, m4a, ogg) or a video with the sound in it.")
    tmp = folder / f"_upload{ext}"
    with open(tmp, "wb") as f:
        shutil.copyfileobj(file.file, f)
    gain = max(0.1, min(6.0, float(gain)))
    cut = ["-ss", f"{max(0.0, start):.3f}"] + (["-to", f"{end:.3f}"] if end > start else [])
    try:
        ffmpeg([*cut, "-i", str(tmp), "-vn", "-af", f"volume={gain:.2f},afade=t=in:d=0.004", "-ar", "44100", "-ac", "2",
                "-c:a", "pcm_s16le", str(folder / "camera-mine.wav")])
    except MediaError as e:
        raise HTTPException(422, f"Could not read that sound: {e}")
    finally:
        tmp.unlink(missing_ok=True)
    return _row("sfx", folder / "camera-mine.wav")


@router.delete("/assets/{kind}/{name}")
def delete_asset(kind: str, name: str) -> dict:
    p = (_folder(kind) / Path(name).name)
    if not p.is_file():
        raise HTTPException(404, "file not found")
    p.unlink()
    if kind == "sfx":
        ensure_sfx()   # built-in effects come back; they are part of the app
    return {"ok": True}


# ---------------------------------------------------------------- templates

@router.get("/templates")
def list_templates() -> list[dict]:
    return sorted(templates.all(), key=lambda t: t.get("name", "").lower())


@router.post("/templates")
def create_template(body: dict) -> dict:
    name = (body.get("name") or "").strip()
    if not name or not isinstance(body.get("spec"), dict):
        raise HTTPException(422, "A template needs a name and a spec.")
    from ..studio.spec import template_from
    return templates.insert({"name": name, "note": body.get("note", ""), "spec": template_from(body["spec"])})


@router.put("/templates/{tid}")
def update_template(tid: str, body: dict) -> dict:
    row = templates.update(tid, {k: v for k, v in body.items() if k in ("name", "note")})
    if not row:
        raise HTTPException(404, "template not found")
    return row


@router.delete("/templates/{tid}")
def delete_template(tid: str) -> dict:
    return {"ok": templates.delete(tid)}


# ---------------------------------------------------------------- voiceover + stock

@router.post("/tts")
def make_voiceover(body: dict) -> dict:
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(422, "Write the script first.")
    return {"job_id": jobs.submit("tts", "Generating voiceover", lambda job: extras.tts(text, body.get("voice"), job)).id}


@router.get("/stock/search")
def stock_search(q: str, orientation: str = "portrait") -> list[dict]:
    try:
        return extras.stock_search(q, orientation)
    except MediaError as e:
        raise HTTPException(422, str(e))


@router.post("/stock/download")
def stock_download(body: dict) -> dict:
    url, name = body.get("url", ""), body.get("name", "stock")
    return {"job_id": jobs.submit("stock", "Downloading b-roll", lambda job: extras.stock_download(url, name, job)).id}
