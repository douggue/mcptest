"""Clipper API: look up a source, cut clips in the background, keep a history."""
from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .. import clipper_core as core
from .. import jobs, media
from ..config import DATA, media_path, media_url
from ..store import Collection

router = APIRouter(prefix="/api/clipper", tags=["clipper"])
clips = Collection("clips")

CLIPS_DIR = DATA / "clips"
SOURCES_DIR = DATA / "sources"
MEDIA_EXT = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg", ".opus"}


class InfoRequest(BaseModel):
    url: str


class Range(BaseModel):
    start: float | None = None      # seconds; both None = whole video
    end: float | None = None
    name: str = ""


class SaveRequest(BaseModel):
    sources: list[str] = Field(min_length=1)     # URLs or /media/... urls of local files
    clips: list[Range] = Field(default_factory=lambda: [Range()])
    format: str = "mp4"                           # mp4 | mov | mp3 | m4a | gif | frames
    quality: int | None = None                    # 360..2160 short side; None = source size
    aspect: str = "original"                      # original | 9:16 | 1:1 | 4:5 | 16:9
    mode: str = "accurate"                        # accurate | fast
    subtitles: bool = False
    sub_lang: str = "en"
    gif_fps: int = 12
    frames_fps: float | None = None
    titles: dict[str, str] = Field(default_factory=dict)   # optional source -> display title


@router.post("/info")
def info(req: InfoRequest) -> dict:
    """Video: {kind:'video', source, origin, title, uploader, view_count, duration, thumbnail, youtube_id,
    width, height, fps, has_video, has_audio, qualities:[{height,fps,actual}], subtitle_langs, auto_caption_langs}.
    Playlist: {kind:'playlist', title, url, entries:[{id,url,title,duration,thumbnail}]}."""
    try:
        return core.fetch_info(req.url)
    except core.ClipError as e:
        raise HTTPException(400, str(e))


@router.post("/upload")
def upload(file: UploadFile = File(...)) -> dict:
    """Save a local file as a source. Returns the same shape as a video info with kind 'local'."""
    original = Path(file.filename or "upload.mp4").name
    ext = Path(original).suffix.lower()
    if ext not in MEDIA_EXT:
        raise HTTPException(400, f"Unsupported file type: {ext or 'unknown'}")
    dest = media.unique_path(SOURCES_DIR, media.safe_name(Path(original).stem, "upload"), ext.lstrip("."))
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out, 1024 * 1024)
    try:
        return core.local_info(dest, title=Path(original).stem, origin=original)
    except media.MediaError as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, f"Could not read that file: {e}")


@router.get("/local-info")
def local_info(source: str) -> dict:
    """Info for a file already under /media (e.g. a previous upload or clip)."""
    try:
        path = media_path(source)
    except ValueError:
        raise HTTPException(400, "Invalid source")
    if not path.is_file():
        raise HTTPException(404, "File not found")
    try:
        return core.local_info(path)
    except media.MediaError as e:
        raise HTTPException(400, str(e))


def _resolve(source: str) -> tuple[str, str]:
    """(engine source, origin label) for a URL or a /media url."""
    if core.is_url(source):
        return source.strip(), source.strip()
    try:
        path = media_path(source)
    except ValueError:
        raise HTTPException(400, "Invalid source")
    if not path.is_file():
        raise HTTPException(404, f"Source not found: {source}")
    return str(path), path.name


@router.post("/save")
def save(req: SaveRequest) -> dict:
    """Cut every range from every source in one background job.

    Returns {job_id}. Job result: {items: [history rows], errors: [{source, name, error}]}."""
    if req.format not in core.FORMATS:
        raise HTTPException(400, f"Unknown format: {req.format}")
    if req.aspect not in core.ASPECTS:
        raise HTTPException(400, f"Unknown aspect: {req.aspect}")
    if req.mode not in ("accurate", "fast"):
        raise HTTPException(400, "mode must be 'accurate' or 'fast'")
    for r in req.clips:
        if r.start is not None and r.end is not None and r.end <= r.start:
            raise HTTPException(400, "Each clip's end must be after its start.")
    resolved = [(*_resolve(s), req.titles.get(s, "")) for s in req.sources]
    tasks = [(src, origin, title, r) for src, origin, title in resolved for r in (req.clips or [Range()])]
    many = len(tasks) > 1

    def run(job: jobs.Job) -> dict:
        items: list[dict] = []
        errors: list[dict] = []
        for i, (src, origin, title, r) in enumerate(tasks):
            span = (i / len(tasks), (i + 1) / len(tasks))
            label = r.name or title or origin
            job.update(span[0], f"Clip {i + 1} of {len(tasks)}: {label}" if many else None)
            spec = core.ClipSpec(
                source=src, start=r.start, end=r.end, fmt=req.format, quality=req.quality, aspect=req.aspect,
                mode=req.mode, name=r.name, subtitles=req.subtitles, sub_lang=req.sub_lang,
                gif_fps=req.gif_fps, frames_fps=req.frames_fps, origin=origin, title=title,
            )
            try:
                res = core.cut_clip(spec, CLIPS_DIR, job, span, tmp_root=DATA / "tmp")
            except jobs.Cancelled:
                raise
            except Exception as e:
                errors.append({"source": origin, "name": label, "error": str(e) or e.__class__.__name__})
                continue
            out = Path(res["path"])
            warnings = list(res["warnings"])
            copied = None
            try:
                copied = media.copy_to_folder(out)
                for sub in res["subtitles"]:
                    media.copy_to_folder(Path(sub))
            except Exception as e:
                warnings.append(str(e))
            thumb = ""
            if req.format in ("mp4", "mov", "gif"):
                t = CLIPS_DIR / ".thumbs" / (out.stem + ".jpg")
                if core.make_thumb(out, t):
                    thumb = media_url(t)
            items.append(clips.insert({
                "title": out.stem, "file": media_url(out), "format": req.format,
                "duration": res["duration"], "width": res["width"], "height": res["height"],
                "size": res["size"], "source_origin": res["source_origin"],
                "source_in": res["source_in"], "source_out": res["source_out"],
                "aspect": req.aspect, "reencoded": res["reencoded"], "thumb": thumb,
                "subtitles": [media_url(s) for s in res["subtitles"]],
                "copied_to": copied, "warnings": warnings, "frames": res.get("frames"),
            }))
        if not items and errors:
            raise RuntimeError(errors[0]["error"])
        return {"items": items, "errors": errors}

    title = f"Saving {len(tasks)} clips" if many else "Saving clip"
    job = jobs.submit("clip", title, run, {"count": len(tasks), "format": req.format})
    return {"job_id": job.id}


@router.get("/history")
def history() -> list[dict]:
    """Saved clips, newest first. Rows whose file was deleted from disk are dropped."""
    rows = []
    for r in clips.all():
        try:
            if media_path(r["file"]).is_file():
                rows.append(r)
            else:
                clips.delete(r["id"])
        except (ValueError, KeyError):
            continue
    return sorted(rows, key=lambda r: r.get("created", 0), reverse=True)


@router.delete("/history/{clip_id}")
def delete_clip(clip_id: str) -> dict:
    row = clips.get(clip_id)
    if not row:
        raise HTTPException(404, "clip not found")
    for url in [row.get("file"), row.get("thumb"), *(row.get("subtitles") or [])]:
        if url:
            try:
                media_path(url).unlink(missing_ok=True)
            except ValueError:
                pass
    clips.delete(clip_id)
    return {"ok": True}
