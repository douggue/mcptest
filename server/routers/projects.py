"""Shorts studio API: projects (one long video each), their transcript, and their clips."""
from __future__ import annotations

import copy
import json
import shutil
import threading
import time
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse

from .. import jobs
from ..config import DATA, media_path
from ..media import MediaError, safe_name
from ..store import Collection, new_id
from ..studio import ai, moments, profiles as styles, render, sources, spec as specs, transcribe, vision

router = APIRouter(prefix="/api/projects", tags=["studio"])
_locks: dict[str, threading.RLock] = {}


def _file(pid: str) -> Path:
    return DATA / "projects" / pid / "project.json"


def load(pid: str) -> dict:
    f = _file(pid)
    if not f.exists():
        raise HTTPException(404, "project not found")
    return json.loads(f.read_text("utf-8"))


def save(project: dict) -> None:
    f = _file(project["id"])
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(project), "utf-8")
    tmp.replace(f)


def mutate(pid: str, fn) -> dict:
    """Read-modify-write under a per-project lock (autosave and background jobs both write)."""
    with _locks.setdefault(pid, threading.RLock()):
        project = load(pid)
        fn(project)
        project["updated"] = time.time()
        save(project)
        return project


def _clip(project: dict, cid: str) -> dict:
    clip = next((c for c in project["clips"] if c["id"] == cid), None)
    if not clip:
        raise HTTPException(404, "clip not found")
    return clip


def _summary(p: dict) -> dict:
    t = p.get("transcript")
    return {"id": p["id"], "name": p["name"], "origin": p.get("origin", ""), "created": p.get("created", 0),
            "source": {k: p["source"][k] for k in ("url", "duration", "width", "height", "fps", "poster")},
            "words": len(t["words"]) if t else 0, "engine": t["engine"] if t else "",
            "clips": [{"id": c["id"], "title": c["title"], "score": c.get("score"), "in": c["spec"]["in"],
                       "out": c["spec"]["out"], "status": c.get("status", "draft")} for c in p["clips"]]}


def _new_clip(project: dict, t_in: float, t_out: float, title: str, extra: dict | None = None,
              template: dict | None = None) -> dict:
    extra = extra or {}
    return {
        "id": new_id("c_"), "title": title, "created": time.time(), "status": "draft",
        "reason": extra.get("reason", ""), "score": extra.get("score"),
        "meta": {"title": extra.get("title", title), "description": extra.get("description", ""),
                 "hashtags": extra.get("hashtags", [])},
        "spec": specs.default_spec(project, t_in, t_out, extra.get("hook_title", ""), template),
    }


# ---------------------------------------------------------------- projects

@router.get("")
def list_projects() -> list[dict]:
    out = []
    for f in (DATA / "projects").glob("*/project.json"):
        try:
            out.append(_summary(json.loads(f.read_text("utf-8"))))
        except (json.JSONDecodeError, KeyError):
            continue
    return sorted(out, key=lambda p: p["created"], reverse=True)


def _create(name: str, video: Path, origin: str) -> dict:
    project = sources.new_project(name, video, origin)
    project["created"] = time.time()
    save(project)
    return {"project_id": project["id"]}


@router.post("")
def create_project(body: dict) -> dict:
    """{url, quality?} downloads a video; {media_url, name?} adopts a file Cutroom already has (e.g. a clipper clip)."""
    url = (body.get("url") or "").strip()
    media = (body.get("media_url") or "").strip()
    if not url and not media:
        raise HTTPException(422, "Give a video URL or a media_url.")

    def work(job: jobs.Job) -> dict:
        if url:
            file, info = sources.download(url, int(body.get("quality") or 1080), job)
            try:
                video = sources.normalise(file, job, (0.92, 1.0))
            finally:
                file.unlink(missing_ok=True)
            return _create(body.get("name") or info.get("title") or "Untitled", video, info.get("webpage_url") or url)
        src = media_path(media)
        if not src.is_file():
            raise MediaError("That file no longer exists.")
        video = sources.normalise(src, job)
        return _create(body.get("name") or src.stem, video, body.get("origin") or src.name)

    return {"job_id": jobs.submit("import", "Importing video", work).id}


