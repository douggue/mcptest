"""Looking at the picture: where the cuts are, where the faces are, and who is talking."""
from __future__ import annotations

import re
import subprocess
import urllib.request
from pathlib import Path

import numpy as np

from ..config import DATA
from ..jobs import Job
from ..media import need

_YUNET_URL = ("https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_detection_yunet/"
              "face_detection_yunet_2023mar.onnx")


def detect_cuts(path: Path, start: float, end: float, threshold: float = 12.0) -> list[float]:
    """Hard cuts between `start` and `end` (source seconds), from ffmpeg's scene-change detector."""
    cmd = [need("ffmpeg"), "-hide_banner", "-loglevel", "info", "-ss", f"{start:.3f}", "-t", f"{max(0.1, end - start):.3f}",
           "-i", str(path), "-an", "-vf", f"scale=320:-2,scdet=threshold={threshold}", "-f", "null", "-"]
    out = subprocess.run(cmd, capture_output=True, text=True)
    cuts = []
    for m in re.finditer(r"lavfi\.scd\.time:\s*([\d.]+)", out.stderr):
        t = start + float(m.group(1))
        if start + 0.4 < t < end - 0.4 and (not cuts or t - cuts[-1] > 0.5):
            cuts.append(round(t, 3))
    return cuts


class FaceFinder:
    """YuNet when its model file is available (better with profiles and small faces), Haar cascades otherwise."""

    def __init__(self) -> None:
        import cv2
        self.cv2 = cv2
        self.yunet = None
        model = DATA / "cache" / "face_detection_yunet.onnx"
        if not model.exists():
            try:
                with urllib.request.urlopen(_YUNET_URL, timeout=8) as r:
                    data = r.read()
                if len(data) > 100_000:
                    model.write_bytes(data)
            except Exception:
                pass
        if model.exists() and hasattr(cv2, "FaceDetectorYN"):
            try:
                self.yunet = cv2.FaceDetectorYN.create(str(model), "", (320, 320), 0.6, 0.3, 50)
            except Exception:
                self.yunet = None
        self.frontal = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        self.frontal_alt = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml")
        self.profile = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
        self.engine = "yunet" if self.yunet is not None else "haar"

    def find(self, frame: np.ndarray) -> list[tuple[float, float, float, float]]:
        """Faces as (cx, cy, w, h), each 0..1 of the frame."""
        cv2 = self.cv2
        H, W = frame.shape[:2]
        target = min(W, 960)
        small = cv2.resize(frame, (target, max(2, int(H * target / max(W, 1))))) if target != W else frame
        h, w = small.shape[:2]
        boxes: list[tuple[float, float, float, float]] = []
        if self.yunet is not None:
            self.yunet.setInputSize((w, h))
            _, found = self.yunet.detect(small)
            for f in found if found is not None else []:
                boxes.append((float(f[0]), float(f[1]), float(f[2]), float(f[3])))
        else:
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            m = max(28, int(h * 0.06))
            for cascade in (self.frontal, self.frontal_alt):
                for x, y, bw, bh in cascade.detectMultiScale(gray, 1.1, 5, minSize=(m, m)):
                    boxes.append((float(x), float(y), float(bw), float(bh)))
                if boxes:
                    break
            if not boxes:
                for flip in (False, True):
                    g = cv2.flip(gray, 1) if flip else gray
                    for x, y, bw, bh in self.profile.detectMultiScale(g, 1.1, 5, minSize=(m, m)):
                        boxes.append((float(w - x - bw) if flip else float(x), float(y), float(bw), float(bh)))
        merged: list[tuple[float, float, float, float]] = []
        for b in sorted(boxes, key=lambda b: b[2] * b[3], reverse=True):
            cx = b[0] + b[2] / 2
            if all(abs(cx - (o[0] + o[2] / 2)) > max(b[2], o[2]) * 0.6 for o in merged):
                merged.append(b)
        return [((x + bw / 2) / w, (y + bh / 2) / h, bw / w, bh / h) for x, y, bw, bh in merged]


