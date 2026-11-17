"""Finding a person or object in a frame and tracing its outline, for spotlights that wrap the subject itself.

Everything runs on the processor with OpenCV, with no model to download:
  - "Find the person": faces (the same detector the framing uses) and OpenCV's built-in people detector, picking the
    one nearest where the spot was placed. A face is grown into a head-and-shoulders box.
  - The outline: GrabCut, started from that box (or from the box the person drew), which separates the subject from
    its background by colour. The largest piece is kept and smoothed.
  - Following: the outline is traced once, then moved with the subject: the subject's own pixels (not the background)
    are searched for in each next sampled frame. Fine for a person walking or a car driving. The shape itself does not
    change, so the margin slider covers arms and legs; following stops at a cut or when the subject is lost.

Outlines are returned in source coordinates (0..1 of the source frame), each resampled to the same number of points
starting from the top, so the interface can blend between two outlines smoothly.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ..media import MediaError
from .vision import FaceFinder, _grab

POINTS = 72        # points per outline, the same for every outline so they can be blended
WORK_WIDTH = 640   # frames are traced at this width; finer gains little and GrabCut slows sharply with size
FOLLOW_FPS = 6     # outlines per second when following
MAX_FOLLOW = 20.0  # seconds; longer runs take minutes and drift


def _open(path: Path):
    import cv2
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise MediaError("Cannot read the source video.")
    return cap


def _small(frame: np.ndarray) -> np.ndarray:
    import cv2
    h, w = frame.shape[:2]
    if w <= WORK_WIDTH:
        return frame
    return cv2.resize(frame, (WORK_WIDTH, max(2, round(h * WORK_WIDTH / w))), interpolation=cv2.INTER_AREA)


def _clip_box(box, w: int, h: int) -> tuple[int, int, int, int]:
    """(x0, y0, x1, y1) in pixels, kept inside the frame and at least a few pixels across."""
    x0, y0, x1, y1 = box
    x0, x1 = sorted((max(0, min(w - 1, int(round(x0)))), max(0, min(w - 1, int(round(x1))))))
    y0, y1 = sorted((max(0, min(h - 1, int(round(y0)))), max(0, min(h - 1, int(round(y1))))))
    if x1 - x0 < 6:
        x1 = min(w - 1, x0 + 6)
    if y1 - y0 < 6:
        y1 = min(h - 1, y0 + 6)
    return x0, y0, x1, y1


def find_person(frame: np.ndarray, near: tuple[float, float]):
    """The person nearest `near` (0..1 of the frame): (box, anchor), both (x0, y0, x1, y1) in 0..1, or None.
    The anchor is a part that is certainly the person (the face), or None when only a body was found."""
    import cv2
    img = _small(frame)
    h, w = img.shape[:2]
    bodies: list[tuple[float, float, float, float]] = []
    # bodies: OpenCV's built-in people detector (upright, roughly full figures)
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
    rects, weights = hog.detectMultiScale(img, winStride=(8, 8), padding=(8, 8), scale=1.05)
    for (x, y, bw, bh), score in zip(rects, np.ravel(weights) if len(rects) else []):
        if score > 0.3:
            bodies.append((x / w, y / h, (x + bw) / w, (y + bh) / h))
    nx, ny = near
    dist = lambda b: ((b[0] + b[2]) / 2 - nx) ** 2 + ((b[1] + b[3]) / 2 - ny) ** 2   # noqa: E731
    # A face is the surest sign of a person and gives an anchor, so faces come first. The box runs from just above
    # the head to the chest, widened to any detected body that the face belongs to.
    people = []
    for cx, cy, fw, fh in FaceFinder().find(frame):
        box = (cx - fw * 1.8, cy - fh * 0.9, cx + fw * 1.8, cy + fh * 3.6)
        for b in bodies:
            if b[0] <= cx <= b[2] and b[1] <= cy <= b[1] + (b[3] - b[1]) * 0.4:
                box = (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
        people.append((box, (cx - fw * 0.3, cy - fh * 0.3, cx + fw * 0.3, cy + fh * 0.35)))
    if people:
        return min(people, key=lambda p: dist(p[0]))
    if bodies:
        return min(bodies, key=dist), None
    return None


def _resample(contour: np.ndarray, n: int = POINTS) -> np.ndarray:
    """n points evenly spaced along the outline, starting at its top-most point and going clockwise."""
    pts = contour.reshape(-1, 2).astype(np.float64)
    start = int(np.argmin(pts[:, 1] * 10000 + pts[:, 0]))
    pts = np.roll(pts, -start, axis=0)
    if len(pts) > 2:
        # clockwise on screen (y down) means a positive signed area
        area = np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
        if area < 0:
            pts = np.concatenate([pts[:1], pts[1:][::-1]])
    closed = np.vstack([pts, pts[:1]])
    seg = np.hypot(*np.diff(closed, axis=0).T)
    dist = np.concatenate([[0], np.cumsum(seg)])
    if dist[-1] <= 0:
        return np.repeat(pts[:1], n, axis=0)
    targets = np.linspace(0, dist[-1], n, endpoint=False)
    xs = np.interp(targets, dist, closed[:, 0])
    ys = np.interp(targets, dist, closed[:, 1])
    return np.stack([xs, ys], axis=1)


def trace(frame: np.ndarray, box: tuple[float, float, float, float], anchor=None) -> tuple[list[list[float]], tuple[float, float, float, float]]:
    """The subject's outline inside `box` (0..1 of the frame): (points in 0..1, the outline's own box in 0..1).

    Falls back to an ellipse filling the box when the subject cannot be separated from its background."""
    import cv2
    img = _small(frame)
    h, w = img.shape[:2]
    x0, y0, x1, y1 = _clip_box((box[0] * w, box[1] * h, box[2] * w, box[3] * h), w, h)
    # outside the box is background; inside is "probably the subject"; the anchor (a face) or else a small patch at
    # the box's centre is "certainly the subject", which keeps GrabCut from settling on the background instead
    mask = np.full((h, w), cv2.GC_BGD, np.uint8)
    mask[y0:y1, x0:x1] = cv2.GC_PR_FGD
    if anchor is not None:
        a0, b0, a1, b1 = _clip_box((anchor[0] * w, anchor[1] * h, anchor[2] * w, anchor[3] * h), w, h)
    else:
        cw, ch = (x1 - x0) * 0.08, (y1 - y0) * 0.08
        a0, b0, a1, b1 = _clip_box(((x0 + x1) / 2 - cw, (y0 + y1) / 2 - ch, (x0 + x1) / 2 + cw, (y0 + y1) / 2 + ch), w, h)
    mask[b0:b1, a0:a1] = cv2.GC_FGD
    bg, fg = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    contour = None
    try:
        cv2.grabCut(img, mask, None, bg, fg, 5, cv2.GC_INIT_WITH_MASK)
        keep = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
        # close small holes and drop specks, so the spot does not flicker around stray pixels
        k = max(3, (x1 - x0) // 25) | 1
        keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        keep = cv2.morphologyEx(keep, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        found, _ = cv2.findContours(keep, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if found:
            best = max(found, key=cv2.contourArea)
            # a piece much smaller than the box means GrabCut found nothing coherent
            if cv2.contourArea(best) > 0.08 * (x1 - x0) * (y1 - y0):
                contour = best
    except cv2.error:
        contour = None
    if contour is None:
        angles = np.linspace(0, 2 * np.pi, POINTS, endpoint=False)
        cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
        contour = np.stack([cx + rx * np.sin(angles), cy - ry * np.cos(angles)], axis=1)
    pts = _resample(np.asarray(contour))
    pts[:, 0] /= w
    pts[:, 1] /= h
    pts = np.clip(pts, 0, 1)
    own = (float(pts[:, 0].min()), float(pts[:, 1].min()), float(pts[:, 0].max()), float(pts[:, 1].max()))
    return [[round(float(x), 4), round(float(y), 4)] for x, y in pts], own


def _move(prev: np.ndarray, nxt: np.ndarray, pts: list[list[float]]) -> tuple[float, float] | None:
    """How far the subject inside outline `pts` (0..1) moved between two frames, as (dx, dy) in 0..1, or None when it
    was lost. Only the subject's own pixels are compared, so a busy or static background cannot pull the match."""
    import cv2
    a, b = _small(prev), _small(nxt)
    h, w = a.shape[:2]
    poly = (np.asarray(pts) * [w, h]).astype(np.int32)
    x0, y0, x1, y1 = _clip_box((poly[:, 0].min(), poly[:, 1].min(), poly[:, 0].max(), poly[:, 1].max()), w, h)
    pw, ph = x1 - x0, y1 - y0
    mask = np.zeros((ph, pw), np.uint8)
    cv2.fillPoly(mask, [poly - [x0, y0]], 255)
    if mask.sum() < 255 * 50:
        return None
    patch = a[y0:y1, x0:x1]
    # search around the old place; between two samples a subject rarely moves further than half its own size
    sx0, sy0 = max(0, x0 - pw // 2 - 8), max(0, y0 - ph // 2 - 8)
    sx1, sy1 = min(w, x1 + pw // 2 + 8), min(h, y1 + ph // 2 + 8)
    area = b[sy0:sy1, sx0:sx1]
    if area.shape[0] < ph or area.shape[1] < pw:
        return None
    score = cv2.matchTemplate(area, patch, cv2.TM_CCORR_NORMED, mask=cv2.merge([mask, mask, mask]))
    score = np.nan_to_num(score, nan=0.0)
    _, best, _, (mx, my) = cv2.minMaxLoc(score)
    if best < 0.9:   # lost it (it left the frame, was covered, or the shot changed)
        return None
    return (sx0 + mx - x0) / w, (sy0 + my - y0) / h


def outline(source: Path, t: float, box: tuple[float, float, float, float], find: bool = False,
            until: float | None = None, job=None) -> dict:
    """Outline(s) of the subject at source time `t`.

    box: (x0, y0, x1, y1) in 0..1 of the source frame: where the spot was placed. With find=True the nearest person
    to its centre is used instead of the box itself. With `until` later than t, the subject is followed to that time.
    Returns {keys: [{t, pts}], box, found: 'person' | 'box' | 'none'}."""
    cap = _open(source)
    try:
        frame = _grab(cap, t)
        if frame is None:
            raise MediaError("Cannot read the frame at that moment.")
        how, anchor = "box", None
        if find:
            person = find_person(frame, ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2))
            if person is None:
                how = "none"
            else:
                (box, anchor), how = person, "person"
        box = tuple(max(0.0, min(1.0, v)) for v in box)   # type: ignore[assignment]
        pts, own = trace(frame, box, anchor)
        keys = [{"t": round(t, 3), "pts": pts}]
        lost = False
        if until is not None and until - t > 0.2:
            end = min(until, t + MAX_FOLLOW)
            steps = max(1, int((end - t) * FOLLOW_FPS))
            prev = frame
            for i in range(1, steps + 1):
                if job is not None:
                    job.update(0.1 + 0.85 * i / steps, f"Following the subject ({i} of {steps})")
                at = t + (end - t) * i / steps
                nxt = _grab(cap, at)
                if nxt is None:
                    break
                shift = _move(prev, nxt, pts)
                if shift is None:   # stop rather than guess; the last outline holds from here on
                    lost = True
                    break
                pts = [[round(min(1.0, max(0.0, x + shift[0])), 4), round(min(1.0, max(0.0, y + shift[1])), 4)] for x, y in pts]
                keys.append({"t": round(at, 3), "pts": pts})
                prev = nxt
        return {"keys": keys, "box": list(own), "found": how,
                "lost_at": keys[-1]["t"] if lost else None}
    finally:
        cap.release()