@router.post("/upload")
def upload_project(file: UploadFile = File(...)) -> dict:
    name = Path(file.filename or "upload.mp4").name
    tmp = DATA / "tmp" / f"{new_id('up_')}{Path(name).suffix or '.mp4'}"
    with open(tmp, "wb") as f:
        shutil.copyfileobj(file.file, f)

    def work(job: jobs.Job) -> dict:
        try:
            video = sources.normalise(tmp, job)
        finally:
            tmp.unlink(missing_ok=True)
        return _create(Path(name).stem, video, name)

    return {"job_id": jobs.submit("import", f"Importing {name}", work).id}


@router.get("/{pid}")
def get_project(pid: str) -> dict:
    return load(pid)


@router.patch("/{pid}")
def rename_project(pid: str, body: dict) -> dict:
    name = safe_name(body.get("name", ""), "")
    if not name:
        raise HTTPException(422, "Name cannot be empty.")
    return _summary(mutate(pid, lambda p: p.update(name=name)))


@router.delete("/{pid}")
def delete_project(pid: str) -> dict:
    project = load(pid)
    sources.remove_project_files(project)
    return {"ok": True}


# ---------------------------------------------------------------- transcript

def _set_transcript(pid: str, result: dict) -> dict:
    mutate(pid, lambda p: p.update(transcript=result))
    return {"words": len(result["words"]), "engine": result["engine"]}


@router.post("/{pid}/transcribe")
def transcribe_project(pid: str, body: dict) -> dict:
    project = load(pid)
    engine = body.get("engine", "whisper")

    def work(job: jobs.Job) -> dict:
        if engine == "youtube":
            if not project.get("origin", "").startswith("http"):
                raise MediaError("This project was not imported from a URL, so there are no online captions to fetch.")
            result = transcribe.youtube_captions(project["origin"], job, body.get("language") or "en")
        else:
            result = transcribe.whisper(sources.source_path(project), job, body.get("model"), body.get("language"))
        if not result["words"]:
            raise MediaError("No speech was found.")
        return _set_transcript(pid, result)

    return {"job_id": jobs.submit("transcribe", "Transcribing", work).id}


@router.post("/{pid}/transcript")
async def import_transcript(pid: str, file: UploadFile = File(...)) -> dict:
    load(pid)
    try:
        result = transcribe.import_file(file.filename or "captions.srt", await file.read())
    except (MediaError, ValueError, KeyError, TypeError) as e:
        raise HTTPException(422, f"Could not read that transcript: {e}")
    return _set_transcript(pid, result)


@router.get("/{pid}/transcript.srt", response_class=PlainTextResponse)
def export_transcript(pid: str) -> str:
    t = load(pid).get("transcript")
    if not t:
        raise HTTPException(404, "no transcript yet")
    return transcribe.to_srt(t["words"])


# ---------------------------------------------------------------- clips

@router.post("/{pid}/moments")
def find_moments(pid: str, body: dict) -> dict:
    project = load(pid)
    if not project.get("transcript"):
        raise HTTPException(422, "Transcribe the video first.")
    template = Collection("templates").get(body["template_id"]) if body.get("template_id") else None
    style = styles.lookup(body.get("profile_id"))
    brief, rules = styles.guidance(body.get("profile_id"))

    def work(job: jobs.Job) -> dict:
        job.update(0.1, "Reading the transcript" + (" with AI" if ai.available() else ""))
        found = moments.find_moments(project["transcript"]["words"], int(body.get("count") or 6),
                                     float(body.get("min_len") or 20), float(body.get("max_len") or 60),
                                     body.get("query") or "", brief, rules)
        job.update(0.9, "Creating clips")

        def add(p: dict) -> None:
            for m in found["clips"]:
                clip = _new_clip(p, m["in"], m["out"], m["hook_title"], m, (style or {}).get("style") or (template or {}).get("spec"))
                if style:
                    clip["profile_id"] = style["id"]
                p["clips"].append(clip)
        mutate(pid, add)
        return {"added": len(found["clips"]), "engine": found["engine"], "note": found["note"]}

    return {"job_id": jobs.submit("moments", "Finding moments", work).id}


