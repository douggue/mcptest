"""AI upscaling for low-resolution footage: Real-ESRGAN (realesr-general-x4v3) run with ONNX Runtime, without PyTorch.

The model enlarges four times, which is slow on a CPU and more than a short needs. Each frame is therefore halved
first and then enlarged, a net 2x, and the result is capped at MAX_SIDE. The model file is downloaded once as a
PyTorch checkpoint and rewritten here as an ONNX graph, so PyTorch never has to be installed.
"""
from __future__ import annotations

import importlib.util
import math
import os
import pickle
import subprocess
import tempfile
import threading
import time
import urllib.request
import zipfile
from collections import OrderedDict
from fractions import Fraction
from pathlib import Path

import numpy as np

from ..config import DATA
from ..jobs import Job
from ..media import MediaError, need, probe

MODEL_URL = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth"
MODELS = DATA / "models"
PTH = MODELS / "realesr-general-x4v3.pth"
ONNX = MODELS / "realesr-general-x4v3.onnx"
PACKAGES = ("onnx", "onnxruntime")
MAX_SIDE = 2160          # the longer side of the result; above this the extra pixels cost time and show nothing
MODEL_SCALE = 4
# Best first. ONNX Runtime lists a provider when its package is installed, which is what "installed" means here.
PROVIDERS = [("CUDAExecutionProvider", "CUDA"), ("DmlExecutionProvider", "DirectML"),
             ("CoreMLExecutionProvider", "CoreML"), ("CPUExecutionProvider", "CPU")]
# Audio that can go into an MP4 untouched; anything else is re-encoded rather than failing at the very end.
MP4_AUDIO = {"aac", "mp3", "ac3", "eac3", "alac", "opus"}

_model_lock = threading.Lock()


def missing() -> list[str]:
    return [p for p in PACKAGES if importlib.util.find_spec(p) is None]


def available() -> bool:
    return not missing()


def _cpus() -> int:
    """The cores this process may use, which in a container can be fewer than the machine has."""
    if hasattr(os, "sched_getaffinity"):
        return len(os.sched_getaffinity(0)) or 1
    return os.cpu_count() or 1


def _provider() -> tuple[str, str]:
    import onnxruntime as ort
    from .. import gpu
    if not gpu.enabled():   # Settings → Graphics card switched off
        return PROVIDERS[-1]
    have = ort.get_available_providers()
    return next((p for p in PROVIDERS if p[0] in have), PROVIDERS[-1])


def state() -> dict:
    """What the interface needs to offer upscaling and to warn how slow it will be."""
    ok = available()
    label = _provider()[1] if ok else ""
    return {"available": ok, "missing": missing(), "model_downloaded": ONNX.exists() or PTH.exists(),
            "provider": label, "gpu": bool(label) and label != "CPU", "cpus": _cpus(),
            "model_folder": str(MODELS), "model_url": MODEL_URL, "max_side": MAX_SIDE}


# ---------------------------------------------------------------- the model: download, convert, load

class _Checkpoint(pickle.Unpickler):
    """Reads a PyTorch checkpoint without PyTorch. Only the three names such a file needs are accepted, so a file
    that is not a plain table of weights is refused instead of being allowed to run code."""

    def __init__(self, file, archive: zipfile.ZipFile, folder: str):
        super().__init__(file)
        self.archive = archive
        self.folder = folder

    def find_class(self, module: str, name: str):
        if (module, name) == ("collections", "OrderedDict"):
            return OrderedDict
        if (module, name) == ("torch._utils", "_rebuild_tensor_v2"):
            return self._tensor
        if (module, name) == ("torch", "FloatStorage"):
            return "float32"
        raise pickle.UnpicklingError(f"unexpected {module}.{name}")

    def persistent_load(self, pid):
        # ('storage', storage type, key, device, element count): the numbers live in their own file in the zip.
        kind, dtype, key = pid[0], pid[1], pid[2]
        if kind != "storage" or dtype != "float32":
            raise pickle.UnpicklingError("unexpected storage")
        return np.frombuffer(self.archive.read(f"{self.folder}data/{key}"), dtype="<f4")

    @staticmethod
    def _tensor(storage, offset, size, stride, *_):
        if not size:
            return storage[offset:offset + 1].reshape(()).copy()
        view = np.lib.stride_tricks.as_strided(storage[offset:], shape=size, strides=[s * 4 for s in stride])
        return np.ascontiguousarray(view)


def _read_weights(pth: Path) -> dict:
    with zipfile.ZipFile(pth) as archive:
        entry = next(n for n in archive.namelist() if n.endswith("data.pkl"))
        with archive.open(entry) as f:
            loaded = _Checkpoint(f, archive, entry[:-len("data.pkl")]).load()
    for key in ("params_ema", "params"):
        if isinstance(loaded, dict) and key in loaded:
            return loaded[key]
    return loaded


