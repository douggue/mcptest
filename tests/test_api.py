from fastapi.testclient import TestClient


def test_health_is_open_everything_else_needs_token(client: TestClient, ctx):
    anon = TestClient(client.app)
    assert anon.get("/health").status_code == 200
    assert anon.get("/profiles").status_code == 401
    assert anon.get("/profiles", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert anon.get("/profiles", headers={"X-API-Token": ctx.token}).status_code == 200


def test_profile_lifecycle_over_api(client: TestClient, ctx):
    proxy = client.post(
        "/proxies", json={"host": "proxy.example", "port": 8080, "username": "u", "password": "p"}
    )
    assert proxy.status_code == 201
    pid = proxy.json()["id"]
    assert proxy.json()["has_password"] is True and "password" not in proxy.json()

    r = client.post(
        "/profiles",
        json={
            "name": "shop-1",
            "group_name": "shop",
            "tags": ["a"],
            "proxy_id": pid,
            "os": "windows",
        },
    )
    assert r.status_code == 201, r.text
    prof = r.json()
    assert prof["fingerprint"]["navigator"]["userAgent"].startswith("Mozilla/5.0")
    assert prof["fingerprint_summary"]["platform"] == "Win32"

    assert len(client.get("/profiles", params={"group": "shop"}).json()) == 1
    assert client.get("/profiles", params={"tag": "zzz"}).json() == []
    assert client.get("/profiles/groups").json() == ["shop"]

    start = client.post(f"/profiles/{prof['id']}/start")
    assert start.status_code == 200, start.text
    assert start.json()["ws_endpoint"].startswith("ws://127.0.0.1:")
    assert client.post(f"/profiles/{prof['id']}/start").json()["already_running"] is True
    running = client.get("/profiles/running").json()
    assert running[0]["profile_id"] == prof["id"]
    assert client.get(f"/profiles/{prof['id']}").json()["status"] == "running"

    # cannot regenerate while running
    assert client.post(f"/profiles/{prof['id']}/regenerate-fingerprint").status_code == 409
    assert client.post(f"/profiles/{prof['id']}/stop").status_code == 200
    assert client.post(f"/profiles/{prof['id']}/stop").status_code == 409
    before = prof["fingerprint"]
    after = client.post(
        f"/profiles/{prof['id']}/regenerate-fingerprint", json={"os": "macos"}
    ).json()["fingerprint"]
    assert after != before and after["navigator"]["platform"] == "MacIntel"

    patched = client.patch(
        f"/profiles/{prof['id']}", json={"name": "renamed", "tags": ["x", "y"]}
    ).json()
    assert patched["name"] == "renamed" and patched["tags"] == ["x", "y"]

    clone = client.post(f"/profiles/{prof['id']}/clone", json={"name": "copy"})
    assert clone.status_code == 201
    assert clone.json()["fingerprint"] != after and clone.json()["proxy_id"] == pid

    events = client.get(f"/profiles/{prof['id']}/events").json()
    assert {"profile.created", "profile.started", "profile.stopped"} <= {e["kind"] for e in events}

    assert client.delete(f"/profiles/{prof['id']}").status_code == 400  # needs confirm
    assert client.delete(f"/profiles/{prof['id']}", params={"confirm": "true"}).status_code == 204
    assert client.get(f"/profiles/{prof['id']}").status_code == 404
    assert not (ctx.settings.profiles_dir / prof["id"]).exists()


def test_dead_proxy_returns_409(client: TestClient):
    pid = client.post("/proxies", json={"host": "dead.example", "port": 1}).json()["id"]
    prof = client.post("/profiles", json={"name": "x", "proxy_id": pid}).json()
    r = client.post(f"/profiles/{prof['id']}/start")
    assert r.status_code == 409 and "refusing" in r.json()["detail"]


def test_proxy_endpoints(client: TestClient):
    r = client.post("/proxies/bulk-import", json={"text": "1.1.1.1:80:u:p\nproxy.example:8080"})
    assert len(r.json()["created"]) == 2 and r.json()["errors"] == []
    checks = client.post("/proxies/check-all").json()
    assert len(checks) == 2 and all(c["healthy"] for c in checks)
    one = client.post(f"/proxies/{checks[0]['proxy_id']}/check").json()
    assert one["exit_ip"] and one["geo"]["timezone"]
    assert client.post("/proxies/parse", json={"text": "socks5://h:1"}).json()["scheme"] == "socks5"
    assert client.post("/proxies/parse", json={"text": "???"}).status_code == 400
    assert client.get("/proxies/nope").status_code == 404
    assert client.delete(f"/proxies/{checks[1]['proxy_id']}").status_code == 204


def test_system_endpoints(client: TestClient, ctx):
    st = client.get("/engine/status").json()
    assert st["engine"] == "mock" and st["browser_installed"] is True
    assert client.post("/engine/install").status_code == 200
    s = client.get("/settings").json()
    assert s["data_dir"] == str(ctx.settings.data_dir)
    assert client.get("/token").json()["token"] == ctx.token
    assert isinstance(client.get("/events").json(), list)


def test_unknown_profile_404(client: TestClient):
    assert client.get("/profiles/nope").status_code == 404
    assert client.post("/profiles/nope/start").status_code == 404
    assert client.post("/profiles", json={"name": "x", "proxy_id": "nope"}).status_code == 400
