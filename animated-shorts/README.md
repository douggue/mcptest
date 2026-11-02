# Animated shorts: "The Building That Cooked Breakfast"

An original 63-second vertical cartoon short made with the **cartoon-3d-short** skill
(`.claude/skills/cartoon-3d-short/`, vendored from
[mromidev/claude-animated-shorts](https://github.com/mromidev/claude-animated-shorts)). It uses the skill's style:
flat ink characters in a painted three.js world, rendered inside Remotion.

> In 2013 a London skyscraper's curved glass face focused sunlight onto the street and melted parts of a parked
> Jaguar. A reporter fried an egg in the beam. Its architect had done it before: his Las Vegas hotel was already
> scorching people by the pool. Facts and sources are at the top of [`scorch/SCRIPT.md`](scorch/SCRIPT.md).

Preview: [`preview/scorch_preview.mp4`](preview/scorch_preview.mp4) is a 2 fps rough cut with the final sound, rendered without a GPU. [`preview/contact.jpg`](preview/contact.jpg) shows one frame per beat.

The voice, music, sound effects, picture and script are all ready. Rendering the video is the one step that needs a
GPU, so run it on your own computer (instructions below).

## Render it on Windows (RTX 3050 laptop)
1. Install **Node.js 20 or 22 LTS** from <https://nodejs.org> and **Git** (defaults are fine).
2. Open **PowerShell** in this folder (`animated-shorts`). If PowerShell says "running scripts is disabled", type
   `npm.cmd` instead of `npm` below, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
   ```powershell
   npm install
   npm run gpu              # check the GPU is used: look for "WebGL: Hardware accelerated"
   npm run render:test      # 70 frames around a crossfade: check speed (frames/s) and that it finishes
   npm run render           # full video -> out\scorch_1080p.mp4 (with sound)
   npm run render:emu       # the Emu War short -> out\emu_1080p.mp4
   ```
   The renders use `--gl angle` (Direct3D on your GPU) and `--chrome-mode chrome-for-testing` (a Chrome build with
   full GPU support; it downloads about 150 MB once), with 3 tabs in parallel (`--concurrency 3`). If a render is
   slow, try `--concurrency 2` or `4` on `render:test` and keep whichever gives the most frames per second.
   Plug the laptop in, and in **NVIDIA Control Panel → Manage 3D settings → Program settings** set `chrome.exe`
   and `node.exe` to "High-performance NVIDIA processor".
3. To scrub through it live: `npm run studio`.

Each Remotion bundle copies `public/` into your temp folder. If `C:` is short on space, run
`$env:REMOTION_TMP="D:\remotion-tmp"` first, and delete old `remotion-webpack-bundle-*` folders there now and then.

## What's where
| Path | What |
|---|---|
| `src/videos/scorch/story.ts` | Shot plan: 16 shots timed to the voice's word timings, camera moves, lens blur per beat, impact kicks |
| `src/videos/scorch/world.ts` | The world: Eastcheap street, concave tower, sunbeam, sunshade fins, flat-window diagram, Las Vegas pool, cast and props per shot |
| `src/videos/scorch/draw.ts` | Ink drawings of the props: melting car, doormat, bike, frying pan and egg, magnifying glass, leaf, rosette, palms, loungers, umbrellas |
| `src/videos/scorch/Scorch.tsx` | Post chain: ink → lens blur → bloom → tone map → grade, plus the soundtrack |
| `src/videos/bridge/` | The skill's original bridge short. Its characters, shading, ink, lens and grade modules are shared |
| `public/scorch/mix.wav` | Final sound mix (voice, music and sound effects, -14 LUFS) |
| `scorch/SCRIPT.md` | Facts, sources and voice-over script |
| `scorch/voice/` | `voice.wav` (Piper TTS, `en_US-ryan-high`), `words.json` (word timings from faster-whisper) |
| `scorch/audio/score.py` | Original score + synthesized sound effects + mix (writes `mix.wav` and `cues.md`) |
| `scripts/stills.mjs` | Renders single frames for look checks: `npm run stills` |
| `SKILL_REVIEW.md` | Code and safety review of the skill, plus what doesn't work out of the box |

## Changing it
- **New voice:** `pip install piper-tts faster-whisper scipy`, then:
  ```
  python -m piper -m en_US-ryan-high.onnx --length-scale 0.88 --sentence-silence 0.12 -f scorch/voice/voice_raw.wav < scorch/voice/vo.txt
  ffmpeg -i scorch/voice/voice_raw.wav -ar 48000 -ac 1 scorch/voice/voice.wav
  python scorch/tools/align.py scorch/voice/voice.wav scorch/voice/words.json
  ```
  Then re-time `SHOTS`/`CAMS` in `story.ts`, and re-run the sound:
  `cd scorch/audio && python score.py && copy mix.wav ..\..\public\scorch\mix.wav`.
- **Your own voice:** record `voice.wav` (48 kHz) and run `align.py` the same way.
- **Silent render:** add `--props "{\"mute\":true}"` to the render command.
