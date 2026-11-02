# Sound for "The War the Army Lost to Birds": an original comic military march (Bb, 116 bpm: tuba oom-pah, snare,
# fife tune), a tense pad under the explanation, a slow defeated march for the ending, plus synthesized SFX on the
# picture events (Lewis gun bursts, the jam, the truck, emu feet and the emus' low drumming), mixed under the voice.
# Usage: python score.py   (reads ../voice/voice.wav + words.json, writes mix.wav, stems and cues.md here)
import json, os, sys
import numpy as np
from dsp import (SR, ns, tt, rng, dbg, lp, hp, bp, pan, st, place, fades, make_ir, convolve_st, integrated, true_peak,
                 read_wav, write_wav, ramp, colored)
import instruments as I

HERE = os.path.dirname(os.path.abspath(__file__))
FPS, TOTAL = 30, 1920
DUR = TOTAL / FPS
N = ns(DUR)
W = lambda s: s - 2 / FPS            # reactions land 2 frames ahead of the word, like the picture
R = rng(7)
F = I.m2f
BPM = 116
Q = 60 / BPM

# ---------------------------------------------------------------- music
CH = {"Bb": [34, 46, 50, 53, 58], "F": [41, 45, 48, 53, 57], "Eb": [39, 46, 51, 55, 58], "Gm": [43, 46, 50, 55, 58],
      "Cm": [36, 48, 51, 55, 60], "F7": [41, 45, 51, 53, 57], "Dm": [38, 50, 53, 57, 62]}
PROG = ["Bb", "F", "Bb", "F7", "Eb", "Bb", "Cm", "F7"]
TUNE = [(0, .75, 2), (.75, .25, 1), (1, .5, 2), (1.5, .5, 3), (2, 1, 3), (3, .5, 2), (3.5, .5, 1)]

def bar_events(t0, bars, kind):
    out = np.zeros((2, N))
    q = Q * (1.35 if kind == "sad" else 1.0)
    for k in range(bars):
        ch = CH[PROG[k % len(PROG)]]
        tb = t0 + k * 4 * q
        if tb >= DUR:
            break
        if kind in ("march", "sad"):
            for bt, m in ((0, ch[0]), (2, ch[0] + 7)):
                place(out, pan(I.brass(F(m), q * 0.8, 0.75 if kind == "march" else 0.5, R, kind="tuba"), -0.15), tb + bt * q)
            for bt in (1, 3):
                for m in ch[1:4]:
                    place(out, pan(I.brass(F(m + 12), q * 0.35, 0.22, R, kind="soft"), 0.25), tb + bt * q)
            for bt in range(4):
                place(out, pan(I.snare(0.45 if bt % 2 else 0.3, R, dur=0.25), 0.15), tb + bt * q)
            if kind == "march":
                place(out, pan(I.snare(0.25, R, dur=0.2), 0.15), tb + 3.5 * q)
            for bt, d, ix in TUNE:
                m = ch[1:][ix % 4] + 24
                if kind == "sad":
                    m -= 12
                place(out, pan(I.fife(F(m), d * q * 0.9, 0.5, R), -0.3), tb + bt * q)
        elif kind == "explain":
            place(out, I.pad([F(m) for m in ch[1:4]], 4 * q, 0.35, R, att=0.8, rel=1.2), tb)
            for i in range(8):
                place(out, pan(I.pluck(F(ch[(i % 3) + 1] + 12), 0.4, R, dur=0.6, bright=0.4), 0.3 * (1 if i % 2 else -1)), tb + i * q / 2)
            place(out, pan(I.timpani(F(ch[0] + 12), 0.4, R, dur=1.5), 0), tb)
    return out

music = np.zeros((2, N))
SECTIONS = [("hook", 0, 4.6, "march"), ("story", 4.6, 37.1, "march"), ("wait", 37.1, 40.1, None),
            ("explain", 40.1, 53.0, "explain"), ("claim", 53.0, 60.8, "march"), ("home", 60.8, 62.6, "sad"), ("stayed", 62.6, DUR, None)]
for name, a, b, kind in SECTIONS:
    if not kind:
        continue
    seg = bar_events(a, int(np.ceil((b - a) / (4 * Q))) + 1, kind)
    g = np.zeros(N); i0, i1 = ns(a), min(N, ns(b))
    g[i0:i1] = 1.0
    fo = ns(0.12)
    g[max(i0, i1 - fo):i1] *= np.linspace(1, 0, i1 - max(i0, i1 - fo))
    music += seg * g[None, :]
# "Wait...": a single questioning fife note; "The emus stayed.": a smug two-note tuba button
place(music, pan(I.fife(F(82), 0.8, 0.5, R), 0), W(37.24))
place(music, pan(I.fife(F(84), 0.9, 0.45, R), 0), W(39.72))
for i, m in enumerate((46, 41)):
    place(music, pan(I.brass(F(m), 0.3, 0.8, R, kind="tuba"), 0), W(63.0) - 0.4 + i * 0.32)
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

def gun_burst(t0, t1, s=0):
    for k, tt_ in enumerate(np.arange(t0, t1, 0.075)):
        cue(float(tt_), "Lewis gun fire", thump(160, 0.06, s + k) * 0.8 + hp(noise(0.06, s + k + 500), 1500) * np.exp(-tt(0.06) / 0.012) * 1.2, 0.8, 0.2)
