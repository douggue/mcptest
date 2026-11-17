"""MCP server for Cutroom: drive a running Cutroom from Claude Desktop, Claude Code or any MCP client.

    python -m server.mcp_server [--url http://127.0.0.1:8000] [--password ...]

It speaks MCP over stdio and talks to Cutroom only through its HTTP API, so the Cutroom it drives can run on this
computer or on a server (the password comes from --password or CUTROOM_PASSWORD). It imports nothing from the app
itself and needs only the standard library and the `mcp` package. See docs/MCP.md for setup.
"""
import argparse
import functools
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

import anyio
from mcp.types import ToolAnnotations

try:   # mcp 2.x
    from mcp.server.mcpserver import Context, MCPServer
    from mcp.server.mcpserver.exceptions import ResourceError, ToolError
except ImportError:   # mcp 1.x
    from mcp.server.fastmcp import Context, FastMCP as MCPServer
    from mcp.server.fastmcp.exceptions import ResourceError, ToolError

DEFAULT_URL = "http://127.0.0.1:8000"
CAPTION_PRESETS = ("boldpop", "karaoke", "tape", "clean", "neon", "typeon", "shadow", "box", "glow")
CLIP_STATUSES = ("draft", "approved", "posted")


# ---------------------------------------------------------------- HTTP client (standard library only)

class CutroomError(Exception):
    pass


class _Multipart:
    """A multipart/form-data body with one file, read in pieces so a large video is never held in memory."""

    def __init__(self, field: str, path: Path):
        self.boundary = "cutroom" + uuid.uuid4().hex
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        name = path.name.replace('"', "")
        self._head = (f"--{self.boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{name}\"\r\n"
                      f"Content-Type: {ctype}\r\n\r\n").encode()
        self._tail = f"\r\n--{self.boundary}--\r\n".encode()
        self.length = len(self._head) + path.stat().st_size + len(self._tail)
        self._parts = [self._head, path.open("rb"), self._tail]

    def read(self, n: int = -1) -> bytes:
        while self._parts:
            part = self._parts[0]
            if isinstance(part, bytes):
                self._parts.pop(0)
                if part:
                    return part
                continue
            chunk = part.read(n if n and n > 0 else 1024 * 1024)
            if chunk:
                return chunk
            part.close()
            self._parts.pop(0)
        return b""


class Cutroom:
    """A small, synchronous client for Cutroom's HTTP API. Signs in on the first 401 when it has a password."""

    def __init__(self, url: str, password: str = ""):
        self.url = url.rstrip("/")
        self.password = password
        self.token = ""
        host = urllib.parse.urlparse(self.url).hostname or ""
        # A Cutroom on this machine must never be reached through an HTTP proxy from the environment.
        handlers = [urllib.request.ProxyHandler({})] if host in ("127.0.0.1", "localhost", "::1") else []
        self._opener = urllib.request.build_opener(*handlers)

    def request(self, method: str, path: str, body: Any = None, params: dict | None = None,
                upload: tuple[str, Path] | None = None, timeout: float = 60, raw: bool = False, _retry: bool = True) -> Any:
        if self.password and not self.token:
            self.login()   # sign in up front: /api/health answers a signed-out caller with less, and uploads need it
        elif upload and _retry and not self.token:
            self.request("GET", "/api/jobs")   # a 401 here is clearer than a reset connection mid-upload
        url = self.url + path
        if params:
            url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        headers = {"Accept": "application/json"}
        data: Any = None
        if upload:
            form = _Multipart(*upload)
            data = form
            headers["Content-Type"] = f"multipart/form-data; boundary={form.boundary}"
            headers["Content-Length"] = str(form.length)
        elif body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Cookie"] = f"cutroom_session={self.token}"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with self._opener.open(req, timeout=timeout) as resp:
                text = resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            detail = _detail(e)
            if e.code == 401 and path != "/api/login" and _retry:
                if not self.password:
                    raise CutroomError(f"The Cutroom at {self.url} asks for a password. Start the MCP server with "
                                       "--password or set CUTROOM_PASSWORD.") from None
                self.login()
                return self.request(method, path, body, params, upload, timeout, raw, _retry=False)
            if e.code == 404 and not detail.strip():
                detail = "not found"
            raise CutroomError(f"Cutroom said ({e.code}): {detail}") from None
        except urllib.error.URLError as e:
            raise CutroomError(f"Could not reach Cutroom at {self.url} ({e.reason}). Is it running? "
                               "Start it with python run.py, or pass --url.") from None
        except TimeoutError:
            raise CutroomError(f"Cutroom at {self.url} did not answer within {timeout:.0f} s.") from None
        if raw:
            return text
        try:
            return json.loads(text) if text else None
        except json.JSONDecodeError:
            return text

    def login(self) -> None:
        try:
            req = urllib.request.Request(self.url + "/api/login", data=json.dumps({"password": self.password}).encode(),
                                         headers={"Content-Type": "application/json"}, method="POST")
            with self._opener.open(req, timeout=30) as resp:
                cookie = resp.headers.get_all("Set-Cookie") or []
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise CutroomError("Cutroom did not accept the password (check --password or CUTROOM_PASSWORD).") from None
            raise CutroomError(f"Signing in to Cutroom failed ({e.code}): {_detail(e)}") from None
        except urllib.error.URLError as e:
            raise CutroomError(f"Could not reach Cutroom at {self.url} ({e.reason}). Is it running?") from None
        for c in cookie:
            m = re.match(r"\s*cutroom_session=([^;]+)", c)
            if m:
                self.token = m.group(1)
                return
        raise CutroomError("Cutroom accepted the password but sent no session cookie.")

    def absolute(self, media: str | None) -> str:
        return self.url + media if media and media.startswith("/") else (media or "")