def _convert(pth: Path, dest: Path) -> None:
    """Write the checkpoint as an ONNX graph: conv + PReLU pairs, a last conv to 48 channels that DepthToSpace
    folds into a 4x picture, and the input enlarged by nearest neighbour added on (the model learns the difference)."""
    from onnx import TensorProto, checker, helper, numpy_helper, save
    try:
        weights = _read_weights(pth)
        layers = sorted({int(k.split(".")[1]) for k in weights})
        nodes, tensors, x, channels = [], [], "input", 0
        for i in layers:
            w = np.asarray(weights[f"body.{i}.weight"], dtype=np.float32)
            if w.ndim == 4:
                tensors += [numpy_helper.from_array(w, f"w{i}"),
                            numpy_helper.from_array(np.asarray(weights[f"body.{i}.bias"], dtype=np.float32), f"b{i}")]
                nodes.append(helper.make_node("Conv", [x, f"w{i}", f"b{i}"], [f"x{i}"], kernel_shape=[3, 3], pads=[1, 1, 1, 1]))
                channels = w.shape[0]
            else:
                tensors.append(numpy_helper.from_array(w.reshape(-1, 1, 1), f"w{i}"))
                nodes.append(helper.make_node("PRelu", [x, f"w{i}"], [f"x{i}"]))
            x = f"x{i}"
        first = weights[f"body.{layers[0]}.weight"]
        if first.shape[1] != 3 or channels != 3 * MODEL_SCALE ** 2:
            raise ValueError("not a 4x RGB model")
    except (KeyError, ValueError, IndexError, StopIteration, zipfile.BadZipFile, pickle.UnpicklingError, OSError) as e:
        raise MediaError(f"{pth.name} in {pth.parent} is not the Real-ESRGAN model this needs ({e}). "
                         f"Delete it and export again to download a fresh copy.") from None
    tensors.append(numpy_helper.from_array(np.array([1, 1, MODEL_SCALE, MODEL_SCALE], dtype=np.float32), "scales"))
    nodes += [
        # CRD is the channel order of PyTorch's PixelShuffle; asymmetric + floor is its nearest-neighbour enlargement.
        helper.make_node("DepthToSpace", [x], ["detail"], blocksize=MODEL_SCALE, mode="CRD"),
        helper.make_node("Resize", ["input", "", "scales"], ["base"], mode="nearest",
                         coordinate_transformation_mode="asymmetric", nearest_mode="floor"),
        helper.make_node("Add", ["detail", "base"], ["output"]),
    ]
    shape = [1, 3, "height", "width"]
    graph = helper.make_graph(nodes, "realesr-general-x4v3",
                              [helper.make_tensor_value_info("input", TensorProto.FLOAT, shape)],
                              [helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 3, "height4", "width4"])],
                              tensors)
    # IR version 8 is the one that goes with opset 17, so older ONNX Runtime releases can read the file too.
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], ir_version=8)
    checker.check_model(model)
    tmp = dest.with_suffix(".onnx.part")
    try:
        save(model, str(tmp))
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)


def _download(job: Job) -> None:
    job.update(message="Downloading the upscaling model (5 MB, first time only)")
    tmp = PTH.with_suffix(".pth.part")
    try:
        with urllib.request.urlopen(MODEL_URL, timeout=30) as response, open(tmp, "wb") as f:
            while chunk := response.read(1 << 16):
                job.update()   # so a cancel is noticed on a slow connection
                f.write(chunk)
        if not zipfile.is_zipfile(tmp):
            raise OSError("what arrived is not the model file")
        tmp.replace(PTH)
    except (OSError, ValueError) as e:   # network errors, timeouts and HTTP errors are all OSError
        reason = str(getattr(e, "reason", "") or e) or e.__class__.__name__
        raise MediaError(f"The upscaling model could not be downloaded ({reason}). Download it yourself from "
                         f"{MODEL_URL} and put the file in {MODELS}, then export again.") from None
    finally:
        tmp.unlink(missing_ok=True)


def _model(job: Job) -> Path:
    """The ONNX model file, downloading and converting it the first time."""
    with _model_lock:   # two exports started together must not both write the file
        if not ONNX.exists():
            MODELS.mkdir(parents=True, exist_ok=True)
            if not PTH.exists():
                _download(job)
            job.update(message="Preparing the upscaling model")
            _convert(PTH, ONNX)
    return ONNX


