"""Command-line mode.

  python -m server.cli clip   SOURCE --start 1:35:56 --end 1:43:31 [--format mp4] [--quality 720] [--aspect 9:16]
  python -m server.cli shorts SOURCE [--count 5] [--min 20] [--max 60] [--query "..."] [--transcript captions.srt]

SOURCE is a video link or a local file. Output goes to the data folder (data/clips, data/exports).
"""
from __future__ import annotations

import argparse
import os
import socket
import sys
import threading
import time
from pathlib import Path

from . import jobs
from .config import DATA, ensure_dirs, media_path
from .media import MediaError, parse_time


class ConsoleJob(jobs.Job):
    """A job that prints its progress instead of feeding the web UI."""

    def __init__(self) -> None:
        super().__init__("cli", "cli")
        self._last = ""

    def update(self, progress=None, message=None) -> None:
        super().update(progress, message)
        line = f"  {int(self.progress * 100):3d}%  {self.message}"
        if line != self._last:
            self._last = line
            print(line.ljust(78), end="\r", file=sys.stderr, flush=True)

    def done(self) -> None:
        print(" " * 78, end="\r", file=sys.stderr)


def cmd_clip(a: argparse.Namespace) -> int:
    from .clipper_core import ClipError, ClipSpec, cut_clip, is_url
    source = a.source if is_url(a.source) else str(Path(a.source).expanduser().resolve())
    spec = ClipSpec(source=source, start=parse_time(a.start) if a.start else None, end=parse_time(a.end) if a.end else None,
                    fmt=a.format, quality=a.quality, aspect=a.aspect, mode="fast" if a.fast else "accurate",
                    name=a.name or "", subtitles=a.subtitles)
    job = ConsoleJob()
    try:
        out = cut_clip(spec, DATA / "clips", job)
    except (ClipError, MediaError) as e:
        job.done()
        print(f"Failed: {e}", file=sys.stderr)
        return 1
    job.done()
    print(out["path"])
    for w in out.get("warnings", []):
        print(f"note: {w}", file=sys.stderr)
    return 0


def _serve() -> None:
    """The renderer fetches media over HTTP, so run the API on a free local port for the duration."""
    import uvicorn
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    os.environ["CUTROOM_PORT"] = str(port)
    server = uvicorn.Server(uvicorn.Config("server.main:app", host="127.0.0.1", port=port, log_level="error"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        if server.started:
            return
        time.sleep(0.1)
    raise MediaError("Could not start the local server needed for rendering.")


def cmd_shorts(a: argparse.Namespace) -> int:
    from .routers import projects as api
    from .studio import auto, moments, render, sources, transcribe
    job = ConsoleJob()
    try:
        if a.source.startswith(("http://", "https://")):
            file, info = sources.download(a.source, a.source_quality, job)
            try:
                video = sources.normalise(file, job)
            finally:
                file.unlink(missing_ok=True)
            project = sources.new_project(info.get("title") or "Untitled", video, info.get("webpage_url") or a.source)
        else:
            src = Path(a.source).expanduser().resolve()
            if not src.is_file():
                raise MediaError(f"No such file: {src}")
            project = sources.new_project(src.stem, sources.normalise(src, job), src.name)
        project["created"] = time.time()

        if a.transcript:
            p = Path(a.transcript).expanduser()
            project["transcript"] = transcribe.import_file(p.name, p.read_bytes())
        elif a.engine == "youtube":
            project["transcript"] = transcribe.youtube_captions(project["origin"], job, a.language or "en")
        else:
            project["transcript"] = transcribe.whisper(sources.source_path(project), job, a.model, a.language)
        api.save(project)
        job.done()
        print(f"Transcript: {len(project['transcript']['words'])} words ({project['transcript']['engine']})", file=sys.stderr)

        job.update(0, "Finding moments")
        found = moments.find_moments(project["transcript"]["words"], a.count, a.min, a.max, a.query or "")
        job.done()
        if found["note"]:
            print(f"note: {found['note']}", file=sys.stderr)
        if not found["clips"]:
            print("No moments found.", file=sys.stderr)
            return 1

        _serve()
        scale = 2 / 3 if a.quality == 720 else 1.0
        for n, m in enumerate(found["clips"], 1):
            clip = api._new_clip(project, m["in"], m["out"], m["hook_title"], m)
            auto.auto_edit(project, clip, job, center=not a.no_center, tighten=not a.no_tighten, graphics=not a.no_graphics)
            project["clips"].append(clip)
            api.save(project)
            row = render.render_clip(project, clip, job, scale)
            job.done()
            score = (m.get("score") or {}).get("total", "-")
            print(f"[{n}/{len(found['clips'])}] score {score}  {media_path(row['file'])}")
        print(f"Open the project to refine these: #/studio/{project['id']}", file=sys.stderr)
        return 0
    except MediaError as e:
        job.done()
        print(f"Failed: {e}", file=sys.stderr)
        return 1


def main() -> int:
    ensure_dirs()
    ap = argparse.ArgumentParser(prog="python -m server.cli", description="Cutroom from the command line.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("clip", help="cut one clip from a link or file")
    c.add_argument("source")
    c.add_argument("--start", help="e.g. 1:35:56")
    c.add_argument("--end", help="e.g. 1:43:31")
    c.add_argument("--format", default="mp4", choices=["mp4", "mov", "mp3", "m4a", "gif", "frames"])
    c.add_argument("--quality", type=int, help="maximum height, e.g. 720")
    c.add_argument("--aspect", default="original", choices=["original", "9:16", "1:1", "4:5", "16:9"])
    c.add_argument("--fast", action="store_true", help="snap to keyframes instead of re-encoding")
    c.add_argument("--subtitles", action="store_true", help="also save subtitles (links only)")
    c.add_argument("--name")
    c.set_defaults(fn=cmd_clip)

    s = sub.add_parser("shorts", help="find the best moments in a long video and render them as shorts")
    s.add_argument("source")
    s.add_argument("--count", type=int, default=5)
    s.add_argument("--min", type=float, default=20, help="shortest clip in seconds")
    s.add_argument("--max", type=float, default=60, help="longest clip in seconds")
    s.add_argument("--query", help="only moments about this")
    s.add_argument("--transcript", help="use this SRT/VTT/JSON instead of transcribing")
    s.add_argument("--engine", default="whisper", choices=["whisper", "youtube"])
    s.add_argument("--model", help="Whisper model size")
    s.add_argument("--language")
    s.add_argument("--source-quality", type=int, default=1080, help="download height for links")
    s.add_argument("--quality", type=int, default=1080, choices=[1080, 720])
    s.add_argument("--no-center", action="store_true", help="skip speaker detection")
    s.add_argument("--no-tighten", action="store_true", help="keep pauses and filler words")
    s.add_argument("--no-graphics", action="store_true", help="captions only")
    s.set_defaults(fn=cmd_shorts)

    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
