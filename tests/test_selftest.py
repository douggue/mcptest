from app.models import Geo, GeoOverride, LaunchOptions, ProfileCreate, ProfileUpdate, ProxyCreate
from app.services.selftest import compare
from tests.conftest import EXIT_IP, fake_generate


def _observed(fp, **over):
    o = {
        "userAgent": fp["navigator"]["userAgent"],
        "platform": fp["navigator"]["platform"],
        "languages": ["de-DE", "de"],
        "hardwareConcurrency": fp["navigator"]["hardwareConcurrency"],
        "timezone": "Europe/Berlin",
        "screen": dict(fp["screen"]),
        "webrtc": {"supported": True, "ips": [f"{EXIT_IP} (srflx)", "192.168.1.5 (host)"]},
    }
    o.update(over)
    return o


GEO = Geo(country="DE", timezone="Europe/Berlin", locale="de-DE")


def _run(fp, observed, **kw):
    args = {
        "exit_ip_seen": EXIT_IP,
        "proxy_exit_ip": EXIT_IP,
        "has_proxy": True,
        "expected_geo": GEO,
        "webrtc_mode": "proxy",
    }
    args.update(kw)
    return {c.name: c for c in compare(observed, fp, **args)}


def test_all_green():
    fp = fake_generate(os="windows")
    res = _run(fp, _observed(fp))
    assert all(c.passed for c in res.values()), [c for c in res.values() if not c.passed]


def test_no_proxy_fails_with_reason():
    fp = fake_generate(os="windows")
    res = _run(
        fp,
        _observed(fp, webrtc={"supported": True, "ips": ["8.8.8.8 (srflx)"]}),
        has_proxy=False,
        proxy_exit_ip=None,
        exit_ip_seen="8.8.8.8",
    )
    assert not res["proxy_assigned"].passed and "real IP" in res["proxy_assigned"].reason
    assert not res["webrtc_no_leak"].passed


def test_wrong_timezone_fails():
    fp = fake_generate(os="windows")
    res = _run(fp, _observed(fp, timezone="America/Chicago"))
    tz = res["timezone_matches_geo"]
    assert not tz.passed and tz.expected == "Europe/Berlin" and tz.actual == "America/Chicago"


def test_webrtc_leak_detected():
    fp = fake_generate(os="windows")
    res = _run(fp, _observed(fp, webrtc={"supported": True, "ips": ["8.8.4.4 (srflx)"]}))
    assert not res["webrtc_no_leak"].passed and "8.8.4.4" in res["webrtc_no_leak"].reason
    res = _run(
        fp,
        _observed(fp, webrtc={"supported": True, "ips": ["8.8.4.4 (srflx)"]}),
        webrtc_mode="block",
    )
    assert not res["webrtc_no_leak"].passed
    res = _run(fp, _observed(fp, webrtc={"supported": False, "ips": []}), webrtc_mode="block")
    assert res["webrtc_no_leak"].passed


def test_exit_ip_mismatch_and_fingerprint_drift():
    fp = fake_generate(os="windows")
    res = _run(
        fp,
        _observed(fp, userAgent="Mozilla/5.0 (X11; Linux x86_64) Firefox/1.0"),
        exit_ip_seen="1.2.3.4",
    )
    assert not res["exit_ip_matches_proxy"].passed
    assert not res["user_agent_is_stored"].passed
    assert not res["ua_platform_consistent"].passed


def test_language_mismatch():
    fp = fake_generate(os="windows")
    res = _run(fp, _observed(fp, languages=["en-US", "en"]))
    assert not res["language_matches_geo"].passed


# -- end-to-end through the service with the mock engine ------------------------------
async def test_service_passes_for_aligned_profile(ctx):
    proxy = ctx.proxies.create(ProxyCreate(host="proxy.example", port=8080))
    p = ctx.profiles.create(ProfileCreate(name="ok", proxy_id=proxy.id))
    report = await ctx.selftest.run(p.id)
    assert report.passed, [c for c in report.checks if not c.passed]
    assert not ctx.launcher.is_running(p.id)  # started for the test, stopped after
    assert ctx.selftest.latest(p.id).id == report.id
    assert ctx.profiles.get(p.id).last_selftest_passed is True


async def test_service_fails_without_proxy(ctx):
    p = ctx.profiles.create(ProfileCreate(name="direct"))
    report = await ctx.selftest.run(p.id)
    assert not report.passed
    failed = {c.name: c for c in report.checks if not c.passed}
    assert "proxy_assigned" in failed


async def test_service_fails_with_wrong_override(ctx):
    proxy = ctx.proxies.create(ProxyCreate(host="proxy.example", port=8080))
    p = ctx.profiles.create(ProfileCreate(name="bad-tz", proxy_id=proxy.id))
    # Browser is launched with the override (Chicago) but the collector is told to
    # report the proxy's zone -> mismatch between expected and observed.
    ctx.profiles.update(p.id, ProfileUpdate(geo_override=GeoOverride(timezone="America/Chicago")))
    ctx.selftest.collector.overrides["observed"] = {"timezone": "Europe/Berlin"}
    report = await ctx.selftest.run(p.id)
    tz = next(c for c in report.checks if c.name == "timezone_matches_geo")
    assert not report.passed and not tz.passed and tz.expected == "America/Chicago"


async def test_service_records_collector_crash(ctx):
    p = ctx.profiles.create(ProfileCreate(name="crash"))
    ctx.selftest.collector.fail_with = RuntimeError("ws gone")
    report = await ctx.selftest.run(p.id)
    assert not report.passed and "ws gone" in report.error
    assert not ctx.launcher.is_running(p.id)


async def test_leaves_running_profile_running(ctx):
    proxy = ctx.proxies.create(ProxyCreate(host="proxy.example", port=8080))
    p = ctx.profiles.create(
        ProfileCreate(name="keep", proxy_id=proxy.id, launch_options=LaunchOptions(webrtc="block"))
    )
    await ctx.launcher.start(p.id)
    ctx.selftest.collector.overrides["observed"] = {"webrtc": {"supported": False, "ips": []}}
    report = await ctx.selftest.run(p.id, external=True)
    assert report.passed and ctx.launcher.is_running(p.id)
    assert len(report.external_pages) == 4


def test_auto_selftest_scheduled_via_api(client, ctx):
    ctx.settings.auto_selftest = True
    prof = client.post("/profiles", json={"name": "auto"}).json()
    import asyncio

    async def wait():
        while ctx.background:
            await asyncio.sleep(0.01)

    client.portal.call(wait)
    hist = client.get(f"/profiles/{prof['id']}/selftest").json()
    assert len(hist) == 1 and hist[0]["passed"] is False  # no proxy -> fails
    r = client.post(f"/profiles/{prof['id']}/selftest").json()
    assert r["checks"][0]["name"] == "proxy_assigned"
    assert client.get(f"/profiles/{prof['id']}/selftest/latest").json()["id"] == r["id"]
