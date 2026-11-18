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
    """Hard cuts between `start` and `end` (source seconds). ffmpeg's scene-change detector first; when it finds
    nothing or fails, PySceneDetect (if installed) and then a frame-by-frame colour comparison have a go, so a soft
    or dark cut that one method misses is still found."""
    try:
        cuts = _scdet_cuts(path, start, end, threshold)
    except Exception:   # noqa: BLE001 - fall through to the backups
        cuts = []
    if cuts or end - start < 1.5:
        return cuts
    for backup in (_pyscenedetect_cuts, _histogram_cuts):
        try:
            found = backup(path, start, end)
        except Exception:   # noqa: BLE001 - a backup that cannot run is skipped
            continue
        if found:
            return found
    return []


def _keep(cuts: list[float], start: float, end: float) -> list[float]:
    out: list[float] = []
    for t in sorted(cuts):
        if start + 0.4 < t < end - 0.4 and (not out or t - out[-1] > 0.5):
            out.append(round(t, 3))
    return out


def _pyscenedetect_cuts(path: Path, start: float, end: float) -> list[float]:
    from scenedetect import ContentDetector, detect   # optional: pip install scenedetect
    scenes = detect(str(path), ContentDetector(threshold=27.0), start_time=start, end_time=end)
    return _keep([a.get_seconds() for a, _ in scenes[1:]], start, end)


def _histogram_cuts(path: Path, start: float, end: float) -> list[float]:
    """Every frame's colour histogram against the previous one; a cut is a jump well above the clip's usual change."""
    import cv2
    cap = cv2.VideoCapture(str(path))
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000.0)
        prev, diffs, times = None, [], []
        n = 0
        while True:
            ok, frame = cap.read()
            t = start + n / fps
            n += 1
            if not ok or t > end:
                break
            small = cv2.resize(frame, (160, 90))
            hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
            h = cv2.calcHist([hsv], [0, 1, 2], None, [16, 8, 8], [0, 180, 0, 256, 0, 256])
            cv2.normalize(h, h)
            if prev is not None:
                diffs.append(1.0 - float(cv2.compareHist(prev, h, cv2.HISTCMP_CORREL)))
                times.append(t)
            prev = h
    finally:
        cap.release()
    if len(diffs) < 3:
        return []
    usual = float(np.median(diffs))
    return _keep([t for t, d in zip(times, diffs) if d > max(0.35, usual * 6)], start, end)


def _scdet_cuts(path: Path, start: float, end: float, threshold: float) -> list[float]:
    cmd = [need("ffmpeg"), "-hide_banner", "-loglevel", "info", "-ss", f"{start:.3f}", "-t", f"{max(0.1, end - start):.3f}",
           "-i", str(path), "-an", "-vf", f"scale=320:-2,scdet=threshold={threshold}", "-f", "null", "-"]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr[-200:])
    return _keep([start + float(m.group(1)) for m in re.finditer(r"lavfi\.scd\.time:\s*([\d.]+)", out.stderr)], start, end)


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


def _focus(cv2, cap, start: float, end: float) -> dict | None:
    """Where the action is in a shot without faces: the centre of the movement between frames a moment apart
    (a hand on a joystick, springs stretching); if nothing moves, the centre of the detail. {cx, cy, how}."""
    dur = max(0.2, end - start)
    motion = np.zeros((90, 160), np.float32)
    detail = np.zeros((90, 160), np.float32)
    for p in (0.2, 0.4, 0.6, 0.8):
        t = start + dur * p
        a, b = _grab(cap, t), _grab(cap, min(end - 0.02, t + 0.15))
        if a is None:
            continue
        ga = cv2.GaussianBlur(cv2.cvtColor(cv2.resize(a, (160, 90)), cv2.COLOR_BGR2GRAY).astype(np.float32), (5, 5), 0)
        detail += np.abs(cv2.Laplacian(ga, cv2.CV_32F))
        if b is not None:
            gb = cv2.GaussianBlur(cv2.cvtColor(cv2.resize(b, (160, 90)), cv2.COLOR_BGR2GRAY).astype(np.float32), (5, 5), 0)
            motion += np.abs(ga - gb)
    for name, field in (("motion", motion), ("detail", detail)):
        field = np.where(field > np.percentile(field, 85), field, 0)   # only the strongest part counts
        total = float(field.sum())
        if total <= 0 or (name == "motion" and float(motion.mean()) < 1.5):
            continue
        ys, xs = np.mgrid[0:90, 0:160]
        return {"cx": round(float((field * xs).sum() / total / 160), 4), "cy": round(float((field * ys).sum() / total / 90), 4), "how": name}
    return None


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
            shot = {"faces": faces, "track": keys}
            # where the action is, for when there is no steady face to frame on (none found, or only doubtful ones)
            if not any(f["seen"] >= 0.5 for f in faces):
                f = _focus(cv2, cap, start, end)
                if f:
                    shot["focus"] = f
            out.append(shot)
    finally:
        cap.release()
    return {"engine": finder.engine, "shots": out}
