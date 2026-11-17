"""Following a person or object through the clip, so a name tag, circle, arrow, label or spotlight stays on them.

Faces are followed with the face detector the framing uses (the face nearest where the subject was last seen); when
no face is near, OpenCV's MIL tracker (part of the standard opencv-python, no download) follows the box by its look.
The result is a path of centre points in source coordinates (0..1 of the source frame), about ten a second, smoothed
so the graphic glides instead of jittering.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ..media import MediaError

STEP = 0.1          # seconds between points on the path
WORK_WIDTH = 640    # frames are tracked at this width


def _smooth(points: list[tuple[float, float, float]], radius: int = 2) -> list[tuple[float, float, float]]:
    if len(points) < 3:
        return points
    arr = np.array(points)
    out = arr.copy()
    for i in range(len(arr)):
        a, b = max(0, i - radius), min(len(arr), i + radius + 1)
        out[i, 1:] = arr[a:b, 1:].mean(axis=0)
    return [tuple(p) for p in out]


def track(source: Path, t0: float, t1: float, box: tuple[float, float, float, float], job=None) -> dict:
    """box: (x0, y0, x1, y1) in 0..1 of the source frame at time t0. Returns {path: [{t, x, y}], lost: seconds or None}."""
    import cv2
    from .vision import FaceFinder

    if t1 - t0 < STEP:
        raise MediaError("The graphic is on screen too briefly to follow anything.")
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise MediaError("Cannot open the video to follow the subject.")
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        W0 = cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1.0
        H0 = cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1.0
        scale = min(1.0, WORK_WIDTH / W0)
        W, H = int(W0 * scale), int(H0 * scale)
        cap.set(cv2.CAP_PROP_POS_MSEC, t0 * 1000.0)

        faces = FaceFinder()
        x0, y0, x1, y1 = box
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        bw, bh = max(0.02, x1 - x0), max(0.02, y1 - y0)
        tracker = None
        points: list[tuple[float, float, float]] = []
        lost = None
        every = max(1, int(round(fps * STEP)))
        n = 0
        total = int((t1 - t0) * fps) + 1
        while n <= total:
            ok, frame = cap.read()
            if not ok:
                break
            t = t0 + n / fps
            n += 1
            if (n - 1) % every:
                continue
            small = cv2.resize(frame, (W, H)) if scale < 1 else frame
            if job is not None and len(points) % 10 == 0:
                job.update(0.1 + 0.85 * (t - t0) / max(0.01, t1 - t0), "Following the subject")
            # a face near where the subject was is the surest anchor
            near = None
            for fx, fy, fw, fh in faces.find(small):
                d = ((fx - cx) ** 2 + (fy - cy) ** 2) ** 0.5
                if d < max(bw, bh) * 0.9 and (near is None or d < near[0]):
                    near = (d, fx, fy)
            if near is not None:
                cx, cy = near[1], near[2]
                tracker = None   # start the look-tracker afresh from here if the face is lost
            else:
                rect = (int((cx - bw / 2) * W), int((cy - bh / 2) * H), max(4, int(bw * W)), max(4, int(bh * H)))
                if tracker is None:
                    tracker = cv2.TrackerMIL_create()
                    tracker.init(small, rect)
                else:
                    found, r = tracker.update(small)
                    if found:
                        cx, cy = (r[0] + r[2] / 2) / W, (r[1] + r[3] / 2) / H
                    elif lost is None:
                        lost = round(t, 2)
            points.append((round(t, 3), min(1.0, max(0.0, cx)), min(1.0, max(0.0, cy))))
    finally:
        cap.release()
    if not points:
        raise MediaError("Could not read the video at that moment.")
    path = [{"t": round(float(t), 3), "x": round(float(x), 4), "y": round(float(y), 4)} for t, x, y in _smooth(points)]
    return {"path": path, "lost": lost}