def _grab(cap, t: float):
    cap.set(0, t * 1000.0)   # CAP_PROP_POS_MSEC
    ok, frame = cap.read()
    return frame if ok else None


def _mouth_motion(cv2, a: np.ndarray, b: np.ndarray, face: tuple[float, float, float, float]) -> float:
    H, W = a.shape[:2]
    cx, cy, w, h = face
    x0, x1 = int(max(0, (cx - w * 0.3) * W)), int(min(W, (cx + w * 0.3) * W))
    y0, y1 = int(max(0, (cy + h * 0.1) * H)), int(min(H, (cy + h * 0.5) * H))
    if x1 - x0 < 4 or y1 - y0 < 4:
        return 0.0
    pa = cv2.cvtColor(a[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY).astype(np.float32)
    pb = cv2.cvtColor(b[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY).astype(np.float32)
    return float(np.mean(np.abs(pa - pb)))


def analyse_shots(path: Path, ranges: list[tuple[float, float]], job: Job | None = None, track: bool = False) -> dict:
    """For each (start, end) shot: the faces in it ranked by who seems to be speaking, and optional tracking keyframes.

    Returns {engine, shots: [{faces: [{cx, cy, w, score}], track: [{t, cx}]}]}; coordinates are 0..1 of the frame.
    """
    import cv2
    finder = FaceFinder()
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError("Could not open the video for analysis.")
    out = []
    try:
        for n, (start, end) in enumerate(ranges):
            if job:
                job.update(n / max(1, len(ranges)), f"Finding the speaker (shot {n + 1} of {len(ranges)})")
            dur = max(0.2, end - start)
            times = [start + dur * p for p in (0.12, 0.3, 0.5, 0.7, 0.88)] if dur > 1 else [start + dur / 2]
            clusters: list[dict] = []
            for t in times:
                a = _grab(cap, t)
                if a is None:
                    continue
                b = _grab(cap, min(end, t + 0.12))
                for face in finder.find(a):
                    c = next((c for c in clusters if abs(c["cx"] - face[0]) < 0.12), None)
                    if c is None:
                        c = {"cx": face[0], "cy": face[1], "w": face[2], "n": 0, "motion": 0.0}
                        clusters.append(c)
                    c["cx"] = (c["cx"] * c["n"] + face[0]) / (c["n"] + 1)
                    c["cy"] = (c["cy"] * c["n"] + face[1]) / (c["n"] + 1)
                    c["w"] = (c["w"] * c["n"] + face[2]) / (c["n"] + 1)
                    c["n"] += 1
                    if b is not None:
                        c["motion"] += _mouth_motion(cv2, a, b, face)
            faces = []
            for c in clusters:
                if c["n"] < max(1, len(times) // 3):
                    continue   # a one-off detection is usually a false positive
                faces.append({"cx": round(c["cx"], 4), "cy": round(c["cy"], 4), "w": round(c["w"], 4),
                              "score": round(c["motion"] / c["n"] * (0.6 + c["w"]), 4),
                              "seen": round(c["n"] / len(times), 2)})   # share of the sampled frames it was found in
            faces.sort(key=lambda f: (f["score"], f["w"]), reverse=True)
            keys: list[dict] = []
            if track and faces:
                last = faces[0]["cx"]
                step = 0.5
                t = start
                raw = []
                while t < end:
                    frame = _grab(cap, t)
                    found = finder.find(frame) if frame is not None else []
                    if found:
                        last = min(found, key=lambda f: abs(f[0] - last))[0]
                    raw.append((t, last))
                    t += step
                for i, (t, _) in enumerate(raw):   # smooth so the crop glides instead of jittering
                    win = [x for _, x in raw[max(0, i - 2):i + 3]]
                    keys.append({"t": round(t, 3), "cx": round(sum(win) / len(win), 4)})
            out.append({"faces": faces, "track": keys})
    finally:
        cap.release()
    return {"engine": finder.engine, "shots": out}
