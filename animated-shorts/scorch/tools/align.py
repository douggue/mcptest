import json, sys
from faster_whisper import WhisperModel
m = WhisperModel("base.en", device="cpu", compute_type="int8")
import numpy as np, subprocess
A = np.frombuffer(subprocess.run(["ffmpeg","-v","error","-i",sys.argv[1],"-ar","16000","-ac","1","-f","f32le","-"],capture_output=True).stdout, np.float32)
segs, _ = m.transcribe(A, word_timestamps=True, language="en")
W = [{"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)} for s in segs for w in s.words]
json.dump(W, open(sys.argv[2], "w"), indent=0); print(len(W), "words"); print(" ".join(w["word"] for w in W))