def _detail(e: urllib.error.HTTPError) -> str:
    try:
        text = e.read().decode("utf-8", "replace")
    except Exception:
        return e.reason or ""
    try:
        detail = json.loads(text).get("detail", text)
    except (json.JSONDecodeError, AttributeError):
        return text[:500] or str(e.reason or "")
    if isinstance(detail, list):   # FastAPI validation errors
        return "; ".join(f"{'.'.join(str(x) for x in d.get('loc', [])[1:])}: {d.get('msg')}" for d in detail if isinstance(d, dict))
    return str(detail)


client = Cutroom(os.environ.get("CUTROOM_URL", DEFAULT_URL), os.environ.get("CUTROOM_PASSWORD", ""))
_data_dir: str | None = None


async def api(method: str, path: str, **kw: Any) -> Any:
    try:
        return await anyio.to_thread.run_sync(functools.partial(client.request, method, path, **kw))
    except CutroomError as e:
        raise ToolError(str(e)) from None


async def data_dir() -> str:
    """Cutroom's data folder (on the Cutroom machine), from /api/health."""
    global _data_dir
    if _data_dir is None:
        h = await api("GET", "/api/health")
        _data_dir = h.get("data") or ""
    return _data_dir


async def file_info(media: str | None) -> dict:
    """A /media/... URL as an absolute URL plus its path on the Cutroom machine."""
    if not media:
        return {}
    out = {"url": client.absolute(media)}
    root = await data_dir()
    if root and media.startswith("/media/"):
        rel = urllib.parse.unquote(media[len("/media/"):].split("?", 1)[0])
        sep = "\\" if re.match(r"^[A-Za-z]:\\", root) else "/"
        out["path_on_cutroom_machine"] = root.rstrip("/\\") + sep + rel.replace("/", sep)
    return out


# ---------------------------------------------------------------- jobs

async def wait_job(ctx: Context | None, job_id: str, timeout: float) -> Any:
    """Poll a Cutroom job until it ends. Reports progress; a cancelled tool call cancels the job too.
    On timeout the job keeps running and the caller gets {job_id, status} to check later with job_status."""
    start = time.monotonic()
    last: tuple | None = None
    delay = 0.5
    try:
        while True:
            job = await api("GET", f"/api/jobs/{job_id}")
            status = job.get("status")
            seen = (round(job.get("progress", 0), 3), job.get("message"))
            if ctx is not None and seen != last:
                last = seen
                try:
                    await ctx.report_progress(round(100 * (job.get("progress") or 0), 1), 100, job.get("message") or job.get("title"))
                except Exception:
                    pass   # a client without progress support must not break the tool
            if status == "done":
                return job.get("result")
            if status == "error":
                raise ToolError(f"{job.get('title') or 'The job'} failed: {job.get('error') or 'unknown error'}")
            if status == "cancelled":
                raise ToolError(f"{job.get('title') or 'The job'} was cancelled in Cutroom.")
            if time.monotonic() - start > timeout:
                raise _StillRunning(job)
            await anyio.sleep(delay)
            delay = min(2.0, delay * 1.3)
    except anyio.get_cancelled_exc_class():
        with anyio.CancelScope(shield=True):
            try:
                await api("POST", f"/api/jobs/{job_id}/cancel", timeout=10)
            except Exception:
                pass
        raise


class _StillRunning(Exception):
    def __init__(self, job: dict):
        self.job = job


async def run_job(ctx: Context | None, start: dict, timeout: float) -> tuple[bool, Any]:
    """(finished, result-or-running-note) for a {job_id} answer."""
    job_id = start["job_id"]
    try:
        return True, await wait_job(ctx, job_id, timeout)
    except _StillRunning as s:
        j = s.job
        return False, {"job_id": job_id, "status": j.get("status"), "progress": j.get("progress"), "message": j.get("message"),
                       "note": f"Still running after {timeout:.0f} s; it keeps going in Cutroom. "
                               "Call job_status with this job_id to wait for the result, or cancel_job to stop it."}


# ---------------------------------------------------------------- compact shapes

def _r(v: Any, n: int = 2) -> Any:
    return round(v, n) if isinstance(v, (int, float)) else v


def clip_out(c: dict) -> dict:
    s = c.get("spec") or {}
    meta = c.get("meta") or {}
    caps = s.get("captions") or {}
    return {
        "id": c["id"], "title": c.get("title"), "score": c.get("score"), "status": c.get("status", "draft"),
        "start": _r(s.get("in")), "end": _r(s.get("out")),
        "duration": _r((s.get("out") or 0) - (s.get("in") or 0), 1),
        "hook_text": (s.get("hook") or {}).get("text", ""), "reason": c.get("reason") or "",
        "style_id": c.get("profile_id") or "", "size": f"{s.get('width')}x{s.get('height')}",
        "captions": {k: caps.get(k) for k in ("visible", "preset", "uppercase", "maxWords", "position", "size") if k in caps},
        "post": {"title": meta.get("title", ""), "description": meta.get("description", ""), "hashtags": meta.get("hashtags", [])},
        "graphics": len(s.get("graphics") or []),
    }


def transcript_text(words: list[dict]) -> str:
    return " ".join(w.get("text", "") for w in words if not w.get("removed")).strip()


def export_out(r: dict) -> dict:
    meta = r.get("meta") or {}
    return {"id": r.get("id"), "title": r.get("title"), "post_title": meta.get("title", ""), "project_id": r.get("project_id"),
            "clip_id": r.get("clip_id"), "status": r.get("status"), "duration": _r(r.get("duration"), 1),
            "size": f"{r.get('width')}x{r.get('height')}", "megabytes": _r((r.get("size") or 0) / 1e6, 1),
            "file": r.get("file"), "created": _when(r.get("created"))}