@router.post("/{pid}/clips")
def add_clip(pid: str, body: dict) -> dict:
    project = load(pid)
    t_in = max(0.0, float(body.get("in", 0)))
    t_out = min(project["source"]["duration"], float(body.get("out", t_in + 30)))
    if t_out - t_in < 1:
        raise HTTPException(422, "A clip must be at least one second long.")
    template = Collection("templates").get(body["template_id"]) if body.get("template_id") else None
    holder: dict = {}

    def add(p: dict) -> None:
        holder["clip"] = _new_clip(p, t_in, t_out, body.get("title") or "New clip", None, (template or {}).get("spec"))
        p["clips"].append(holder["clip"])
    mutate(pid, add)
    return holder["clip"]


@router.put("/{pid}/clips/{cid}")
def save_clip(pid: str, cid: str, body: dict) -> dict:
    def apply(p: dict) -> None:
        clip = _clip(p, cid)
        for key in ("spec", "title", "meta", "status", "profile_id"):
            if key in body:
                clip[key] = body[key]
    return {"ok": True, "updated": mutate(pid, apply)["updated"]}


@router.post("/{pid}/clips/{cid}/duplicate")
def duplicate_clip(pid: str, cid: str) -> dict:
    holder: dict = {}

    def dup(p: dict) -> None:
        c = copy.deepcopy(_clip(p, cid))
        c.update(id=new_id("c_"), title=c["title"] + " (copy)", created=time.time(), status="draft")
        p["clips"].append(c)
        holder["clip"] = c
    mutate(pid, dup)
    return holder["clip"]


@router.delete("/{pid}/clips/{cid}")
def delete_clip(pid: str, cid: str) -> dict:
    def rm(p: dict) -> None:
        _clip(p, cid)
        p["clips"] = [c for c in p["clips"] if c["id"] != cid]
    mutate(pid, rm)
    return {"ok": True}


# ---------------------------------------------------------------- per-clip tools (results are applied by the editor)

@router.post("/{pid}/clips/{cid}/analyse")
def analyse_clip(pid: str, cid: str, body: dict) -> dict:
    """Find cuts and faces. {detect_cuts: bool, track: bool, cuts?: [seconds]} -> job -> {engine, shots:[{start,end,faces,track}]}"""
    project = load(pid)
    clip = _clip(project, cid)
    src = sources.source_path(project)
    t_in, t_out = clip["spec"]["in"], clip["spec"]["out"]

    def work(job: jobs.Job) -> dict:
        if body.get("detect_cuts", True):
            job.update(0.02, "Looking for camera cuts")
            cuts = vision.detect_cuts(src, t_in, t_out)
        else:
            cuts = sorted(float(c) for c in body.get("cuts", []) if t_in < float(c) < t_out)
        bounds = [t_in, *cuts, t_out]
        ranges = list(zip(bounds, bounds[1:]))
        sub = jobs.Job("x", "x")
        sub.update = lambda p=None, m=None: job.update(None if p is None else 0.15 + 0.85 * p, m)  # type: ignore
        result = vision.analyse_shots(src, ranges, sub, bool(body.get("track")))
        return {"engine": result["engine"],
                "shots": [{"start": a, "end": b, **s} for (a, b), s in zip(ranges, result["shots"])]}

    return {"job_id": jobs.submit("analyse", "Analysing picture", work).id}


def _clip_job(pid: str, cid: str, kind: str, title: str, fn) -> dict:
    project = load(pid)
    clip = _clip(project, cid)

    def work(job: jobs.Job) -> dict:
        job.update(0.15, title + (" with AI" if ai.available() else ""))
        try:
            return fn(project, clip, job)
        except ai.AIUnavailable as e:
            raise MediaError(str(e)) from e

    return {"job_id": jobs.submit(kind, title, work).id}


@router.post("/{pid}/clips/{cid}/remix")
def remix_clip(pid: str, cid: str, body: dict) -> dict:
    return _clip_job(pid, cid, "remix", "Planning the edit",
                     lambda p, c, j: moments.remix(c["spec"]["words"], float(body.get("density") or 1.0), c["title"], *styles.guidance(c.get("profile_id"))))


@router.post("/{pid}/clips/{cid}/meta")
def meta_clip(pid: str, cid: str) -> dict:
    return _clip_job(pid, cid, "meta", "Writing title and description",
                     lambda p, c, j: moments.post_meta(c["spec"]["words"], c["spec"]["hook"]["text"], *styles.guidance(c.get("profile_id"))))


