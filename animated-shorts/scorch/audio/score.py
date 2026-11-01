# Sound for "The Building That Cooked Breakfast": an original light comedy score (F major, 108 bpm: pizzicato bass,
# vibes/glock tune, brushes, pads under the explanation, a lounge swing for Las Vegas, a sad-brass "wah-wah" on
# "Unluckily", an applause + brass stab ending) plus synthesized SFX on the picture events, mixed under the voice.
# Usage: python score.py   (reads ../voice/voice.wav + words.json, writes mix.wav, stems and cues.md here)
import json, os, sys
import numpy as np
from dsp import (SR, ns, tt, rng, dbg, lp, hp, bp, pan, st, place, fades, make_ir, convolve_st, integrated, true_peak,
                 read_wav, write_wav, ramp, colored)
import instruments as I

HERE = os.path.dirname(os.path.abspath(__file__))
FPS, TOTAL = 30, 1900
DUR = TOTAL / FPS
N = ns(DUR)
W = lambda s: s - 2 / FPS            # reactions land 2 frames ahead of the word, like the picture
R = rng(7)
F = I.m2f
BPM = 108
Q = 60 / BPM

# ---------------------------------------------------------------- music
CH = {"F": [41, 53, 57, 60, 65], "Dm": [38, 50, 53, 57, 62], "Bb": [34, 46, 50, 53, 58], "C": [36, 48, 52, 55, 60],
      "Gm": [43, 50, 55, 58, 62], "A7": [33, 49, 52, 55, 61], "C7": [36, 48, 52, 58, 64]}
PROG = ["F", "Dm", "Bb", "C", "F", "Dm", "Gm", "C7"]
TUNE = [(0, 1, 0), (1, .5, 2), (1.5, .5, 1), (2, 1.5, 3), (3.5, .5, 2)]  # (beat, length, chord-tone index into upper voices)

def bar_events(t0, bars, kind):
    """returns a stereo buffer for `bars` bars starting at t0 of the given arrangement"""
    out = np.zeros((2, N))
    for k in range(bars):
        ch = CH[PROG[k % len(PROG)]]
        tb = t0 + k * 4 * Q
        if tb >= DUR:
            break
        if kind in ("story", "end", "lounge"):
            # pizz bass on 1 and 3 (walking on 2 and 4 in the lounge swing)
            for bt, m in ((0, ch[0]), (2, ch[0] + 7)) if kind != "lounge" else ((0, ch[0]), (1, ch[0] + 4), (2, ch[0] + 7), (3, ch[0] + 9)):
                place(out, pan(I.pluck(F(m), 0.9, R, dur=0.7, bright=0.35), -0.15), tb + bt * Q)
            # off-beat chord plucks
            for bt in (1, 3) if kind != "lounge" else (1.67, 3.67):
                for m in ch[1:4]:
                    place(out, pan(I.pluck(F(m + 12), 0.25, R, dur=0.35, bright=0.6), 0.3), tb + bt * Q)
            # brushes on every beat
            for bt in range(4):
                place(out, pan(I.brush(0.35 if bt % 2 else 0.2, R), 0.2), tb + bt * Q)
            # tune on vibes (every other bar answers an octave up on glock)
            for bt, d, ix in TUNE:
                m = ch[1:][ix % 4] + 12
                v = I.vibes(F(m), 0.45, R, dur=1.2) if k % 2 == 0 else I.glock(F(m + 12), 0.3, R, dur=1.0)
                place(out, pan(v, -0.3), tb + (bt if kind != "lounge" else np.floor(bt) + (2 / 3 if bt % 1 else 0)) * Q)
        elif kind == "explain":
            place(out, I.pad([F(m) for m in ch[1:4]], 4 * Q, 0.35, R, att=0.8, rel=1.2), tb)
            for i, m in enumerate([ch[1], ch[2], ch[3], ch[2] + 12, ch[3], ch[2], ch[1] + 12, ch[3]]):
                place(out, pan(I.glock(F(m + 12), 0.22, R, dur=0.9), 0.35 * (1 if i % 2 else -1)), tb + i * Q / 2)
            place(out, pan(I.pluck(F(ch[0]), 0.7, R, dur=1.2, bright=0.3), -0.1), tb)
    return out

music = np.zeros((2, N))
SECTIONS = [("hook", 0, 3.5, "story"), ("story", 3.5, 29.4, "story"), ("wait", 29.4, 31.6, None),
            ("explain", 31.6, 47.6, "explain"), ("shade", 47.6, 54.0, "story"), ("unlucky", 54.0, 55.3, None),
            ("vegas", 55.3, 59.0, "lounge"), ("end", 59.0, DUR, "end")]
for name, a, b, kind in SECTIONS:
    if not kind:
        continue
    seg = bar_events(a, int(np.ceil((b - a) / (4 * Q))) + 1, kind)
    g = np.zeros(N); i0, i1 = ns(a), min(N, ns(b))
    g[i0:i1] = 1.0
    fo = ns(0.12)
    g[max(i0, i1 - fo):i1] *= np.linspace(1, 0, i1 - max(i0, i1 - fo))
    music += seg * g[None, :] * (1.15 if kind == "end" else 1.0)
