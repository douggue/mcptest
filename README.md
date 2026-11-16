# Cutroom

A personal clipping tool that runs on your own computer. It has four parts:

- **Clipper** – cut a section out of a video link or a local file and save it as MP4, MOV, MP3, M4A, GIF or PNG frames.
- **Shorts studio** – find the best moments in a long video and edit each into a captioned vertical short.
- **Library** – your exports, music, b-roll, sound effects, logos, voiceovers and style templates.
- **Agency** – campaigns, accounts, a posting planner, view and earnings tracking, rule checks and duplicate detection.

Everything is stored in the `data/` folder next to this file. Nothing is uploaded anywhere unless you add an AI key, in which case transcripts are sent to the Anthropic API.

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
| AI moment picking, scores, remix, hooks, post text | An Anthropic API key (Settings → AI). Without one, simpler built-in rules are used |
| Caption translation | An Anthropic API key |
| Voiceover from a script | Internet (uses the `edge-tts` voice service) |
| Stock b-roll search | A free Pexels API key (Settings) |
| Refreshing view counts in Agency | Internet |

## Clipper

Paste a link or drop a file, set the range with the slider or the time boxes, choose format, quality, shape and cut mode, and save. You can queue several ranges from one video, or paste several links to cut with the same settings. For links, only the selected section is downloaded. Saved clips can be sent to the studio.

## Shorts studio

1. **Import** a long video from a link or a file.
2. **Transcribe** it with Whisper, with the site's own captions, or by importing an SRT, VTT or JSON file.
3. **Find moments.** Each gets a hook title, a reason and a 0–100 score built from hook, flow, value and trend. You can also describe what you are looking for, or mark a clip by hand.
4. **Edit** each clip:
   - *Framing* – detect camera cuts, centre the speaker in each shot, follow movement, split for two or three people, or fit the whole frame over a blur. Zooms, opening hook, audio mixer, voice clean-up, music with ducking, voiceover.
   - *Style* – six caption styles, fonts, colours, emojis, translation, colour looks, brand kit, reusable templates.
   - *Words* – remove silences and filler words, or click any word to cut, rewrite or emphasise it.
   - *Motion* – keyword pops, cascades, gauges, counters, lower thirds, step lists, emoji bursts and b-roll, each with placement, animation and sound. "AI remix" plans them for you.
   - *Export* – post title, description and hashtags; 9:16, 4:5, 1:1 or 16:9; 30 or 60 fps; 1080p or 720p.

Shortcuts in the editor: Space plays, ←/→ step a frame (Shift for a second), Ctrl+Z / Ctrl+Shift+Z undo and redo.

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

## Copy to Google Drive

Set **Settings → Also copy finished files to this folder** to your Google Drive (or Dropbox, OneDrive) desktop folder. Every clip and export is copied there and syncs to the cloud. There is no direct Drive login.

## Docker

```bash
docker compose up --build        # then open http://127.0.0.1:8000
```

The compose file binds to localhost only. The app has no login, so do not expose it to the internet without a password-protected proxy in front. Note that video sites often block downloads from datacenter addresses; on a rented server, upload source videos instead.

## Using it from a phone

Start with `python run.py --host 0.0.0.0` and open `http://<your computer's address>:8000` from a phone on the same Wi-Fi. Anyone on that network can then open it, so only do this on a network you trust.

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
