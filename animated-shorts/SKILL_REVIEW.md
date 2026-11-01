# Review: mromidev/claude-animated-shorts (cartoon-3d-short skill)

Reviewed 2026-11-01 at the upstream commit cloned that day. Scope: everything in `SKILL.md`, `templates/` and
`references/*.md`.

## Safety: nothing harmful found
- **No network calls.** The only loader is three.js `GLTFLoader` reading `public/bridge/kenney/*.glb` from the local
  Remotion server, and it tolerates missing files (`.catch(() => [n, null])`).
- **No shell injection.** `subprocess` is used only in `mix.py` and `short_qa.py`, to run `ffprobe`/`ffmpeg` with
  fixed argument lists (no `shell=True`).
- **No `eval`, `exec`, `child_process` or downloads.** No secrets, telemetry or obfuscated code.
- **Destructive operations:** `bridge_merge.py` copies files over `src/videos/bridge/`, but it makes a timestamped
  backup first. `SKILL.md` tells Claude to *ask* before deleting old Remotion temp folders.
- **Licence:** MIT for the code and docs. The 58 reference images (`references/frames`, `references/sheets`) are
  stills from someone else's channel, "for style study only". SKILL.md itself says never to upload or publish them,
  so **they are not copied into this repo**.

## Things that don't work out of the box
1. **Windows-only paths.** `bridge-stills.mjs` hard-codes `C:/Program Files/Google/Chrome/Application/chrome.exe`.
   `SKILL.md` and the comments refer to `D:` and `\remotion-tmp`.
2. **Placeholder paths.** `bridge_merge.py` has `ROOT = os.path.expanduser("your Remotion project")`, and
   `bridge_shots.py` writes to `out/bridge/` without creating it. Both fail as shipped.
3. **No Remotion project included.** You must create one: `src/index.ts`, a `Root.tsx` registering `BridgeShort`,
   and pinned dependency versions. The README doesn't list versions; the set that works is in `package.json` here.
4. **Missing assets.** The Kenney CC0 nature-kit `.glb` models aren't included (that's where the ~1.3 GB `public/`
   comes from), so trees, carts and stalls drop out silently.
5. **Type errors with current packages.** `Bridge.tsx` passes `null` children to `EffectComposer`;
   `@react-three/postprocessing` 2.16 types reject that. It still bundles and runs, because Remotion strips types.
6. **Hidden Python dependency.** The audio scripts need `scipy` and `numpy`, which aren't documented.
7. **Audio tied to the bridge.** `timeline.py`, `sfx.py`, `music.py` and `mix.py` mirror the bridge short's story
   constants frame by frame, so a new short needs its own sound script. Only `dsp.py` and `instruments.py` are
   reusable as-is.
8. **No voice tool.** Step 3 assumes you already have `voice.wav` + `words.json`. For this repo I used Piper TTS
   (`en_US-ryan-high`) and faster-whisper (word timestamps).

## Rendering cost (measured)
- In a cloud container with no GPU (SwiftShader software WebGL), one 1080x1920 frame took about 100 s for the bridge
  and about 50 s for the new short at half-resolution buffers. A full short there would take tens of hours.
- On a GPU machine the author reports about 4 fps at 2K; an RTX 3050 laptop should take minutes.

## Verdict
Safe to use. The skill is mostly a well-documented recipe plus one complete worked example (the bridge). Reuse
`toon.ts` (characters), `cast.ts` (sprite pool), `cardshade.ts`, `shade.ts`, `lights.ts`, `ink.ts`, `lensblur.ts`,
`grade.ts`, `paint.ts`/`build.ts` (textures and houses) and the post chain in `Bridge.tsx`. Write a new
`story.ts`, `world.ts` and sound script for each new story, as `src/videos/scorch/` does here.
