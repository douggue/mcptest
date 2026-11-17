# Cutroom

A personal clipping tool that runs on your own computer. It has four parts:

- **Clipper** – cut a section out of a video link or a local file and save it as MP4, MOV, MP3, M4A, GIF or PNG frames.
- **Shorts studio** – find the best moments in a long video and edit each into a captioned vertical short.
- **Library** – your exports, music, b-roll, sound effects, logos, voiceovers and style templates.
- **Agency** – campaigns, accounts, a posting planner, view and earnings tracking, rule checks and duplicate detection.

Everything is stored in the `data/` folder next to this file. Nothing is uploaded anywhere unless you add an AI key, in which case transcripts are sent to the provider you chose (Anthropic or Google).

## Install and run

You need three things installed first:

| Tool | Version | Get it |
|---|---|---|
| Python | 3.10 or newer | python.org |
| Node.js | 18 or newer | nodejs.org |
| ffmpeg | any recent | ffmpeg.org (must be on your PATH) |

Then:

- **Windows:** double-click `start.bat`
- **macOS / Linux:** run `./start.sh`

The first run installs the dependencies and builds the interface (a few minutes). After that it starts in seconds. Open <http://127.0.0.1:8000>.

The first export also downloads the renderer's headless browser (about 100 MB), once.

### Manual steps

```bash
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd web && npm install && npm run build && cd ..
python run.py                                     # --port 8000 --host 127.0.0.1
```

For development, run `python run.py` and, in another terminal, `cd web && npm run dev` (interface on port 5173 with live reload).

## What needs a key or internet

| Feature | Needs |
|---|---|
| Clipping local files, editing, rendering | Nothing |
| Clipping or importing from a link | Internet. Sites change often, so if links stop working run `pip install -U "yt-dlp[default]"` |
| Whisper transcription | A one-time model download on first use |
| AI moment picking, scores, remix, hooks, post text | A Claude (Anthropic) or Gemini (Google) API key (Settings → AI). Without one, simpler built-in rules are used |
| Caption translation | A Claude or Gemini API key |
| Voiceover from a script | Internet (uses the `edge-tts` voice service), or a Gemini key for Google voices |
| Generating images, clips (Gemini Omni 1.2 Flash), voices and music | A Gemini key; billed by Google per use |
| AI upscale | `pip install onnx onnxruntime`, and a one-time 5 MB download |
| CapCut project export | `pip install pycapcut==0.0.4` (included in requirements) |
| Stock b-roll search | A free Pexels API key (Settings) |
| Refreshing view counts in Agency | Internet |

## Choosing the AI

Settings → AI lets you pick **Claude** or **Gemini** and paste a key for either or both. Gemini keys are free to create in Google AI Studio and the Flash models work on the free tier. The Gemini model defaults to `gemini-flash-latest`; after saving a key, **Load list** fetches the models your key can actually use. You can also set `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` in the environment instead of saving keys.

## Clipper

Paste a link or drop a file, set the range with the slider or the time boxes, choose format, quality, shape and cut mode, and save. You can queue several ranges from one video, or paste several links to cut with the same settings. For links, only the selected section is downloaded. Saved clips can be sent to the studio.

## Shorts studio

1. **Import** a long video from a link or a file.
2. **Transcribe** it with Whisper, with the site's own captions, or by importing an SRT, VTT or JSON file.
3. **Find moments.** Choose what to make: highlights, a series (Part 1, 2, 3…), every moment on a topic, a recap of the main points, or a trailer that holds back the ending. Pick a length (Auto, Short, Medium, Long), add instructions in your own words, or mark a clip by hand. Each clip gets a hook title and a 0–100 score. Once five or more of your posted clips have views, the AI is told what worked for your audience. Select clips to merge them, or export them all at once.
4. **Edit** each clip:
   - *Framing* – detect camera cuts, centre the speaker in each shot, follow movement, split for two or three people, or fit the whole frame over a blur. Twelve transitions between shots (cross-fade, slide, push, zoom, whip pan, spin, blur, flash, dip to black, glitch, smooth pan, hard cut) with adjustable length. Zooms, freezes, speed changes, opening hook, audio mixer, voice clean-up, music with ducking, voiceover.
   - *Style* – caption styles, fonts, colours, emojis, translation, colour looks with brightness, contrast and saturation, film grain, cinema bars, slow push-in, fade in and out, mirror, brand kit, reusable templates and learned styles.
   - *Words* – remove silences and filler words, or click any word to cut, rewrite or emphasise it.
   - *Motion* – keyword pops, cascades, gauges, counters, lower thirds, step lists, emoji bursts, b-roll, text labels, name tags, circles, arrows, spotlights, image stickers and blur boxes (to hide a face or number plate), each with placement, animation and sound, and a Duplicate button. "AI remix" plans them for you.
   - *Export* – post title, description and hashtags; 9:16, 4:5, 3:4, 1:1 or 16:9; 30 or 60 fps; 1080p or 720p; optional **AI upscale** for low-resolution footage; captions as an `.srt` file; or **Finish in CapCut** (below).

