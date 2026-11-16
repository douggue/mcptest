"""Clipper engine: source info, section download, cutting and format conversion.

Pure functions only (no FastAPI) so the web router and the CLI share them.
"""
from __future__ import annotations

import re
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import media
from .jobs import Cancelled, Job

VIDEO_FORMATS = ("mp4", "mov")
AUDIO_FORMATS = ("mp3", "m4a")
IMAGE_FORMATS = ("gif", "frames")
FORMATS = VIDEO_FORMATS + AUDIO_FORMATS + IMAGE_FORMATS
ASPECTS = {"original": None, "9:16": 9 / 16, "1:1": 1.0, "4:5": 4 / 5, "16:9": 16 / 9}
STANDARD_HEIGHTS = (360, 480, 720, 1080, 1440, 2160)
MAX_FRAMES = 3000          # cap for PNG sequences
GIF_MAX_SIDE = 480         # GIFs above this get very large

# codecs that can be stream-copied into each container
_COPY_VIDEO = {"mp4": {"h264", "hevc", "av1", "vp9", "mpeg4"}, "mov": {"h264", "hevc", "mpeg4", "prores"}}
_COPY_AUDIO = {"mp4": {"aac", "mp3", "alac", "opus", "ac3"}, "mov": {"aac", "mp3", "alac", "ac3"}, "m4a": {"aac", "alac"}}


class ClipError(RuntimeError):
    pass


# --------------------------------------------------------------------------- helpers

def is_url(source: str) -> bool:
    return bool(re.match(r"^https?://", (source or "").strip(), re.I))


def youtube_id(url: str) -> str | None:
    """Video id for youtube.com / youtu.be / shorts / embed / live URLs."""
    m = re.search(
        r"(?:youtu\.be/|youtube(?:-nocookie)?\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/|v/))([A-Za-z0-9_-]{11})",
        url or "",
    )
    return m.group(1) if m else None


