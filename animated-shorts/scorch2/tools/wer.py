import sys, re, numpy as np, subprocess
from faster_whisper import WhisperModel
m = WhisperModel("base.en", device="cpu", compute_type="int8")
ref = re.findall(r"[a-z']+", open("vo.txt").read().lower().replace("2013", "twenty thirteen"))
for f in sys.argv[1:]:
    A = np.frombuffer(subprocess.run(["ffmpeg","-v","error","-i",f,"-ar","16000","-ac","1","-f","f32le","-"],capture_output=True).stdout, np.float32)
    segs, _ = m.transcribe(A, language="en")
    hyp = re.findall(r"[a-z']+", " ".join(s.text for s in segs).lower())
    # word error rate by edit distance
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        nd = [i]
        for j, h in enumerate(hyp, 1): nd.append(min(d[j] + 1, nd[j - 1] + 1, d[j - 1] + (r != h)))
        d = nd
    print(f, "WER", round(d[-1] / len(ref), 3))