def _when(t: Any) -> str:
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(t)) if isinstance(t, (int, float)) and t else ""


def _is_url(s: str) -> bool:
    return bool(re.match(r"^https?://", s.strip(), re.I))


def _local_file(path: str) -> Path:
    p = Path(path.strip().strip('"')).expanduser()
    if not p.is_file():
        raise ToolError(f"No file at {path} on the computer running this MCP server. Give a full path to an existing file, "
                        "a video link, or a /media/... URL of a file Cutroom already has.")
    return p


# ---------------------------------------------------------------- clip range edits (mirrors web/src/studio/logic.ts retime)

def _derive_segments(spec: dict) -> list[dict]:
    tin, tout = spec["in"], spec["out"]
    words = [w for w in spec.get("words", []) if w["end"] > tin and w["start"] < tout]
    cuts: list[tuple[float, float]] = []
    i = 0
    while i < len(words):
        if not words[i].get("removed"):
            i += 1
            continue
        j = i
        while j + 1 < len(words) and words[j + 1].get("removed"):
            j += 1
        before = words[i - 1] if i > 0 else None
        after = words[j + 1] if j + 1 < len(words) else None
        s = min(before["end"] + 0.04, words[i]["start"]) if before else tin
        e = max(after["start"] - 0.04, words[j]["end"]) if after else tout
        if e - s > 0.06:
            cuts.append((s, e))
        i = j + 1
    gap = (spec.get("edit") or {}).get("silence") or 0
    if gap > 0:
        live = [w for w in words if not w.get("removed")]
        keep = min(gap, 0.24) / 2
        for a, b in zip(live, live[1:]):
            if b["start"] - a["end"] > gap:
                cuts.append((a["end"] + keep, b["start"] - keep))
        if live:
            if live[0]["start"] - tin > gap:
                cuts.append((tin, live[0]["start"] - 0.15))
            if tout - live[-1]["end"] > gap + 0.2:
                cuts.append((live[-1]["end"] + 0.3, tout))
    cuts.sort()
    segs, cursor = [], tin
    for s, e in cuts:
        s, e = min(max(s, tin), tout), min(max(e, tin), tout)
        if e <= cursor:
            continue
        if s - cursor > 0.08:
            segs.append({"start": round(cursor, 3), "end": round(s, 3)})
        cursor = max(cursor, e)
    if tout - cursor > 0.08:
        segs.append({"start": round(cursor, 3), "end": round(tout, 3)})
    ranges = spec.get("ranges") or []
    if not ranges:
        return segs or [{"start": tin, "end": tout}]
    # a multi-part clip (merged, recap, trailer): the gaps between its parts stay cut, as in the editor
    def meet(a: list[dict], b: list[dict]) -> list[dict]:
        out = []
        for x in a:
            for y in b:
                s0, e0 = max(x["start"], y["start"]), min(x["end"], y["end"])
                if e0 - s0 > 0.08:
                    out.append({"start": round(s0, 3), "end": round(e0, 3)})
        return out
    return meet(segs, ranges) or meet([{"start": tin, "end": tout}], ranges) or [{"start": tin, "end": tout}]


def _move_ranges(ranges: list[dict] | None, tin: float, tout: float) -> list[dict] | None:
    """Mirror of moveRanges in web/src/studio/logic.ts."""
    if not ranges:
        return ranges
    out = [{"start": max(r["start"], tin), "end": min(r["end"], tout)} for r in ranges]
    out = [r for r in out if r["end"] - r["start"] > 0.05]
    if not out:
        return [{"start": round(tin, 3), "end": round(tout, 3)}]
    if tin < ranges[0]["start"]:
        out[0]["start"] = tin
    if tout > ranges[-1]["end"]:
        out[-1]["end"] = tout
    return [{"start": round(r["start"], 3), "end": round(r["end"], 3)} for r in out]


def _retime(spec: dict, all_words: list[dict], tin: float, tout: float) -> dict:
    have = {w.get("id"): w for w in spec.get("words", [])}
    words = [have.get(w.get("id"), dict(w)) for w in all_words if w["start"] >= tin - 0.05 and w["end"] <= tout + 0.05]
    shots = [s for i, s in enumerate(spec.get("shots") or []) if i == 0 or tin < s["start"] < tout]
    if shots:
        shots[0] = {**shots[0], "start": tin}
    else:
        shots = [{"start": tin, "layout": "single", "x": [50], "transition": "cut"}]
    spec = {**spec, "in": round(tin, 3), "out": round(tout, 3), "words": words, "shots": shots,
            "ranges": _move_ranges(spec.get("ranges"), tin, tout),
            "zooms": [z for z in spec.get("zooms") or [] if tin <= z.get("at", tin) < tout],
            "graphics": [g for g in spec.get("graphics") or [] if tin <= g.get("at", tin) < tout]}
    if spec.get("freezes"):
        spec["freezes"] = [f for f in spec["freezes"] if tin <= f.get("at", tin) < tout]
    if spec.get("speeds"):
        spec["speeds"] = [s for s in spec["speeds"] if s.get("start", tin) >= tin and s.get("end", tout) <= tout]
    spec["segments"] = _derive_segments(spec)
    return spec


# ---------------------------------------------------------------- server

mcp = MCPServer(
    "cutroom",
    instructions=(
        "Cutroom turns long videos into short vertical clips. Typical flow: import_video (a link or a file) -> "
        "transcribe or import_transcript -> find_moments -> update_clip / apply_style -> export_clip. "
        "Times are seconds in the source video. Long tools wait for Cutroom's background job and report progress; "
        "if one times out it returns a job_id to check with job_status. Cutroom never posts to social platforms: "
        "plan_post only records a plan. Generation tools are billed by Google per use."
    ),
)

