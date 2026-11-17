"""Optional connector to flow-mcp (https://github.com/GTAI-1/flow-mcp), desktop edition only.

flow-mcp is a separate program the user installs. It drives Google Flow through a Chrome window signed in as the
user, and speaks MCP over stdio. Cutroom acts as an MCP client: it starts `node <folder>/dist/index.js`, asks for
stills, clips or narration, waits, and copies the finished files into the Library.

This is OFF by default. flow-mcp's own README says automated use of Flow may be against Google's terms; Cutroom only
passes requests through at flow-mcp's own pace and does nothing to hide or speed up that automation.
"""
from __future__ import annotations

import asyncio
import json
import os
import shlex
import shutil
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from .. import auth
from ..config import DATA, get_settings, media_url
from ..jobs import Cancelled, Job
from ..media import safe_name, unique_path
from ..store import Collection

PROJECT = "Cutroom"                       # sub-folder of flow-mcp's output root that our requests land in
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXT = {".mp4", ".mov", ".webm"}
AUDIO_EXT = {".m4a", ".mp3", ".wav", ".ogg"}
IMAGE_ASPECTS = ("16:9", "9:16", "1:1", "4:3", "3:4")
VIDEO_ASPECTS = ("16:9", "9:16")
DURATIONS = (4, 6, 8, 10)
CALL_TIMEOUT = 80.0                       # flow-mcp answers every call within about 45 s, slow ones with a task id

_tools: list[str] = []                    # tool names of the installed flow-mcp, from the last successful connection
imports = Collection("flow_imports")


class FlowError(RuntimeError):
    """Something the user can read and act on."""


# ---------------------------------------------------------------- availability

def enabled() -> bool:
    return bool(get_settings().get("flow_enabled"))


def server_edition() -> bool:
    return auth.enabled()


def out_dir() -> Path:
    custom = (get_settings().get("flow_out_dir") or "").strip()
    return Path(custom).expanduser() if custom else Path.home() / "flow-mcp-out"


def _command() -> tuple[str, list[str]] | None:
    """How to start flow-mcp: `node <folder>/dist/index.js` (CUTROOM_FLOW_CMD replaces it, for tests)."""
    override = os.environ.get("CUTROOM_FLOW_CMD")
    if override:
        parts = shlex.split(override)
        return parts[0], parts[1:]
    folder = (get_settings().get("flow_mcp_path") or "").strip()
    node = shutil.which("node")
    if not folder or not node:
        return None
    return node, [str(Path(folder).expanduser() / "dist" / "index.js")]


def why_not_import() -> str:
    """Reason the folder import cannot be used, or '' when it can. It needs no running flow-mcp."""
    if server_edition():
        return "Flow is part of the desktop edition. It needs a Chrome window on your own computer, so it is not available on a server."
    if not enabled():
        return "The Flow connector is turned off. Turn it on under Settings → Google Flow."
    return ""


def why() -> str:
    """Reason flow-mcp cannot be used right now, or '' when it can."""
    reason = why_not_import()
    if reason:
        return reason
    if os.environ.get("CUTROOM_FLOW_CMD"):
        return ""
    folder = (get_settings().get("flow_mcp_path") or "").strip()
    if not folder:
        return "Set the flow-mcp folder under Settings → Google Flow."
    path = Path(folder).expanduser()
    if not path.is_dir():
        return f"The flow-mcp folder does not exist: {path}"
    if not (path / "dist" / "index.js").is_file():
        return f"flow-mcp is not built yet. In {path}, run: npm install, then npm run build."
    if not shutil.which("node"):
        return "Node.js was not found on PATH; flow-mcp needs it."
    return ""


def available() -> bool:
    return not why()


def state() -> dict:
    root = out_dir()
    return {
        "enabled": enabled(), "available": available(), "why": why(), "can_import": not why_not_import(),
        "server_edition": server_edition(), "tools": list(_tools), "path": (get_settings().get("flow_mcp_path") or ""),
        "out_dir": str(root), "out_dir_exists": root.is_dir(),
    }


