"""Turning a clip's spec into an MP4 with the Remotion renderer (web/render.mjs)."""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import time

from ..config import DATA, WEB, media_path, media_url
from ..jobs import Cancelled, Job
from ..media import MediaError, copy_to_folder, ffmpeg, probe, safe_name, unique_path
from ..store import Collection
from . import spec as specs


def base_url() -> str:
    return f"http://127.0.0.1:{os.environ.get('CUTROOM_PORT', '8000')}"


def _kill_tree(proc: subprocess.Popen) -> None:
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
        else:
            os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        proc.kill()
    proc.wait()


def _run_node(args: list[str], job: Job, span: tuple[float, float]) -> None:
    node = shutil.which("node")
    if not node:
        raise MediaError("Node.js was not found on PATH; it is needed to render shorts.")
    if not (WEB / "node_modules" / "@remotion" / "renderer").exists():
        raise MediaError("Renderer packages are missing. Run 'npm install' in the web folder.")
    # Own process group, so a cancel also stops the headless browser the renderer started.
    group = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
    proc = subprocess.Popen([node, str(WEB / "render.mjs"), *args], cwd=str(WEB), stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, **group)
    reported = ""
    try:
        assert proc.stdout
        for line in proc.stdout:
            if job.cancelled:
                raise Cancelled()
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("error"):
                reported = str(msg["error"])
                continue
            job.update(span[0] + (span[1] - span[0]) * float(msg.get("progress", 0)), msg.get("stage"))
        proc.wait()
    finally:
        if proc.poll() is None:
            _kill_tree(proc)
    if proc.returncode != 0:
        if not reported:
            err = (proc.stderr.read() if proc.stderr else "").strip().splitlines()
            reported = next((l.strip() for l in err if l.strip().startswith("Error")), err[-1] if err else "unknown error")
        if "Could not download Chrome" in reported:
            reported = ("the renderer could not download its browser (needed once, about 100 MB). "
                        "Check the internet connection and export again.")
        raise MediaError("Render failed: " + reported[:400])


def render_clip(project: dict, clip: dict, job: Job, scale: float = 1.0, crf: int = 18) -> dict:
    """Render one clip and record it in the exports collection. Returns the export row."""
    spec = clip["spec"]
    source = media_path(spec["src"])
    work = DATA / "tmp" / f"render_{job.id}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        # 1. A trimmed, quick-to-seek copy of just this clip's range, so the renderer never touches the full source.
        offset = max(0.0, spec["in"] - 0.5)
        length = spec["out"] - offset + 0.5
        proxy = work / "source.mp4"
        ffmpeg(["-ss", f"{offset:.3f}", "-t", f"{length:.3f}", "-i", str(source), "-map", "0:v:0", "-map", "0:a:0?",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-g", "15", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(proxy)],
               job, length, (0.0, 0.12), "Preparing source")
        render_spec = specs.for_render(spec, offset, base_url(), base_url() + media_url(proxy))
        spec_file = work / "spec.json"
        spec_file.write_text(json.dumps(render_spec), "utf-8")

        # 2. Render.
        title = clip.get("title") or project["name"]
        out = unique_path(DATA / "exports", safe_name(title, "short"), "mp4")
        tmp_out = work / "out.mp4"
        _run_node(["--spec", str(spec_file), "--out", str(tmp_out), "--scale", str(scale), "--crf", str(crf)], job, (0.12, 0.97))
        shutil.move(str(tmp_out), str(out))

        # 3. Cover frame + bookkeeping.
        info = probe(out)
        cover = out.with_suffix(".jpg")
        try:
            ffmpeg(["-ss", f"{min(1.0, info['duration'] / 2):.2f}", "-i", str(out), "-frames:v", "1", "-q:v", "3", str(cover)])
        except MediaError:
            cover = None
        copied = None
        try:
            copied = copy_to_folder(out)
        except MediaError as e:
            job.update(message=str(e))
        row = Collection("exports").insert({
            "project_id": project["id"], "clip_id": clip["id"], "title": title, "file": media_url(out),
            "cover": media_url(cover) if cover else "", "duration": info["duration"], "width": info["width"],
            "height": info["height"], "fps": info["fps"], "size": info["size"], "status": clip.get("status", "draft"),
            "source_origin": project.get("origin", ""), "source_in": spec["in"], "source_out": spec["out"],
            "meta": clip.get("meta") or {"title": title, "description": "", "hashtags": []},
            "transcript_text": specs.transcript_text(spec), "copied_to": copied, "rendered": time.time(),
        })
        return row
    finally:
        shutil.rmtree(work, ignore_errors=True)


def clean_voice(project: dict, clip: dict, job: Job) -> dict:
    """Denoise, even out and normalise the clip's speech into its own audio file."""
    spec = clip["spec"]
    source = media_path(spec["src"])
    if not probe(source)["has_audio"]:
        raise MediaError("This video has no audio to clean.")
    offset = max(0.0, spec["in"] - 0.5)
    length = spec["out"] - offset + 0.5
    folder = DATA / "projects" / project["id"]
    folder.mkdir(parents=True, exist_ok=True)
    out = folder / f"voice_{clip['id']}_{int(time.time())}.m4a"
    chain = ("highpass=f=70,afftdn=nf=-25,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,"
             "loudnorm=I=-15:TP=-1.5:LRA=11")
    ffmpeg(["-ss", f"{offset:.3f}", "-t", f"{length:.3f}", "-i", str(source), "-vn", "-af", chain, "-ar", "48000",
            "-c:a", "aac", "-b:a", "192k", str(out)], job, length, (0.0, 1.0), "Cleaning audio")
    for old in folder.glob(f"voice_{clip['id']}_*.m4a"):
        if old != out:
            old.unlink(missing_ok=True)
    return {"cleanSrc": media_url(out), "cleanOffset": round(offset, 3)}
