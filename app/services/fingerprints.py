"""Fingerprint generation and freezing.

A fingerprint is generated **once** when a profile is created (or when you
explicitly regenerate it) and stored as JSON on the profile. Every launch
passes that stored dict to the engine untouched, so the profile looks the
same from one session to the next.

Generation is delegated to Camoufox's generator (the BrowserForge lineage,
now the ``fpgen`` model in Camoufox 0.5+), which samples complete fingerprints
from real-world distributions so OS, UA, platform, screen, cores and fonts
agree with each other. Fields are never randomised one at a time.
"""

from __future__ import annotations

import platform
from collections.abc import Callable
from typing import Any

from app.models import FingerprintSummary, ScreenConstraints

Generator = Callable[..., dict[str, Any]]

REQUIRED_PATHS = (
    ("navigator", "userAgent"),
    ("navigator", "platform"),
    ("screen", "width"),
    ("screen", "height"),
)


def host_os() -> str:
    system = platform.system().lower()
    if system.startswith("win"):
        return "windows"
    if system == "darwin":
        return "macos"
    return "linux"


def _camoufox_generate(**kwargs: Any) -> dict[str, Any]:
    from camoufox.fingerprints import Screen, generate_fingerprint

    screen = kwargs.pop("screen", None)
    cf_screen = Screen(**screen) if screen else None
    return generate_fingerprint(screen=cf_screen, **kwargs)


class FingerprintService:
    def __init__(self, generator: Generator | None = None):
        self._generate = generator or _camoufox_generate

    def generate(
        self,
        os_name: str | None = None,
        screen: ScreenConstraints | None = None,
        window: tuple[int, int] | None = None,
    ) -> dict[str, Any]:
        """Return a complete, internally consistent fingerprint for ``os_name``.

        Defaults to the host OS: OS-level signals (font rendering, TCP/TLS
        stack) are hard to fake, so a Windows host should run Windows profiles.
        """
        target_os = os_name or host_os()
        kwargs: dict[str, Any] = {"os": target_os}
        if screen:
            cons = {k: v for k, v in screen.model_dump().items() if v is not None}
            if cons:
                kwargs["screen"] = cons
        if window:
            kwargs["window"] = tuple(window)
        fp = self._generate(**kwargs)
        self.validate(fp)
        fp.setdefault("_meta", {})
        fp["_meta"].update({"target_os": target_os})
        return fp

    @staticmethod
    def validate(fp: dict[str, Any]) -> None:
        if not isinstance(fp, dict):
            raise ValueError("fingerprint must be a JSON object")
        for path in REQUIRED_PATHS:
            node: Any = fp
            for key in path:
                if not isinstance(node, dict) or key not in node:
                    raise ValueError(f"fingerprint is missing {'.'.join(path)}")
                node = node[key]

    @staticmethod
    def summarize(fp: dict[str, Any]) -> FingerprintSummary:
        nav = fp.get("navigator", {}) or {}
        scr = fp.get("screen", {}) or {}
        win = fp.get("window", {}) or {}
        gpu = fp.get("webgl", {}) or fp.get("videoCard", {}) or {}
        ua = nav.get("userAgent")
        version = None
        if ua and "Firefox/" in ua:
            version = ua.split("Firefox/", 1)[1].split()[0]
        langs = nav.get("languages") or ([nav["language"]] if nav.get("language") else [])
        return FingerprintSummary(
            user_agent=ua,
            platform=nav.get("platform"),
            os=fp.get("os") or (fp.get("_meta") or {}).get("target_os"),
            browser_version=version,
            screen=f"{scr.get('width')}x{scr.get('height')}" if scr.get("width") else None,
            window=(
                f"{win.get('outerWidth')}x{win.get('outerHeight')}"
                if win.get("outerWidth")
                else None
            ),
            hardware_concurrency=nav.get("hardwareConcurrency"),
            languages=list(langs),
            gpu_vendor=gpu.get("vendor") or gpu.get("unmaskedVendor"),
            gpu_renderer=gpu.get("renderer") or gpu.get("unmaskedRenderer"),
            timezone=(fp.get("intl") or {}).get("timeZone"),
        )
