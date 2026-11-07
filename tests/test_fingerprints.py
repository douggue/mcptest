import json

import pytest

from app.models import ProfileCreate, RegenerateRequest, ScreenConstraints
from app.services.fingerprints import FingerprintService, host_os
from tests.conftest import fake_generate


def test_generate_defaults_to_host_os():
    svc = FingerprintService(fake_generate)
    fp = svc.generate()
    assert fp["_meta"]["target_os"] == host_os()
    FingerprintService.validate(fp)


def test_generate_passes_screen_constraints():
    svc = FingerprintService(fake_generate)
    fp = svc.generate("windows", ScreenConstraints(max_width=1366))
    assert fp["screen"]["width"] <= 1366


def test_validate_rejects_incomplete():
    with pytest.raises(ValueError):
        FingerprintService.validate({"navigator": {}})


def test_summary():
    s = FingerprintService.summarize(fake_generate(os="windows"))
    assert s.platform == "Win32" and s.browser_version == "146.0"
    assert s.screen in {"1920x1080", "2560x1440"} and s.languages == ["en-US", "en"]
    assert s.gpu_renderer.startswith("ANGLE")


def test_fingerprint_is_frozen_across_launches(ctx):
    """The stored fingerprint is what every launch receives, byte for byte."""
    import asyncio

    prof = ctx.profiles.create(ProfileCreate(name="stable"))
    stored = ctx.profiles.fingerprint(prof.id)
    seen = []
    for _ in range(5):
        asyncio.run(ctx.launcher.start(prof.id))
        seen.append(json.dumps(ctx.engine.launched[-1].fingerprint, sort_keys=True))
        asyncio.run(ctx.launcher.stop(prof.id))
    assert len(set(seen)) == 1
    assert json.loads(seen[0]) == stored


def test_two_profiles_differ_and_are_consistent(ctx):
    a = ctx.profiles.create(ProfileCreate(name="a", os="windows"))
    b = ctx.profiles.create(ProfileCreate(name="b", os="windows"))
    fa, fb = ctx.profiles.fingerprint(a.id), ctx.profiles.fingerprint(b.id)
    assert fa != fb
    for fp in (fa, fb):
        assert "Windows" in fp["navigator"]["userAgent"] and fp["navigator"]["platform"] == "Win32"


def test_regenerate_only_on_request(ctx):
    prof = ctx.profiles.create(ProfileCreate(name="r"))
    before = ctx.profiles.fingerprint(prof.id)
    ctx.profiles.update(
        prof.id, __import__("app.models", fromlist=["ProfileUpdate"]).ProfileUpdate(name="renamed")
    )
    assert ctx.profiles.fingerprint(prof.id) == before
    ctx.profiles.regenerate_fingerprint(prof.id, RegenerateRequest(os="linux"))
    after = ctx.profiles.fingerprint(prof.id)
    assert after != before and after["navigator"]["platform"] == "Linux x86_64"
    assert ctx.profiles.get(prof.id).os == "linux"
