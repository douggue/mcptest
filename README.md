# Cutroom

A personal clipping tool that runs on your own computer. It has five parts:

- **Clipper** – cut a section out of a video link or a local file and save it as MP4, MOV, MP3, M4A, GIF or PNG frames.
- **Shorts studio** – turn a video into captioned vertical shorts: the best moments of a long video, a whole advert, or one story from raw footage, each edited in the style you choose.
- **Styles** – how your shorts look and get made: built-in styles, your copies of them, and styles learned from reference videos and from your own edits.
- **Library** – your exports, music, b-roll, sound effects, logos, voiceovers and templates.
- **Agency** – campaigns, accounts, a posting planner, view and earnings tracking, rule checks and duplicate detection.

Everything is stored in the `data/` folder next to this file (or in `CutroomData` in your user folder when Cutroom sits inside OneDrive or Dropbox, see below). Nothing is uploaded anywhere unless you set up an AI, in which case transcripts and frames are sent to the one you chose (Anthropic, OpenAI or Google).

## Install and run

You need three things installed first:

| Tool | Version | Get it |
|---|---|---|
| Python | 3.10 or newer | python.org |
| Node.js | 18 or newer | nodejs.org |
| ffmpeg | any recent | ffmpeg.org (must be on your PATH) |

Then:

- **Windows:** double-click `start.bat`. Keep the folder out of OneDrive or Dropbox if you can (for example `C:\Cutroom`): they lock files while uploading them, which breaks the install, and would upload every video. If it is inside one, `start.bat` keeps the Python environment in `%LOCALAPPDATA%\Cutroom\venv` and your videos and projects in `%USERPROFILE%\CutroomData` instead.
- **macOS / Linux:** run `./start.sh`

The first run installs the dependencies and builds the interface (a few minutes). After that it starts in seconds. Open <http://127.0.0.1:8000>.

The first export also downloads the renderer's headless browser (about 100 MB), once.

### Updating

Get the new version over the old one and start it as usual:

- **Downloaded as a ZIP:** on GitHub, open the branch you use, choose **Code → Download ZIP**, and unzip it over your Cutroom folder, replacing the files. Use the same folder, so your projects stay where they are.
- **With git:** run `git pull` in the Cutroom folder.

Then double-click `start.bat` (or run `./start.sh`). It notices what changed: it rebuilds the interface when its code changed, reinstalls packages when the requirement files changed, and repairs OpenCV if two copies of it were installed over each other. (Versions of `start.bat` before November 2026 only built the interface once; if you update from one of those, delete the `web\dist` folder once so the new interface is built.)

### Manual steps