READ = ToolAnnotations(readOnlyHint=True, openWorldHint=False)
WEB = ToolAnnotations(openWorldHint=True)


@mcp.tool(annotations=READ)
async def status() -> dict:
    """Check that Cutroom is reachable and ready: whether it runs locally or as the password-protected server edition,
    the AI provider (no key means rule-based fallbacks), ffmpeg, and how many projects, exports and running jobs it has."""
    h = await api("GET", "/api/health")
    projects = await api("GET", "/api/projects")
    exports = await api("GET", "/api/exports")
    jobs = await api("GET", "/api/jobs")
    running = [{"id": j["id"], "title": j["title"], "status": j["status"], "progress": j["progress"]}
               for j in jobs if j.get("status") in ("queued", "running")]
    return {
        "url": client.url, "ok": h.get("ok"),
        "edition": "server (password login)" if h.get("auth") else "desktop (no login)",
        "ai": h.get("ai"), "ai_provider": h.get("ai_provider") or "none (rule-based fallbacks)",
        "ffmpeg": h.get("ffmpeg"), "data_folder": h.get("data"),
        "projects": len(projects), "exports": len(exports), "running_jobs": running,
    }


@mcp.tool(annotations=READ)
async def list_projects(limit: int = 20) -> dict:
    """List studio projects (one imported long video each), newest first, with their clip counts and transcript size."""
    rows = await api("GET", "/api/projects")
    return {"total": len(rows), "projects": [{
        "id": p["id"], "name": p["name"], "created": _when(p.get("created")),
        "duration": _r(p["source"].get("duration"), 1), "transcript_words": p.get("words", 0),
        "transcript_engine": p.get("engine") or "", "clips": len(p.get("clips", [])), "origin": p.get("origin", ""),
    } for p in rows[:max(1, limit)]]}


@mcp.tool(annotations=READ)
async def get_project(project_id: str, include_transcript: bool = False, transcript_chars: int = 4000) -> dict:
    """One project with its clips (id, title, score, start/end/duration, hook, style, captions, post text).
    The transcript is summarised by length; set include_transcript to get its text, cut to transcript_chars characters.
    The full transcript with timings is also the resource cutroom://projects/{project_id}/transcript."""
    p = await api("GET", f"/api/projects/{project_id}")
    t = p.get("transcript") or {}
    words = t.get("words") or []
    text = transcript_text(words)
    src = p.get("source") or {}
    out = {
        "id": p["id"], "name": p["name"], "origin": p.get("origin", ""),
        "source": {"duration": _r(src.get("duration"), 1), "size": f"{src.get('width')}x{src.get('height')}", "fps": src.get("fps"),
                   **(await file_info(src.get("url")))},
        "transcript": {"engine": t.get("engine", ""), "words": len(words), "characters": len(text)} if t else None,
        "clips": [clip_out(c) for c in p.get("clips", [])],
    }
    if include_transcript and text:
        limit = max(100, transcript_chars)
        out["transcript"]["text"] = text[:limit] + (" …" if len(text) > limit else "")
        out["transcript"]["truncated"] = len(text) > limit
    return out


@mcp.tool(annotations=WEB)
async def import_video(source: str, name: str = "", quality: int = 1080, timeout: float = 1800, ctx: Context = None) -> dict:
    """Start a new project from a video. `source` is a link (YouTube and other sites yt-dlp supports), a full path to a
    video file on this computer (it is uploaded to Cutroom, so it also works with a Cutroom on another machine), or a
    /media/... URL of a file Cutroom already has (e.g. a Clipper clip). `quality` is the download height for links
    (use 1440 or 2160 for sharper vertical crops). Waits for the import and returns the project id; next, transcribe it
    or import_transcript."""
    source = source.strip()
    if _is_url(source):
        start = await api("POST", "/api/projects", body={"url": source, "quality": quality, **({"name": name} if name else {})})
    elif source.startswith("/media/"):
        start = await api("POST", "/api/projects", body={"media_url": source, **({"name": name} if name else {})})
    else:
        f = _local_file(source)
        start = await api("POST", "/api/projects/upload", upload=("file", f), timeout=max(120, timeout))
    done, result = await run_job(ctx, start, timeout)
    if not done:
        return result
    pid = result["project_id"]
    if name and not (_is_url(source) or source.startswith("/media/")):
        await api("PATCH", f"/api/projects/{pid}", body={"name": name})
    p = await api("GET", f"/api/projects/{pid}")
    return {"project_id": pid, "name": p["name"], "duration": _r(p["source"].get("duration"), 1),
            "size": f"{p['source'].get('width')}x{p['source'].get('height')}",
            "next": "transcribe(project_id) or import_transcript(project_id, path)"}


@mcp.tool()
async def transcribe(project_id: str, engine: str = "whisper", language: str = "", model: str = "",
                     timeout: float = 3600, ctx: Context = None) -> dict:
    """Make the word-timed transcript that find_moments and captions need. engine "whisper" runs speech-to-text on the
    Cutroom machine (minutes for a long video; `model` like tiny/base/small/medium/large-v3, `language` like "en");
    engine "youtube" fetches the site's captions for a project imported from a link (fast)."""
    if engine not in ("whisper", "youtube"):
        raise ToolError('engine must be "whisper" or "youtube".')
    body: dict = {"engine": engine}
    if language:
        body["language"] = language
    if model:
        body["model"] = model
    start = await api("POST", f"/api/projects/{project_id}/transcribe", body=body)
    done, result = await run_job(ctx, start, timeout)
    return {"project_id": project_id, **result} if done else result


