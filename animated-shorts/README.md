# Animated shorts: "The Building That Cooked Breakfast"

An original 63-second vertical cartoon short made with the **cartoon-3d-short** skill
(`.claude/skills/cartoon-3d-short/`, vendored from
[mromidev/claude-animated-shorts](https://github.com/mromidev/claude-animated-shorts)). It uses the skill's style:
flat ink characters in a painted three.js world, rendered inside Remotion.

> In 2013 a London skyscraper's curved glass face focused sunlight onto the street and melted parts of a parked
> Jaguar. A reporter fried an egg in the beam. Its architect had done it before: his Las Vegas hotel was already
> scorching people by the pool. Facts and sources are at the top of [`scorch/SCRIPT.md`](scorch/SCRIPT.md).

**Version 2 (current, `Scorch2Short`, rendered by `npm run render`)** is a rebuild after feedback on v1:
- **Voice:** Kokoro TTS (`af_heart`, the highest-rated Kokoro voice) with a tighter script
  ([`scorch2/SCRIPT.md`](scorch2/SCRIPT.md)). The tools to regenerate it are in `scorch2/tools/`.
- **Acting:** characters gesture (hands on head, cheering, pointing, holding things, thumbs-up), walk, jump and
  react on the word. New free arm poses (`armL`/`armR`) were added to `src/videos/bridge/toon.ts`.
- **18 shots** with closer framing and visual gags: the crane on the roof, the spoon and satellite-dish pop-ins, a
  time-lapse sun, a cyclist leaping off the seat, the coffee drop, a tourist diving into the pool.
- **Reviewed in motion:** two rounds of full-length 6 fps previews in which every shot was checked and fixed, then
  a 10 fps preview with sound ([`preview/scorch_v2_preview.mp4`](preview/scorch_v2_preview.mp4)).

Version 1 is still there as `ScorchShort` (`npm run render:v1`, preview in `preview/scorch_preview.mp4`).

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
   npm run render           # full v2 video -> out\scorch_v2_1080p.mp4 (with sound)
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

## Short #2: "The War the Army Lost to Birds" (the Great Emu War, 1932)
In 1932 the Australian army sent a major, two soldiers, two Lewis guns and 10,000 bullets against 20,000 emus, and
lost. Facts and sources: [`emu/SCRIPT.md`](emu/SCRIPT.md). Render it with `npm.cmd run render:emu:test` (5 s check),
then `npm.cmd run render:emu` → `out\emu_1080p.mp4`. Code: `src/videos/emu/` (story, world, ink drawings of the
emus, truck, Lewis gun, crates, gum trees, tally board). Sound: `emu/audio/score.py` (comic march, gunfire, the jam,
the truck, emu feet and drumming).

## What's where
| Path | What |
|---|---|
| `src/videos/scorch2/` | **v2** (current): `story.ts` shot plan + cameras, `world.ts` world + per-shot acting, `draw.ts` props (spoon, dish, coffee, cash, flame, trophy...), `Scorch2.tsx` post + sound |
| `scorch2/` | v2 script, Kokoro voice + word timings, sound (`audio/score.py`), voice tools (`tools/tts.py`, `tools/wer.py`) |
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
