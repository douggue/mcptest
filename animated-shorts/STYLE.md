# House style for our shorts (approved 2026-11-02 on "The Building That Cooked Breakfast" v2)

The owner reviewed v2 and said "everything good this time; keep that style". Every new short follows this.

## Voice
- Kokoro TTS, voice `af_heart`, speed ~1.3, generated per line with ~0.16 s between lines
  (`scorch2/tools/tts.py`). Target ~3.5 words/s and 60-65 s.
- Check clarity with `scorch2/tools/wer.py` (word error rate under ~6 %), then align word timings with
  `scorch/tools/align.py` (faster-whisper). Everything is timed to `words.json`.

## Script
- Hook = the absurd fact in one line. Escalation in short beats, each with its own picture.
- One "Wait...?" question beat, then "You see," plus an everyday analogy.
- A "Luckily ... / Unluckily ..." double, then a callback twist as the last line. Facts and sources at the top of
  SCRIPT.md.

## Picture: what made v2 work
- **About one shot per sentence** (v2 had 18 shots in 64 s). Cut on the words, with reactions 2 frames before
  the word.
- **Characters act on every beat**, using the free arm poses in `toon.ts` (`armL`/`armR`: hands on head, cheer,
  shrug, point, hold, thumbs-up, hips, give/take). Walks (side view), jumps (y offset), head tilts, and
  expression changes on the word.
- **Props carry the jokes**, held in hands or popping in with `pop()`: coffee, cash, pan, trophy, spoon, satellite
  dish, sweat drop, steam, flames, glints.
- **Close framing**: close-ups for reactions and details, wides only to set up a place. No static holds; every
  shot creeps in.
- **The beam/glow material goes in the opaque queue** with renderOrder below the cards (0.8 < 1), so effects never
  wash out characters.
- Cameras never glide through buildings. Use a cut, or keep the camera fixed and only turn it.
- Use daylight when a crowd must read. Low golden sun buries street-level people in shadow.

## Process
1. Script + voice + `words.json`.
2. Shot plan in `story.ts`, acting in `world.ts`, props in `draw.ts`, sound in `audio/score.py` (every action gets
   a sound).
3. Stills check: one frame per shot.
4. **Motion review**: full-length proxy (`proxy.mjs`, every 5th frame), read as contact sheets shot by shot, fix,
   repeat (2 rounds for v2).
5. A 10 fps preview with sound for the owner, then the final render on the owner's RTX 3050 laptop
   (`npm.cmd run render`, `--gl angle --chrome-mode chrome-for-testing`).