@mcp.tool()
async def import_transcript(project_id: str, path: str) -> dict:
    """Use an existing transcript instead of transcribing: a full path on this computer to an .srt, .vtt or a JSON
    file of word timings ({"words": [{"text", "start", "end"}]}). Replaces the project's transcript."""
    f = _local_file(path)
    res = await api("POST", f"/api/projects/{project_id}/transcript", upload=("file", f), timeout=120)
    return {"project_id": project_id, **res}


async def _resolve_style(style: str) -> dict | None:
    if not style:
        return None
    rows = await api("GET", "/api/profiles")
    want = style.strip().lower()
    hit = next((s for s in rows if s["id"] == style), None) or next((s for s in rows if s.get("name", "").lower() == want), None)
    if not hit:
        names = ", ".join(f"{s.get('name')} ({s['id']})" for s in rows[:30])
        raise ToolError(f"No style '{style}'. Styles: {names}")
    return hit


@mcp.tool()
async def find_moments(project_id: str, count: int = 6, min_seconds: float = 20, max_seconds: float = 60, query: str = "",
                       style: str = "", kind: str = "", instructions: str = "", template_id: str = "",
                       timeout: float = 900, ctx: Context = None) -> dict:
    """Find the best short clips in a transcribed project and add them to it as draft clips. Returns the new clips.
    `query` steers what to look for (a topic, a quote); `style` (id or name from list_styles) gives the clips that
    style's look and lets its rules guide the choice. `kind` (e.g. "series", "topic", "recap", "trailer") and
    `instructions` (free text for the AI) are passed through for Cutroom versions that support them and are ignored
    by older ones. Without an AI key Cutroom uses a rule-based picker."""
    found_style = await _resolve_style(style)
    before = {c["id"] for c in (await api("GET", f"/api/projects/{project_id}")).get("clips", [])}
    body: dict = {"count": count, "min_len": min_seconds, "max_len": max_seconds, "query": query}
    if found_style:
        body["profile_id"] = found_style["id"]
    if kind:
        body["kind"] = kind
    if instructions:
        body["instructions"] = instructions
    if template_id:
        body["template_id"] = template_id
    start = await api("POST", f"/api/projects/{project_id}/moments", body=body)
    done, result = await run_job(ctx, start, timeout)
    if not done:
        return result
    p = await api("GET", f"/api/projects/{project_id}")
    new = [clip_out(c) for c in p.get("clips", []) if c["id"] not in before]
    out = {"project_id": project_id, "engine": result.get("engine"), "added": len(new), "clips": new}
    if result.get("note"):
        out["note"] = result["note"]
    return out


@mcp.tool(annotations=READ)
async def list_styles() -> dict:
    """Editing styles: the person's own (learned from reference videos, with rules) and the built-in presets.
    Use a style's id with find_moments(style=...) or apply_style."""
    rows = await api("GET", "/api/profiles")
    return {"styles": [{
        "id": s["id"], "name": s.get("name"), "builtin": bool(s.get("builtin")),
        "summary": (s.get("summary") or s.get("brief") or "")[:200],
        "rules": len([r for r in s.get("rules", []) if r.get("on", True)]),
    } for s in rows]}


@mcp.tool()
async def apply_style(project_id: str, clip_id: str, style_id: str) -> dict:
    """Attach a style to an existing clip. Cutroom applies a style's full look (captions, frame, header, standing
    graphics) only in the browser editor, so this tool sets the clip's style (which also guides later AI edits of the
    clip) and returns a note: to see the look, open the clip in Cutroom and pick the style, or create clips with
    find_moments(style=...), which applies the look on the server."""
    hit = await _resolve_style(style_id)
    await api("PUT", f"/api/projects/{project_id}/clips/{clip_id}", body={"profile_id": hit["id"]})
    return {"ok": True, "clip_id": clip_id, "style_id": hit["id"], "style": hit.get("name"),
            "note": "Style attached. Its look is applied when the clip is opened in Cutroom's editor and the style is "
                    "picked there; find_moments(style=...) creates clips that already have it."}