# ---------------------------------------------------------------- MCP plumbing

def _field(obj: Any, snake: str, camel: str, default: Any = None) -> Any:
    """The MCP package renamed its fields between major versions (isError -> is_error); read either."""
    value = getattr(obj, snake, None)
    return getattr(obj, camel, default) if value is None else value


def _flatten(err: BaseException) -> BaseException:
    """anyio reports a failure inside its task groups as an exception group; dig out the real cause."""
    while getattr(err, "exceptions", None):
        err = err.exceptions[0]  # type: ignore[attr-defined]
    return err


def _run(work: Callable[[Any], Awaitable[Any]], timeout: float) -> Any:
    """Start flow-mcp, run `work(session)` against it, and shut it down again. One process per operation, because
    flow-mcp's queue and its task ids only live as long as the process that issued them."""
    reason = why()
    if reason:
        raise FlowError(reason)
    try:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
    except ImportError as e:
        raise FlowError("The Flow connector needs the 'mcp' package: pip install mcp") from e
    command, args = _command()  # type: ignore[misc]
    env = dict(os.environ)
    if (get_settings().get("flow_out_dir") or "").strip():
        env["FLOW_MCP_OUTPUT"] = str(out_dir())
    log = DATA / "tmp" / "flow-mcp.log"
    log.parent.mkdir(parents=True, exist_ok=True)

    async def go() -> Any:
        global _tools
        with open(log, "a", encoding="utf-8", errors="replace") as errlog:
            async with stdio_client(StdioServerParameters(command=command, args=args, env=env), errlog=errlog) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    _tools = sorted(t.name for t in (await session.list_tools()).tools)
                    return await work(session)

    try:
        return asyncio.run(asyncio.wait_for(go(), timeout))
    except (FlowError, Cancelled):
        raise
    except asyncio.TimeoutError as e:
        raise FlowError("flow-mcp did not answer in time. Anything it finished is still in Flow; use Import to collect it.") from e
    except BaseException as e:  # noqa: BLE001 - anyio wraps failures in exception groups
        inner = _flatten(e)
        if isinstance(inner, (FlowError, Cancelled)):
            raise inner from None
        if isinstance(inner, (KeyboardInterrupt, SystemExit)):
            raise
        if isinstance(inner, FileNotFoundError):
            raise FlowError(f"Could not start flow-mcp: {command} was not found.") from e
        if inner.__class__.__name__.lower() == "mcperror" and "connection closed" not in str(inner).lower():
            raise FlowError(f"flow-mcp refused the request: {str(inner)[:300]}") from e
        raise FlowError(f"flow-mcp stopped unexpectedly ({inner.__class__.__name__}: {str(inner)[:200]}). Details are in {log}.") from e


def _parse(result: Any) -> Any:
    """flow-mcp answers with one JSON text block; errors carry {"error": "..."}."""
    text = "\n".join(getattr(c, "text", "") or "" for c in (getattr(result, "content", None) or []) if getattr(c, "type", "") == "text")
    try:
        data = json.loads(text) if text.strip() else {}
    except json.JSONDecodeError:
        data = {"text": text}
    if _field(result, "is_error", "isError", False):
        message = data.get("error") if isinstance(data, dict) else None
        raise FlowError(str(message or text or "flow-mcp reported an error.")[:600])
    return data


