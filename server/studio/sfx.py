"""Sound effects, synthesised with numpy so the library ships with no third-party audio."""
from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

from ..config import DATA

SR = 44100
NAMES = {
    "pop": "Warm pop", "whoosh": "Soft whoosh", "click": "Click", "ding": "Ding",
    "riser": "Riser", "thud": "Thud", "swish": "Swish", "glitch": "Glitch", "sparkle": "Sparkle",
    "camera": "Camera flash (built-in)", "camera-mine": "Camera flash (yours)",
}


def _env(n: int, attack: float, decay: float) -> np.ndarray:
    t = np.arange(n) / SR
    return np.minimum(1.0, t / max(attack, 1e-4)) * np.exp(-t / decay)


def _noise(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).uniform(-1, 1, n)


def _lowpass(x: np.ndarray, alpha: np.ndarray | float) -> np.ndarray:
    out = np.zeros_like(x)
    a = np.broadcast_to(alpha, x.shape)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        out[i] = acc
    return out


def _synth(name: str) -> np.ndarray:
    if name == "pop":
        n = int(SR * 0.16); t = np.arange(n) / SR
        f = 520 * np.exp(-t * 16) + 150
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(n, 0.002, 0.045)
    if name == "click":
        n = int(SR * 0.05); t = np.arange(n) / SR
        return (np.sin(2 * np.pi * 2100 * t) * 0.6 + _noise(n, 1) * 0.4) * _env(n, 0.0005, 0.008)
    if name == "ding":
        n = int(SR * 0.9); t = np.arange(n) / SR
        return sum(a * np.sin(2 * np.pi * f * t) for f, a in ((1320, 0.6), (2640, 0.25), (3960, 0.12))) * _env(n, 0.002, 0.22)
    if name == "thud":
        n = int(SR * 0.4); t = np.arange(n) / SR
        f = 120 * np.exp(-t * 9) + 42
        return (np.sin(2 * np.pi * np.cumsum(f) / SR) + _lowpass(_noise(n, 2), 0.05) * 0.5) * _env(n, 0.003, 0.11)
    if name in ("whoosh", "swish"):
        dur = 0.55 if name == "whoosh" else 0.28
        n = int(SR * dur); p = np.linspace(0, 1, n)
        sweep = 0.02 + 0.5 * np.sin(np.pi * p) ** 2
        return _lowpass(_noise(n, 3), sweep) * np.sin(np.pi * p) ** 1.5 * 1.8
    if name == "riser":
        n = int(SR * 1.2); p = np.linspace(0, 1, n)
        f = 180 + 1400 * p ** 2
        tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.4
        return (tone + _lowpass(_noise(n, 4), 0.03 + 0.4 * p) * 0.9) * p ** 2
    if name == "glitch":
        n = int(SR * 0.3); rng = np.random.default_rng(5)
        out = np.zeros(n); pos = 0
        while pos < n:
            ln = int(rng.integers(300, 2200)); f = float(rng.choice([220, 440, 880, 1760, 3520]))
            seg = np.sign(np.sin(2 * np.pi * f * np.arange(min(ln, n - pos)) / SR)) * (rng.random() > 0.3)
            out[pos:pos + len(seg)] = seg; pos += ln
        return out * 0.5 * _env(n, 0.001, 0.2)
    if name == "sparkle":
        n = int(SR * 0.7); t = np.arange(n) / SR; out = np.zeros(n)
        for i, f in enumerate((1568, 1976, 2349, 3136, 3951)):
            s = int(i * 0.06 * SR); m = n - s
            out[s:] += np.sin(2 * np.pi * f * t[:m]) * _env(m, 0.001, 0.12) * 0.4
        return out
    if name == "camera":
        # a shutter: two sharp clicks a few hundredths apart, a short burst of air, and a faint flash whine
        n = int(SR * 0.45); t = np.arange(n) / SR; out = np.zeros(n)
        for at, amp in ((0.0, 1.0), (0.055, 0.7)):
            s0 = int(at * SR); m = int(SR * 0.03)
            out[s0:s0 + m] += (_noise(m, 7 + s0) * 0.7 + np.sin(2 * np.pi * 3200 * t[:m]) * 0.3) * _env(m, 0.0003, 0.004) * amp
        burst = int(SR * 0.12)
        out[:burst] += _lowpass(_noise(burst, 9), 0.25) * _env(burst, 0.001, 0.03) * 0.5
        out += np.sin(2 * np.pi * (5200 + 900 * t) * t) * _env(n, 0.02, 0.15) * 0.04
        return out
    raise KeyError(name)


def ensure_sfx() -> Path:
    """Write any missing effect to DATA/assets/sfx and return that folder."""
    folder = DATA / "assets" / "sfx"
    folder.mkdir(parents=True, exist_ok=True)
    for name in NAMES:
        if name.endswith("-mine"):
            continue   # the person's own sounds are uploaded, never made here
        f = folder / f"{name}.wav"
        if f.exists():
            continue
        x = _synth(name)
        x = x / (np.max(np.abs(x)) or 1.0) * 0.82
        fade = min(len(x) // 4, int(SR * 0.01))
        x[-fade:] *= np.linspace(1, 0, fade)
        pcm = (np.stack([x, x], axis=1) * 32767).astype("<i2")
        with wave.open(str(f), "wb") as w:
            w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    return folder


def camera_name() -> str:
    """The camera-flash sound to use: the person's own when they have added one, else the built-in one."""
    return "camera-mine" if (DATA / "assets" / "sfx" / "camera-mine.wav").exists() else "camera"