def _session(path: Path):
    """An inference session on the best provider that actually starts, and that provider's label."""
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = _cpus()   # the default counts physical cores only
    options.log_severity_level = 3
    name, label = _provider()
    if name == "DmlExecutionProvider":   # DirectML's documented requirements
        options.enable_mem_pattern = False
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    # A GPU provider can be installed and still fail to start (missing driver libraries), so the CPU is tried last.
    for providers in ([name, "CPUExecutionProvider"], ["CPUExecutionProvider"]):
        try:
            session = ort.InferenceSession(str(path), sess_options=options, providers=list(dict.fromkeys(providers)))
            used = session.get_providers()[0]
            return session, next((lab for prov, lab in PROVIDERS if prov == used), used)
        except Exception as e:   # ONNX Runtime raises its own exception types
            failure = e
    raise MediaError(f"The upscaling model could not be loaded ({str(failure).splitlines()[0][:200]}). "
                     f"Delete {path} and export again to rebuild it.")


# ---------------------------------------------------------------- the video

def _video_facts(src: Path) -> dict:
    """The exact frame rate and the colour and pixel-shape tags; probe() rounds the first and leaves out the rest."""
    out = subprocess.run(
        [need("ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=avg_frame_rate,r_frame_rate,color_space,color_transfer,color_primaries,sample_aspect_ratio",
         "-of", "default=noprint_wrappers=1", str(src)], capture_output=True, text=True)
    facts = dict(line.split("=", 1) for line in out.stdout.splitlines() if "=" in line)
    rate = Fraction(30)
    for key in ("avg_frame_rate", "r_frame_rate"):
        try:
            value = Fraction(facts.get(key, ""))
        except (ValueError, ZeroDivisionError):   # "0/0" or missing
            continue
        if 1 <= value <= 240:
            rate = value
            break

    def tag(key: str) -> str:
        value = facts.get(key, "")
        return "" if value in ("unknown", "unspecified", "N/A") else value

    return {"rate": rate, "matrix": tag("color_space"), "transfer": tag("color_transfer"),
            "primaries": tag("color_primaries"), "sar": tag("sample_aspect_ratio")}


def plan(width: int, height: int) -> dict:
    """Sizes for one video: what the model is fed, what it returns and what is written. The written size is exactly
    twice the source unless that would pass MAX_SIDE; then it is the largest size under the cap, in multiples of four
    so the model's own output is used as it is."""
    out_w, out_h = 2 * width, 2 * height
    if max(out_w, out_h) > MAX_SIDE:
        k = MAX_SIDE / max(out_w, out_h)
        out_w, out_h = (max(4, round(side * k / 4) * 4) for side in (out_w, out_h))
    in_w, in_h = math.ceil(out_w / MODEL_SCALE), math.ceil(out_h / MODEL_SCALE)
    return {"in": (in_w, in_h), "model": (in_w * MODEL_SCALE, in_h * MODEL_SCALE), "out": (out_w, out_h)}


def _left(seconds: float) -> str:
    if seconds < 90:
        return f"about {max(5, round(seconds / 5) * 5)} s left"
    if seconds < 5400:
        return f"about {round(seconds / 60)} min left"
    return f"about {seconds / 3600:.1f} h left"


def _last_line(log) -> str:
    log.seek(0)
    lines = log.read().decode("utf-8", "replace").strip().splitlines()
    return lines[-1] if lines else ""


def upscale_video(src: Path, dst: Path, job: Job, span: tuple[float, float] = (0.0, 1.0)) -> dict:
    """Write `src` to `dst` at twice the size (see plan), same frame rate, with its audio carried across.

    Returns {width, height, frames, reused, seconds, seconds_per_frame, provider}. `reused` counts frames that were
    identical to the one before and so skipped the model."""
    if not available():
        raise MediaError("AI upscaling needs the " + " and ".join(f"'{p}'" for p in missing())
                         + " package(s): pip install onnx onnxruntime")
    src, dst = Path(src), Path(dst)
    info = probe(src)
    if not info["has_video"] or not info["width"] or not info["height"]:
        raise MediaError("That file has no video to upscale.")
    facts = _video_facts(src)
    sizes = plan(info["width"], info["height"])
    (in_w, in_h), (model_w, model_h), (out_w, out_h) = sizes["in"], sizes["model"], sizes["out"]
    rate = f"{facts['rate'].numerator}/{facts['rate'].denominator}"
    total = max(1, round(info["duration"] * facts["rate"]))

    job.update(span[0], "Loading the upscaling model")
    session, provider = _session(_model(job))

    # Decode at the model's input size and at a constant frame rate. The fps filter repeats or drops frames against
    # the source's own timestamps, starting at zero, so frame N of the pipe is the picture at N / rate and the copied
    # audio stays in sync even when the source's frame timing is uneven. Untagged video is read the way players read
    # it (BT.709 from 720 lines up, BT.601 below) because ffmpeg alone would assume BT.601 for everything.
    matrix = "" if facts["matrix"] else f":in_color_matrix={'bt709' if info['height'] >= 720 else 'bt601'}"
    decode = [need("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(src), "-map", "0:v:0",
              "-vf", f"fps={rate}:start_time=0,scale={in_w}:{in_h}:flags=area{matrix},format=rgb24",
              "-f", "rawvideo", "pipe:1"]
    # The result is always written as BT.709 and says so, which keeps the colours of the source in any player.
    # A short keyframe interval, like the render proxy, because the renderer seeks in this file frame by frame.
    filters = f"scale={out_w}:{out_h}:flags=area:out_color_matrix=bt709:out_range=tv,format=yuv420p"
    if facts["sar"] and facts["sar"] not in ("1:1", "0:1"):
        filters += f",setsar={facts['sar'].replace(':', '/')}"
    tags = ["-colorspace", "bt709", "-color_range", "tv"]
    for flag, key in (("-color_primaries", "primaries"), ("-color_trc", "transfer")):
        if facts[key]:
            tags += [flag, facts[key]]
    audio = ["-c:a", "copy"] if info["acodec"] in MP4_AUDIO else ["-c:a", "aac", "-b:a", "192k"]
    part = dst.with_name(dst.stem + ".part" + (dst.suffix or ".mp4"))   # dst only ever appears complete
    encode = [need("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error", "-nostdin",
              "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{model_w}x{model_h}", "-r", rate, "-i", "pipe:0",
              "-i", str(src), "-map", "0:v:0", "-map", "1:a:0?", "-vf", filters,
              "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-g", "15", *tags, *audio,
              "-movflags", "+faststart", str(part)]

    dst.parent.mkdir(parents=True, exist_ok=True)
    frame_bytes = in_w * in_h * 3
    frames = reused = 0
    started = time.time()
    done = False
    # ffmpeg's messages go to files, not pipes: nothing reads them while frames are moving, and a full pipe would stall.
    with tempfile.TemporaryFile() as dec_log, tempfile.TemporaryFile() as enc_log:
        dec = subprocess.Popen(decode, stdout=subprocess.PIPE, stderr=dec_log)
        enc = subprocess.Popen(encode, stdin=subprocess.PIPE, stderr=enc_log)
        try:
            assert dec.stdout and enc.stdin
            previous = picture = b""
            job.update(span[0], f"Upscaling: 0 of {total} frames")
            while True:
                raw = dec.stdout.read(frame_bytes)
                if len(raw) < frame_bytes:
                    break
                if raw == previous:
                    reused += 1   # a freeze frame: the answer would be the same, so the model is not asked again
                else:
                    x = np.ascontiguousarray(np.frombuffer(raw, np.uint8).reshape(1, in_h, in_w, 3).transpose(0, 3, 1, 2),
                                             dtype=np.float32)
                    x /= 255.0
                    y = session.run(None, {"input": x})[0][0]
                    np.clip(y, 0.0, 1.0, out=y)
                    y *= 255.0
                    y += 0.5
                    picture = y.astype(np.uint8).transpose(1, 2, 0).tobytes()
                    previous = raw
                try:
                    enc.stdin.write(picture)
                except OSError:   # the encoder has gone; its own message says why
                    raise MediaError("Upscaling failed while writing the video: " + (_last_line(enc_log) or "ffmpeg stopped")) from None
                frames += 1
                # The estimate follows the frames the model really ran on, so a long freeze does not make it optimistic.
                per_frame = (time.time() - started) / max(1, frames - reused)
                todo = max(0, total - frames)
                job.update(span[0] + (span[1] - span[0]) * min(1.0, frames / total),
                           f"Upscaling: {frames} of {max(total, frames)} frames, {_left(per_frame * todo)}")
            if dec.wait() != 0 or not frames:
                raise MediaError("Upscaling failed while reading the video: " + (_last_line(dec_log) or "no frames could be read"))
            enc.stdin.close()
            if enc.wait() != 0:
                raise MediaError("Upscaling failed while writing the video: " + (_last_line(enc_log) or "ffmpeg failed"))
            part.replace(dst)
            done = True
        finally:
            # Reached on success, on an error and on a cancel (job.update raises): nothing may be left running or half written.
            for proc in (dec, enc):
                if proc.poll() is None:
                    proc.kill()
                for pipe in (proc.stdout, proc.stdin):
                    try:
                        if pipe:
                            pipe.close()
                    except OSError:
                        pass
                proc.wait()
            if not done:
                part.unlink(missing_ok=True)
    seconds = time.time() - started
    job.update(span[1], "Upscaling finished")
    return {"width": out_w, "height": out_h, "frames": frames, "reused": reused, "seconds": round(seconds, 1),
            "seconds_per_frame": round(seconds / frames, 3), "provider": provider}