async def _call(session: Any, name: str, args: dict, job: Job | None = None) -> Any:
    """Call a tool. A slow call comes back as {still_working, task_id}; collect its answer with flow_wait."""
    if name not in _tools:
        raise FlowError(f"This version of flow-mcp has no '{name}' tool. Update flow-mcp (git pull, npm install, npm run build).")
    data = _parse(await session.call_tool(name, args, read_timeout_seconds=CALL_TIMEOUT))
    if not (isinstance(data, dict) and data.get("still_working") and data.get("task_id")):
        return data
    task_id = data["task_id"]
    deadline = time.time() + 15 * 60
    while time.time() < deadline:
        if job and job.cancelled:
            raise Cancelled()
        waited = _parse(await session.call_tool("flow_wait", {"job_ids": [task_id], "timeout_seconds": 40}, read_timeout_seconds=CALL_TIMEOUT))
        task = next((t for t in waited.get("tasks", []) if t.get("task_id") == task_id), None)
        if task and task.get("status") == "done":
            return task.get("result") or {}
        if task and task.get("status") in ("failed", "unknown"):
            raise FlowError(str(task.get("error") or task.get("note") or "flow-mcp lost track of that request.")[:600])
    raise FlowError("Flow is still working on that request. Check Flow, then use Import to collect the result.")


def _job_ids(data: Any) -> list[str]:
    """Queue job ids from a flow_generate / flow_agent_images answer ({jobs:[{id}]}, a single job, or {job_id})."""
    if isinstance(data, dict):
        if isinstance(data.get("jobs"), list):
            return [str(j["id"]) for j in data["jobs"] if isinstance(j, dict) and j.get("id")]
        for key in ("id", "job_id"):
            if data.get(key):
                return [str(data[key])]
        if isinstance(data.get("job"), dict) and data["job"].get("id"):
            return [str(data["job"]["id"])]
    if isinstance(data, list):
        return [str(j["id"]) for j in data if isinstance(j, dict) and j.get("id")]
    return []


async def _wait_jobs(session: Any, ids: list[str], job: Job | None, what: str, minutes: float) -> list[dict]:
    """Poll flow_wait until every queued job has finished; returns flow-mcp's job views."""
    if not ids:
        raise FlowError("flow-mcp accepted the request but returned no job to wait for.")
    deadline = time.time() + minutes * 60
    views: list[dict] = []

    async def stop_if_cancelled() -> None:
        if not (job and job.cancelled):
            return
        if "flow_cancel" in _tools:   # only jobs that have not started can be cancelled; a running one finishes in Flow
            for jid in ids:
                try:
                    await session.call_tool("flow_cancel", {"job_id": jid}, read_timeout_seconds=30)
                except Exception:
                    pass
        raise Cancelled()

    while True:
        await stop_if_cancelled()
        waited = _parse(await session.call_tool("flow_wait", {"job_ids": ids, "timeout_seconds": 40}, read_timeout_seconds=CALL_TIMEOUT))
        await stop_if_cancelled()
        views = [j for j in waited.get("jobs", []) if isinstance(j, dict)]
        done = sum(1 for j in views if j.get("status") not in ("queued", "running"))
        if job:
            pacing = waited.get("pacing")
            note = f"Flow is making {what}: {done} of {len(ids)} finished" + (f" ({pacing})" if isinstance(pacing, str) and pacing else "")
            job.update(0.05 + 0.85 * (done / max(1, len(ids))), note)
        if waited.get("finished"):
            return views
        if time.time() > deadline:
            raise FlowError(f"Flow has not finished the {what} yet. They keep running in Flow; use Import later to collect them.")


def _paths(obj: Any) -> list[Path]:
    """Every existing media file path mentioned anywhere in an answer."""
    found: list[Path] = []
    if isinstance(obj, str):
        if len(obj) < 1024 and Path(obj).suffix.lower() in IMAGE_EXT | VIDEO_EXT | AUDIO_EXT:
            p = Path(obj)
            if p.is_absolute() and p.is_file():
                found.append(p)
    elif isinstance(obj, dict):
        for v in obj.values():
            found += _paths(v)
    elif isinstance(obj, list):
        for v in obj:
            found += _paths(v)
    return list(dict.fromkeys(found))


# ---------------------------------------------------------------- library

