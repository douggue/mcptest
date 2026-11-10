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
FPS, TOTAL = 30, 1752
DUR = TOTAL / FPS
N = ns(DUR)
W = lambda s: s - 2 / FPS            # reactions land 2 frames ahead of the word, like the picture
R = rng(7)
F = I.m2f
BPM = 116
Q = 60 / BPM

# ---------------------------------------------------------------- music
CH = {"F": [41, 53, 57, 60, 65], "Am": [45, 57, 60, 64, 69], "Dm": [38, 50, 53, 57, 62], "Bb": [34, 46, 50, 53, 58], "C": [36, 48, 52, 55, 60],
      "Gm": [43, 50, 55, 58, 62], "A7": [33, 49, 52, 55, 61], "C7": [36, 48, 52, 58, 64]}
PROG = ["F", "C", "Dm", "Am", "Bb", "F", "Gm", "C7"]
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
SECTIONS = [("hook", 0, 5.2, "story"), ("story", 5.2, 31.4, "story"), ("why", 31.4, 43.5, "explain"),
            ("fix", 43.5, 53.0, "story"), ("end", 53.0, DUR, "end")]
for name, a, b, kind in SECTIONS:
    seg = bar_events(a, int(np.ceil((b - a) / (4 * Q))) + 1, kind)
    g = np.zeros(N); i0, i1 = ns(a), min(N, ns(b))
    g[i0:i1] = 1.0
    fo = ns(0.12)
    g[max(i0, i1 - fo):i1] *= np.linspace(1, 0, i1 - max(i0, i1 - fo))
    music += seg * g[None, :] * (1.1 if kind == "end" else 1.0)
# mandolin-style tremolo on the melody notes of the story sections (Italian colour)
for t0 in np.arange(5.4, 31.2, 4 * Q):
    for k in range(6): place(music, pan(I.pluck(F(72 + (k % 2) * 4), 0.18, R, dur=0.2, bright=0.8), 0.35), t0 + k * 0.07)
place(music, pan(I.vibes(F(74), 0.45, R, dur=1.6), 0), W(31.58))
for m in (53, 57, 60, 65):
    place(music, pan(I.brass(F(m), 0.45, 0.7, R, kind="stab"), 0), W(57.38))
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

def boing(f0=220, d=0.45, s=0):
    t_ = tt(d); f = f0 * (1 + 1.2 * np.exp(-t_ / 0.08) * np.sin(2 * np.pi * 9 * t_)); return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(d, 0.005, d * 0.6) * 0.8
def whistle_tune(t0):
    for i, m in enumerate([79, 83, 86, 83, 81, 79]): cue(t0 + i * 0.16, "businessman whistles", I.fife(F(m + 5), 0.14, 0.4, R), 0.7, 0.3)

def mx(*xs):
    n = max(len(x) for x in xs); return sum(np.pad(x, (0, n - len(x))) for x in xs)
def groan(d=1.2, f0=95, f1=60, s=0):
    return (lp(np.sign(np.sin(2 * np.pi * np.cumsum(f0 * (f1 / f0) ** (tt(d) / d) * (1 + 0.03 * np.sin(2 * np.pi * 9 * tt(d)))) / SR)), 500) * 0.4 + lp(noise(d, s), 300) * 0.3) * env(d, 0.1, d * 0.5)
def creak(s=0, d=0.35):
    return bp(noise(d, s), 700, 1600) * (0.5 + 0.5 * np.sin(2 * np.pi * 37 * tt(d))) * env(d, 0.02, d * 0.6) * 1.4
def tick(s=0): return hp(noise(0.03, s), 3000) * env(0.03, 0.001, 0.02) * 0.8
def snore(t0, n=4):
    for k in range(n): cue(t0 + k * 0.9, "tower snores", lp(noise(0.6, 70 + k), 400) * env(0.6, 0.25, 0.3) * 0.9, 0.7)