# "Wait, how does a building make breakfast?": one question vibe note; "Unluckily": sad brass wah-wah
place(music, pan(I.vibes(F(72), 0.5, R, dur=1.8), 0), W(29.48))
place(music, pan(I.vibes(F(74), 0.45, R, dur=1.8), 0), W(30.94))
for i, (m, d) in enumerate([(58, .32), (57, .32), (56, .32), (55, 1.0)]):
    place(music, pan(I.brass(F(m), d, 0.6, R, kind="horn", fall=(-1.0 if i == 3 else 0.0)), 0.1), W(54.08) + i * 0.33)
# final stab on "building"
for m in (53, 57, 60, 65):
    place(music, pan(I.brass(F(m), 0.5, 0.85, R, kind="stab"), 0), W(62.48))
place(music, pan(I.cymbal(0.6, R, dur=2.0), 0.2), W(62.48))
music = convolve_st(music * 0.9, make_ir(1.1, 3, pre=0.01))[:, :N] * 0.35 + music

# ---------------------------------------------------------------- sfx
sfx = np.zeros((2, N))
CUES = []
def cue(t, name, x, g=1.0, p=0.0):
    CUES.append((t, name)); place(sfx, pan(x, p) if np.ndim(x) == 1 else x, t, g)
noise = lambda d, s=0: rng(s).standard_normal(ns(d))
def env(d, a=0.01, r=0.2):
    n = ns(d); e = np.ones(n); na, nr = min(n, ns(a)), min(n, ns(r))
    e[:na] = np.linspace(0, 1, na); e[n - nr:] *= np.linspace(1, 0, nr); return e
def sweep(d, f0, f1, s=1):
    x = noise(d, s); out = np.zeros_like(x); seg = ns(0.02)
    for i in range(0, len(x), seg):
        f = f0 * (f1 / f0) ** (i / len(x)); out[i:i + seg] = bp(x[i:i + seg + 400], f * 0.7, f * 1.4)[:len(x[i:i + seg])]
    return out * env(d, d * 0.6, d * 0.4)
def gliss(d, f0, f1, wob=0.0):
    t = tt(d); f = f0 * (f1 / f0) ** (t / d) * (1 + wob * np.sin(2 * np.pi * 7 * t))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(d, 0.01, d * 0.5)
def sizzle(d, s=3):
    x = hp(noise(d, s), 2500) * (0.5 + 0.5 * lp(np.abs(noise(d, s + 1)), 30) * 3)
    crack = np.zeros(ns(d)); r = rng(s + 2)
    for _ in range(int(d * 40)): k = r.integers(0, len(crack) - 200); crack[k:k + 120] += r.uniform(-1, 1) * np.exp(-np.arange(120) / 20)
    return (x * 0.5 + hp(crack, 1500) * 2) * env(d, 0.15, 0.6)
def thump(f0=70, d=0.35, s=4):
    return (gliss(d, f0 * 1.8, f0) * 1.2 + lp(noise(d, s), 400) * np.exp(-tt(d) / 0.05)) * env(d, 0.002, d * 0.7)
def step(s):
    d = 0.12; return (lp(noise(d, s), 1500) * np.exp(-tt(d) / 0.02) + gliss(d, 160, 90) * 0.3) * 0.6
def clank(s):
    a = I.glock(F(48 + (s % 3) * 2), 0.6, rng(s), dur=0.7); b = thump(140, 0.15, s); a[:len(b)] += 0.4 * b
    return a
def pop(s):
    return gliss(0.06, 900 + 300 * (s % 3), 300) * 0.6

