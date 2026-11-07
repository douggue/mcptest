"""Engine registry."""

from __future__ import annotations

from app.engines.base import Engine


def make_engine(name: str, *, headless: bool = False) -> Engine:
    if name == "camoufox":
        from app.engines.camoufox_engine import CamoufoxEngine

        return CamoufoxEngine(headless_default=headless)
    if name == "mock":
        from app.engines.mock_engine import MockEngine

        return MockEngine()
    raise ValueError(f"unknown engine {name!r}")


__all__ = ["Engine", "make_engine"]
