"""Word-level transcripts: local Whisper, YouTube's own captions, or an imported file."""
from __future__ import annotations

import json
import re
from pathlib import Path

from ..config import DATA, get_settings
from ..jobs import Job
from ..media import MediaError, ffmpeg, probe


def _finish(words: list[dict]) -> list[dict]:
    """Sort, drop empties, make times sane and number the words."""
    clean = []
    for w in sorted(words, key=lambda w: w["start"]):
        text = str(w["text"]).strip()
        if not text:
            continue
        start = max(0.0, float(w["start"]))
        end = max(start + 0.04, float(w["end"]))
        clean.append({"text": text, "start": round(start, 3), "end": round(end, 3)})
    for i, w in enumerate(clean):
        if i + 1 < len(clean) and w["end"] > clean[i + 1]["start"]:
            w["end"] = max(w["start"] + 0.04, clean[i + 1]["start"])
        w["id"] = i
    return clean


def whisper(path: Path, job: Job, model_name: str | None = None, language: str | None = None) -> dict:
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise MediaError("Local transcription needs the 'faster-whisper' package: pip install faster-whisper") from e
    info = probe(path)
    if not info["has_audio"]:
        raise MediaError("This video has no audio track to transcribe.")
    wav = DATA / "tmp" / f"asr_{job.id}.wav"
    ffmpeg(["-i", str(path), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)],
           job, info["duration"], (0.0, 0.12), "Extracting audio")
    try:
        name = model_name or get_settings().get("whisper_model") or "small"
        job.update(0.12, f"Loading speech model ({name}); the first run downloads it")
        try:
            model = WhisperModel(name, device="auto", compute_type="auto")
        except Exception as e:
            raise MediaError(f"Could not load the '{name}' speech model (it is downloaded on first use, which needs "
                             f"internet access): {e}") from e
        segments, meta = model.transcribe(str(wav), word_timestamps=True, vad_filter=True, language=language or None)
        words: list[dict] = []
        for seg in segments:
            for w in seg.words or []:
                words.append({"text": w.word, "start": w.start, "end": w.end})
            job.update(0.15 + 0.85 * min(1.0, seg.end / max(1.0, info["duration"])), "Transcribing")
        return {"words": _finish(words), "language": meta.language, "engine": f"whisper-{name}"}
    finally:
        wav.unlink(missing_ok=True)


def youtube_captions(url: str, job: Job, language: str = "en") -> dict:
    """YouTube's word-timed captions (creator-written first, auto-generated otherwise). Fast, no model needed."""
    import urllib.request

    import yt_dlp

    job.update(0.1, "Looking up captions")
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as ydl:
        info = ydl.extract_info(url, download=False)
    tracks = None
    for source in (info.get("subtitles") or {}, info.get("automatic_captions") or {}):
        for code in (language, f"{language}-orig", *[c for c in source if c.startswith(language)]):
            if code in source:
                tracks = source[code]
                break
        if tracks:
            break
    if not tracks:
        raise MediaError(f"No '{language}' captions are available for this video; use Whisper instead.")
    track = next((t for t in tracks if t.get("ext") == "json3"), None)
    if not track:
        raise MediaError("Captions exist but not in a word-timed format; use Whisper instead.")
    job.update(0.5, "Downloading captions")
    with urllib.request.urlopen(track["url"], timeout=60) as r:
        data = json.loads(r.read().decode("utf-8"))
    return {"words": parse_json3(data), "language": language, "engine": "youtube-captions"}


def parse_json3(data: dict) -> list[dict]:
    words: list[dict] = []
    for ev in data.get("events", []):
        base = ev.get("tStartMs", 0)
        dur = ev.get("dDurationMs", 0)
        segs = [s for s in ev.get("segs", []) or [] if s.get("utf8", "").strip()]
        for i, s in enumerate(segs):
            start = (base + s.get("tOffsetMs", 0)) / 1000
            nxt = (base + segs[i + 1].get("tOffsetMs", 0)) / 1000 if i + 1 < len(segs) else (base + dur) / 1000
            pieces = s["utf8"].split()
            span = max(0.08, min(nxt, start + 0.9 * len(pieces)) - start)
            for k, piece in enumerate(pieces):   # creator-written captions put several words in one segment
                a = start + span * k / len(pieces)
                words.append({"text": piece, "start": a, "end": a + span / len(pieces)})
    return _finish(words)


_TS = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})")


def _ts(s: str) -> float:
    m = _TS.search(s)
    if not m:
        raise ValueError(s)
    h, mi, se, ms = m.groups()
    return int(h or 0) * 3600 + int(mi) * 60 + int(se) + int(ms.ljust(3, "0")) / 1000


def parse_cues(text: str) -> list[dict]:
    """SRT or VTT -> words, spreading each cue's time across its words by length."""
    words: list[dict] = []
    for block in re.split(r"\n\s*\n", text.replace("\r", "")):
        lines = [l for l in block.strip().split("\n") if l.strip()]
        idx = next((i for i, l in enumerate(lines) if "-->" in l), None)
        if idx is None:
            continue
        a, b = lines[idx].split("-->")[:2]
        try:
            start, end = _ts(a), _ts(b)
        except ValueError:
            continue
        body = re.sub(r"<[^>]+>|\{[^}]+\}", "", " ".join(lines[idx + 1:])).split()
        total = sum(len(t) + 1 for t in body) or 1
        t = start
        for tok in body:
            d = (end - start) * (len(tok) + 1) / total
            words.append({"text": tok, "start": t, "end": t + d * 0.94})
            t += d
    return _finish(words)


def import_file(name: str, raw: bytes) -> dict:
    text = raw.decode("utf-8-sig", errors="replace")
    if name.lower().endswith(".json"):
        data = json.loads(text)
        if "events" in data:
            return {"words": parse_json3(data), "language": "", "engine": "import-json3"}
        items = data.get("words", data) if isinstance(data, dict) else data
        words = [{"text": w.get("text", w.get("word", w.get("w", ""))),
                  "start": w.get("start", w.get("s", 0)), "end": w.get("end", w.get("e", 0))} for w in items]
        return {"words": _finish(words), "language": "", "engine": "import-json"}
    words = parse_cues(text)
    if not words:
        raise MediaError("No timed captions found in that file (expected SRT, VTT or JSON).")
    return {"words": words, "language": "", "engine": "import-" + name.rsplit(".", 1)[-1].lower()}


def to_srt(words: list[dict], offset: float = 0.0, per_line: int = 8) -> str:
    out = []
    live = [w for w in words if not w.get("removed")]
    n = 1
    for i in range(0, len(live), per_line):
        chunk = live[i:i + per_line]

        def f(t: float) -> str:
            t = max(0.0, t - offset)
            return f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{int(t % 60):02d},{int(t % 1 * 1000):03d}"
        out.append(f"{n}\n{f(chunk[0]['start'])} --> {f(chunk[-1]['end'])}\n{' '.join(w['text'] for w in chunk)}\n")
        n += 1
    return "\n".join(out)