@mcp.tool()
async def update_clip(project_id: str, clip_id: str, title: str | None = None, hook_text: str | None = None,
                      hook_visible: bool | None = None, start: float | None = None, end: float | None = None,
                      captions_visible: bool | None = None, caption_preset: str | None = None,
                      caption_uppercase: bool | None = None, caption_max_words: int | None = None,
                      caption_position: float | None = None, caption_size: int | None = None,
                      caption_color: str | None = None, caption_highlight: str | None = None,
                      post_title: str | None = None, description: str | None = None, hashtags: list[str] | None = None,
                      status: str | None = None) -> dict:
    """Small safe edits to one clip; only the fields you give change.
    title: the clip's name. hook_text / hook_visible: the opening title card. start / end: the clip's range in
    seconds of the source video (words, cuts and graphics follow, as in the editor). Captions: caption_preset
    (boldpop, karaoke, tape, clean, neon, typeon, shadow, box, glow), caption_uppercase, caption_max_words (words on
    screen at once), caption_position (% from the top), caption_size (px at 1080 wide), caption_color /
    caption_highlight (#rrggbb). post_title, description, hashtags: the text for posting. status: draft | approved | posted."""
    p = await api("GET", f"/api/projects/{project_id}")
    clip = next((c for c in p.get("clips", []) if c["id"] == clip_id), None)
    if not clip:
        raise ToolError(f"No clip {clip_id} in project {project_id}. get_project lists the clips.")
    spec = clip["spec"]
    body: dict = {}
    changed: list[str] = []
    if start is not None or end is not None:
        tin = spec["in"] if start is None else float(start)
        tout = spec["out"] if end is None else float(end)
        duration = (p.get("source") or {}).get("duration") or tout
        tin, tout = max(0.0, tin), min(float(duration), tout)
        if tout - tin < 1:
            raise ToolError(f"A clip must be at least one second long (got {tin:.2f}-{tout:.2f}; the video is {duration:.1f} s).")
        spec = _retime(spec, (p.get("transcript") or {}).get("words") or [], tin, tout)
        changed.append("range")
    if hook_text is not None or hook_visible is not None:
        hook = dict(spec.get("hook") or {})
        if hook_text is not None:
            hook["text"] = hook_text
            hook["visible"] = bool(hook_text) if hook_visible is None else hook_visible
        if hook_visible is not None:
            hook["visible"] = hook_visible
        spec = {**spec, "hook": hook}
        changed.append("hook")
    caps = dict(spec.get("captions") or {})
    for key, value in (("visible", captions_visible), ("preset", caption_preset), ("uppercase", caption_uppercase),
                       ("maxWords", caption_max_words), ("position", caption_position), ("size", caption_size),
                       ("color", caption_color), ("highlight", caption_highlight)):
        if value is None:
            continue
        if key == "preset" and value not in CAPTION_PRESETS:
            raise ToolError(f"Unknown caption preset '{value}'. Use one of: {', '.join(CAPTION_PRESETS)}.")
        if key in ("color", "highlight") and not re.match(r"^#[0-9a-fA-F]{6}$", str(value)):
            raise ToolError(f"{key} must be a colour like #ffcc00.")
        if key == "maxWords" and not 1 <= int(value) <= 12:
            raise ToolError("caption_max_words must be between 1 and 12.")
        if key == "position" and not 0 <= float(value) <= 100:
            raise ToolError("caption_position is a percentage from 0 to 100.")
        caps[key] = value
        changed.append(f"captions.{key}")
    if caps != (spec.get("captions") or {}):
        spec = {**spec, "captions": caps}
    if spec is not clip["spec"]:
        body["spec"] = spec
    if title is not None:
        body["title"] = title
        changed.append("title")
    if post_title is not None or description is not None or hashtags is not None:
        meta = dict(clip.get("meta") or {})
        if post_title is not None:
            meta["title"] = post_title
        if description is not None:
            meta["description"] = description
        if hashtags is not None:
            meta["hashtags"] = [h if h.startswith("#") else "#" + h for h in (h.strip() for h in hashtags) if h]
        body["meta"] = meta
        changed.append("post text")
    if status is not None:
        if status not in CLIP_STATUSES:
            raise ToolError(f"status must be one of: {', '.join(CLIP_STATUSES)}.")
        body["status"] = status
        changed.append("status")
    if not body:
        raise ToolError("Nothing to change: give at least one field.")
    await api("PUT", f"/api/projects/{project_id}/clips/{clip_id}", body=body)
    return {"ok": True, "changed": changed, "clip": clip_out({**clip, **body})}


@mcp.tool()
async def export_clip(project_id: str, clip_id: str, quality: str = "1080", upscale: bool = False,
                      timeout: float = 1800, ctx: Context = None) -> dict:
    """Render a clip to an MP4 (it appears under list_exports). quality "1080" or "720" (faster). upscale=true runs
    AI upscaling for a low-resolution source (slow). Rendering takes roughly 2-5x the clip's length.
    Returns the export's URL and its file path on the Cutroom machine."""
    if str(quality) not in ("1080", "720"):
        raise ToolError('quality must be "1080" or "720".')
    start = await api("POST", f"/api/projects/{project_id}/clips/{clip_id}/render",
                      body={"quality": str(quality), **({"upscale": True} if upscale else {})})
    done, row = await run_job(ctx, start, timeout)
    if not done:
        return row
    out = export_out(row)
    out.update(await file_info(row.get("file")))
    if row.get("cover"):
        out["cover_url"] = client.absolute(row["cover"])
    if row.get("copied_to"):
        out["copied_to"] = row["copied_to"]
    return out


@mcp.tool(annotations=READ)
async def list_exports(limit: int = 20, project_id: str = "") -> dict:
    """Rendered shorts, newest first (optionally for one project), with URL and file path."""
    rows = await api("GET", "/api/exports")
    if project_id:
        rows = [r for r in rows if r.get("project_id") == project_id]
    out = []
    for r in rows[:max(1, limit)]:
        e = export_out(r)
        e.update(await file_info(r.get("file")))
        out.append(e)
    return {"total": len(rows), "exports": out}


