import pytest

from app.models import ProxyBulkImport, ProxyCreate, ProxyUpdate
from app.services.proxies import ProxyError, parse_proxy
from tests.conftest import EXIT_IP


@pytest.mark.parametrize(
    "text,expected",
    [
        ("http://user:pass@1.2.3.4:8080", ("http", "1.2.3.4", 8080, "user", "pass")),
        ("socks5://1.2.3.4:1080", ("socks5", "1.2.3.4", 1080, None, None)),
        ("1.2.3.4:8080:user:pass", ("http", "1.2.3.4", 8080, "user", "pass")),
        ("1.2.3.4:8080:user:pa:ss", ("http", "1.2.3.4", 8080, "user", "pa:ss")),
        ("1.2.3.4:8080", ("http", "1.2.3.4", 8080, None, None)),
        ("socks5:proxy.host:1080:u:p", ("socks5", "proxy.host", 1080, "u", "p")),
        ("user:p%40ss@host.example:3128", ("http", "host.example", 3128, "user", "p@ss")),
        ("https://us%3Aer:p%2Fw@h:1", ("https", "h", 1, "us:er", "p/w")),
    ],
)
def test_parse_proxy(text, expected):
    p = parse_proxy(text)
    assert (p.scheme, p.host, p.port, p.username, p.password) == expected


@pytest.mark.parametrize("text", ["", "nonsense", "host:notaport", "ftp://h:1", "h:1:u"])
def test_parse_proxy_rejects(text):
    with pytest.raises(ProxyError):
        parse_proxy(text)


def test_password_is_encrypted_at_rest(ctx):
    p = ctx.proxies.create(
        ProxyCreate(host="proxy.example", port=8080, username="u", password="s3cret")
    )
    row = ctx.db.fetchone("SELECT password_enc FROM proxies WHERE id=?", (p.id,))
    assert b"s3cret" not in bytes(row["password_enc"])
    assert ctx.proxies.credentials(p.id).password == "s3cret"
    assert p.has_password is True


async def test_check_sets_exit_ip_and_geo(ctx):
    p = ctx.proxies.create(ProxyCreate(host="proxy.example", port=8080))
    res = await ctx.proxies.check(p.id)
    assert res.healthy and res.exit_ip == EXIT_IP
    assert res.geo.timezone == "Europe/Berlin" and res.geo.locale == "de-DE"
    stored = ctx.proxies.get(p.id)
    assert stored.healthy is True and stored.last_geo.country == "DE"
    assert stored.last_latency_ms == pytest.approx(12.5)


async def test_check_failure_marks_unhealthy(ctx):
    p = ctx.proxies.create(ProxyCreate(host="dead.example", port=8080))
    res = await ctx.proxies.check(p.id)
    assert res.healthy is False and "refused" in res.error
    assert ctx.proxies.get(p.id).healthy is False


async def test_shared_exit_ip_warning(ctx):
    a = ctx.proxies.create(ProxyCreate(host="shared-a", port=1))
    b = ctx.proxies.create(ProxyCreate(host="shared-b", port=1))
    await ctx.proxies.check(a.id)
    res = await ctx.proxies.check(b.id)
    assert res.shared_with == [a.id]
    assert ctx.proxies.shared_exit_ips() == {EXIT_IP: sorted([a.id, b.id], key=[a.id, b.id].index)}
    kinds = [e["kind"] for e in ctx.db.events()]
    assert "proxy.shared_exit_ip" in kinds


def test_bulk_import(ctx):
    text = "1.1.1.1:80:u:p\n# comment\n\nsocks5://2.2.2.2:1080\nbroken line\n"
    created, errors = ctx.proxies.bulk_import(ProxyBulkImport(text=text, label_prefix="pool"))
    assert [c.host for c in created] == ["1.1.1.1", "2.2.2.2"]
    assert created[0].label == "pool-1" and created[1].scheme == "socks5"
    assert len(errors) == 1 and "line 5" in errors[0]


async def test_update_resets_health(ctx):
    p = ctx.proxies.create(ProxyCreate(host="proxy.example", port=8080))
    await ctx.proxies.check(p.id)
    updated = ctx.proxies.update(p.id, ProxyUpdate(host="other.example"))
    assert updated.healthy is None and updated.last_exit_ip is None
    labelled = ctx.proxies.update(p.id, ProxyUpdate(label="x"))
    assert labelled.label == "x"


def test_delete_proxy_detaches_profiles(ctx):
    from app.models import ProfileCreate

    p = ctx.proxies.create(ProxyCreate(host="proxy.example", port=8080))
    prof = ctx.profiles.create(ProfileCreate(name="a", proxy_id=p.id))
    assert ctx.proxies.get(p.id).profile_count == 1
    ctx.proxies.delete(p.id)
    assert ctx.profiles.get(prof.id).proxy_id is None
