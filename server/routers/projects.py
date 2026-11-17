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
from ..studio import ai, cliptypes, moments, profiles as styles, render, sources, spec as specs, transcribe, vision

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

def _performance() -> dict | None:
    """What has done well among the posts tracked in Agency, or None when there are too few with views."""
    from .. import agency_core
    from .agency import all_videos
    return agency_core.performance_summary(Collection("agency_posts").all(), all_videos())


@router.get("/{pid}/moments/performance")
def moments_performance(pid: str) -> dict:
    """{posts: n} when past views will steer Find moments, {posts: 0} when there are not enough (or no AI to use them)."""
    load(pid)
    perf = _performance() if ai.available() else None
    return {"posts": perf["count"] if perf else 0}


@router.post("/{pid}/moments")
def find_moments(pid: str, body: dict) -> dict:
    """{kind?: highlights|series|topic|recap|trailer, count, min_len, max_len, query?, instructions?, template_id?, profile_id?}"""
    project = load(pid)
    if not project.get("transcript"):
        raise HTTPException(422, "Transcribe the video first.")
    kind = body.get("kind") or "highlights"
    if kind not in cliptypes.KINDS:
        raise HTTPException(422, f"Unknown clip type: {kind}.")
    if kind == "topic" and not (body.get("query") or "").strip():
        raise HTTPException(422, "Type the topic to look for.")
    try:
        min_len, max_len = float(body.get("min_len") or 20), float(body.get("max_len") or 60)
        int(body.get("count") or 6)
    except (TypeError, ValueError):
        raise HTTPException(422, "The lengths and the number of clips must be numbers.")
    if max_len < min_len:
        raise HTTPException(422, "The longest length must be at least the shortest.")
    template = Collection("templates").get(body["template_id"]) if body.get("template_id") else None
    style = styles.lookup(body.get("profile_id"))
    brief, rules = styles.guidance(body.get("profile_id"))
    label = {"highlights": "Finding moments", "series": "Planning the series", "topic": "Finding the topic",
             "recap": "Building the recap", "trailer": "Building the trailer"}[kind]

    def work(job: jobs.Job) -> dict:
        perf = _performance() if ai.available() else None
        job.update(0.1, "Reading the transcript" + (" with AI" if ai.available() else ""))
        found = cliptypes.find(project["transcript"]["words"], kind, int(body.get("count") or 6), min_len, max_len,
                               body.get("query") or "", body.get("instructions") or "", brief, rules, perf)
        job.update(0.9, "Creating clips")

        def add(p: dict) -> None:
            for m in found["clips"]:
                clip = _new_clip(p, m["in"], m["out"], m["hook_title"], m, (style or {}).get("style") or (template or {}).get("spec"))
                if m.get("segments"):
                    cliptypes.apply_ranges(clip["spec"], m["segments"])
                clip["kind"] = kind
                if style:
                    clip["profile_id"] = style["id"]
                p["clips"].append(clip)
        mutate(pid, add)
        return {"added": len(found["clips"]), "engine": found["engine"], "note": found["note"],
                "performance_posts": perf["count"] if perf else 0}

    return {"job_id": jobs.submit("moments", label, work).id}


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
                     lambda p, c, j: moments.remix(c["spec"]["words"], float(body.get("density") or 1.0), c["title"], *styles.guidance(c.get("profile_id")),
                                                 limits=styles.limits(c.get("profile_id"))))


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
        raise HTTPException(422, "Planning from the picture needs the AI: only a model can see what happens in the clip. " + ai.setup_hint())

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
        has_title = any(g.get("origin") == "style" and g.get("type") == "label" and g.get("duration", 0) > duration * 0.6 for g in spec.get("graphics") or [])
        return moments.direct(frames, words, duration, brief, rules, clip["title"], limits=styles.limits(clip.get("profile_id")), has_title=has_title)

    return _clip_job(pid, cid, "direct", "Planning the edit from the picture", plan)


