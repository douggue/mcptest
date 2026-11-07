# Personal Multi-Profile Browser — Build Plan

A single-user, local-first tool for running many fully isolated browser profiles.
Each profile has its own storage, proxy and stable fingerprint, and the tool has a
local API for automation.

---

## 1. Goals and non-goals

**Goals**
- Profiles are strongly isolated: cookies, storage, cache, extensions and history never cross over.
- Each profile keeps a fingerprint that is **realistic, consistent and stable** from one launch to the next.
- Each profile gets its own proxy, and timezone, locale, geolocation and WebRTC follow it automatically.
- Profiles can be started from a UI or a local REST API that returns an automation endpoint.
- Every profile can be leak-checked with a built-in self-test.
- Profile data is encrypted at rest, and profiles can be backed up and restored.

**Non-goals (for now)**
- Multi-user teams, billing and a cloud SaaS.
- Maintaining a custom Chromium fork. This is deferred, see Phase 8.

---

## 2. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Language | **Python 3.12** | The best open-source fingerprinting engine and generator are Python-native. |
| Browser engine | **Camoufox** (Firefox-based, open source) | Spoofing happens inside the engine (C++), not through JS injection, so there are no prototype-tampering tells. Playwright can drive it. |
| Fingerprint generation | **BrowserForge** (via Camoufox) | Builds fingerprints from real-world distributions, so the values stay internally consistent. |
| API | **FastAPI** on `127.0.0.1` only, with a bearer token | Simple, typed and async. |
| Storage | **SQLite** (one file) plus a directory per profile | Zero ops, easy to back up. |
| Secrets | OS keyring (via `keyring`) holds the master key, and **libsodium** (`pynacl`) encrypts proxy creds and profile archives | Nothing sensitive is stored in plaintext. |
| UI | Local web UI (React + Vite), served by the daemon; optional **Tauri** wrapper later | One codebase, and it works in any browser. |
| Automation | Playwright connects to a per-profile websocket server | Works with existing Playwright scripts. |

**Engine abstraction.** Everything talks to an `Engine` interface (`launch`, `stop`, `ws_endpoint`).
Camoufox is the first implementation. A Chromium engine can be added later without touching the rest of the code.

---

## 3. What makes it effective (design rules)

These rules matter more than any single feature:

1. **Consistency beats randomness.** Every value has to agree with the others: OS, UA, platform, GPU,
   screen size, fonts and hardware concurrency. Sample complete fingerprints from real distributions.
   Never randomize fields one at a time.
2. **Stability.** A profile's fingerprint is generated **once**, saved, and reused on every launch.
   A fingerprint that changes every session looks worse than an ordinary one.
3. **Match the host OS.** OS-level signals (font rendering, TCP/TLS stack) are hard to fake.
   By default, generate fingerprints for the OS the tool runs on.
4. **Proxy-aligned geo.** On launch, look up the proxy's exit IP and set timezone, locale,
   `Accept-Language` and geolocation to match. WebRTC must never expose the real IP.
5. **One identity, one IP.** Each profile gets its own sticky proxy. Two profiles never share an exit IP.
6. **Real browser, headful.** Run windows that are actually visible (or a virtual display on servers). Avoid headless mode.
7. **Verify, don't assume.** Every fingerprint or proxy change triggers the leak self-test (Phase 6).

---

## 4. Architecture

```
┌──────────────┐     HTTP (localhost + token)     ┌───────────────────────────┐
│ Web UI/Tauri │ ───────────────────────────────▶ │  Daemon (FastAPI)         │
└──────────────┘                                  │  ├─ ProfileService        │
┌──────────────┐                                  │  ├─ FingerprintService    │
│ Your scripts │ ── POST /profiles/:id/start ───▶ │  ├─ ProxyService (+geo)   │
│ (Playwright) │ ◀── { ws_endpoint } ──────────── │  ├─ LaunchManager (locks) │
│              │ ══ connect(ws_endpoint) ═══╗     │  ├─ SelfTestService       │
└──────────────┘                            ║     │  └─ Vault (encryption)    │
                                            ║     └────────────┬──────────────┘
                                            ║                  │
                                            ▼                  ▼
                                   ┌─────────────────┐   ┌──────────────────────┐
                                   │ Camoufox process│   │ SQLite + profiles/   │
                                   │ (one per profile)│  │   <id>/user-data/    │
                                   └─────────────────┘   └──────────────────────┘
```

