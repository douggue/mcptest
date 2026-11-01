# Animated shorts: "The Building That Cooked Breakfast"

An original 63-second vertical cartoon short made with the **cartoon-3d-short** skill
(`.claude/skills/cartoon-3d-short/`, vendored from
[mromidev/claude-animated-shorts](https://github.com/mromidev/claude-animated-shorts)). It uses the skill's style:
flat ink characters in a painted three.js world, rendered inside Remotion.

> In 2013 a London skyscraper's curved glass face focused sunlight onto the street and melted parts of a parked
> Jaguar. A reporter fried an egg in the beam. Its architect had done it before: his Las Vegas hotel was already
> scorching people by the pool. Facts and sources are at the top of [`scorch/SCRIPT.md`](scorch/SCRIPT.md).

The voice, music, sound effects, picture and script are all ready. Rendering the video is the one step that needs a
GPU, so run it on your own computer (instructions below).

## Render it on Windows (RTX 3050 laptop: about 15-30 min for 1080p)
1. Install **Node.js 20 or 22 LTS** from <https://nodejs.org> (defaults are fine). Also install **Git**, or download
   this repo as a ZIP.
2. Open **PowerShell** in this folder (`animated-shorts`) and run:
   ```powershell
   npm install
   npm run render:test      # first 5 seconds only: checks everything works (about 1-2 min)
   npm run render           # full video -> out\scorch_1080p.mp4 (with sound)
   npm run render:2k        # optional 1440x2560 version -> out\scorch_2k.mp4
   ```
   The first render downloads a headless Chrome (about 150 MB). `--gl angle` makes Chrome use your graphics card. If
   the laptop has a "battery saver" or "Optimus" mode, plug it in and let Windows use the NVIDIA GPU for `node.exe`
   (NVIDIA Control Panel → Manage 3D settings → Program settings).
3. To scrub through it live: `npm run studio`, which opens the Remotion Studio in your browser.

Each Remotion bundle copies `public/` into your temp folder. If `C:` is short on space, run
`set REMOTION_TMP=D:\remotion-tmp` first, and delete old `remotion-webpack-bundle-*` folders there now and then.

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