@mcp.tool(annotations=WEB)
async def clipper_cut(source: str, start: float | None = None, end: float | None = None, format: str = "mp4",
                      aspect: str = "original", quality: int | None = None, name: str = "", subtitles: bool = False,
                      mode: str = "accurate", timeout: float = 1800, ctx: Context = None) -> dict:
    """The Clipper: cut a plain piece out of a video, with no editing. `source` is a link, a full path to a file on this
    computer (uploaded first), or a /media/... URL. start/end in seconds (both empty = the whole video).
    format: mp4 | mov | mp3 | m4a | gif | frames. aspect: original | 9:16 | 1:1 | 4:5 | 16:9 (centre crop).
    quality: short-side height (360-2160), empty = as the source. mode "fast" skips re-encoding where possible.
    subtitles=true also saves the site's captions for a link."""
    src = source.strip()
    if not (_is_url(src) or src.startswith("/media/")):
        info = await api("POST", "/api/clipper/upload", upload=("file", _local_file(src)), timeout=max(120, timeout))
        src = info["source"]
    rng: dict = {"name": name}
    if start is not None:
        rng["start"] = start
    if end is not None:
        rng["end"] = end
    body = {"sources": [src], "clips": [rng], "format": format, "aspect": aspect, "mode": mode, "subtitles": subtitles}
    if quality:
        body["quality"] = quality
    begin = await api("POST", "/api/clipper/save", body=body)
    done, result = await run_job(ctx, begin, timeout)
    if not done:
        return result
    items = []
    for it in result.get("items", []):
        row = {"id": it.get("id"), "title": it.get("title"), "format": it.get("format"), "duration": _r(it.get("duration"), 2),
               "size": f"{it.get('width')}x{it.get('height')}", "megabytes": _r((it.get("size") or 0) / 1e6, 2),
               "file": it.get("file"), **(await file_info(it.get("file")))}
        if it.get("warnings"):
            row["warnings"] = it["warnings"]
        if it.get("subtitles"):
            row["subtitles"] = [client.absolute(s) for s in it["subtitles"]]
        items.append(row)
    out: dict = {"clips": items}
    if result.get("errors"):
        out["errors"] = result["errors"]
    out["tip"] = "To edit a clip into a short, import_video(source=<its file /media/... URL>)."
    return out


async def _generated(ctx: Context | None, path: str, body: dict, timeout: float) -> dict:
    start = await api("POST", path, body=body)
    done, row = await run_job(ctx, start, timeout)
    if not done:
        return row
    out = {k: row[k] for k in ("id", "name", "label", "type", "duration", "note", "lyrics") if row.get(k) not in (None, "")}
    out.update(await file_info(row.get("url")))
    out["media_url"] = row.get("url")
    return out


@mcp.tool(annotations=WEB)
async def generate_image(prompt: str, aspect: str = "9:16", model: str = "", timeout: float = 300, ctx: Context = None) -> dict:
    """Generate an image with Google AI Studio (needs a Gemini key in Cutroom; billed by Google). It is saved to
    Cutroom's library (b-roll). aspect: 9:16 | 16:9 | 1:1 | 4:5 | 3:4."""
    return await _generated(ctx, "/api/generate/image", {"prompt": prompt, "aspect": aspect, **({"model": model} if model else {})}, timeout)


@mcp.tool(annotations=WEB)
async def generate_speech(text: str, provider: str = "gemini", voice: str = "", style: str = "", model: str = "",
                          timeout: float = 600, ctx: Context = None) -> dict:
    """Generate a voiceover saved to Cutroom's library. provider "gemini" (Google AI Studio, billed, `style` describes
    the delivery) or "edge" (free Microsoft voices, e.g. voice "en-US-GuyNeural")."""
    body = {"text": text, "provider": provider}
    body.update({k: v for k, v in (("voice", voice), ("style", style), ("model", model)) if v})
    return await _generated(ctx, "/api/generate/speech", body, timeout)


@mcp.tool(annotations=WEB)
async def generate_music(prompt: str, instrumental: bool = True, model: str = "", timeout: float = 600, ctx: Context = None) -> dict:
    """Generate a music track with Google AI Studio (billed), saved to Cutroom's music library."""
    return await _generated(ctx, "/api/generate/music", {"prompt": prompt, "instrumental": instrumental,
                                                         **({"model": model} if model else {})}, timeout)


@mcp.tool(annotations=WEB)
async def generate_video(prompt: str, confirm: bool = False, aspect: str = "9:16", seconds: float | None = None,
                         image_url: str = "", timeout: float = 1200, ctx: Context = None) -> dict:
    """Generate a short video clip with Google (3-15 s). This is billed by Google per clip and is slow, so it only
    runs with confirm=true: ask the person first. image_url (a /media/... URL) animates an existing image."""
    if confirm is not True:
        raise ToolError("Video generation is billed by Google per clip. Ask the person, then call again with confirm=true.")
    body: dict = {"prompt": prompt, "aspect": aspect, "confirm": True}
    if seconds:
        body["seconds"] = seconds
    if image_url:
        body["image_url"] = image_url
    return await _generated(ctx, "/api/generate/video", body, timeout)


@mcp.tool(annotations=READ)
async def list_posts(status: str = "", limit: int = 30) -> dict:
    """Agency planner: planned and published posts (Cutroom never posts itself; these are a plan and a record), with
    the accounts and campaigns to use in plan_post, and totals."""
    rows = await api("GET", "/api/agency/posts")
    accounts = await api("GET", "/api/agency/accounts")
    campaigns = await api("GET", "/api/agency/campaigns")
    by_acct = {a["id"]: a for a in accounts}
    by_camp = {c["id"]: c for c in campaigns}
    if status:
        rows = [r for r in rows if r.get("status") == status]
    return {
        "total": len(rows),
        "posts": [{"id": r["id"], "scheduled": r.get("scheduled"), "status": r.get("status"),
                   "account": (by_acct.get(r.get("account_id")) or {}).get("handle", "?"),
                   "platform": (by_acct.get(r.get("account_id")) or {}).get("platform", ""),
                   "campaign": (by_camp.get(r.get("campaign_id")) or {}).get("name", ""),
                   "video": r.get("video_title") or r.get("video_key"), "caption": (r.get("caption") or {}).get("title", ""),
                   "views": r.get("views", 0), "earnings": r.get("earnings", 0), "url": r.get("url", "")}
                  for r in rows[:max(1, limit)]],
        "accounts": [{"id": a["id"], "handle": a["handle"], "platform": a["platform"], "times": a.get("times", [])} for a in accounts],
        "campaigns": [{"id": c["id"], "name": c["name"], "rate": c.get("rate"), "platforms": c.get("platforms"),
                       "earned": (c.get("stats") or {}).get("earned")} for c in campaigns],
    }


