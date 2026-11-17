"""AI upscaling status, so the interface can offer it and say how slow it will be."""
from __future__ import annotations

from fastapi import APIRouter

from ..studio import upscale

router = APIRouter(prefix="/api/upscale", tags=["upscale"])


@router.get("/state")
def get_state() -> dict:
    """{available, missing[], model_downloaded, provider, gpu, cpus, model_folder, model_url, max_side}"""
    return upscale.state()