cue(0.0, "piazza ambience bed", lp(colored(ns(5.3), rng(5), -1.2), 1400) * env(5.3, 0.6, 1.0) * 0.25)
cue(2.3, "tourist camera shutter", tick(1) + np.pad(tick(2), (ns(0.05), 0))[:ns(0.03)] * 0.6, 0.9, 0.3)
cue(W(4.14), "tower groans (still hasn't landed)", groan(1.0, 90, 70, 3), 0.8)
cue(W(5.38) - 0.3, "whoosh into 1173", sweep(0.5, 400, 4000) * 0.9)
for k in range(10): cue(5.6 + k * 0.32, "chisel taps", I.glock(F(88 + (k % 3)), 0.18, R, dur=0.25), 0.8, -0.3 + 0.06 * k)
for k, d in enumerate((0, 0.2, 0.47)): cue(W(7.66) + d, "marble sparkle", I.glock(F(93 + k * 2), 0.35, R, dur=0.8), p=0.3 - 0.3 * k)
cue(W(8.96), "cutaway thunk", thump(110, 0.25, 4) * 0.9)
cue(W(9.36), "ruler ting", I.glock(F(84), 0.35, R, dur=0.6), p=0.4)
cue(W(10.16), "'big mistake' bonk", boing(150, 0.45, 5) * 0.9)
cue(W(12.22), "boot sinks: squelch", (gliss(0.9, 220, 80, 0.08) + lp(noise(0.9, 6), 500) * 0.5) * env(0.9, 0.03, 0.5) * 0.9)
cue(W(13.9), "stone groan: sinking", groan(1.4, 110, 55, 7), 1.0)
cue(W(14.0), "creak", creak(8), 0.8, 0.3)
cue(W(15.04), "war drum", thump(55, 0.8, 9) * 1.4)
for k in range(5): cue(W(15.04) + 0.1 + k * 0.08, "tools clatter", clank(20 + k), 0.4, -0.3 + 0.15 * k)
for k in range(6): cue(15.3 + k * 0.17, "running feet", step(30 + k), 0.7, -0.4)
for k in range(6): cue(16.83 + k * 0.3, "calendar pages flip", hp(noise(0.12, 40 + k), 2500) * env(0.12, 0.005, 0.08) * 0.7, p=-0.3 + 0.12 * k)
snore(16.9, 2)
for k in range(5): cue(18.9 + k * 0.2, "builders return: steps", step(50 + k), 0.6, 0.2)
for k in range(5): cue(20.0 + k * 0.733, "new storey thuds", thump(120, 0.22, 60 + k) * 0.8 + 0, 0.9, 0.0)
cue(W(21.84), "measuring rod 'boing'", boing(260, 0.4, 7) * 0.7)
cue(W(25.86), "banana pop + slide whistle", gliss(0.6, 500, 1400, 0.0) * 0.5)
cue(26.4, "1990: tourist chatter bed", bp(colored(ns(5.0), rng(80), -0.8), 300, 2500) * env(5.0, 0.5, 1.0) * 0.18)
cue(W(28.64), "protractor tick-tick", tick(81) + 0, 0.9)
cue(W(30.26), "'closed' stamp + sad horn", (thump(90, 0.3, 82) * 1.1 + np.pad(gliss(0.6, 300, 200, 0.02), (0, 0))[:ns(0.3)] * 0.3), 1.0)
cue(W(31.5) - 0.2, "x-ray scan whoosh", sweep(0.6, 2000, 6000, 83) * 0.7)
for k in range(4): cue(W(34.86) + k * 0.25, "centre of weight pulse", gliss(0.2, 440, 520) * 0.3, p=0.2)
for k in range(3): cue(W(36.26) + k * 0.18, "edge alarm beep", np.sin(2 * np.pi * 1200 * tt(0.08)) * env(0.08, 0.005, 0.03) * 0.35, p=0.3)
for k, tq in enumerate((38.68, 39.14, 39.3)): cue(tq - 0.05, "chair creaks (fine, fine, fine)", creak(90 + k), 0.9, 0.2)
cue(40.0, "chair tips: long creak", creak(93, 1.0) * 0.8, p=0.2)
cue(W(41.04) + 0.12, "chair crash", mx(thump(70, 0.5, 94) * 1.3, hp(noise(0.3, 95), 1500) * env(0.3, 0.002, 0.25) * 0.6))
for k in range(3): cue(W(41.04) + 0.35 + k * 0.15, "dizzy stars", I.glock(F(96 - k * 2), 0.25, R, dur=0.4), p=0.3)
cue(W(42.16), "tension sting", I.pad([F(61), F(65), F(68)], 1.0, 0.35, R, att=0.05, rel=0.6)[:, :ns(1.6)], 0.9)
for k in range(8): cue(45.07 + k * 0.167, "lead blocks thud", thump(60, 0.3, 100 + k) * 1.1, p=-0.3)
drill = bp(noise(3.6, 110), 600, 2400) * (0.6 + 0.4 * np.sin(2 * np.pi * 23 * tt(3.6))) * env(3.6, 0.2, 0.5)
cue(46.7, "drill whirr", drill * 0.7, p=-0.2)
for k in range(4): cue(47.4 + k * 0.6, "soil buckets clank", clank(120 + k), 0.4, -0.2)
cue(W(51.22), "tower settles back: deep groan", groan(1.8, 80, 50, 130), 1.0)
cue(W(51.78), "relief chime", I.glock(F(84), 0.45, R, dur=1.2), p=0.2)
cue(53.2, "piazza ambience + laughter", bp(colored(ns(5.0), rng(140), -0.8), 300, 2500) * env(5.0, 0.6, 1.2) * 0.2)
cue(W(55.92), "tiny wobble groan", groan(0.6, 100, 85, 141) * 0.6, 0.8)
cue(W(57.26), "wink 'ting'", I.glock(F(98), 0.5, R, dur=0.9), p=0.3)

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