```bash
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-optional.txt
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
| AI moment picking, scores, planning edits, Ask, hooks, post text, studying styles | Any AI set up under Settings → AI: a Claude or Gemini API key, or your Claude, ChatGPT or Google subscription through its command-line tool (below). Without one, simpler built-in rules are used where there are some |
| Caption translation | Any AI set up |
| Watching whole reference videos (with their sound) | Gemini: an API key, or your Google subscription through the Antigravity CLI. The others look at still frames |
| Voiceover from a script | Internet (uses the `edge-tts` voice service), or a Gemini key for Google voices |
| Generating images, clips (Gemini Omni 1.2 Flash), voices and music | A Gemini key; billed by Google per use |
| AI upscale | Installed by `start.bat` (optional packages), and a one-time 5 MB download. On Windows it runs on the graphics card |
| CapCut project export | `pip install pycapcut==0.0.4` (in requirements-optional.txt) |
| Stock b-roll search | A free Pexels API key (Settings) |
| Refreshing view counts in Agency | Internet |

## Choosing the AI

Settings → AI lets you pick **Claude** or **Gemini** and paste a key for either or both. Gemini keys are free to create in Google AI Studio and the Flash models work on the free tier. The Gemini model defaults to `gemini-flash-latest`; after saving a key, **Load list** fetches the models your key can actually use. You can also set `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` in the environment instead of saving keys.


**Claude subscription (no API key).** If Claude Code is installed on this computer and signed in with your Claude account, choose *Claude subscription* under Settings → AI. Cutroom then sends every AI request through Claude Code, with its tools switched off, and it counts towards your plan's usage limits like any Claude chat. Pick the model (Opus, Sonnet, Haiku, Fable, or any model name) and the effort there, and press Test. Install Claude Code from https://claude.com/claude-code, then run `claude` once in a terminal to sign in. This is for Cutroom on your own computer only; the password-protected server edition never uses it. Watching whole reference videos still needs Gemini; with this choice, styles are studied from still frames.

**ChatGPT subscription (no API key).** If OpenAI's Codex CLI is installed (`npm install -g @openai/codex`) and signed in with your ChatGPT account (`codex login`), choose *ChatGPT subscription* under Settings → AI. Requests go through `codex exec`, read-only, with your own Codex settings and plugins left out; answers are held to each feature's format with `--output-schema`. Choose the model and reasoning effort there and press Test. It looks at still frames, not whole videos. Own computer only, like the Claude subscription; it can also be picked for studying a style on the style's page.

**Gemini with your Google subscription (no API key), for chosen tasks.** If the Antigravity CLI (`agy`) is installed and signed in with your Google AI Pro or Ultra account, Settings → AI can send *finding moments* and/or *studying and reviewing style references* to it, while everything else keeps the provider above. It watches reference videos whole, with their sound, but slowly (about five minutes for a 30-second video). Install it from https://antigravity.google, run `agy` once to sign in, then tick the tasks and press Test. Since June 2026 the Gemini CLI no longer takes personal Google sign-ins, which is why Cutroom uses `agy`. Own computer only, like the Claude subscription.

On the same card: a model for each task (*Load models* asks `agy` for the ones your plan offers, or type any name); *Whole videos, frame by frame as backup* or *Frame by frame only (faster)*; and *Backup for everything else*, which sends any request to Gemini when the main AI fails (usage limit reached, signed out, an error). Because the CLI cannot be held to an answer format, every answer is checked against the format the feature needs and sent back once with the problems listed if it does not fit.

## Clipper

Paste a link or drop a file, set the range with the slider or the time boxes, choose format, quality, shape and cut mode, and save. You can queue several ranges from one video, or paste several links to cut with the same settings. For links, only the selected section is downloaded. Saved clips can be sent to the studio.

## Shorts studio

1. **Import** a long video from a link or a file.
2. **Transcribe** it with Whisper, with the site's own captions, or by importing an SRT, VTT or JSON file.
3. **Make clips.** Pick the style first; each style makes its short its own way:
   - **Brand ad:** *Make the short* uses the whole advert (the fade from black at the start and the held last second are trimmed). There are no moments to find.
   - **Storyline, Kindness story, Clean story, Neon story:** one story from raw footage: *Use the whole video*, or mark where the story starts and ends. Each style shows the length it works best at.
   - **Narrated story:** finds the one moment the narration sets up.
   - **No style or your own styles:** *Find moments*: highlights, a series (Part 1, 2, 3…), every moment on a topic, a recap of the main points, or a trailer that holds back the ending. Pick a length, add instructions in your own words, or mark a clip by hand. Each clip gets a hook title and a 0–100 score; once five or more of your posted clips have views, the AI is told what worked for your audience. A video under 90 seconds can also simply become the short.

   Select clips to merge them, or export them all at once.
4. **Edit** each clip. At the top of the side panel, the chosen style's own steps are a checklist: the ones the program can see tick themselves (music added, edit planned, title written…), the rest you tick, and each opens the tool where it is done. *Plan the edit* (Style) has the AI place the style's titles, captions, callouts, freezes and speed changes, within what the style allows. **Simple view** (the default) folds less-used settings away; *Show all tools* shows everything.
   - *Framing* – detect camera cuts and frame each shot: on the speaker, on two people together when they fit, or on the action when there is no face; follow movement; split for two or three people, or fit the whole frame over a blur. Fourteen transitions between shots (including whip up and dip-and-defocus) with adjustable length. Zooms, freezes, speed changes, title and opening hook. Audio: voice clean-up; music with ducking, a song start, *Drop at the playhead* to land the music's drop on a moment, fades, and *replaces the original sound*; your **camera-flash sound** (styles play it on their flashes or spotlights); and a voiceover, which can be **transcribed into the captions** (the clip's own sound can pause while the narrator speaks).
   - *Style* – caption styles, fonts, colours, emojis, translation, colour looks with brightness, contrast, saturation, **sharpen** and **warmth**, film grain, cinema bars, slow push-in, fade in and out, mirror, brand kit, templates, and the style itself (see Styles).
   - *Words* – remove silences and filler words, or click any word to cut, rewrite or emphasise it.
   - *Motion* – keyword pops, cascades, gauges, counters, lower thirds, step lists, emoji bursts, b-roll, text labels, name tags, circles, arrows, spotlights, image stickers and blur boxes (to hide a face or number plate), each with placement, animation (including letter-by-letter typing and word by word) and sound. **Follow the person** makes a name tag, circle, arrow, label or spotlight move with whoever or whatever it sits on.
   - *Export* – post title, description and hashtags; 9:16, 4:5, 3:4, 1:1 or 16:9; 30 or 60 fps; 1080p or 720p; **smooth 60 fps** (new in-between frames for 24–30 fps footage; slow); optional **AI upscale** for low-resolution footage; the loudness is evened out to the style's level; captions as an `.srt` file; or **Finish in CapCut** (below).

**AI upscale.** Sharpens CCTV, dashcam and old phone footage with Real-ESRGAN before the short is made (installed by `start.bat`; a 5 MB model downloads on first use). Storyline turns it on by default. On a processor it is slow (about 1.2 seconds per frame on four cores, roughly 15 to 20 minutes for a 30-second short); on Windows `start.bat` sets it up to run on the graphics card, which is much faster.

**Finish in CapCut.** Sends the edit to CapCut as a project you can keep editing: every cut and speed change, freeze frames, framing (tracking and punch-ins as keyframes), split screens, b-roll, logo, captions, title, text graphics, watermark, voice, voiceover, music and sound effects, each on its own track. On the same computer it is saved straight into CapCut; otherwise you download a zip to unpack into CapCut's projects folder. Effects CapCut cannot import (animated cards, circles, arrows, the word-by-word caption highlight, colour looks) are listed after the export. This uses the open-source `pycapcut` library and has not yet been opened in CapCut by us; tell us if a project does not open.

**Edit by asking:** type a change in the box at the top of the editor ("make the title red and freeze for a second when he says sorry"). The AI picks the changes, the editor applies them as one step that Ctrl+Z undoes, and says what it could not do. Needs an AI set up.

**Split:** Export → "Split into two" cuts a clip at the playhead; each half keeps its edits.

**Editing on the video:** click the captions, hook title, logo, watermark or a motion graphic in the preview to select it, drag to move it, and drag its corner to resize it. Double-click a title to edit its text. Positions snap to the centre line, and Style → Brand kit has a button to reset them.

Shortcuts in the editor: Space plays, ←/→ step a frame (Shift for a second), Ctrl+Z / Ctrl+Shift+Z undo and redo, Delete removes the selected graphic, Esc clears the selection.

## Styles

The **Styles** page (left menu) lists the built-in styles and your own; each style has its own page.

| Built-in style | For | Step 2 |
|---|---|---|
| Storyline | CCTV, dashcam and phone clips: square picture, title that stays up, boxed captions, freeze-frame spotlights | One story from the footage |
| Kindness story | Feel-good stories: typed narration, callout freeze, colour flashes, heart at the end; music replaces the sound | One story, about 20–35 s |
| Clean story | Brighter story in quoted labels, name tag, callouts; no freezes | One story, about 16–22 s |
| Neon story | Caption-only story in neon text, spotlight and twist freeze; original sound | One story, about 14–27 s |
| Brand ad | A TV advert as a short: channel header, two-line colour title, rounded box, word captions | The whole advert |
| Narrated story | Your voiceover with glowing centre captions, a new shot every few seconds | One moment |

Each built-in style also decides what the AI may add (Storyline: no circles or arrows; Brand ad: no extra graphics, sound effects or emoji), its sound (music, camera-flash sound, loudness), its framing (Brand ad follows moving subjects) and its steps. Built-in styles are fixed; **Copy to make it yours** (or *Copy to teach it* in the editor) makes a copy you can change and teach.

On a style's page:

- **AI for studying and reviewing** – choose which AI does the work below: Claude or ChatGPT (your subscription or a key), or Gemini. **Each AI keeps its own findings**, and *Use these* switches which ones the style follows.
- **Reference videos** – videos made in the style, saved with it. The built-in styles list the reference links from your skills (*Download N listed*); add any link or file. *Study the style* (your own styles) builds the look and rules from them.
- **What the AI remembers** – *Review again* has the AI look at the saved references and write down what to match; that list goes with every AI request in the style, and *Plan the edit* also looks at frames from the references each time.
- **Before and after: learn from your own edits** – add a raw video and the short made from it. Cutroom lines the two up by their sound and measures every decision (trims, where each shot is framed, punch-ins, pans); *Understand this edit* has the AI explain each one and why; *Learn the style* turns what holds across all your pairs into the style's rules. The more pairs, the better it separates the style from one video's content.
- **Rules** – what the AI follows, including corrections you teach from the editor.

## Agency

Campaigns hold the pay rate, budget and rules (required hashtags, banned words, duration limits). The planner schedules posts per account and can distribute one video across several accounts. Cutroom posts to **YouTube** (below); for TikTok and Instagram it plans and tracks, and you post by hand. Rule checks run before you submit, and duplicate detection warns about overlapping clips.

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

## Graphics card

Settings → **Graphics card** shows what runs on it. Cutroom finds the card's own video encoder (NVIDIA, AMD, Intel, or Apple on a Mac) and uses it for encoding; on Windows the export draws through the card and `start.bat` sets the AI upscaler up on it (DirectML, any card), and on an NVIDIA card adds the libraries Whisper needs (about 1 GB, once). Anything that fails on the card is done again on the processor. Switch it off there if an export ever shows glitches. Smooth 60 fps stays on the processor.

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
- Whisper uses an NVIDIA graphics card when its libraries are installed (`start.bat` does it) and the processor otherwise.
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
  gpu.py            using the graphics card, with the processor as fallback
  studio/           transcription, moments, vision, render, AI, styles (presets.py, profiles.py),
                    before-and-after edit comparison (compare.py)
  routers/          HTTP endpoints
web/                interface (React + Vite)
  src/remotion/     the short itself: one composition used for preview and render
  src/studio/       the editor
  render.mjs        renders a spec to MP4
data/               your videos, projects, exports and settings (not in git)
```
