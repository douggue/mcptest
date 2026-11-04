# Reference study (2026-11-04): what "the level we want" looks like

Three reference shorts supplied by the owner (an explainer channel: a Japanese workplace story, a sleep/ideas
explainer, a Japanese gambling-law story; 39-61 s, 30 fps) were analysed frame by frame by five parallel agents
(character animation, camera/editing, timing/script, effects/props, look), each comparing them with our v2
London-tower short. Only measurements are recorded here: no frames, video or wording from the references are
kept in this repo. Captions: the owner adds them in CapCut, so our renders have **no captions** and keep the
bottom ~20% of the frame clear.

## Biggest gaps between v2 and the references (ranked)
1. **One protagonist** carries the whole video (often "you": "Imagine your boss..."), with 1-2 side characters.
   v2 had 8 different people and no lead.
2. **Characters are always big and always present:** 45-75% of frame height in hero shots, and in at least 80% of
   shots. v2 had characters at under 10% height and none in about half the shots.
3. **Nothing is ever still:** idle sway and breathing on every character, and the camera always drifting or
   pushing. v2 had rigid bodies and some static holds.
4. **A new visual event every ~1.0-1.2 s (~4 words);** every concrete noun or verb gets its own picture. v2 had
   one every ~1.45 s, with dead stretches.
5. **Explain with objects:** symbolic props with in-scene labels, insert close-ups (25-45 f), diagram "worlds"
   (gauge, corkboard, X-ray scan). Overlay FX are rare and each has one job.
6. **Structure:** a 13-14 word paradox hook (3.4-4.2 s), escalation, the "You see," turn at **60-80%** of the
   runtime, an explanation of 10-15 s, then **one** callback ending that stops 0.3-0.8 s after the last word. v2
   turned at 45%, then had three separate endings.
7. **Look:** tinted ink (plum or brown, not black), thick character outlines (~10-16 px at 1080) with thinner
   world lines, soft gradient shading with cool shadows, bloom on light sources, dense prop-filled sets, clean
   flat textures with graphic decals.

## Rules (measured numbers)
### Script and timing
- 3.6-3.8 words/s; sentences ~14 words; pauses 0.26-0.46 s; a 0.4-0.5 s pause before each punchline, with the
  new image arriving inside that pause.
- **Props and signs appear 4-8 frames before their noun.** Actions and reactions land 0-2 frames after the word.
  Scene dissolves (5-8 f) start 3-5 frames after the connecting word ("So", "Then", "You see", "Instead").
- Frame 0 already has a character plus an odd object, already moving. Hold a deadpan face ~1.2 s after a joke
  line. Add one silent visual gag per ~15 s that the narration never mentions.

### Character animation
- Bodies animate on 1s (every frame). Faces swap instantly as held drawings.
- **Idle on every visible character:** head `2°·sin(2πt/2.3+seed)`, body `1°·sin(2πt/3.1)`, breathing scale-y
  `1+0.012·sin(2πt/2.6)` anchored at the feet. Never fully still.
- **Noodle limbs:** each limb is a curve, with the knee/elbow control point offset `0.25·len`, not a straight
  stick.
- **Walk:** 13-frame stride (a step every 6.5 f), bob 2.5% of height (lowest at contact), arms ±10° close to the
  body.
- **Blink** every 2.5-4.5 s (random per character): half, closed, closed, half.
- **Expression swap masked by a blink:** mouth at f, eyes shut at f+1..f+2, new eyes at f+3 with a 1-frame head
  squash (1.06, 0.94).
- **Gestures:** 4-6 frames ease-out with 5-8% overshoot settling over 6 frames, then ±2° drift while holding.
- **Lit cards:** a radial gradient from the key light (-15% on the far side, +8% near the light), plus an optional
  3 px rim.
- **Crowds:** 8-15 characters at ~15% height, with idle phases offset.

### Effects and props
- Props are solid objects with contact shadows. When they land, a 5-8% bounce.
- Sparkle: a 4-point star ~25 px, 6 frames (scale 0 → 1.2 → 0), exactly on the word, on the object.
- Ripple rings for sounds and impacts: 3 rings, spreading over 30 f, 40% → 0% opacity.
- Burst: ~3 frames, then smoke puffs lingering 10-15 frames.
- Insert close-up (25-45 f) for each key noun. Text and numbers live in the scene (signs, plaques, gauges,
  clipboards, calendars).
- Motivated transitions: crash zoom (8 f, 1-4×) into an object, a character crossing the foreground as a wipe,
  calendar pages tearing off (4-5 f each) for time passing, an X-ray scan line (8 f) into a diagram view.
- Effects density: about 1-3 overlay effects and 2-4 inserts or diagram beats per 10 s.

### Look
- **Ink:** world 4.5 px near → 2 px far, creases at 0.6×. Characters ~16 px. Line colour #231b2c (cool scenes) or
  #3a2418 (warm), mixed 30% toward the local hue on world lines.
- **Shadows:** cool (~#a1b5df multiplier, hue ~220°) by day, #8a6a8c in warm scenes. A soft terminator (~0.35),
  not hard two-tone.
- **Colour:** one dominant hue family per video, plus small saturated prop accents. Contrast p5-p95 ≈ 180-215
  levels. Mean saturation 0.43-0.50.
- **Light:** motivated practicals (lamps, windows, glowing strips) with bloom (threshold 0.85, strength 0.35,
  radius 0.6). One key per scene with darker surroundings and a vignette of ~0.35.
- **Sets:** 20-40 simple chamfered props per view. Clean flat albedo with graphic decals (posters, labels,
  patterned floors); no noisy painted grain.
- **Camera:** ~1.0-1.4 m high, 1-3 m from the hero, 35-45° vertical FOV, background blurred.

## Camera and editing
- **No hard cuts at all.** Every scene change is a dissolve, 6 frames on average (range 4-10), with an S-curve
  alpha, and both cameras keep moving through it. Plus 1-2 motivated transitions per video: whip-tilt with motion
  blur, a push into an object until it fills the frame, a crash zoom (~3x in 10 f), a graphic scan-line wipe, or
  the same framing dissolving to a lighting change. v2 had ~20 hard cuts.
- **About one scene per sentence**, ~3.2-3.9 s on average (range 0.9-11 s). The dissolve lands on the first or
  second word of the new sentence. Cutaways (inserts) land mid-sentence on the noun. Long shots stay alive with
  following moves (a truck or pan at 20-40%/s with a walking character).
- **The camera never stops.** Two layers:
  - a base drift or push of 3-9%/s;
  - one **bell-shaped move per shot**, 1-2 s long, changing subject scale by 30-60%, peaking on the key word, then
    settling back to the drift.
  Zoom speed has a median of ~13%/s and p90 34-54%/s (v2's p90 was 18%/s). About 75-80% of moves are push-ins.
  Also: orbits of ~45° over 20 frames with growing roll, crane-downs from a prop to the character, and a fast
  constant push in the opening.
- **Dutch angles of 8-15°** on comic or uneasy beats. **No camera shake** (impacts use ripple graphics instead),
  so drop our roll KICKS. No freeze frames, no speed ramps. Motion blur on fast moves.
- **Framing:** ~30% close-up, 45% medium, 25% wide. A character in ~85% of shots at 40-70% of frame height. Shots
  without a character are short inserts (1-1.5 s).
