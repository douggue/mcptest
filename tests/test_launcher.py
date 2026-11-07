import json
import os

import pytest

from app.models import GeoOverride, ProfileCreate, ProfileUpdate, ProxyCreate
from app.services.launcher import LaunchManager, LaunchRefused, NotRunning
from tests.conftest import EXIT_IP


async def test_start_stop_isolated_dirs(ctx):
    a = ctx.profiles.create(ProfileCreate(name="a"))
    b = ctx.profiles.create(ProfileCreate(name="b"))
    ha, _ = await ctx.launcher.start(a.id)
    hb, _ = await ctx.launcher.start(b.id)
    specs = {s.profile_id: s for s in ctx.engine.launched}
    assert specs[a.id].user_data_dir != specs[b.id].user_data_dir
    assert specs[a.id].user_data_dir == ctx.settings.profiles_dir / a.id / "user-data"
    assert ha.ws_endpoint != hb.ws_endpoint
    assert {r.profile_id for r in ctx.launcher.running()} == {a.id, b.id}
    assert ctx.profiles.get(a.id, running=ctx.launcher.running_map()).status == "running"
    await ctx.launcher.stop(a.id)
    assert ctx.profiles.get(a.id).status == "stopped"
    assert not (ctx.settings.profiles_dir / a.id / "lock").exists()
    with pytest.raises(NotRunning):
        await ctx.launcher.stop(a.id)


async def test_never_runs_twice(ctx):
    p = ctx.profiles.create(ProfileCreate(name="once"))
    h1, already1 = await ctx.launcher.start(p.id)
    h2, already2 = await ctx.launcher.start(p.id)
    assert (already1, already2) == (False, True) and h1 is h2
    assert len(ctx.engine.launched) == 1


async def test_lock_held_by_live_foreign_process_refuses(ctx):
    p = ctx.profiles.create(ProfileCreate(name="locked"))
    lock = ctx.settings.profiles_dir / p.id / "lock"
    lock.parent.mkdir(parents=True, exist_ok=True)
    # Pretend another live process (our parent) owns the profile.
    lock.write_text(json.dumps({"pid": os.getppid(), "ts": "x"}))
    with pytest.raises(LaunchRefused):
        await ctx.launcher.start(p.id)


async def test_stale_lock_is_cleaned(ctx):
    p = ctx.profiles.create(ProfileCreate(name="stale"))
    lock = ctx.settings.profiles_dir / p.id / "lock"
    lock.write_text(json.dumps({"pid": 999_999_9, "ts": "x"}))
    await ctx.launcher.start(p.id)
    assert ctx.launcher.is_running(p.id)


async def test_dead_proxy_refuses_launch(ctx):
    proxy = ctx.proxies.create(ProxyCreate(host="dead.example", port=1))
    p = ctx.profiles.create(ProfileCreate(name="kill-switch", proxy_id=proxy.id))
    with pytest.raises(LaunchRefused, match="refusing to launch"):
        await ctx.launcher.start(p.id)
    assert not ctx.engine.launched
    assert any(e["kind"] == "profile.launch_refused" for e in ctx.db.events(p.id))


async def test_proxy_geo_is_aligned_on_launch(ctx):
    proxy = ctx.proxies.create(
        ProxyCreate(host="proxy.example", port=8080, username="u", password="p")
    )
    p = ctx.profiles.create(ProfileCreate(name="geo", proxy_id=proxy.id))
    await ctx.launcher.start(p.id)
    spec = ctx.engine.launched[-1]
    assert spec.proxy.password == "p" and spec.exit_ip == EXIT_IP
    assert spec.geo.timezone == "Europe/Berlin" and spec.geo.locale == "de-DE"
    assert spec.geo.latitude == pytest.approx(52.52)


async def test_geo_override_wins(ctx):
    proxy = ctx.proxies.create(ProxyCreate(host="proxy.example", port=8080))
    p = ctx.profiles.create(
        ProfileCreate(
            name="ov",
            proxy_id=proxy.id,
            geo_override=GeoOverride(timezone="Europe/Paris", locale="fr-FR"),
        )
    )
    await ctx.launcher.start(p.id)
    spec = ctx.engine.launched[-1]
    assert spec.geo.timezone == "Europe/Paris" and spec.geo.locale == "fr-FR"
    assert spec.geo.latitude == pytest.approx(52.52)  # untouched fields come from the proxy


async def test_require_proxy_setting(ctx):
    ctx.settings.require_proxy = True
    p = ctx.profiles.create(ProfileCreate(name="noproxy"))
    with pytest.raises(LaunchRefused, match="no proxy"):
        await ctx.launcher.start(p.id)


async def test_engine_failure_releases_lock(ctx):
    p = ctx.profiles.create(ProfileCreate(name="boom"))
    ctx.engine.fail_next = "browser exploded"
    with pytest.raises(RuntimeError, match="exploded"):
        await ctx.launcher.start(p.id)
    assert not (ctx.settings.profiles_dir / p.id / "lock").exists()
    assert ctx.profiles.get(p.id).status == "stopped"
    await ctx.launcher.start(p.id)  # works afterwards


async def test_crash_is_detected_and_cleaned(ctx):
    p = ctx.profiles.create(ProfileCreate(name="crash"))
    await ctx.launcher.start(p.id)
    ctx.engine.crash(p.id)
    assert ctx.launcher.running() == []
    assert ctx.profiles.get(p.id).status == "stopped"
    assert any(e["kind"] == "profile.exited" for e in ctx.db.events(p.id))


async def test_recover_reattaches_survivors(ctx):
    p = ctx.profiles.create(ProfileCreate(name="survivor"))
    q = ctx.profiles.create(ProfileCreate(name="gone"))
    await ctx.launcher.start(p.id)
    await ctx.launcher.start(q.id)
    ctx.engine.crash(q.id)  # browser died while the daemon was "down"
    # New daemon, same engine state and data dir.
    fresh = LaunchManager(ctx.db, ctx.engine, ctx.profiles, ctx.proxies, ctx.settings)
    fresh.recover()
    assert [r.profile_id for r in fresh.running()] == [p.id]
    assert ctx.profiles.get(q.id).status == "stopped"
    assert not (ctx.settings.profiles_dir / q.id / "running.json").exists()


async def test_group_start_stop(ctx):
    a = ctx.profiles.create(ProfileCreate(name="a", group_name="shop"))
    b = ctx.profiles.create(ProfileCreate(name="b", group_name="shop"))
    ctx.profiles.create(ProfileCreate(name="c", group_name="other"))
    res = await ctx.launcher.start_group("shop")
    assert set(res) == {a.id, b.id} and len(ctx.launcher.running()) == 2
    await ctx.launcher.stop_group("shop")
    assert ctx.launcher.running() == []


async def test_update_proxy_flags_change(ctx):
    proxy = ctx.proxies.create(ProxyCreate(host="proxy.example", port=8080))
    p = ctx.profiles.create(ProfileCreate(name="u"))
    _, changed = ctx.profiles.update(p.id, ProfileUpdate(proxy_id=proxy.id))
    assert changed
    _, changed = ctx.profiles.update(p.id, ProfileUpdate(notes="hi"))
    assert not changed
    detail, changed = ctx.profiles.update(p.id, ProfileUpdate(clear_proxy=True))
    assert changed and detail.proxy_id is None
