"""ffmpeg / ffprobe helpers shared by the clipper and the studio."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

from .jobs import Cancelled, Job


class MediaError(RuntimeError):
    pass


def need(binary: str) -> str:
    path = shutil.which(binary)
    if not path:
        raise MediaError(f"{binary} was not found on PATH. Install ffmpeg (it includes ffprobe) and restart.")
    return path


def probe(path: str | Path) -> dict:
    """Duration, size, frame rate and stream facts for a media file."""
    out = subprocess.run(
        [need("ffprobe"), "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise MediaError(out.stderr.strip() or f"could not read {path}")
    info = json.loads(out.stdout)
    v = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"
              and s.get("disposition", {}).get("attached_pic", 0) == 0), None)
    a = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)
    fps = 0.0
    width = height = 0
    if v:
        num, _, den = (v.get("avg_frame_rate") or v.get("r_frame_rate") or "0/1").partition("/")
        fps = float(num) / float(den or 1) if float(den or 1) else 0.0
        width, height = int(v.get("width", 0)), int(v.get("height", 0))
        rotation = 0
        for sd in v.get("side_data_list", []) or []:
            rotation = int(sd.get("rotation", 0) or 0)
        if abs(rotation) in (90, 270):
            width, height = height, width
    duration = float(info.get("format", {}).get("duration") or (v or a or {}).get("duration") or 0)
    return {
        "duration": duration, "width": width, "height": height, "fps": round(fps, 3),
        "has_video": bool(v), "has_audio": bool(a),
        "vcodec": (v or {}).get("codec_name", ""), "acodec": (a or {}).get("codec_name", ""),
        "size": int(info.get("format", {}).get("size") or 0),
    }


def ffmpeg(args: list[str], job: Job | None = None, total: float | None = None,
           span: tuple[float, float] = (0.0, 1.0), message: str | None = None) -> None:
    """Run ffmpeg. With a job and a total duration (seconds of output), reports progress into `span`."""
    cmd = [need("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", *args]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if job and message:
        job.update(span[0], message)
    try:
        assert proc.stdout
        for line in proc.stdout:
            if job and job.cancelled:
                proc.kill()
                raise Cancelled()
            if job and total and line.startswith("out_time_us="):
                try:
                    done = int(line.split("=", 1)[1]) / 1_000_000
                except ValueError:
                    continue
                frac = max(0.0, min(1.0, done / total))
                job.update(span[0] + (span[1] - span[0]) * frac)
        proc.wait()
    finally:
        if proc.poll() is None:
            proc.kill()
    if proc.returncode != 0:
        err = proc.stderr.read().strip() if proc.stderr else ""
        raise MediaError(err.splitlines()[-1] if err else "ffmpeg failed")
    if job:
        job.update(span[1])


def safe_name(name: str, fallback: str = "clip") -> str:
    """A filename safe on Windows, macOS and Linux."""
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', " ", name or "")
    name = re.sub(r"\s+", " ", name).strip(" .")
    return name[:120] or fallback


def unique_path(folder: Path, stem: str, ext: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / f"{stem}.{ext}"
    n = 2
    while p.exists():
        p = folder / f"{stem} ({n}).{ext}"
        n += 1
    return p


def parse_time(value: str | float | int) -> float:
    """'1:35:56', '95:56', '5756.5' -> seconds."""
    if isinstance(value, (int, float)):
        return float(value)
    parts = [float(p) for p in str(value).strip().split(":")]
    secs = 0.0
    for p in parts:
        secs = secs * 60 + p
    return secs


def fmt_time(seconds: float, millis: bool = False) -> str:
    seconds = max(0.0, seconds)
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    base = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
    return base + (f".{int((seconds % 1) * 1000):03d}" if millis else "")


def copy_to_folder(path: Path) -> str | None:
    """Copy a finished file to the user's configured folder (e.g. a Google Drive sync folder)."""
    from .config import get_settings
    target = (get_settings().get("copy_folder") or "").strip()
    if not target:
        return None
    dest_dir = Path(target).expanduser()
    if not dest_dir.is_dir():
        raise MediaError(f"Copy folder does not exist: {dest_dir}")
    dest = unique_path(dest_dir, path.stem, path.suffix.lstrip("."))
    shutil.copy2(path, dest)
    return str(dest)