def _even(n: float) -> int:
    return max(2, int(n) // 2 * 2)


def quality_ladder(sizes: list[tuple[int, float]]) -> list[dict]:
    """Standard quality steps a source can deliver.

    `sizes` is a list of (short_side_pixels, fps) for every video variant the source has.
    Returns [{height, fps, actual}], lowest first. Steps below the best variant are always
    offered (ffmpeg can downscale); steps above it never are.
    """
    sizes = [(int(h), float(f or 0)) for h, f in sizes if h]
    if not sizes:
        return []
    best = max(h for h, _ in sizes)
    out: list[dict] = []
    prev = 300          # anything smaller is not offered as "360p"
    for q in STANDARD_HEIGHTS:
        # a 1036-line encode still counts as "1080p"
        inside = [(h, f) for h, f in sizes if prev < h <= q * 1.02]
        if inside:
            out.append({"height": q, "fps": round(max(f for _, f in inside), 2), "actual": max(h for h, _ in inside)})
        elif best > q:
            above = min((h for h, _ in sizes if h > q), default=best)
            fps = max(f for h, f in sizes if h == above)
            out.append({"height": q, "fps": round(fps, 2), "actual": q})
        prev = int(q * 1.02)
    if not out:  # source is smaller than 360p
        out.append({"height": best, "fps": round(max(f for h, f in sizes if h == best), 2), "actual": best})
    return out


def crop_dims(width: int, height: int, aspect: str) -> tuple[int, int]:
    """Largest centred crop of (width, height) with the given aspect, even-sized."""
    ratio = ASPECTS.get(aspect)
    if not ratio or not width or not height:
        return _even(width), _even(height)
    if width / height > ratio:
        return _even(height * ratio), _even(height)
    return _even(width), _even(width / ratio)


def output_dims(width: int, height: int, aspect: str, quality: int | None) -> tuple[int, int]:
    """Final frame size after centre crop and (downscale-only) quality limit on the short side."""
    cw, ch = crop_dims(width, height, aspect)
    short = min(cw, ch)
    if quality and short > quality * 1.02:
        # use the ideal ratio so e.g. 9:16 at 1080 is exactly 1080x1920
        ratio = ASPECTS.get(aspect) or cw / ch
        if ratio <= 1:
            return _even(quality), _even(round(quality / ratio))
        return _even(round(quality * ratio)), _even(quality)
    return cw, ch


def plan_output(src: dict, fmt: str, quality: int | None, aspect: str, mode: str) -> dict:
    """Decide how a source must be processed. `src` is a media.probe() dict.

    Returns {kind, width, height, vf, copy_video, copy_audio, reencode}.
    """
    if fmt not in FORMATS:
        raise ClipError(f"Unknown format: {fmt}")
    if fmt in AUDIO_FORMATS:
        if not src.get("has_audio"):
            raise ClipError("This source has no audio track.")
        copy = fmt == "m4a" and src.get("acodec") in _COPY_AUDIO["m4a"]
        return {"kind": "audio", "width": 0, "height": 0, "vf": None,
                "copy_video": False, "copy_audio": copy, "reencode": not copy}
    if not src.get("has_video"):
        raise ClipError("This source has no video track.")

    w, h = int(src["width"]), int(src["height"])
    if fmt == "gif":
        quality = min(quality or GIF_MAX_SIDE, GIF_MAX_SIDE)
    cw, ch = crop_dims(w, h, aspect)
    ow, oh = output_dims(w, h, aspect, quality)
    filters: list[str] = []
    if (cw, ch) != (w, h):
        filters.append(f"crop={cw}:{ch}")
    if (ow, oh) != (cw, ch):
        filters.append(f"scale={ow}:{oh}:flags=lanczos")
    vf = ",".join(filters) or None

    if fmt in IMAGE_FORMATS:
        return {"kind": fmt, "width": ow, "height": oh, "vf": vf,
                "copy_video": False, "copy_audio": False, "reencode": True}

    container = fmt
    can_copy_v = vf is None and src.get("vcodec") in _COPY_VIDEO[container]
    can_copy_a = (not src.get("has_audio")) or src.get("acodec") in _COPY_AUDIO[container]
    copy = mode == "fast" and can_copy_v and can_copy_a
    return {"kind": "video", "width": ow, "height": oh, "vf": vf,
            "copy_video": copy, "copy_audio": copy, "reencode": not copy}


def build_ffmpeg_args(src_path: str | Path, out_path: str | Path, fmt: str, plan: dict,
                      start: float = 0.0, duration: float | None = None, has_audio: bool = True,
                      gif_fps: int = 12, frames_fps: float | None = None) -> list[str]:
    """ffmpeg arguments (without the binary and global flags) for one cut."""
    args: list[str] = []
    if start and start > 0:
        args += ["-ss", f"{start:.3f}"]
    args += ["-i", str(src_path)]
    if duration is not None:
        args += ["-t", f"{duration:.3f}"]

    kind = plan["kind"]
    if kind == "audio":
        args += ["-vn", "-map", "0:a:0"]
        if fmt == "mp3":
            args += ["-c:a", "libmp3lame", "-b:a", "192k"]
        elif plan["copy_audio"]:
            args += ["-c:a", "copy"]
        else:
            args += ["-c:a", "aac", "-b:a", "192k"]
        if fmt == "m4a":
            args += ["-movflags", "+faststart"]
        args += ["-f", "mp3" if fmt == "mp3" else "ipod", str(out_path)]
        return args

    if kind == "gif":
        chain = f"fps={int(gif_fps)}" + (f",{plan['vf']}" if plan["vf"] else "")
        graph = (f"[0:v:0]{chain},split[a][b];[a]palettegen=stats_mode=diff[p];"
                 f"[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle")
        args += ["-filter_complex", graph, "-an", "-loop", "0", "-f", "gif", str(out_path)]
        return args

    if kind == "frames":
        chain = [f"fps={frames_fps:g}"] if frames_fps else []
        if plan["vf"]:
            chain.append(plan["vf"])
        args += ["-map", "0:v:0", "-an"]
        if chain:
            args += ["-vf", ",".join(chain)]
        args += [str(out_path)]
        return args

    # video
    args += ["-map", "0:v:0"]
    if has_audio:
        args += ["-map", "0:a:0"]
    if plan["copy_video"]:
        args += ["-c", "copy", "-avoid_negative_ts", "make_zero"]
    else:
        if plan["vf"]:
            args += ["-vf", plan["vf"]]
        args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"]
        if has_audio:
            args += ["-c:a", "aac", "-b:a", "192k"]
    args += ["-movflags", "+faststart", "-f", "mov" if fmt == "mov" else "mp4", str(out_path)]
    return args


# --------------------------------------------------------------------------- subtitles

_TS = r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})"
_CUE = re.compile(_TS + r"\s*-->\s*" + _TS)