def _kind(path: Path) -> str | None:
    ext = path.suffix.lower()
    if ext in IMAGE_EXT | VIDEO_EXT:
        return "broll"
    if ext in AUDIO_EXT:
        return "voice"
    return None


def _media_type(path: Path) -> str:
    ext = path.suffix.lower()
    return "gif" if ext == ".gif" else "video" if ext in VIDEO_EXT else "image" if ext in IMAGE_EXT else "audio"


def _key(path: Path) -> str:
    st = path.stat()
    return f"{path.resolve()}|{st.st_size}|{int(st.st_mtime)}"


def _adopt(path: Path, label: str = "") -> dict | None:
    """Copy a finished file into the Library (b-roll or voiceovers) and remember it, so an import does not copy it again."""
    kind = _kind(path)
    if not kind:
        return None
    stem = safe_name(label, "")[:60] or safe_name(f"flow {path.parent.name} {path.stem}", "flow")
    dest = unique_path(DATA / "assets" / kind, stem, path.suffix.lower().lstrip("."))
    shutil.copy2(path, dest)
    imports.insert({"key": _key(path), "source": str(path), "asset": dest.name, "kind": kind})
    return {"name": dest.name, "label": dest.stem, "url": media_url(dest), "size": dest.stat().st_size,
            "type": _media_type(dest), "id": dest.stem, "kind": kind}


def _scene_number(name: str) -> int | None:
    digits = "".join(ch if ch.isdigit() else " " for ch in name).split()
    return int(digits[0]) if digits else None


def _collect(views: list[dict], labels: dict[str, str], batch: list[str] | None = None) -> dict:
    """Adopt every finished file. `batch` is the prompt list of an agent batch: one job, one file per scene, numbered
    scene-NN from the job's own first scene, so each file can be named after its description."""
    items, failed, credits = [], [], 0.0
    for view in views:
        files = _paths(view.get("files"))
        label = labels.get(str(view.get("id")), "") or str(view.get("prompt") or "")[:60]
        first = _scene_number(str(view.get("scene") or ""))
        for n, f in enumerate(files):
            name = label if len(files) == 1 else f"{label} {n + 1}"
            number = _scene_number(f.stem)
            if batch and first is not None and number is not None and 0 <= number - first < len(batch):
                name = batch[number - first][:60]
            row = _adopt(f, name)
            if row:
                items.append(row)
        if isinstance(view.get("credits"), (int, float)):
            credits += view["credits"]
        problem = view.get("error") or (view.get("note") if not files else None)
        if view.get("status") != "done" or not files or view.get("failed_scenes"):
            failed.append({"scene": str(view.get("scene") or view.get("id") or ""), "status": str(view.get("status") or ""),
                           "error": str(problem or ("No file was produced." if not files else "Some scenes failed."))[:400]})
    return {"items": items, "failed": failed, "credits": credits}


# ---------------------------------------------------------------- operations

def status(job: Job | None = None) -> dict:
    """Is the Flow window signed in, which plan, how many credits; plus what this flow-mcp version can do."""
    async def work(session: Any) -> dict:
        if job:
            job.update(0.3, "Asking flow-mcp for the Flow session")
        try:
            data = await _call(session, "flow_status", {"detailed": True}, job)
        except FlowError as e:
            if "chrome" in str(e).lower() or "cdp" in str(e).lower():
                raise FlowError(f"{e} Open the Flow Chrome window first: in the flow-mcp folder run `npm run login`, sign in to "
                                "Google, open a Flow project, and leave that window open.") from e
            raise
        flow = data.get("flow") if isinstance(data.get("flow"), dict) else {}
        voices: Any = None
        if "flow_voices" in _tools:
            try:
                voices = await _call(session, "flow_voices", {}, job)
            except FlowError:
                voices = None
        return {
            "signed_in": bool(flow.get("signedIn")), "in_project": bool(flow.get("inProject")),
            "plan": flow.get("plan") or "", "credits": flow.get("credits_remaining"), "hint": flow.get("hint") or "",
            "ready": bool(flow.get("signedIn") and flow.get("inProject")),
            "output_root": data.get("output_root") or "", "queued": len(data.get("jobs") or []),
            "tools": list(_tools), "voices": _voice_names(voices),
        }
    return _run(work, 180)


