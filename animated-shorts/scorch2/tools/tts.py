import sys, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
k = Kokoro("/home/user/studio/models/kokoro-v1.0.onnx", "/home/user/studio/models/voices-v1.0.bin")
voice, speed, src, out = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4]
lines = [l.strip() for l in open(src) if l.strip()]
parts = []
for l in lines:
    a, sr = k.create(l, voice=voice, speed=speed, lang="en-gb" if voice.startswith("b") else "en-us")
    # trim leading/trailing silence, then a short beat between lines (the reference narrator barely pauses)
    th = 0.01 * np.abs(a).max(); idx = np.where(np.abs(a) > th)[0]
    a = a[max(0, idx[0] - int(0.02 * sr)): idx[-1] + int(0.06 * sr)]
    parts += [a, np.zeros(int(0.16 * sr), np.float32)]
y = np.concatenate(parts); sf.write(out, y, sr); print(out, sr, round(len(y) / sr, 2), "s")
