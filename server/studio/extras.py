"""Optional online extras: text-to-speech voiceover and stock b-roll search."""
from __future__ import annotations

import asyncio
import json
import urllib.parse
import urllib.request
from pathlib import Path

from ..config import DATA, get_settings, media_url
from ..jobs import Job
from ..media import MediaError, safe_name, unique_path


def tts(text: str, voice: str | None, job: Job) -> dict:
    """Speak `text` with Microsoft Edge's online voices (package: edge-tts). Needs internet."""
    try:
        import edge_tts
    except ImportError as e:
        raise MediaError("Voiceover generation needs the 'edge-tts' package: pip install edge-tts") from e
    voice = voice or get_settings().get("tts_voice") or "en-US-GuyNeural"
    out = unique_path(DATA / "assets" / "voice", safe_name(text[:40], "voiceover"), "mp3")
    job.update(0.2, "Generating voiceover")
    try:
        asyncio.run(edge_tts.Communicate(text, voice).save(str(out)))
    except Exception as e:
        out.unlink(missing_ok=True)
        raise MediaError(f"Voiceover failed (this needs internet access): {e}") from e
    return {"name": out.name, "url": media_url(out)}


def stock_search(query: str, orientation: str = "portrait", per_page: int = 12) -> list[dict]:
    key = get_settings().get("pexels_api_key")
    if not key:
        raise MediaError("Add a Pexels API key in Settings to search stock footage.")
    url = "https://api.pexels.com/videos/search?" + urllib.parse.urlencode(
        {"query": query, "orientation": orientation, "per_page": per_page})
    req = urllib.request.Request(url, headers={"Authorization": key, "User-Agent": "cutroom"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        raise MediaError(f"Stock search failed: {e}") from e
    out = []
    for v in data.get("videos", []):
        files = sorted((f for f in v.get("video_files", []) if f.get("file_type") == "video/mp4"),
                       key=lambda f: abs((f.get("height") or 0) - 1280))
        if files:
            out.append({"id": v["id"], "thumb": v.get("image", ""), "duration": v.get("duration", 0),
                        "url": files[0]["link"], "credit": (v.get("user") or {}).get("name", ""), "page": v.get("url", "")})
    return out


def stock_download(url: str, name: str, job: Job) -> dict:
    if not url.startswith("https://"):
        raise MediaError("Only https downloads are allowed.")
    out = unique_path(DATA / "assets" / "broll", safe_name(name, "stock"), "mp4")
    job.update(0.05, "Downloading")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "cutroom"})
        with urllib.request.urlopen(req, timeout=60) as r, open(out, "wb") as f:
            total = int(r.headers.get("Content-Length") or 0)
            done = 0
            while chunk := r.read(1 << 16):
                f.write(chunk)
                done += len(chunk)
                if total:
                    job.update(0.05 + 0.95 * done / total)
    except Exception as e:
        Path(out).unlink(missing_ok=True)
        raise MediaError(f"Download failed: {e}") from e
    return {"name": out.name, "url": media_url(out)}
