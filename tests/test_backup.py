import pytest

from app.models import LaunchOptions, ProfileCreate, ProxyCreate
from app.services.backup import BackupError
from app.services.profiles import ProfileBusy


def _populate(ctx, name="shop-1"):
    proxy = ctx.proxies.create(
        ProxyCreate(label="p", host="proxy.example", port=8080, username="u", password="pw")
    )
    prof = ctx.profiles.create(
        ProfileCreate(
            name=name,
            group_name="g",
            tags=["t"],
            proxy_id=proxy.id,
            launch_options=LaunchOptions(webrtc="block"),
        )
    )
    udd = ctx.profiles.user_data_dir(prof.id)
    (udd / "cookies.sqlite").write_bytes(b"\x00" * 5000)
    (udd / "storage").mkdir()
    (udd / "storage" / "x.txt").write_text("hello")
    (udd / "lock").write_text("stale lock, must not be archived")
    return prof, proxy


def test_export_import_round_trip_same_machine(ctx):
    prof, proxy = _populate(ctx)
    fp = ctx.profiles.fingerprint(prof.id)
    path = ctx.backup.export_profile(prof.id, "pass-phrase-1")
    assert path.exists() and path.suffix == ".mpbackup"
    assert b"hello" not in path.read_bytes()

    # wipe and restore
    ctx.profiles.delete(prof.id)
    ctx.proxies.delete(proxy.id)
    res = ctx.backup.import_profile(path, "pass-phrase-1")
    assert res.profile_id == prof.id and not res.replaced
    restored = ctx.profiles.get(prof.id)
    assert (
        restored.name == "shop-1"
        and restored.tags == ["t"]
        and restored.launch_options.webrtc == "block"
    )
    assert ctx.profiles.fingerprint(prof.id) == fp
    udd = ctx.profiles.user_data_dir(prof.id)
    assert (udd / "storage" / "x.txt").read_text() == "hello"
    assert (udd / "cookies.sqlite").stat().st_size == 5000
    assert not (udd / "lock").exists()
    # proxy recreated with its password
    creds = ctx.proxies.credentials(restored.proxy_id)
    assert creds.host == "proxy.example" and creds.password == "pw"


def test_import_on_other_machine(ctx, tmp_path, settings):
    """A second daemon with a different master key can read the archive (passphrase only)."""
    from app.config import Settings
    from app.main import build_context
    from app.services.fingerprints import FingerprintService
    from app.vault import Vault
    from tests.conftest import fake_generate

    prof, _ = _populate(ctx)
    path = ctx.backup.export_profile(prof.id, "shared secret")

    other = Settings(data_dir=tmp_path / "other", engine="mock", auto_selftest=False)
    octx = build_context(
        other,
        engine=ctx.engine,
        vault=Vault(master_key=bytes(32)),
        fingerprints=FingerprintService(fake_generate),
    )
    try:
        res = octx.backup.import_profile(path, "shared secret")
        assert octx.profiles.get(res.profile_id).name == "shop-1"
        assert octx.proxies.credentials(octx.profiles.get(res.profile_id).proxy_id).password == "pw"
        assert (octx.profiles.user_data_dir(res.profile_id) / "storage" / "x.txt").exists()
    finally:
        octx.db.close()


def test_import_replaces_or_duplicates(ctx):
    prof, _ = _populate(ctx)
    path = ctx.backup.export_profile(prof.id, "pp-12345678")
    (ctx.profiles.user_data_dir(prof.id) / "storage" / "x.txt").write_text("changed")
    res = ctx.backup.import_profile(path, "pp-12345678")
    assert (
        res.replaced
        and (ctx.profiles.user_data_dir(prof.id) / "storage" / "x.txt").read_text() == "hello"
    )
    res2 = ctx.backup.import_profile(path, "pp-12345678", new_id_always=True)
    assert res2.profile_id != prof.id and not res2.replaced
    assert ctx.profiles.get(res2.profile_id).name.endswith("(restored)")
    assert len(ctx.proxies.list()) == 1  # identical proxy reused, not duplicated


def test_wrong_passphrase_and_running_profile(ctx):
    import asyncio

    prof, _ = _populate(ctx)
    path = ctx.backup.export_profile(prof.id, "right-one")
    with pytest.raises(BackupError):
        ctx.backup.import_profile(path, "wrong-one")
    asyncio.run(ctx.launcher.start(prof.id))
    with pytest.raises(ProfileBusy):
        ctx.backup.export_profile(prof.id, "right-one")
    with pytest.raises(ProfileBusy):
        ctx.backup.import_profile(path, "right-one")


def test_backup_api(client, ctx, tmp_path):
    prof, _ = _populate(ctx)
    r = client.post(
        "/backup/export",
        json={
            "profile_ids": [prof.id],
            "passphrase": "api-passphrase",
            "destination_dir": str(tmp_path),
        },
    )
    assert r.status_code == 200, r.text
    f = r.json()["files"][0]
    assert (
        client.post("/backup/import", json={"path": f, "passphrase": "nope-nope"}).status_code
        == 400
    )
    ok = client.post(
        "/backup/import", json={"path": f, "passphrase": "api-passphrase", "new_id": True}
    )
    assert ok.status_code == 200 and ok.json()["profile_id"] != prof.id
    assert (
        client.post(
            "/backup/export", json={"profile_ids": ["missing"], "passphrase": "api-passphrase"}
        ).status_code
        == 404
    )