def _voice_names(data: Any) -> list[str]:
    """Kokoro voice ids from a flow_voices answer, whatever its exact layout."""
    names: list[str] = []

    def walk(obj: Any, under_kokoro: bool) -> None:
        if isinstance(obj, dict):
            if under_kokoro and isinstance(obj.get("id"), str):
                names.append(obj["id"])
            elif under_kokoro and isinstance(obj.get("name"), str):
                names.append(obj["name"])
            for k, v in obj.items():
                walk(v, under_kokoro or "kokoro" in str(k).lower())
        elif isinstance(obj, list):
            for v in obj:
                if under_kokoro and isinstance(v, str):
                    names.append(v)
                else:
                    walk(v, under_kokoro)
    walk(data, False)
    return list(dict.fromkeys(names))[:60]


def _clean(prompts: list[Any], limit: int) -> list[str]:
    out = [str(p).strip() for p in prompts if str(p).strip()]
    if not out:
        raise FlowError("Write at least one description.")
    if len(out) > limit:
        raise FlowError(f"That is {len(out)} scenes; the limit is {limit} per request.")
    return out


def images(prompts: list[Any], aspect: str, job: Job | None = None, exact: bool = False) -> dict:
    """Free stills. Uses Flow's parallel agent batch when flow-mcp has it (fast, the agent may reword prompts), or one
    paced generation per prompt (`exact`, or when the batch tool is missing)."""
    scenes = _clean(prompts, 50)
    if aspect not in IMAGE_ASPECTS:
        raise FlowError(f"Stills can be {', '.join(IMAGE_ASPECTS)}.")

    async def work(session: Any) -> dict:
        if job:
            job.update(0.03, "Sending the stills to Flow")
        batch = "flow_agent_images" in _tools and not exact
        if batch:
            data = await _call(session, "flow_agent_images", {"project": PROJECT, "scenes": scenes, "aspect_ratio": aspect}, job)
        else:
            data = await _call(session, "flow_generate", {"project": PROJECT, "scenes": [
                {"prompt": p, "type": "image", "aspect_ratio": aspect, "max_credits": 0} for p in scenes]}, job)
        ids = _job_ids(data)
        labels = {i: p[:60] for i, p in zip(ids, scenes)} if len(ids) == len(scenes) else {}
        views = await _wait_jobs(session, ids, job, "stills", 15 + 4 * len(scenes))
        result = _collect(views, labels, scenes if batch and len(ids) == 1 else None)
        result["mode"] = "batch" if batch else "one by one"
        return result
    return _run(work, (20 + 5 * len(scenes)) * 60)


def clips(scenes: list[Any], aspect: str, seconds: int | None, max_credits: int, job: Job | None = None,
          confirm: bool = False, resolution: str | None = None, model: str | None = None) -> dict:
    """Paid video clips. Each scene is skipped by flow-mcp, spending nothing, when Flow quotes more than max_credits."""
    prompts = _clean(scenes, 20)
    if not confirm:
        raise FlowError("Generating clips spends Flow credits. Confirm the spend first.")
    if aspect not in VIDEO_ASPECTS:
        raise FlowError("Flow clips can be 16:9 or 9:16.")
    if seconds is not None and seconds not in DURATIONS:
        raise FlowError("Clip length can be 4, 6, 8 or 10 seconds.")
    cap = int(max_credits)
    if cap < 1 or cap > 200:
        raise FlowError("Set a credit cap between 1 and 200 per clip.")
    scene_args = []
    for p in prompts:
        s: dict = {"prompt": p, "type": "video", "aspect_ratio": aspect, "max_credits": cap}
        if seconds:
            s["duration"] = seconds
        if resolution in ("360p", "720p"):
            s["resolution"] = resolution
        if model and model.strip():
            s["model"] = model.strip()
        scene_args.append(s)

    async def work(session: Any) -> dict:
        if job:
            job.update(0.03, "Sending the clips to Flow")
        data = await _call(session, "flow_generate", {"project": PROJECT, "scenes": scene_args}, job)
        ids = _job_ids(data)
        labels = {i: p[:60] for i, p in zip(ids, prompts)} if len(ids) == len(prompts) else {}
        views = await _wait_jobs(session, ids, job, "clips", 10 + 12 * len(prompts))
        return _collect(views, labels)
    return _run(work, (15 + 13 * len(prompts)) * 60)