def _ts(groups: tuple) -> float:
    h, m, s, ms = groups
    return int(h or 0) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def parse_cues(text: str) -> list[dict]:
    """Parse WebVTT or SRT into [{start, end, text}] (inline tags removed)."""
    cues: list[dict] = []
    cur: dict | None = None
    for raw in text.replace("\r", "").split("\n"):
        line = raw.strip()
        m = _CUE.search(line)
        if m:
            g = m.groups()
            cur = {"start": _ts(g[:4]), "end": _ts(g[4:]), "lines": []}
            cues.append(cur)
            continue
        if not raw:                 # only a truly empty line ends a cue (YouTube emits " " lines inside cues)
            cur = None
            continue
        if cur is not None and line:
            clean = re.sub(r"<[^>]+>", "", line)
            clean = clean.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").strip()
            if clean:
                cur["lines"].append(clean)
    return [{"start": c["start"], "end": c["end"], "text": "\n".join(c["lines"])} for c in cues if c["lines"]]


def dedupe_rolling(cues: list[dict]) -> list[dict]:
    """YouTube auto-captions repeat the previous line in every cue; keep each line once."""
    out: list[dict] = []
    seen_prev: list[str] = []
    for c in cues:
        lines = c["text"].split("\n")
        fresh = [ln for ln in lines if ln not in seen_prev]
        seen_prev = lines
        if not fresh:
            continue
        if out and c["end"] - c["start"] < 0.05:
            continue  # zero-length "hold" cue
        out.append({"start": c["start"], "end": c["end"], "text": " ".join(fresh)})
    # close gaps created by removing the repeated cues
    for a, b in zip(out, out[1:]):
        if a["end"] > b["start"]:
            a["end"] = b["start"]
    return [c for c in out if c["end"] > c["start"]]


def retime_cues(cues: list[dict], start: float | None, end: float | None) -> list[dict]:
    """Keep cues that overlap [start, end] and shift them so the clip starts at 0."""
    s = start or 0.0
    out = []
    for c in cues:
        if end is not None and c["start"] >= end:
            continue
        if c["end"] <= s:
            continue
        a = max(c["start"], s) - s
        b = (min(c["end"], end) if end is not None else c["end"]) - s
        if b - a > 0.01:
            out.append({"start": round(a, 3), "end": round(b, 3), "text": c["text"]})
    return out


