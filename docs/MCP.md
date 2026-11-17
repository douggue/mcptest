# Using Cutroom from Claude (MCP)

Cutroom comes with an MCP server, so Claude Desktop, Claude Code or any other MCP client can import videos, find
clips, edit and export them, cut with the Clipper, generate media and plan posts for you.

The MCP server is a small separate program (`server/mcp_server.py`). It talks to a **running** Cutroom over its
normal web API, the same way the browser does, so:

- Cutroom has to be running (`python run.py`, or the server edition).
- It works the same with a Cutroom on this computer or on a server elsewhere.
- It needs nothing beyond Cutroom's own virtualenv (the `mcp` package is in `requirements.txt`).

```
python -m server.mcp_server [--url http://127.0.0.1:8000] [--password ...]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--url` | `CUTROOM_URL`, else `http://127.0.0.1:8000` | Where Cutroom is running |
| `--password` | `CUTROOM_PASSWORD` | The login password of the server edition |

Run it from the Cutroom folder, with the Python of Cutroom's virtualenv. Your MCP client starts and stops it for
you; you do not run it by hand.

## Claude Desktop on Windows

1. Start Cutroom as usual (`start.bat` or `python run.py`).
2. In Claude Desktop open **Settings → Developer → Edit Config**. This opens
   `%APPDATA%\Claude\claude_desktop_config.json`.
3. Add Cutroom under `mcpServers`, with your own Cutroom folder in place of `C:\\path\\to\\cutroom`
   (in JSON every backslash is written twice):

```json
{
  "mcpServers": {
    "cutroom": {
      "command": "C:\\path\\to\\cutroom\\.venv\\Scripts\\python.exe",
      "args": ["-m", "server.mcp_server"],
      "env": { "PYTHONPATH": "C:\\path\\to\\cutroom" }
    }
  }
}
```

   Claude Desktop does not let you choose the folder a server starts in, so `PYTHONPATH` tells Python where
   Cutroom's `server` folder is. (Pointing at the file also works:
   `"args": ["C:\\path\\to\\cutroom\\server\\mcp_server.py"]`.)
4. Quit Claude Desktop completely (also from the tray icon) and open it again. Cutroom's tools appear under the
   tools button in a new chat. Try: *"Check Cutroom's status"*.

If Cutroom runs on another port, add `"--url", "http://127.0.0.1:8001"` to `args`.

### A Cutroom on a server (password)

```json
{
  "mcpServers": {
    "cutroom": {
      "command": "C:\\path\\to\\cutroom\\.venv\\Scripts\\python.exe",
      "args": ["-m", "server.mcp_server", "--url", "https://cutroom.example.com"],
      "env": {
        "PYTHONPATH": "C:\\path\\to\\cutroom",
        "CUTROOM_PASSWORD": "your Cutroom password"
      }
    }
  }
}
```

The MCP server signs in with `POST /api/login` and keeps the session cookie. A wrong password comes back as
"Cutroom did not accept the password", and a missing one as "asks for a password".

You still need a copy of the Cutroom folder (and its virtualenv) on the computer running Claude, because that is
where the MCP server runs; nothing else of Cutroom has to run there.

## Claude Code

From the Cutroom folder (Windows; use `.venv/bin/python` on macOS and Linux):

```
claude mcp add cutroom -- .venv\Scripts\python.exe -m server.mcp_server
```

For every project rather than only this folder, add `--scope user` and use full paths plus `PYTHONPATH`:

```
claude mcp add cutroom --scope user -e PYTHONPATH=C:\path\to\cutroom -- C:\path\to\cutroom\.venv\Scripts\python.exe -m server.mcp_server
```

For the server edition add `-e CUTROOM_PASSWORD=...` and `--url https://...` at the end. Or check a `.mcp.json`
into the Cutroom folder:

```json
{
  "mcpServers": {
    "cutroom": {
      "command": ".venv\\Scripts\\python.exe",
      "args": ["-m", "server.mcp_server", "--url", "http://127.0.0.1:8000"]
    }
  }
}
```

`/mcp` inside Claude Code shows whether it connected.

## Tools

Times are seconds in the source video. Long tools (import, transcribe, find moments, export, Clipper,
generation) wait for Cutroom's background job and send progress notifications. Each has a `timeout` (seconds):
when it runs out, the job keeps going in Cutroom and the tool returns its `job_id`, to finish with `job_status`.
Stopping a tool call from the client cancels the Cutroom job.

| Tool | What it does |
| --- | --- |
| `status` | Reachable? Desktop or server edition, AI provider, ffmpeg, number of projects and exports, running jobs |
| `list_projects` | Projects with duration, transcript size and clip count |
| `get_project` | One project's clips (title, score, start/end, hook, style, captions, post text); `include_transcript` + `transcript_chars` for the text |
| `import_video` | New project from a link, a file path on the computer running the MCP server (uploaded, so it also works with a remote Cutroom), or a `/media/...` URL |
| `transcribe` | `engine`: `whisper` (speech-to-text on the Cutroom machine) or `youtube` (the site's captions) |
| `import_transcript` | Use an `.srt`, `.vtt` or word-timing `.json` file instead |
| `find_moments` | Find and add clips: `count`, `min_seconds`, `max_seconds`, `query`, `style`; `kind` and `instructions` are passed through to Cutroom versions that support them |
| `list_styles` | Your styles and the built-in ones |
| `apply_style` | Attach a style to a clip. The full look is applied by Cutroom's editor in the browser, so this sets the clip's style and says so; `find_moments(style=...)` makes clips that already have the look |
| `update_clip` | Title, hook text, start/end (words, cuts and graphics follow, as in the editor), caption preset/case/words/position/size/colours, post title/description/hashtags, status |
| `export_clip` | Render to MP4: `quality` `1080` or `720`, optional AI `upscale`. Returns the URL and the file's path on the Cutroom machine |
| `list_exports` | Rendered shorts with URL and path |
| `clipper_cut` | The Clipper: a plain cut from a link or file, `start`/`end`, `format` (mp4, mov, mp3, m4a, gif, frames), `aspect` (original, 9:16, 1:1, 4:5, 16:9) |
| `generate_image`, `generate_speech`, `generate_music` | Google AI Studio generation into Cutroom's library (needs a Gemini key; `generate_speech` can also use the free Edge voices) |
| `generate_video` | Google video generation. Billed per clip, so it only runs with `confirm=true` |
| `list_posts` | The Agency planner: posts, accounts and campaigns |
| `plan_post` | Add a planned post for an export or clip on an account (Cutroom never publishes anything itself) |
| `job_status`, `cancel_job` | Follow up on, or stop, a Cutroom job |

Resources (read-only): `cutroom://projects` (all projects, JSON),
`cutroom://projects/{project_id}/transcript` (text with a start time per sentence) and
`cutroom://projects/{project_id}/transcript.srt`.

## Good to know

- File paths given to `import_video`, `import_transcript` and `clipper_cut` are read on the computer that runs the
  MCP server and uploaded to Cutroom. Paths in the results (`path_on_cutroom_machine`) are on the Cutroom computer.
- Media URLs in results point at Cutroom. With the server edition, a browser has to be signed in to open them.
- Errors come back as plain messages from Cutroom (for example "Transcribe the video first.") that Claude can act on.
- Built for the `mcp` package 2.x (what `requirements.txt` installs today); it falls back to the 1.x `FastMCP` API on older installs.