def narrate(text: str, voice: str | None = None, job: Job | None = None, engine: str = "kokoro", speed: float | None = None) -> dict:
    """Free narration, recorded by flow-mcp (Kokoro on this computer by default)."""
    line = (text or "").strip()
    if not line:
        raise FlowError("Write the narration first.")
    args: dict = {"project": PROJECT, "text": line, "engine": "gemini" if engine == "gemini" else "kokoro"}
    if voice and voice.strip():
        args["voice"] = voice.strip()
    if speed and args["engine"] == "kokoro":
        args["speed"] = max(0.5, min(2.0, float(speed)))

    async def work(session: Any) -> dict:
        if job:
            job.update(0.1, "Recording narration (the first take downloads the voice model)")
        started = time.time() - 2
        data = await _call(session, "flow_narrate", args, job)
        files = [p for p in _paths(data) if p.suffix.lower() in AUDIO_EXT]
        if not files and isinstance(data, dict) and data.get("output_dir"):   # fall back to the newest take in its folder
            folder = Path(str(data["output_dir"]))
            if folder.is_dir():
                files = sorted((p for p in folder.glob("narration-*") if p.suffix.lower() in AUDIO_EXT and p.stat().st_mtime >= started),
                               key=lambda p: p.stat().st_mtime)[-1:]
        if not files:
            raise FlowError("flow-mcp recorded the narration but did not say where the file is. Use Import to collect it.")
        row = _adopt(files[0], "narration " + line[:40])
        return {"items": [row] if row else [], "failed": [], "voice": data.get("voice") if isinstance(data, dict) else None,
                "engine": data.get("engine") if isinstance(data, dict) else None}
    return _run(work, 20 * 60)


def import_folder(job: Job | None = None) -> dict:
    """Copy new images, videos and audio from flow-mcp's output folder into the Library. Needs no running flow-mcp."""
    reason = why_not_import()
    if reason:
        raise FlowError(reason)
    root = out_dir()
    if not root.is_dir():
        raise FlowError(f"The Flow output folder does not exist yet: {root}. Generate something in flow-mcp first, or set the folder in Settings.")
    seen = {r.get("key") for r in imports.all()}
    now = time.time()
    candidates: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        depth = len(Path(dirpath).relative_to(root).parts)
        dirnames[:] = [d for d in dirnames if not d.startswith(".")] if depth < 4 else []
        for name in filenames:
            p = Path(dirpath) / name
            if name.startswith(".") or not _kind(p):
                continue
            candidates.append(p)
    items, skipped, busy = [], 0, 0
    for n, p in enumerate(sorted(candidates)):
        if job:
            job.update(n / max(1, len(candidates)), f"Importing {p.name}")
        try:
            st = p.stat()
        except OSError:
            continue
        if st.st_size == 0 or now - st.st_mtime < 3:   # still being written
            busy += 1
            continue
        if _key(p) in seen:
            skipped += 1
            continue
        rel = p.relative_to(root)
        row = _adopt(p, " ".join(["flow", *rel.parts[:-1], p.stem]))
        if row:
            items.append(row)
    return {"items": items, "failed": [], "skipped": skipped, "busy": busy, "folder": str(root)}
