"""Using the graphics card where it speeds things up, with the processor as the fallback everywhere.

  - Video encoding: the card's own H.264 encoder (NVIDIA NVENC, AMD AMF, Intel Quick Sync, Apple VideoToolbox),
    found by encoding a tiny test clip once. Any encode that fails on it is redone with x264 on the processor.
  - Drawing the short: Chrome renders through the card (ANGLE) on Windows; see render.py.
  - AI upscaling: ONNX Runtime's DirectML (any card on Windows) or CUDA build; see upscale.py and start.bat.
  - Whisper: CUDA on an NVIDIA card when its libraries are installed; see transcribe.py.
Settings → Graphics card turns it all off.
"""
from __future__ import annotations

import subprocess
import threading

from .config import get_settings

# best first; each is tried with a tiny encode, so one listed by ffmpeg but without a working driver is skipped
HW_ENCODERS = [("h264_nvenc", "NVIDIA NVENC"), ("h264_amf", "AMD AMF"), ("h264_qsv", "Intel Quick Sync"),
               ("h264_videotoolbox", "Apple VideoToolbox")]
_found: dict = {}
_lock = threading.Lock()
FALLBACK: dict[tuple, list[str]] = {}   # hardware encoder arguments -> the x264 arguments that replace them on failure


def enabled() -> bool:
    return get_settings().get("use_gpu", True) is not False


def hardware_encoder() -> tuple[str, str] | None:
    """(ffmpeg encoder, name) of a working hardware H.264 encoder, or None. Tested once per run."""
    with _lock:
        if "enc" in _found:
            return _found["enc"]
        _found["enc"] = None
        try:
            from .media import need
            ff = need("ffmpeg")
            listed = subprocess.run([ff, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=30).stdout
        except Exception:   # noqa: BLE001 - no ffmpeg, no hardware encoding
            return None
        for enc, name in HW_ENCODERS:
            if enc not in listed:
                continue
            test = subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=0.3:r=30",
                                   "-pix_fmt", "yuv420p", "-c:v", enc, "-f", "null", "-"], capture_output=True, text=True, timeout=60)
            if test.returncode == 0:
                _found["enc"] = (enc, name)
                break
        return _found["enc"]


def cpu_h264(crf: int = 18) -> list[str]:
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf)]


def h264(crf: int = 18) -> list[str]:
    """Encoder arguments for H.264 at about the quality of x264's CRF `crf`: the graphics card's encoder when there
    is a working one (and it is not switched off), else x264."""
    hw = hardware_encoder() if enabled() else None
    if not hw:
        return cpu_h264(crf)
    enc = hw[0]
    if enc == "h264_nvenc":
        args = ["-c:v", enc, "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", str(crf + 1), "-b:v", "0"]
    elif enc == "h264_amf":
        args = ["-c:v", enc, "-quality", "quality", "-rc", "cqp", "-qp_i", str(crf), "-qp_p", str(crf + 2)]
    elif enc == "h264_qsv":
        args = ["-c:v", enc, "-preset", "medium", "-global_quality", str(crf + 2)]
    else:   # VideoToolbox has no constant-quality mode on every Mac: a generous bitrate instead
        args = ["-c:v", enc, "-b:v", "16M" if crf <= 16 else "10M"]
    FALLBACK[tuple(args)] = cpu_h264(crf)
    return args


def swap_to_cpu(args: list[str]) -> list[str] | None:
    """The same ffmpeg arguments with any hardware encoder replaced by x264, or None if there was none."""
    for hw, cpu in FALLBACK.items():
        n = len(hw)
        for i in range(len(args) - n + 1):
            if tuple(args[i:i + n]) == hw:
                return args[:i] + cpu + args[i + n:]
    return None


def chrome_gl() -> str | None:
    """How Chrome should draw when rendering: through the card (ANGLE, i.e. Direct3D) on Windows."""
    import os
    if not enabled():
        return None
    return "angle" if os.name == "nt" else None


def cuda_libraries() -> None:
    """On Windows, let CTranslate2 (Whisper) find NVIDIA's cuBLAS and cuDNN when they were installed as pip packages
    (start.bat does that on a computer with an NVIDIA card): their DLL folders are added to the search path."""
    import os
    import sys
    from pathlib import Path
    if os.name != "nt":
        return
    for base in map(Path, sys.path):
        for sub in ("cublas", "cudnn", "cuda_runtime", "cuda_nvrtc"):
            d = base / "nvidia" / sub / "bin"
            if d.is_dir():
                try:
                    os.add_dll_directory(str(d))
                except (OSError, AttributeError):
                    pass
                if str(d) not in os.environ.get("PATH", ""):
                    os.environ["PATH"] = str(d) + os.pathsep + os.environ.get("PATH", "")


def status() -> dict:
    """What uses the graphics card on this computer, for Settings."""
    import importlib.util
    hw = hardware_encoder()
    up = {"provider": "", "gpu": False}
    try:
        from .studio import upscale
        if upscale.available():
            name = upscale._provider()[1]
            up = {"provider": name, "gpu": name != "CPU"}
    except Exception:   # noqa: BLE001
        pass
    cuda = False
    if importlib.util.find_spec("ctranslate2") is not None:
        try:
            import ctranslate2
            cuda = ctranslate2.get_cuda_device_count() > 0
        except Exception:   # noqa: BLE001
            cuda = False
    return {"enabled": enabled(), "encoder": hw[1] if hw else "", "drawing": "Graphics card (ANGLE)" if chrome_gl() else "Processor",
            "upscaler": up["provider"], "upscaler_gpu": up["gpu"], "whisper_gpu": cuda}