**AI upscale.** Sharpens CCTV, dashcam and old phone footage with Real-ESRGAN before the short is made (needs `pip install onnx onnxruntime`; a 5 MB model downloads on first use). It is slow on a processor: about 1.2 seconds per frame on four cores, so roughly 15 to 20 minutes for a 30-second short. A graphics card is much faster.

**Finish in CapCut.** Sends the edit to CapCut as a project you can keep editing: every cut and speed change, freeze frames, framing (tracking and punch-ins as keyframes), split screens, b-roll, logo, captions, title, text graphics, watermark, voice, voiceover, music and sound effects, each on its own track. On the same computer it is saved straight into CapCut; otherwise you download a zip to unpack into CapCut's projects folder. Effects CapCut cannot import (animated cards, circles, arrows, the word-by-word caption highlight, colour looks) are listed after the export. This uses the open-source `pycapcut` library and has not yet been opened in CapCut by us; tell us if a project does not open.

**Edit by asking:** type a change in the box at the top of the editor ("make the title red and freeze for a second when he says sorry"). The AI picks the changes, the editor applies them as one step that Ctrl+Z undoes, and says what it could not do. Needs an AI key.

**Split:** Export → "Split into two" cuts a clip at the playhead; each half keeps its edits.

**Editing on the video:** click the captions, hook title, logo, watermark or a motion graphic in the preview to select it, drag to move it, and drag its corner to resize it. Double-click a title to edit its text. Positions snap to the centre line, and Style → Brand kit has a button to reset them.

Shortcuts in the editor: Space plays, ←/→ step a frame (Shift for a second), Ctrl+Z / Ctrl+Shift+Z undo and redo, Delete removes the selected graphic, Esc clears the selection.

## Agency

Campaigns hold the pay rate, budget and rules (required hashtags, banned words, duration limits). The planner schedules posts per account and can distribute one video across several accounts. Cutroom **does not upload to TikTok, YouTube or Instagram**; it plans and tracks, and you post by hand. Rule checks run before you submit, and duplicate detection warns about overlapping clips.

## Command line

```bash
python -m server.cli clip "https://…" --start 1:35:56 --end 1:43:31 --aspect 9:16
python -m server.cli shorts podcast.mp4 --count 5 --min 20 --max 60
python -m server.cli shorts "https://…" --engine youtube --query "the part about sleep"
```

`shorts` runs the whole pipeline (transcribe, pick moments, centre the speaker, tighten, add graphics, render) and prints the finished files. Run either command with `--help` for all options.

The web API is documented at <http://127.0.0.1:8000/docs> while the app is running.

## Posting to YouTube

Settings → YouTube connects your own channels with your own Google Cloud OAuth client, and the Export panel and the Agency planner then post a short now or at a set time, and read its views, likes and comments back. Setup in [docs/YOUTUBE.md](docs/YOUTUBE.md). Until Google audits your app, uploads arrive as private; make them public in YouTube Studio.

## Using Cutroom from Claude (MCP)

`python -m server.mcp_server` lets Claude Desktop, Claude Code or any MCP client import videos, find moments, edit and export clips, and more, on a running Cutroom. Setup in [docs/MCP.md](docs/MCP.md).

## Copy to Google Drive

Set **Settings → Also copy finished files to this folder** to your Google Drive (or Dropbox, OneDrive) desktop folder. Every clip and export is copied there and syncs to the cloud. There is no direct Drive login.

## Two editions

- **On your computer** (this README): everything, including link downloads and local tools. No login, because it only listens to this machine.
- **On a server**: the same app behind a password, reachable from anywhere, using the Claude and Gemini APIs. See [DEPLOY.md](DEPLOY.md) for step-by-step setup with Docker and automatic HTTPS.

Setting `CUTROOM_PASSWORD` before starting turns the login on in either case.

## Using it from a phone

Start with `python run.py --host 0.0.0.0` and open `http://<your computer's address>:8000` from a phone on the same Wi-Fi. Set `CUTROOM_PASSWORD` first so that others on the network have to sign in.

## Good to know

- YouTube links need a JavaScript runtime for `yt-dlp`; Cutroom points it at the Node.js you already installed, so there is nothing extra to set up.
- Whisper uses a graphics card when one is set up for it and falls back to the processor otherwise.
- Only clip videos you have the right to use. Downloading from a site may be against its terms unless the owner has allowed it, as clipping campaigns usually do.
- Rendering takes roughly two to five times the clip's length on a typical laptop.
- For sharper vertical crops from a wide video, import at 1440p or 4K.
- Emoji use your operating system's emoji font.
- Rendering uses [Remotion](https://www.remotion.dev), which is free for individuals and small teams; larger companies need a Remotion licence.
- Face detection uses OpenCV. On first use it tries to download a better detector (YuNet) and falls back to the built-in one if it cannot.

## Layout

```
run.py              start the server
server/             Python API (FastAPI)
  clipper_core.py   cutting, formats, yt-dlp
  agency_core.py    earnings, rule checks, duplicates
  studio/           transcription, moments, vision, render, AI
  routers/          HTTP endpoints
web/                interface (React + Vite)
  src/remotion/     the short itself: one composition used for preview and render
  src/studio/       the editor
  render.mjs        renders a spec to MP4
data/               your videos, projects, exports and settings (not in git)
```