@mcp.tool()
async def plan_post(video: str, account: str, scheduled: str = "", campaign: str = "", caption_title: str = "",
                    description: str = "", hashtags: list[str] | None = None, notes: str = "") -> dict:
    """Add a post to the agency planner (a plan only: the person publishes by hand). `video` is an export id (from
    list_exports), a key like "export:<id>" or "clip:<id>", or just a title. `account` is an account id or handle
    and `campaign` a campaign id or name (both from list_posts). `scheduled` is "YYYY-MM-DD HH:MM" (empty = unscheduled).
    The caption defaults to the export's post text."""
    videos = await api("GET", "/api/agency/videos")
    v = next((x for x in videos if video in (x["key"], x["id"])), None)
    accounts = await api("GET", "/api/agency/accounts")
    a = next((x for x in accounts if account in (x["id"], x["handle"]) or x["handle"].lstrip("@").lower() == account.lstrip("@").lower()), None)
    if not a:
        raise ToolError(f"No account '{account}'. Accounts: " + (", ".join(f"{x['handle']} ({x['platform']})" for x in accounts)
                                                             or "none yet; add one on Cutroom's Agency page."))
    body: dict = {"account_id": a["id"], "scheduled": scheduled, "notes": notes, "status": "planned"}
    if v:
        body["video_key"], body["video_title"] = v["key"], v["title"]
    else:
        body["video_title"] = video
    if campaign:
        camps = await api("GET", "/api/agency/campaigns")
        c = next((x for x in camps if campaign in (x["id"], x["name"]) or x["name"].lower() == campaign.lower()), None)
        if not c:
            raise ToolError(f"No campaign '{campaign}'. Campaigns: " + (", ".join(x["name"] for x in camps) or "none"))
        body["campaign_id"] = c["id"]
    meta = (v or {}).get("meta") or {}
    body["caption"] = {"title": caption_title or meta.get("title", ""), "description": description or meta.get("description", ""),
                       "hashtags": hashtags if hashtags is not None else meta.get("hashtags", [])}
    row = await api("POST", "/api/agency/posts", body=body)
    return {"ok": True, "post": {"id": row["id"], "scheduled": row.get("scheduled"), "status": row.get("status"),
                                 "account": a["handle"], "video": row.get("video_title") or row.get("video_key"),
                                 "caption": row.get("caption")},
            "matched_video": bool(v)}


@mcp.tool(annotations=READ)
async def job_status(job_id: str, wait_seconds: float = 0, ctx: Context = None) -> dict:
    """Check a Cutroom background job (from a tool that timed out). wait_seconds > 0 waits up to that long for it to
    finish and returns its result."""
    if wait_seconds > 0:
        done, result = await run_job(ctx, {"job_id": job_id}, wait_seconds)
        if done:
            return {"job_id": job_id, "status": "done", "result": result}
        return result
    j = await api("GET", f"/api/jobs/{job_id}")
    return {k: j.get(k) for k in ("id", "title", "status", "progress", "message", "error", "result")}


@mcp.tool()
async def cancel_job(job_id: str) -> dict:
    """Cancel a running Cutroom job."""
    res = await api("POST", f"/api/jobs/{job_id}/cancel")
    return {"ok": bool(res.get("ok")), "job_id": job_id}


# ---------------------------------------------------------------- resources

async def _resource_get(path: str, **kw: Any) -> Any:
    try:
        return await anyio.to_thread.run_sync(functools.partial(client.request, "GET", path, **kw))
    except CutroomError as e:
        raise ResourceError(str(e)) from None


@mcp.resource("cutroom://projects", name="projects", mime_type="application/json")
async def projects_resource() -> str:
    """Every project with its clips (JSON)."""
    return json.dumps(await list_projects(limit=1000), indent=1)


@mcp.resource("cutroom://projects/{project_id}/transcript", name="transcript", mime_type="text/plain")
async def transcript_resource(project_id: str) -> str:
    """A project's transcript as text, one line per sentence with its start time in seconds."""
    p = await _resource_get(f"/api/projects/{project_id}")
    words = (p.get("transcript") or {}).get("words") or []
    if not words:
        return "(no transcript yet)"
    lines, cur, t0 = [], [], None
    for w in words:
        if t0 is None:
            t0 = w["start"]
        cur.append(w["text"])
        if re.search(r"[.!?]$", w["text"]) or len(cur) >= 40:
            lines.append(f"[{t0:.1f}] {' '.join(cur)}")
            cur, t0 = [], None
    if cur:
        lines.append(f"[{t0:.1f}] {' '.join(cur)}")
    return "\n".join(lines)


@mcp.resource("cutroom://projects/{project_id}/transcript.srt", name="transcript-srt", mime_type="application/x-subrip")
async def transcript_srt_resource(project_id: str) -> str:
    """A project's transcript as SRT subtitles."""
    return await _resource_get(f"/api/projects/{project_id}/transcript.srt", raw=True)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="python -m server.mcp_server", description="MCP server (stdio) for a running Cutroom.")
    ap.add_argument("--url", default=os.environ.get("CUTROOM_URL", DEFAULT_URL),
                    help=f"Cutroom's address (default: CUTROOM_URL or {DEFAULT_URL})")
    ap.add_argument("--password", default=os.environ.get("CUTROOM_PASSWORD", ""),
                    help="password for the server edition (default: CUTROOM_PASSWORD)")
    a = ap.parse_args(argv)
    client.__init__(a.url, a.password)
    print(f"Cutroom MCP server for {client.url}", file=sys.stderr)
    mcp.run()


if __name__ == "__main__":
    main()