### Repo layout
```
app/
  main.py              # FastAPI app, auth, startup
  config.py            # paths, ports, settings
  db.py                # SQLite + migrations
  models.py            # pydantic schemas
  vault.py             # keyring + libsodium helpers
  engines/
    base.py            # Engine interface
    camoufox_engine.py
  services/
    profiles.py
    fingerprints.py
    proxies.py         # parse, health check, exit-IP geo lookup
    launcher.py        # process mgmt, per-profile lock, ws server
    selftest.py
    backup.py          # export/import encrypted profile archives
  api/
    profiles.py proxies.py launch.py selftest.py
ui/                    # React + Vite
tests/
PLAN.md
```

### Data model (SQLite)
```
profiles(id TEXT PK, name, group_name, tags JSON, notes,
         engine TEXT, os TEXT,
         fingerprint JSON,          -- frozen at creation
         proxy_id FK NULL,
         geo_override JSON NULL,    -- manual tz/locale if wanted
         created_at, last_used_at, status)

proxies(id TEXT PK, label, scheme TEXT,  -- http | https | socks5
        host, port, username, password_enc BLOB,
        sticky BOOL, last_exit_ip, last_geo JSON, last_checked_at, healthy BOOL)

selftests(id PK, profile_id FK, ran_at, passed BOOL, report JSON)
events(id PK, profile_id, ts, kind, detail JSON)  -- launches, errors
```

### Local API
```
GET    /profiles                     list (filter by group/tag)
POST   /profiles                     create (generates + freezes fingerprint)
GET    /profiles/{id}
PATCH  /profiles/{id}                rename, tags, proxy, notes
DELETE /profiles/{id}                deletes data dir too (confirm flag)
POST   /profiles/{id}/clone          new id + NEW fingerprint, optional cookie copy
POST   /profiles/{id}/regenerate-fingerprint

POST   /profiles/{id}/start          -> { ws_endpoint, pid }
POST   /profiles/{id}/stop
GET    /profiles/running

POST   /profiles/{id}/cookies/import  JSON/Netscape format
GET    /profiles/{id}/cookies/export

GET/POST/PATCH/DELETE /proxies
POST   /proxies/{id}/check           -> exit IP, geo, latency
POST   /proxies/bulk-import          host:port:user:pass lines

POST   /profiles/{id}/selftest       -> report
POST   /backup/export   POST /backup/import
```

---

## 5. Phased build plan

Each phase ends with a **done when** check. Do not move on until it passes.

### Phase 0 — Setup (½ day)
- Python 3.12 project with `uv`, plus `ruff`, `pytest` and pre-commit.
- Install Camoufox and download its browser binary. Confirm one window opens with a test script.
- **Done when:** a hard-coded script opens Camoufox at `https://example.com`.

### Phase 1 — Profiles and isolation (2–3 days)
- SQLite schema and migrations. `ProfileService` handles CRUD.
- Each profile gets `profiles/<id>/user-data/` as a persistent context directory.
- `LaunchManager`: start and stop, track PIDs, and hold a **per-profile lockfile** so a profile never runs twice.
  Clean up stale locks on daemon startup.
- **Done when:** you log into a site in profile A, profile B is still logged out,
  and A is still logged in after a restart.

### Phase 2 — Fingerprints (2–3 days)
- `FingerprintService.generate(os, screen_constraints)` uses BrowserForge and stores the full JSON on the profile.
- Every launch passes the **stored** fingerprint to Camoufox. Nothing is regenerated.
- Options: target OS (defaults to host OS), screen-size limits, window size, and font set consistent with the OS.
- Regenerate only when you ask, through the API.
- **Done when:** the same profile shows identical values on fingerprint test pages across 5 launches,
  and two profiles show different, internally consistent values.

### Phase 3 — Proxies and geo alignment (2–3 days)
- Parse `scheme://user:pass@host:port` and `host:port:user:pass`. Encrypt passwords with the vault.
- Health check: fetch the exit IP through the proxy, then geo-lookup the IP to get country, timezone and coordinates.
  Use a local GeoLite2 DB so the lookup itself never leaks.
- On launch: set timezone, locale and languages, and geolocation from the proxy's geo.
  Force WebRTC to the proxy, or disable it.
- Refuse to launch if the proxy is down. Never silently fall back to a direct connection (kill switch).
- Warn if two profiles share an exit IP.
- **Done when:** the WebRTC leak test shows only the proxy IP, and the timezone and language match the proxy country.