@router.post("/{pid}/clips/{cid}/hooks")
def hooks_clip(pid: str, cid: str) -> dict:
    return _clip_job(pid, cid, "hooks", "Writing hook ideas",
                     lambda p, c, j: moments.hook_ideas(c["spec"]["words"], 5, *styles.guidance(c.get("profile_id"))))


@router.post("/{pid}/clips/{cid}/direct")
def direct_clip(pid: str, cid: str) -> dict:
    """Plan a story edit by looking at the clip itself: labels, callouts, freezes and speed changes, in the clip's style."""
    if not ai.available():
        raise HTTPException(422, "Planning from the picture needs an AI key (Settings → AI): only a model can see what happens in the clip.")

    def plan(project: dict, clip: dict, job: jobs.Job) -> dict:
        spec = clip["spec"]
        t_in, t_out = spec["in"], spec["out"]
        duration = t_out - t_in
        n = int(max(6, min(24, duration / 1.5)))
        src = sources.source_path(project)
        job.update(0.2, "Looking at the clip")
        frames = [(t - t_in, jpeg) for t, jpeg in styles._frames(src, duration, n, start=t_in)]
        words = [{**w, "start": w["start"] - t_in, "end": w["end"] - t_in} for w in spec["words"]]
        brief, rules = styles.guidance(clip.get("profile_id"))
        job.update(0.45, f"Planning the edit with {ai.provider_label()}")
        return moments.direct(frames, words, duration, brief, rules, clip["title"])

    return _clip_job(pid, cid, "direct", "Planning the edit from the picture", plan)


@router.post("/{pid}/clips/{cid}/subject")
def subject_outline(pid: str, cid: str, body: dict) -> dict:
    """{t, box: [x0, y0, x1, y1] (0..1 of the source), find?: bool, until?: source time} -> job ->
    {keys: [{t, pts: [[x, y], ...]}], box, found}: the outline of the person or object under a spotlight."""
    try:
        t = float(body["t"])
        box = tuple(float(v) for v in body["box"])
        until = float(body["until"]) if body.get("until") not in (None, "") else None
    except (KeyError, TypeError, ValueError):
        raise HTTPException(422, "Send the time and the box to look in.")
    if len(box) != 4:
        raise HTTPException(422, "The box needs four numbers.")
    find = bool(body.get("find"))

    project = load(pid)
    _clip(project, cid)

    def work(job: jobs.Job) -> dict:
        from ..studio import subject
        job.update(0.05, "Finding the person" if find else "Tracing the outline")
        return subject.outline(sources.source_path(project), t, box, find, until, job)

    return {"job_id": jobs.submit("subject", "Fitting the spotlight", work, {"project_id": pid, "clip_id": cid}).id}


@router.post("/{pid}/clips/{cid}/translate")
def translate_clip(pid: str, cid: str, body: dict) -> dict:
    language = (body.get("language") or "").strip()
    lines = body.get("lines") or []
    if not language or not lines:
        raise HTTPException(422, "Give a language and the caption lines to translate.")
    if not ai.available():
        raise HTTPException(422, "Translation needs an AI key (Settings → AI).")
    return _clip_job(pid, cid, "translate", f"Translating captions to {language}",
                     lambda p, c, j: moments.translate_lines(lines, language))


@router.post("/{pid}/clips/{cid}/clean-audio")
def clean_audio(pid: str, cid: str) -> dict:
    project = load(pid)
    clip = _clip(project, cid)
    return {"job_id": jobs.submit("clean", "Cleaning audio", lambda job: render.clean_voice(project, clip, job)).id}


@router.post("/{pid}/clips/{cid}/render")
def render_clip(pid: str, cid: str, body: dict) -> dict:
    project = load(pid)
    clip = _clip(project, cid)
    scale = 2 / 3 if str(body.get("quality", "1080")) == "720" else 1.0
    upscale = body.get("upscale") is True
    if upscale:
        from ..studio import upscale as ai_upscale
        if not ai_upscale.available():
            raise HTTPException(422, "AI upscaling needs two packages: pip install onnx onnxruntime, then restart Cutroom.")

    def work(job: jobs.Job) -> dict:
        return render.render_clip(project, clip, job, scale, int(body.get("crf") or 18), upscale)

    return {"job_id": jobs.submit("render", f"Exporting {clip['title']}", work, {"project_id": pid, "clip_id": cid}).id}
