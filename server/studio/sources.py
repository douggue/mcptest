"""Getting long videos into the studio: download, upload, or hand-over from the clipper."""
from __future__ import annotations

import shutil
from pathlib import Path

from ..config import DATA, media_url
from ..jobs import Cancelled, Job
from ..media import MediaError, ffmpeg, probe, safe_name
from ..store import new_id

BROWSER_VIDEO = {"h264", "vp9", "av1", "vp8"}
BROWSER_AUDIO = {"aac", "mp3", "opus", "vorbis", ""}


def download(url: str, max_height: int, job: Job) -> tuple[Path, dict]:
    """Download a whole video with yt-dlp. Returns (file, info)."""
    import yt_dlp

    out_dir = DATA / "sources"
    stem = new_id("src_")
    if max_height <= 1080:   # H.264 exists up to 1080p on most sites and plays everywhere
        fmt = (f"bv*[height<={max_height}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<={max_height}]+ba/"
               f"b[height<={max_height}]/b")
    else:
        fmt = f"bv*[height<={max_height}]+ba[ext=m4a]/bv*[height<={max_height}]+ba/b"

    def hook(d: dict) -> None:
        if job.cancelled:
            raise Cancelled()
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                job.update(0.02 + 0.9 * d.get("downloaded_bytes", 0) / total, "Downloading")

    opts = {"format": fmt, "outtmpl": str(out_dir / f"{stem}.%(ext)s"), "merge_output_format": "mp4",
            "quiet": True, "no_warnings": True, "noplaylist": True, "progress_hooks": [hook]}
    job.update(0.01, "Contacting the site")
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except Cancelled:
        raise
    except Exception as e:
        raise MediaError(f"Download failed: {str(e).replace('ERROR: ', '')[:300]}") from e
    files = sorted(out_dir.glob(f"{stem}.*"), key=lambda p: p.stat().st_size, reverse=True)
    if not files:
        raise MediaError("Download finished but no file was produced.")
    return files[0], info


def normalise(path: Path, job: Job, span: tuple[float, float] = (0.0, 1.0)) -> Path:
    """Make sure a browser can play and seek the file: MP4 with the index up front, in a codec Chrome decodes."""
    info = probe(path)
    if not info["has_video"]:
        raise MediaError("That file has no video track.")
    out = DATA / "sources" / f"{new_id('src_')}.mp4"
    playable = info["vcodec"] in BROWSER_VIDEO and info["acodec"] in BROWSER_AUDIO
    if playable:
        try:
            ffmpeg(["-i", str(path), "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", str(out)],
                   job, info["duration"], span, "Preparing video")
            return out
        except MediaError:
            out.unlink(missing_ok=True)   # some stream/container pairs cannot be copied into MP4; re-encode instead
    ffmpeg(["-i", str(path), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)],
           job, info["duration"], span, "Converting video (one time)")
    return out


def poster(video: Path, at: float) -> str:
    out = video.with_suffix(".jpg")
    try:
        ffmpeg(["-ss", f"{at:.2f}", "-i", str(video), "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", str(out)])
        return media_url(out)
    except MediaError:
        return ""


def new_project(name: str, video: Path, origin: str) -> dict:
    info = probe(video)
    pid = new_id("p_")
    return {
        "id": pid, "name": safe_name(name, "Untitled")[:100], "origin": origin,
        "source": {"path": str(video), "url": media_url(video), "duration": info["duration"], "width": info["width"],
                   "height": info["height"], "fps": info["fps"], "size": info["size"],
                   "poster": poster(video, min(info["duration"] * 0.2, 30))},
        "transcript": None, "clips": [],
    }


def remove_project_files(project: dict) -> None:
    src = Path(project["source"]["path"])
    for f in (src, src.with_suffix(".jpg")):
        f.unlink(missing_ok=True)
    shutil.rmtree(DATA / "projects" / project["id"], ignore_errors=True)