@router.post("/{pid}/clips/{cid}/split")
def split_clip(pid: str, cid: str, body: dict) -> dict:
    """{t: source time} -> {first, second}: the clip becomes the part before t, and a new clip right after it holds the rest."""
    from ..studio import clipops
    try:
        t = float(body["t"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(422, "Say where to split.")
    holder: dict = {}

    def work(p: dict) -> None:
        clip = _clip(p, cid)
        try:
            a, b = clipops.split(clip["spec"], t)
        except MediaError as e:
            raise HTTPException(422, str(e))
        second = _new_clip(p, b["in"], b["out"], f"{clip['title']} (part 2)")
        second.update(spec=b, profile_id=clip.get("profile_id"), meta=dict(clip.get("meta") or {}), status=clip.get("status", "draft"))
        clip["spec"] = a
        p["clips"].insert(p["clips"].index(clip) + 1, second)
        holder.update(first=clip, second=second)
    mutate(pid, work)
    return holder


@router.post("/{pid}/clips/merge")
def merge_clips(pid: str, body: dict) -> dict:
    """{ids: [clip ids], title?} -> the new clip: the kept parts of all of them in time order. The originals stay."""
    from ..studio import clipops
    ids = list(dict.fromkeys(str(i) for i in body.get("ids") or []))   # the same clip twice is one clip
    holder: dict = {}

    def work(p: dict) -> None:
        clips = [_clip(p, i) for i in ids]
        try:
            spec = clipops.merge([c["spec"] for c in clips])
        except MediaError as e:
            raise HTTPException(422, str(e))
        first = min(clips, key=lambda c: c["spec"]["in"])
        clip = _new_clip(p, spec["in"], spec["out"], str(body.get("title") or f"{first['title']} + {len(clips) - 1} more"))
        clip.update(spec=spec, profile_id=first.get("profile_id"), meta=dict(first.get("meta") or {}))
        p["clips"].append(clip)
        holder["clip"] = clip
    mutate(pid, work)
    return holder["clip"]


@router.post("/{pid}/clips/{cid}/ask")
def ask_clip(pid: str, cid: str, body: dict) -> dict:
    """{request, spec} -> job -> {changes: [...], reply, engine}: a plain-language edit turned into typed changes that the
    editor applies (as one undoable step). The spec is the editor's current one, so unsaved changes are seen too."""
    request = str(body.get("request") or "").strip()
    spec = body.get("spec")
    if not request:
        raise HTTPException(422, "Say what to change.")
    if len(request) > 2000:
        raise HTTPException(422, "That request is too long (2,000 characters at most).")
    if not isinstance(spec, dict) or "words" not in spec:
        raise HTTPException(422, "Send the clip as it is now.")
    if not ai.available():
        raise HTTPException(422, "Editing by asking needs the AI. " + ai.setup_hint())
    project = load(pid)
    _clip(project, cid)

    def work(job: jobs.Job) -> dict:
        from ..studio import ask
        job.update(0.2, f"Working out the change with {ai.provider_label()}")
        try:
            return ask.plan(spec, request)
        except ai.AIUnavailable as e:
            raise MediaError(str(e)) from e

    return {"job_id": jobs.submit("ask", "Editing by asking", work, {"project_id": pid, "clip_id": cid}).id}


@router.post("/{pid}/clips/{cid}/subject")
def subject_outline(pid: str, cid: str, body: dict) -> dict:
    """{t, box: [x0, y0, x1, y1] (0..1 of the source), find?: bool} -> job ->
    {keys: [{t, pts: [[x, y], ...]}], box, found, how}: the outline of the person or object under a spotlight."""
    try:
        t = float(body["t"])
        box = tuple(float(v) for v in body["box"])
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
        return subject.outline(sources.source_path(project), t, box, find, job)

    return {"job_id": jobs.submit("subject", "Fitting the spotlight", work, {"project_id": pid, "clip_id": cid}).id}


@router.post("/{pid}/clips/{cid}/translate")
def translate_clip(pid: str, cid: str, body: dict) -> dict:
    language = (body.get("language") or "").strip()
    lines = body.get("lines") or []
    if not language or not lines:
        raise HTTPException(422, "Give a language and the caption lines to translate.")
    if not ai.available():
        raise HTTPException(422, "Translation needs the AI. " + ai.setup_hint())
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


class _ClipSlice:
    """One clip's render inside an export-all job: its progress fills its share of the bar, and a cancel of the
    whole job stops it."""

    def __init__(self, job: jobs.Job, index: int, total: int, title: str):
        self.job, self.index, self.total, self.title = job, index, total, title
        self.id = f"{job.id}_{index}"

    @property
    def cancelled(self) -> bool:
        return self.job.cancelled

    def update(self, progress: float | None = None, message: str | None = None) -> None:
        p = None if progress is None else (self.index + max(0.0, min(1.0, progress))) / self.total
        head = f"Exporting {self.index + 1} of {self.total}"
        self.job.update(p, f"{head}: {message}" if message else (None if self.job.message.startswith(head) else f"{head}: {self.title}"))


@router.post("/{pid}/render-all")
def render_all(pid: str, body: dict) -> dict:
    """Render every clip of the project, one after another, in one job. {quality?: '1080'|'720'} ->
    job -> {exported: [export rows], failed: [{clip_id, title, error}]}"""
    project = load(pid)
    ids = [c["id"] for c in sorted(project["clips"], key=lambda c: c["spec"]["in"])]
    if not ids:
        raise HTTPException(422, "This project has no clips to export yet.")
    scale = 2 / 3 if str(body.get("quality", "1080")) == "720" else 1.0

    def work(job: jobs.Job) -> dict:
        exported, failed = [], []
        for i, cid in enumerate(ids):
            current = load(pid)   # pick up edits saved since the export was queued
            clip = next((c for c in current["clips"] if c["id"] == cid), None)
            if not clip:
                continue
            part = _ClipSlice(job, i, len(ids), clip["title"])
            part.update(0.0)
            try:
                exported.append(render.render_clip(current, clip, part, scale))  # type: ignore[arg-type]
            except MediaError as e:
                failed.append({"clip_id": cid, "title": clip["title"], "error": str(e)})
        if failed and not exported:
            raise MediaError(f"None of the clips exported. {failed[0]['title']}: {failed[0]['error']}")
        job.update(1.0, f"Exported {len(exported)} of {len(ids)} clips")
        return {"exported": exported, "failed": failed}

    return {"job_id": jobs.submit("render", "Exporting all clips", work, {"project_id": pid}).id}