cue(0.0, "beam hum + shimmer (hook)", lp(colored(ns(3.5), rng(1), -1.0), 900) * env(3.5, 1.2, 0.3) * 0.5)
cue(1.0, "melt droop (hook)", gliss(1.0, 520, 180, 0.04) * 0.5, p=0.3)
cue(W(3.56) - 0.35, "whoosh into flash", sweep(0.6, 400, 5000) * 1.2)
cue(5.6, "city ambience bed", lp(colored(ns(5.0), rng(5), -1.2), 1200) * env(5.0, 1.0, 1.5) * 0.25)
cue(9.5, "spoon 'ting'", I.glock(F(84), 0.5, R, dur=1.2), p=0.4)
eng = np.sin(2 * np.pi * np.cumsum(55 + 25 * env(2.2, 0.3, 1.2)) / SR)
cue(11.1, "car rolls in (engine)", lp(np.sign(eng) * 0.3 + eng, 700) * env(2.2, 0.3, 0.9) * 0.6, p=-0.4)
cue(12.95, "car door", thump(90, 0.3, 9) * 1.1, p=0.2)
for k in range(3): cue(14.95 + k * 0.5, "footsteps (businessman back)", step(20 + k), 0.8, 0.3)
cue(W(16.86), "mirror melts: droop", gliss(0.9, 700, 140, 0.05) * 0.8, p=0.25)
for k in range(3): cue(W(18.06) + k * 0.22, "badge drips", I.pluck(F(84 - k * 3), 0.4, R, dur=0.4, bright=0.9), p=0.4)
cue(W(19.28), "panels go soft: squelch", (gliss(1.2, 220, 90, 0.08) + lp(noise(1.2, 30), 500) * 0.4) * env(1.2, 0.05, 0.6) * 0.8)
cue(W(22.32), "doormat smoke fsss", hp(noise(1.4, 31), 3000) * env(1.4, 0.4, 0.8) * 0.5, p=-0.2)
for k in range(4): cue(W(23.94) + k * 0.13, "seat blister pops", pop(k), 0.7, 0.3)
for k in range(5): cue(25.3 + k * 0.5, "footsteps (reporter)", step(40 + k), 0.8, -0.2)
cue(W(28.86), "egg sizzle", sizzle(2.4), 0.7)
for k in range(5): cue(W(32.56) + k * 0.1, "rays bounce (flat)", I.glock(F(79 + (k % 2) * 5), 0.25, R, dur=0.6), p=-0.5 + k * 0.25)
cue(W(41.24), "rays gather", sweep(2.0, 300, 2400, 7) * 0.7)
cue(W(43.3), "squeeze rise", sweep(1.6, 600, 8000, 8) * 0.9)
cue(W(44.88), "burning spot: fwoomp", (thump(55, 0.9, 11) * 1.5 + sweep(0.9, 3000, 400, 12) * 0.6) * 1.0)
for k in range(8): cue(W(46.32) + k * 0.16, "crane up gliss (160 m)", I.glock(F(72 + k * 2), 0.25, R, dur=0.6), p=0.3)
for k in range(6): cue(W(49.66) + k * 0.3, "sunshade fins clank", clank(k), 0.6, -0.3 + 0.12 * k)
cue(W(57.72), "tourists sizzle", sizzle(1.6, 50), 0.6)
cue(57.0, "pool splashes / lounge", lp(colored(ns(2.0), rng(51), -0.6), 3000) * env(2.0, 0.5, 1.0) * 0.3)
clap = np.zeros(ns(3.2)); r2 = rng(60)
for _ in range(260):
    k = r2.integers(0, len(clap) - 600); clap[k:k + 500] += r2.uniform(0.3, 1) * bp(r2.standard_normal(500), 900, 3500) * np.exp(-np.arange(500) / 60)
cue(W(60.44), "award applause", clap * env(3.2, 0.3, 1.2) * 0.6)

# ---------------------------------------------------------------- mix
v, sr = read_wav(os.path.join(HERE, "..", "voice", "voice.wav"))
assert sr == SR, sr
voice = st(v[0] if v.shape[0] == 1 else v.mean(0))
vv = np.zeros((2, N)); vv[:, :min(N, voice.shape[1])] = voice[:, :N]
words = json.load(open(os.path.join(HERE, "..", "voice", "words.json")))
speak = np.zeros(N)
for w in words: speak[ns(w["start"]):ns(w["end"] + 0.08)] = 1
duck = lp(speak, 6, 1); duck = 1 - (1 - dbg(-4)) * np.clip(duck, 0, 1)
Lv = integrated(vv)
music *= dbg(Lv - 13 - integrated(music)); sfx *= dbg(Lv - 9 - integrated(sfx))
music *= duck[None, :]
mix = vv + music + sfx
g = dbg(-14 - integrated(mix)); mix *= g; vv *= g; music *= g; sfx *= g
peak = 10 ** (true_peak(mix) / 20)
if peak > dbg(-1.0): mix = np.tanh(mix / dbg(-1.0)) * dbg(-1.0)
write_wav(os.path.join(HERE, "mix.wav"), fades(mix, 0.002, 0.05))
for k, x in (("voice", vv), ("music", music), ("sfx", sfx)): write_wav(os.path.join(HERE, f"stem_{k}.wav"), x)
with open(os.path.join(HERE, "cues.md"), "w") as fo:
    fo.write(f"# Sound cues\n\nmix.wav: 48 kHz stereo, {DUR:.3f} s, integrated {integrated(mix):.1f} LUFS, true peak {true_peak(mix):.1f} dBTP\n\n")
    fo.write("## Music sections\n" + "".join(f"- {a:5.2f}-{b:5.2f} s {n} ({k or 'stinger only'})\n" for n, a, b, k in SECTIONS))
    fo.write("\n## SFX events\n" + "".join(f"- {t:6.2f} s  {n}\n" for t, n in sorted(set(CUES))))
print("mix", round(integrated(mix), 2), "LUFS, TP", round(true_peak(mix), 2), "dBTP;", len(CUES), "cues")
