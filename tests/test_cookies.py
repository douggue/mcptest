import time

import pytest

from app.models import Cookie, CookieImport
from app.services import cookies

NETSCAPE = """# Netscape HTTP Cookie File
.example.com\tTRUE\t/\tTRUE\t4102444800\tsid\tabc
#HttpOnly_.example.com\tTRUE\t/\tFALSE\t0\tsession\txyz
bad line
"""


def test_netscape_round_trip():
    parsed = cookies.parse_netscape(NETSCAPE)
    assert len(parsed) == 2
    assert parsed[0].secure and parsed[0].expires == 4102444800
    assert parsed[1].http_only and parsed[1].expires is None
    text = cookies.to_netscape(parsed)
    assert cookies.parse_netscape(text) == parsed


def test_json_formats():
    pw_style = '{"cookies": [{"name": "a", "value": "1", "domain": ".x.com", "path": "/", "expires": -1, "httpOnly": true, "sameSite": "Lax"}]}'
    ext_style = '[{"name": "b", "value": "2", "domain": "x.com", "expirationDate": 1e10, "sameSite": "no_restriction", "secure": true}]'
    a = cookies.parse_json(pw_style)[0]
    b = cookies.parse_json(ext_style)[0]
    assert a.expires is None and a.http_only and a.same_site == "Lax"
    assert b.expires == 1e10 and b.same_site == "None" and b.secure


def test_from_request_variants():
    assert cookies.from_request(CookieImport(format="netscape", text=NETSCAPE))[0].name == "sid"
    assert (
        cookies.from_request(CookieImport(cookies=[Cookie(name="n", value="v", domain="d")]))[
            0
        ].name
        == "n"
    )
    with pytest.raises(ValueError):
        cookies.from_request(CookieImport())


def test_to_playwright_skips_expired():
    past = Cookie(name="old", value="v", domain="d", expires=time.time() - 10)
    fresh = Cookie(
        name="new", value="v", domain="d", expires=time.time() + 1000, same_site="Strict"
    )
    out = cookies.to_playwright([past, fresh])
    assert [c["name"] for c in out] == ["new"] and out[0]["sameSite"] == "Strict"
    back = cookies.from_playwright(out)
    assert back[0].name == "new" and back[0].same_site == "Strict"


async def test_cookie_api_starts_profile_briefly(client, ctx, monkeypatch):
    store: dict[str, list[dict]] = {}

    async def fake_get(ws):
        return store.get(ws, [])

    async def fake_add(ws, items):
        store.setdefault(ws, []).extend(items)
        return len(items)

    monkeypatch.setattr("app.services.browser.get_cookies", fake_get)
    monkeypatch.setattr("app.services.browser.add_cookies", fake_add)
    prof = client.post("/profiles", json={"name": "c"}).json()
    r = client.post(
        f"/profiles/{prof['id']}/cookies/import",
        json={"format": "netscape", "text": NETSCAPE},
    )
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 2
    # profile was started for the import and stopped again
    assert client.get(f"/profiles/{prof['id']}").json()["status"] == "stopped"
    # a second launch gets a new ws endpoint from the mock; copy store over
    ws_first = next(iter(store))
    store["*"] = store[ws_first]

    async def fake_get_any(ws):
        return store["*"]

    monkeypatch.setattr("app.services.browser.get_cookies", fake_get_any)
    exported = client.get(f"/profiles/{prof['id']}/cookies/export").json()["cookies"]
    assert {c["name"] for c in exported} == {"sid", "session"}
    text = client.get(f"/profiles/{prof['id']}/cookies/export", params={"format": "netscape"}).text
    assert text.startswith("# Netscape") and "\tsid\tabc" in text

    clone = client.post(f"/profiles/{prof['id']}/clone", json={"copy_cookies": True})
    assert clone.status_code == 201, clone.text