### Phase 4 — Automation API (2 days)
- FastAPI with token auth. The token is generated on first run, saved under the user config dir, and the API binds to `127.0.0.1` only.
- `/start` launches the profile as a Playwright server and returns its `ws_endpoint`.
- Ship a small client helper: `with profile("shopping-1") as page: ...`.
- **Done when:** an external Playwright script connects, drives the page, disconnects,
  and the profile keeps running for manual use.

### Phase 5 — UI (4–5 days)
- Profile table: name, group, tags, proxy, country flag, status, last used, and Start/Stop buttons.
- Create and edit dialog: OS and screen options, assign a proxy, preview the fingerprint summary.
- Proxy manager: bulk import, check all, health badges.
- Bulk actions: start or stop a group, assign proxies, delete.
- Optional: wrap it with Tauri for a tray icon and an app window.
- **Done when:** the whole daily workflow works without the terminal.

### Phase 6 — Self-test harness (2 days)
- Headless-free run: start the profile, visit a set of public leak and fingerprint test pages
  (e.g. CreepJS, BrowserLeaks WebRTC, DNS leak test), and collect the results.
- Local checks: does the exit IP equal the proxy IP, does the timezone match the IP geo, does the language match,
  is the WebRTC IP the proxy's, does the UA platform match `navigator.platform` and the fonts, and is the fingerprint the same as the stored one.
- Save the report to `selftests` and show pass/fail in the UI. Run it automatically after create, proxy change or regenerate.
- **Done when:** a deliberately broken config (wrong timezone, or no proxy) fails the test with a clear reason.

### Phase 7 — Hardening and quality of life (3–4 days)
- **Encrypted backup:** each profile packs into one `.tar.zst` file encrypted with libsodium.
  Restore works on another machine.
- **Cookie import/export** (JSON and Netscape formats).
- **Clone:** a new profile with a fresh fingerprint, optionally reusing cookies.
- **Per-profile extensions** (Firefox `.xpi`) pinned at creation.
- **Logs and events** in the UI, plus crash recovery (reattach to running processes or reset their state).
- Auto-update check for new Camoufox builds. Pin the version per profile so updates don't break fingerprints.
- **Done when:** you can wipe the machine, restore the backups, and everything works.

### Phase 8 — Optional extensions (only if needed)
- **Sync between your own devices:** encrypted profile archives over Syncthing, or an S3 bucket you control.
  Use last-writer-wins with a lock so a profile never runs on two devices at once.
- **Chromium engine:** add `chromium_engine.py` behind the same interface. Realistically this means maintaining
  a patch set on top of upstream Chromium: rebasing about every 4 weeks, multi-hour builds, and a 32GB+ RAM build machine.
  Only do it if Firefox-based profiles are not enough for your sites.
- **Scheduler:** cron-like jobs that run your scripts against profile groups.

---

## 6. Timeline (one person, part-time)

| Week | Phases | Result |
|---|---|---|
| 1 | 0, 1, 2 | Isolated profiles with stable fingerprints from the CLI |
| 2 | 3, 4 | Proxy-aligned profiles drivable from scripts |
| 3 | 5 | Usable daily through the UI |
| 4 | 6, 7 | Self-tested, encrypted and backed up. Feature-complete for personal use. |

---

## 7. Testing strategy
- **Unit:** proxy parsing, vault round-trip, fingerprint freeze and reload, lock handling.
- **Integration (pytest + a real Camoufox):** isolation test (Phase 1), stability test (Phase 2),
  and proxy alignment against a local mock proxy (Phase 3).
- **Regression:** save a "golden" self-test report per profile and diff it on every Camoufox version bump.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Sites behave differently on Firefox-based browsers | Keep the engine interface clean. The Chromium engine is Phase 8. |
| Engine updates change fingerprint output | Pin the engine version per profile, and run golden self-tests before upgrading. |
| Proxy drops mid-session and leaks the real IP | Run all traffic through the proxy inside the engine, with no direct fallback, and run health checks before launch. |
| Profile corruption | Per-profile locks, automatic backups before upgrades. |
| Secrets on disk | Master key in the OS keyring, everything else encrypted. API on localhost only, with a token. |

---

## 9. Responsible use
This is for managing your own accounts and identities privately: separating work, personal and client
logins, privacy, and QA testing. Many platforms prohibit multiple or duplicate accounts and ban evasion in
their terms, and using a tool like this for fake accounts or fraud can carry legal liability.