def _srt_ts(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def cues_to_srt(cues: list[dict]) -> str:
    return "\n".join(f"{i}\n{_srt_ts(c['start'])} --> {_srt_ts(c['end'])}\n{c['text']}\n"
                     for i, c in enumerate(cues, 1))


def cues_to_text(cues: list[dict]) -> str:
    return re.sub(r"\s+", " ", " ".join(c["text"] for c in cues)).strip() + "\n"


# --------------------------------------------------------------------------- source info

def _ydl(opts: dict):
    try:
        import yt_dlp
    except ImportError as e:  # pragma: no cover
        raise ClipError("yt-dlp is not installed. Run: pip install -U yt-dlp") from e
    base = {"quiet": True, "no_warnings": True, "noprogress": True, "retries": 3}
    return yt_dlp.YoutubeDL({**base, **opts})


def _friendly(e: Exception) -> str:
    msg = re.sub(r"\x1b\[[0-9;]*m", "", str(e))
    msg = re.sub(r"^ERROR:\s*", "", msg).strip()
    msg = re.split(r";\s*please report this issue", msg)[0]
    msg = re.sub(r"\s*\(caused by .*$", "", msg, flags=re.S).strip()
    return msg.splitlines()[0][:300] if msg else e.__class__.__name__


def info_from_ytdlp(info: dict) -> dict:
    """Normalise a yt-dlp info dict (video or playlist) for the UI."""
    if info.get("_type") in ("playlist", "multi_video") or "entries" in info:
        entries = []
        for e in info.get("entries") or []:
            if not e:
                continue
            url = e.get("webpage_url") or e.get("url") or ""
            if not is_url(url) and e.get("id") and "youtube" in (e.get("ie_key") or info.get("extractor") or "").lower():
                url = f"https://www.youtube.com/watch?v={e['id']}"
            thumbs = e.get("thumbnails") or []
            entries.append({
                "id": e.get("id") or "", "url": url, "title": e.get("title") or url,
                "duration": float(e.get("duration") or 0),
                "thumbnail": e.get("thumbnail") or (thumbs[-1].get("url") if thumbs else ""),
            })
        return {"kind": "playlist", "title": info.get("title") or "Playlist",
                "url": info.get("webpage_url") or "", "entries": [e for e in entries if e["url"]]}

    sizes: list[tuple[int, float]] = []
    formats = info.get("formats") or []
    for f in formats:
        if f.get("vcodec") == "none":
            continue
        w, h = f.get("width") or 0, f.get("height") or 0
        short = min(w, h) if w and h else h
        if short:
            sizes.append((int(short), float(f.get("fps") or 0)))
    if not sizes and info.get("height"):
        w, h = info.get("width") or 0, info["height"]
        sizes.append((int(min(w, h) if w else h), float(info.get("fps") or 0)))
    url = info.get("webpage_url") or info.get("original_url") or ""
    subs = sorted((info.get("subtitles") or {}).keys())
    auto = sorted((info.get("automatic_captions") or {}).keys())
    return {
        "kind": "video",
        "source": url,
        "origin": url,
        "id": info.get("id") or "",
        "youtube_id": youtube_id(url) or (info.get("id") if "youtube" in (info.get("extractor") or "").lower() else None),
        "title": info.get("title") or url,
        "uploader": info.get("uploader") or info.get("channel") or "",
        "view_count": info.get("view_count"),
        "duration": float(info.get("duration") or 0),
        "thumbnail": info.get("thumbnail") or "",
        "width": info.get("width") or 0,
        "height": info.get("height") or 0,
        "fps": float(info.get("fps") or 0),
        # a codec of None means "unknown" (direct file links), which usually has both tracks
        "has_video": bool(sizes) or any(f.get("vcodec") != "none" for f in formats) or not formats,
        "has_audio": any(f.get("acodec") != "none" for f in formats) or not formats,
        "qualities": quality_ladder(sizes),
        "subtitle_langs": subs,
        "auto_caption_langs": auto[:200],
        "is_live": bool(info.get("is_live")),
    }


def fetch_info(url: str) -> dict:
    """Look up a URL with yt-dlp. Returns a video dict or a playlist dict (see info_from_ytdlp)."""
    if not is_url(url):
        raise ClipError("Enter a full URL starting with http:// or https://")
    try:
        with _ydl({"skip_download": True, "extract_flat": "in_playlist"}) as ydl:
            info = ydl.extract_info(url.strip(), download=False)
    except Exception as e:
        raise ClipError(_friendly(e)) from e
    out = info_from_ytdlp(ydl.sanitize_info(info))
    if out["kind"] == "video" and not out["qualities"] and info.get("direct") and is_url(info.get("url") or ""):
        # a plain media file: yt-dlp knows nothing about it, ffprobe does
        try:
            pr = media.probe(info["url"])
            short = min(pr["width"], pr["height"]) if pr["has_video"] else 0
            out.update(duration=out["duration"] or pr["duration"], width=pr["width"], height=pr["height"], fps=pr["fps"],
                       has_video=pr["has_video"], has_audio=pr["has_audio"],
                       qualities=quality_ladder([(short, pr["fps"])]) if short else [])
        except media.MediaError:
            pass
    return out


def local_info(path: str | Path, title: str | None = None, origin: str | None = None) -> dict:
    """Same shape as a video info dict, for a file on disk."""
    from .config import media_url
    p = Path(path)
    pr = media.probe(p)
    short = min(pr["width"], pr["height"]) if pr["has_video"] else 0
    return {
        "kind": "local",
        "source": media_url(p),
        "origin": origin or p.name,
        "id": p.stem,
        "youtube_id": None,
        "title": title or p.stem,
        "uploader": "",
        "view_count": None,
        "duration": pr["duration"],
        "thumbnail": "",
        "width": pr["width"],
        "height": pr["height"],
        "fps": pr["fps"],
        "has_video": pr["has_video"],
        "has_audio": pr["has_audio"],
        "qualities": quality_ladder([(short, pr["fps"])]) if short else [],
        "subtitle_langs": [],
        "auto_caption_langs": [],
        "is_live": False,
        "size": pr["size"],
    }


# --------------------------------------------------------------------------- downloading

def ytdlp_options(fmt: str, quality: int | None, start: float | None, end: float | None,
                  accurate: bool, outtmpl: str) -> dict:
    """yt-dlp options for fetching just what one clip needs."""
    opts: dict[str, Any] = {"outtmpl": outtmpl, "noplaylist": True, "concurrent_fragment_downloads": 4}
    if fmt in AUDIO_FORMATS:
        opts["format"] = "bestaudio[ext=m4a]/bestaudio/best" if fmt == "m4a" else "bestaudio/best"
    else:
        opts["format"] = "bestvideo*+bestaudio/best"
        # resolution first (never above the requested step), then codecs that copy cleanly into MP4/MOV
        sort = [f"res:{int(quality)}"] if quality else []
        opts["format_sort"] = sort + ["vcodec:h264", "acodec:aac"]
        opts["merge_output_format"] = "mkv"
    if start is not None or end is not None:
        from yt_dlp.utils import download_range_func
        opts["download_ranges"] = download_range_func(None, [(float(start or 0), float(end) if end is not None else float("inf"))])
        # Exact cuts need a re-encode while downloading (yt-dlp's ffmpeg downloader). Audio packets are
        # ~20 ms long, so audio-only clips are cut by stream copy either way.
        exact = bool(accurate) and fmt not in AUDIO_FORMATS
        opts["force_keyframes_at_cuts"] = exact
        if exact:
            opts["external_downloader_args"] = {"ffmpeg_o": [
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k"]}
    return opts


def download_source(url: str, tmp: Path, fmt: str, quality: int | None, start: float | None,
                    end: float | None, accurate: bool, job: Job | None = None,
                    span: tuple[float, float] = (0.0, 1.0)) -> tuple[Path, dict]:
    """Download the requested part of a URL into `tmp`. Returns (file, yt-dlp info)."""
    from yt_dlp.utils import DownloadCancelled

    def hook(d: dict) -> None:
        if job and job.cancelled:
            raise DownloadCancelled("cancelled")
        if not job or d.get("status") != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        done = d.get("downloaded_bytes") or 0
        frac = min(1.0, done / total) if total else 0.0
        size = f" · {done / 1_048_576:.1f} MB" if done else ""
        job.update(span[0] + (span[1] - span[0]) * frac, f"Downloading{size}")

    opts = ytdlp_options(fmt, quality, start, end, accurate, str(tmp / "dl.%(ext)s"))
    opts["progress_hooks"] = [hook]
    if job:
        job.update(span[0], "Downloading")
    try:
        with _ydl(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            info = ydl.sanitize_info(info)
    except DownloadCancelled as e:
        raise Cancelled() from e
    except Cancelled:
        raise
    except Exception as e:
        if job and job.cancelled:
            raise Cancelled() from e
        raise ClipError(_friendly(e)) from e
    path = None
    for d in info.get("requested_downloads") or []:
        if d.get("filepath") and Path(d["filepath"]).exists():
            path = Path(d["filepath"])
    if not path:
        files = sorted((p for p in tmp.glob("dl.*") if p.suffix not in (".part", ".ytdl")), key=lambda p: p.stat().st_size)
        if not files:
            raise ClipError("Download finished but no file was produced.")
        path = files[-1]
    if job:
        job.update(span[1])
    return path, info


def fetch_subtitles(url: str, start: float | None, end: float | None, lang: str,
                    out_dir: Path, stem: str) -> list[Path]:
    """Save subtitles (or auto-captions) for the range as SRT and TXT. Returns the files written."""
    lang = (lang or "en").strip()
    with tempfile.TemporaryDirectory() as td:
        opts = {"skip_download": True, "writesubtitles": True, "writeautomaticsub": True,
                "subtitleslangs": [lang, f"{lang}-orig", f"{lang}.*"], "subtitlesformat": "vtt/srt/best",
                "outtmpl": str(Path(td) / "subs.%(ext)s"), "noplaylist": True}
        try:
            with _ydl(opts) as ydl:
                ydl.extract_info(url, download=True)
        except Exception as e:
            raise ClipError("Subtitles: " + _friendly(e)) from e
        files = sorted(list(Path(td).glob("subs*.vtt")) + list(Path(td).glob("subs*.srt")),
                       key=lambda p: (f".{lang}." not in p.name, len(p.name)))
        if not files:
            raise ClipError(f"No subtitles or auto-captions found for language '{lang}'.")
        cues = parse_cues(files[0].read_text("utf-8", errors="replace"))
    cues = retime_cues(dedupe_rolling(cues), start, end)
    if not cues:
        raise ClipError("No subtitle lines fall inside the selected range.")
    srt = media.unique_path(out_dir, stem, "srt")
    srt.write_text(cues_to_srt(cues), "utf-8")
    txt = media.unique_path(out_dir, stem, "txt")
    txt.write_text(cues_to_text(cues), "utf-8")
    return [srt, txt]


# --------------------------------------------------------------------------- cutting

@dataclass
class ClipSpec:
    source: str                     # URL, or absolute path of a local file
    start: float | None = None      # seconds; None with end=None means the whole video
    end: float | None = None
    fmt: str = "mp4"                # mp4 | mov | mp3 | m4a | gif | frames
    quality: int | None = None      # short-side limit (360..2160); None keeps the source size
    aspect: str = "original"        # original | 9:16 | 1:1 | 4:5 | 16:9
    mode: str = "accurate"          # accurate (re-encode, exact frames) | fast (keyframe snap, stream copy)
    name: str = ""                  # output file name without extension; defaults to the source title
    subtitles: bool = False         # URL sources only
    sub_lang: str = "en"
    gif_fps: int = 12
    frames_fps: float | None = None  # None = every source frame
    origin: str = ""                # what to record as the source (URL or original file name)
    title: str = ""                 # display title fallback for local files


def make_thumb(path: Path, dest: Path) -> bool:
    """Small JPEG poster for a video or GIF."""
    try:
        d = media.probe(path).get("duration") or 0
        dest.parent.mkdir(parents=True, exist_ok=True)
        media.ffmpeg(["-ss", f"{min(1.0, d / 2):.2f}", "-i", str(path), "-frames:v", "1",
                      "-vf", "scale=360:-2", "-q:v", "4", str(dest)])
        return dest.exists()
    except Exception:
        return False


def cut_clip(spec: ClipSpec, out_dir: Path, job: Job | None = None,
             span: tuple[float, float] = (0.0, 1.0), tmp_root: Path | None = None) -> dict:
    """Produce one output file for `spec` in `out_dir`.

    Returns {path, format, title, duration, width, height, size, reencoded,
             source_origin, source_in, source_out, subtitles: [paths], warnings: [str]}.
    """
    if spec.fmt not in FORMATS:
        raise ClipError(f"Unknown format: {spec.fmt}")
    if spec.aspect not in ASPECTS:
        raise ClipError(f"Unknown aspect: {spec.aspect}")
    start, end = spec.start, spec.end
    if start is not None and start < 0:
        start = 0.0
    if start is not None and end is not None and end - start < 0.03:
        raise ClipError("The end must be after the start.")

    lo, hi = span
    warnings: list[str] = []
    tmp = Path(tempfile.mkdtemp(prefix="clip-", dir=str(tmp_root) if tmp_root else None))
    try:
        if is_url(spec.source):
            accurate = spec.mode != "fast"
            src_path, info = download_source(spec.source, tmp, spec.fmt, spec.quality, start, end, accurate,
                                             job, (lo, lo + (hi - lo) * 0.7))
            title = spec.name or info.get("title") or "clip"
            origin = spec.origin or info.get("webpage_url") or spec.source
            local_start, local_dur = 0.0, None            # the download is already the section
            proc_span = (lo + (hi - lo) * 0.7, hi)
        else:
            src_path = Path(spec.source)
            if not src_path.is_file():
                raise ClipError("Source file not found.")
            title = spec.name or spec.title or src_path.stem
            origin = spec.origin or src_path.name
            local_start = float(start or 0.0)
            local_dur = None
            proc_span = (lo, hi)

        src = media.probe(src_path)
        if not is_url(spec.source):
            stop = min(float(end), src["duration"]) if end is not None else src["duration"]
            if local_start >= stop:
                raise ClipError("The start is past the end of the video.")
            if start is not None or end is not None:
                local_dur = stop - local_start
        out_dur = local_dur if local_dur is not None else src["duration"]

        # A downloaded section is already cut, so it only needs re-encoding for a crop, resize or codec change.
        plan = plan_output(src, spec.fmt, spec.quality, spec.aspect, "fast" if is_url(spec.source) else spec.mode)
        stem = media.safe_name(title)
        ext = "zip" if spec.fmt == "frames" else spec.fmt
        out_path = media.unique_path(out_dir, stem, ext)
        label = "Copying streams" if not plan["reencode"] else "Encoding"

        if spec.fmt == "frames":
            fps = spec.frames_fps or src["fps"] or 30
            if out_dur * fps > MAX_FRAMES:
                raise ClipError(f"That is about {int(out_dur * fps)} frames; the limit is {MAX_FRAMES}. "
                                "Shorten the range or lower the frame rate.")
            frames_dir = tmp / "frames"
            frames_dir.mkdir()
            args = build_ffmpeg_args(src_path, frames_dir / "frame_%05d.png", spec.fmt, plan, local_start,
                                     local_dur, frames_fps=spec.frames_fps)
            media.ffmpeg(args, job, out_dur, (proc_span[0], proc_span[0] + (proc_span[1] - proc_span[0]) * 0.9),
                         "Extracting frames")
            frames = sorted(frames_dir.glob("*.png"))
            if not frames:
                raise ClipError("No frames were extracted.")
            with zipfile.ZipFile(out_path, "w", zipfile.ZIP_STORED) as z:
                for f in frames:
                    z.write(f, f.name)
            frame_count = len(frames)
        else:
            args = build_ffmpeg_args(src_path, out_path, spec.fmt, plan, local_start, local_dur,
                                     has_audio=src["has_audio"], gif_fps=spec.gif_fps)
            media.ffmpeg(args, job, out_dur, proc_span, label)
            frame_count = None

        result: dict[str, Any] = {
            "path": str(out_path), "format": spec.fmt, "title": title,
            "duration": out_dur, "width": plan["width"], "height": plan["height"],
            "size": out_path.stat().st_size, "reencoded": bool(plan["reencode"]),
            "source_origin": origin,
            "source_in": float(start or 0.0),
            "source_out": float(end) if end is not None else float(start or 0.0) + out_dur,
            "subtitles": [], "warnings": warnings,
        }
        if frame_count is not None:
            result["frames"] = frame_count
        if spec.fmt != "frames":
            try:
                pr = media.probe(out_path)
                result["duration"] = pr["duration"] or out_dur
                if pr["has_video"]:
                    result["width"], result["height"] = pr["width"], pr["height"]
            except media.MediaError:
                pass

        if spec.subtitles:
            if is_url(spec.source):
                try:
                    subs = fetch_subtitles(spec.source, start, end, spec.sub_lang, out_dir, out_path.stem)
                    result["subtitles"] = [str(p) for p in subs]
                except ClipError as e:
                    warnings.append(str(e))
            else:
                warnings.append("Subtitles are only available for URL sources. Use the shorts studio to transcribe a local file.")
        if job:
            job.update(hi)
        return result
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
