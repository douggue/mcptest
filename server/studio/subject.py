"""Finding a person or object in a still frame and tracing its outline, for spotlights that light the subject itself.

  - "Find the person": faces (the same detector the framing uses) and OpenCV's built-in people detector, picking the
    one nearest where the spot was placed.
  - The body: PP-HumanSeg, a 6 MB person-segmentation model from the OpenCV model zoo (Apache 2.0), run by OpenCV on a
    crop around the person so small figures in wide shots are as clear as close-ups. Only the piece of body joined to
    the person found is kept. Downloaded once; nothing else to install.
  - Anything that is not a person (a car, a dog), or when the model cannot be had: GrabCut, which separates the
    subject inside the spot from its background by colour.

Outlines are returned in source coordinates (0..1 of the source frame), resampled to a fixed number of points.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

import urllib.request

from ..config import DATA
from ..media import MediaError
from .vision import FaceFinder, _grab

POINTS = 96        # points per outline
WORK_WIDTH = 640   # GrabCut works at this width; finer gains little and it slows sharply with size
SEG_URL = ("https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/human_segmentation_pphumanseg/"
           "human_segmentation_pphumanseg_2023mar.onnx")
SEG_SIZE = 192     # the model's input size
_seg_net = None


def _segmenter():
    """The person-segmentation network, downloading it the first time. None if it cannot be had (offline)."""
    global _seg_net
    if _seg_net is not None:
        return _seg_net
    import cv2
    model = DATA / "cache" / "human_segmentation_pphumanseg_2023mar.onnx"
    if not model.exists():
        try:
            model.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(SEG_URL, timeout=30) as r:
                data = r.read()
            if len(data) < 1_000_000:   # an error page, not the model
                return None
            tmp = model.with_suffix(".part")
            tmp.write_bytes(data)
            tmp.replace(model)
        except Exception:
            return None
    try:
        _seg_net = cv2.dnn.readNet(str(model))
    except Exception:
        return None
    return _seg_net


def _segment(frame: np.ndarray, net, x0: int, y0: int, x1: int, y1: int) -> np.ndarray:
    """The model's person mask for one crop, placed in a full-frame 0/255 mask."""
    import cv2
    h, w = frame.shape[:2]
    x = cv2.resize(frame[y0:y1, x0:x1], (SEG_SIZE, SEG_SIZE), interpolation=cv2.INTER_AREA)[:, :, ::-1].astype(np.float32) / 255.0
    net.setInput(((x - 0.5) / 0.5).transpose(2, 0, 1)[None])
    out = net.forward()[0]
    soft = cv2.resize((out[1] - out[0]).astype(np.float32), (x1 - x0, y1 - y0), interpolation=cv2.INTER_CUBIC)
    mask = np.zeros((h, w), np.uint8)
    mask[y0:y1, x0:x1] = (soft > 0).astype(np.uint8) * 255
    return mask


def person_mask(frame: np.ndarray, box: tuple[float, float, float, float]) -> np.ndarray | None:
    """Where a person is, inside `box` (0..1), as a full-frame 0/255 mask; None without the model.

    The model sees a small fixed-size picture, so a generous first look finds the body and a second, tight look around
    it traces the edges at the best detail."""
    net = _segmenter()
    if net is None:
        return None
    h, w = frame.shape[:2]
    bw, bh = (box[2] - box[0]) * w, (box[3] - box[1]) * h
    first = _segment(frame, net, *_clip_box((box[0] * w - bw * 0.1, box[1] * h - bh * 0.05, box[2] * w + bw * 0.1, box[3] * h + bh * 0.05), w, h))
    ys, xs = np.nonzero(first)
    if len(xs) < 50:
        return first
    fx0, fx1, fy0, fy1 = xs.min(), xs.max(), ys.min(), ys.max()
    pw, ph = (fx1 - fx0) * 0.12 + 4, (fy1 - fy0) * 0.08 + 4
    return _segment(frame, net, *_clip_box((fx0 - pw, fy0 - ph, fx1 + pw, fy1 + ph), w, h))


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
        box = (cx - fw * 2.4, cy - fh * 1.0, cx + fw * 2.4, cy + fh * 7.5)   # head to feet: a standing adult is about 7.5 heads tall
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


def _contour_of(mask: np.ndarray, anchor, box) -> np.ndarray | None:
    """The piece of `mask` that belongs to the subject: the one touching the anchor (a face), else the largest."""
    import cv2
    h, w = mask.shape
    k = max(3, int(min(h, w) * 0.006)) | 1
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    found, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not found:
        return None
    if anchor is not None:
        ax, ay = (anchor[0] + anchor[2]) / 2 * w, (anchor[1] + anchor[3]) / 2 * h
        hits = [c for c in found if cv2.pointPolygonTest(c, (float(ax), float(ay)), True) > -max(4, (anchor[2] - anchor[0]) * w)]
        if hits:
            return max(hits, key=cv2.contourArea)
    best = max(found, key=cv2.contourArea)
    area = (box[2] - box[0]) * w * (box[3] - box[1]) * h
    return best if cv2.contourArea(best) > 0.04 * area else None


def outline(source: Path, t: float, box: tuple[float, float, float, float], find: bool = False, job=None) -> dict:
    """The outline of the subject in the frame at source time `t`.

    box: (x0, y0, x1, y1) in 0..1 of the source frame: where the spot was placed. With find=True the person nearest
    its centre is used. Returns {keys: [{t, pts}], box, found: 'person' | 'box' | 'none', how: 'body' | 'colour'}."""
    cap = _open(source)
    try:
        frame = _grab(cap, t)
    finally:
        cap.release()
    if frame is None:
        raise MediaError("Cannot read the frame at that moment.")
    found, anchor = "box", None
    if find:
        person = find_person(frame, ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2))
        if person is None:
            found = "none"
        else:
            (box, anchor), found = person, "person"
    box = tuple(max(0.0, min(1.0, v)) for v in box)   # type: ignore[assignment]
    if job is not None:
        job.update(0.4, "Cutting out the body")
    h, w = frame.shape[:2]
    contour, how = None, "body"
    mask = person_mask(frame, box)
    if mask is not None:
        contour = _contour_of(mask, anchor, box)
    if contour is None:   # not a person (or no model): separate whatever is in the spot by colour
        pts, own = trace(frame, box, anchor)
        how = "colour"
    else:
        pts_arr = _resample(contour.astype(np.float64))
        pts_arr[:, 0] /= w
        pts_arr[:, 1] /= h
        pts_arr = np.clip(pts_arr, 0, 1)
        pts = [[round(float(x), 4), round(float(y), 4)] for x, y in pts_arr]
        own = (float(pts_arr[:, 0].min()), float(pts_arr[:, 1].min()), float(pts_arr[:, 0].max()), float(pts_arr[:, 1].max()))
    return {"keys": [{"t": round(t, 3), "pts": pts}], "box": list(own), "found": found, "how": how}