def emu_feet(t0, t1, rate=0.11, s=0):
    r = rng(s)
    for tt_ in np.arange(t0, t1, rate):
        cue(float(tt_ + r.uniform(0, rate * 0.6)), "emu feet patter", step(int(r.integers(0, 999))) * 0.6, 0.5, float(r.uniform(-0.6, 0.6)))
def drum(t0, s=0):  # emus' low "boom" drumming call
    d = 0.5; x = np.sin(2 * np.pi * np.cumsum(np.full(ns(d), 75.0)) / SR) * (1 - np.cos(2 * np.pi * 18 * tt(d))) * 0.5 * env(d, 0.03, 0.3)
    cue(t0, "emu drumming boom", lp(x, 400) * 1.4, 0.8)

cue(0.0, "outback wind bed", lp(colored(ns(63.9), rng(1), -1.4), 700) * env(63.9, 1.0, 1.5) * 0.15)
gun_burst(1.0, 4.0, 10)
emu_feet(0.2, 4.4, 0.09, 11)
cue(3.95, "gun jams (hook)", thump(220, 0.15, 12) * 1.2, p=0.2)
cue(W(4.64) - 0.35, "whoosh into flash", sweep(0.6, 400, 5000) * 1.2)
for k in range(3): cue(7.0 + k * 0.8, "rooster / farm ting", I.glock(F(79 + k * 2), 0.3, R, dur=0.8), p=-0.4)
emu_feet(10.0, 12.6, 0.07, 13)
for k in range(4): drum(10.4 + k * 0.6, 14 + k)
eng = np.sin(2 * np.pi * np.cumsum(48 + 20 * env(2.0, 0.3, 1.0)) / SR)
cue(12.75, "army truck arrives", lp(np.sign(eng) * 0.4 + eng, 600) * env(2.0, 0.2, 0.9) * 0.7, p=-0.4)
cue(14.5, "truck door", thump(90, 0.3, 15) * 1.0, p=0.2)
for k in range(3): cue(W(17.44) + k * 0.16, "ammo crates thud", thump(110, 0.2, 16 + k) * 0.9, p=0.3)
cue(W(19.46), "'how hard?' cocky ting", I.glock(F(86), 0.45, R, dur=1.0), p=0.2)
cue(W(21.38), "scatter whoosh", sweep(0.9, 500, 6000, 17) * 1.0)
emu_feet(21.3, 24.2, 0.05, 18)
for k in range(3): cue(25.6 + k * 0.4, "soldiers creep", step(30 + k) * 0.6, 0.6, -0.2)
emu_feet(27.1, 28.9, 0.12, 19)
gun_burst(W(29.08), W(30.6), 20)
for k in range(5): cue(W(29.4) + k * 0.25, "feathers puff", hp(noise(0.12, 40 + k), 2000) * env(0.12, 0.005, 0.1) * 0.6, p=0.3)
cue(W(30.68), "gun JAMS: clunk", (thump(240, 0.18, 21) + I.glock(F(60), 0.3, R, dur=0.4)[:len(thump(240, 0.18, 21))]) * 1.4)
emu_feet(31.0, 33.0, 0.06, 22)
eng2 = np.sin(2 * np.pi * np.cumsum(60 + 30 * np.abs(np.sin(2 * np.pi * 0.7 * tt(6.0)))) / SR)
cue(31.2, "truck chase engine", lp(np.sign(eng2) * 0.4 + eng2, 650) * env(6.0, 0.3, 0.8) * 0.6, p=-0.2)
for k in range(10): cue(33.3 + k * 0.38, "truck bumps", thump(80, 0.2, 50 + k) * 0.9, p=0.1)
emu_feet(33.4, 37.0, 0.06, 23)
cue(W(37.24), "record scratch stop", sweep(0.25, 3000, 300, 24) * 1.0)
cue(W(39.72), "emu blink 'tink'", I.glock(F(96), 0.25, R, dur=0.4), p=0.3)
for k in range(6): drum(42.1 + k * 0.5, 30 + k)
cue(W(47.58), "crosshair lock", I.glock(F(84), 0.5, R, dur=0.5), p=0)
cue(W(48.6), "everyone gone whoosh", sweep(1.0, 600, 7000, 25) * 1.1)
emu_feet(48.6, 49.8, 0.04, 26)
emu_feet(49.9, 53.0, 0.1, 27)
cue(W(50.52), "bullet ping on the emu", (gliss(0.25, 2400, 1200) * 0.5 + np.pad(hp(noise(0.12, 28), 2500) * env(0.12, 0.002, 0.1), (0, ns(0.25) - ns(0.12)))) * 1.1)
for k in range(12): cue(53.6 + k * 0.17, "tally chalk scratches", hp(noise(0.08, 60 + k), 3000) * env(0.08, 0.005, 0.05) * 0.5, p=0.3)
for k in range(6): drum(59.4 + k * 0.25, 70 + k)
cue(W(60.88), "truck drives off", lp(np.sign(eng) * 0.4 + eng, 600) * env(2.0, 0.2, 1.2) * 0.5, p=0.4)
drum(W(63.0), 80)
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
