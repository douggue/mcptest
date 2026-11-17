"""Paths and persistent settings. Everything Cutroom writes lives under DATA."""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from urllib.parse import quote, unquote

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("CUTROOM_DATA", ROOT / "data")).resolve()
WEB = ROOT / "web"

SUBDIRS = [
    "sources",        # full source videos (downloads and uploads)
    "projects",       # one folder per studio project
    "clips",          # clipper output
    "exports",        # rendered shorts and covers
    "assets/music",
    "assets/broll",
    "assets/sfx",
    "assets/brand",
    "assets/voice",
    "db",             # small JSON collections
    "cache",
    "tmp",
]

DEFAULT_SETTINGS = {
    "ai_provider": "anthropic",       # anthropic | gemini  (whichever has a key is used if this one has none)
    "anthropic_api_key": "",          # falls back to ANTHROPIC_API_KEY in the environment
    "ai_model": "claude-opus-5-5",
    "gemini_api_key": "",             # falls back to GEMINI_API_KEY / GOOGLE_API_KEY in the environment
    "gemini_model": "gemini-4-hydrogen",
    "whisper_model": "small",         # tiny | base | small | medium | large-v3
    "copy_folder": "",                # e.g. your Google Drive desktop folder; finished files are copied here
    "capcut_folder": "",              # CapCut's projects folder on the computer that runs CapCut
    "pexels_api_key": "",             # optional, for stock b-roll search
    # Generation through Google AI Studio (uses the Gemini key). These are defaults that may need changing:
    # model names change often, so each is free text and the Generate page can load the live list.
    "gen_image_model": "gemini-3.1-flash-lite-image",
    "gen_tts_model": "gemini-3.8-flash-tts",
    "gen_tts_voice": "Kore",
    "gen_music_model": "lyria-3-clip-preview",
    "tts_voice": "en-US-GuyNeural",
    "flow_enabled": False,            # optional flow-mcp connector (desktop edition only); off unless the user turns it on
    "flow_mcp_path": "",              # folder where flow-mcp is installed (the one containing dist/index.js)
    "flow_out_dir": "",               # flow-mcp's output folder; empty means ~/flow-mcp-out
    "brand": {
        "name": "",
        "accent": "#ffb224",
        "secondary": "#ffffff",
        "font": "Anton",
        "logo": "",                   # /media/... url
        "logoPos": "top-right",
        "logoSize": 12,               # % of frame width
        "watermark": "",
    },
}

_lock = threading.Lock()


def ensure_dirs() -> None:
    for sub in SUBDIRS:
        (DATA / sub).mkdir(parents=True, exist_ok=True)


def media_url(path: str | Path) -> str:
    """Public URL for a file under DATA."""
    rel = Path(path).resolve().relative_to(DATA)
    return "/media/" + quote(rel.as_posix())


def media_path(url: str) -> Path:
    """Inverse of media_url. Rejects anything that escapes DATA."""
    rel = unquote(url.split("/media/", 1)[-1].split("?", 1)[0])
    p = (DATA / rel).resolve()
    if DATA not in p.parents and p != DATA:
        raise ValueError("path outside data directory")
    return p


def _merge(base: dict, patch: dict) -> dict:
    out = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def get_settings() -> dict:
    f = DATA / "db" / "settings.json"
    saved = {}
    if f.exists():
        try:
            saved = json.loads(f.read_text("utf-8"))
        except json.JSONDecodeError:
            saved = {}
    return _merge(DEFAULT_SETTINGS, saved)


def save_settings(patch: dict) -> dict:
    with _lock:
        merged = _merge(get_settings(), patch)
        f = DATA / "db" / "settings.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(merged, indent=2), "utf-8")
        return merged


def anthropic_key() -> str:
    return get_settings().get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY", "")


def gemini_key() -> str:
    return (get_settings().get("gemini_api_key") or os.environ.get("GEMINI_API_KEY", "")
            or os.environ.get("GOOGLE_API_KEY", ""))
