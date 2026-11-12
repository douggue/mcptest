# Stream Studio

A private, self-hosted streaming studio. Upload videos once, then broadcast them — or a live OBS feed — to
**YouTube, Facebook, TikTok, Instagram, Twitch, Kick, X, LinkedIn and any RTMP server at the same time**,
in **16:9 or 9:16**, right now or on a schedule. It runs on one small VPS, so broadcasts keep going with your
phone and computer switched off.

It is a personal alternative to hosted multistreaming services such as OneStream: one owner, your server,
your keys, no per-month platform fee beyond the server itself.

## What it does

| | |
|---|---|
| **Library** | Resumable chunked uploads (multi-GB files survive dropped connections), automatic inspection, thumbnails and conversion to streaming-ready H.264/AAC in 16:9 and/or 9:16. Choose blurred-background, black-bar or crop framing when changing shape. Videos without audio get a silent track (platforms often reject streams with no audio). |
| **Playlists** | Drag-and-drop ordering, shuffle, total running time. Mixed 16:9 and 9:16 videos play seamlessly because each is pre-converted to the broadcast format. |
| **Broadcasts** | Source = a video, a playlist, or **live from OBS**. Format = 16:9 or 9:16. Any set of destinations. Manual, one-off or recurring schedules (days of week, start/end dates, time zone aware incl. daylight saving). Optional duration and looping. Overlap warnings. Preflight checks. Run history with per-platform results. |
| **Live from OBS** | Each live broadcast gets a private RTMP key. While armed, your encoder's feed is relayed to every platform; if OBS drops, outputs wait and resume automatically when it reconnects. |
| **Reliability** | Every platform has its **own** output process and retry budget (5 s → 15 s → 45 s…), so a Facebook failure never interrupts YouTube. Engine restarts are reconciled: broadcasts resume at the right position, leftover processes are cleaned up, and starts missed while offline are recorded rather than fired hours late. |
| **Monitoring** | Live dashboard with per-platform state and bitrate, playback position, on-air timer, authenticated live preview, CPU/RAM/disk/network health, 60-day activity log. Alerts to Discord, Slack, ntfy (phone push) or any webhook. |
| **Security** | One owner account, scrypt password hashing, optional TOTP two-factor, HttpOnly SameSite cookies, CSRF header, login rate limiting, strict CSP, no third-party scripts. Stream keys are AES-256-GCM encrypted at rest, never returned to the browser and scrubbed from logs. RTMP publishing requires a valid per-broadcast key. |
| **Platform policy gate** | TikTok (and other gated platforms) are blocked until you confirm your account has LIVE encoder access, and pre-recorded/looped content is blocked for them unless you explicitly allow it. |

## Architecture

```
            Browser (phone / desktop)
                     │ HTTPS
                  ┌──▼───┐
                  │Caddy │  automatic TLS
                  └──┬───┘
                ┌────▼────┐   SQLite (WAL)    ┌──────────┐
                │   web   │◄────────────────►│  engine   │  scheduler · preflight · retries
                │dashboard│   internal API    │           │  media conversion (ffmpeg)
                └─────────┘                   └──┬─────┬──┘
                                     playback    │     │ one ffmpeg per destination
                                     worker      ▼     ▼
   OBS ──RTMP:1935──────────────────────────► MediaMTX relay ──► YouTube  (RTMPS)
                                                         ├──────► Facebook (RTMPS)
                                                         └──────► TikTok / Twitch / …
```

* **web** and **engine** are separate processes: restarting or updating the dashboard never touches a live stream.
* Videos are converted **once at upload**, so broadcasting is stream-copy — a 2-vCPU server comfortably runs
  several simultaneous outputs.
* MediaMTX authorises every publish/read through the engine; its API and HLS ports are never exposed.

Stack: Node.js 22 (no npm dependencies — built-in `node:sqlite`, `fetch`, `crypto`), ffmpeg, MediaMTX, Caddy,
Docker Compose. Vanilla-JS dashboard, no build step.

## Install on a VPS (≈10 minutes)

1. **Get a server.** Ubuntu 22.04/24.04. 2 vCPU / 4 GB is enough for a few outputs; 4 vCPU / 8 GB if you convert a
   lot of video or run several broadcasts at once. Pick a plan with plenty of **outbound transfer** (see costs below).
2. **Point a domain** (e.g. `studio.example.com`) at the server's IP with an `A` record.
3. **Install:**
   ```bash
   git clone <this repo> stream-studio && cd stream-studio
   sudo ./setup.sh
   ```
   The script installs Docker, opens ports 22/80/443/1935, adds swap on small servers, generates `.env` with fresh
   secrets, and starts everything. It prints your **setup code**.
4. Open `https://studio.example.com`, enter the setup code and choose your password. Turn on two-factor in
   **Settings → Security**.
5. **Back up `.env`** somewhere safe. `APP_SECRET` decrypts your saved stream keys.

## Connect your platforms

**Destinations → Add destination** shows step-by-step instructions for each platform. In short:

| Platform | Where to find the key | Notes |
|---|---|---|
| YouTube | Studio → Create → Go live → Stream | Enable **Auto-start/Auto-stop** and use a reusable key for scheduled shows. 9:16 works for vertical live. |
| Facebook | facebook.com/live/producer → Streaming software | Turn on **persistent stream key**. Check max live duration for long loops. |
| TikTok | LIVE Studio / LIVE Center → streaming software | Only for accounts with LIVE encoder access; keys usually change per session. TikTok Shop LIVE prohibits pre-recorded and looped content — Stream Studio blocks it unless you confirm otherwise. |
| Instagram | Instagram web → Create → Live video | Professional accounts; key changes every session. 9:16. |
| Twitch | Creator Dashboard → Settings → Stream | Label pre-recorded content as such. |
| Kick, X, LinkedIn, custom | Their producer / stream settings | Paste server URL + key. |

Use **Test** on a destination to check the ingest server is reachable (it does not start a stream).

## Daily use

* **Pre-recorded show:** Library → upload → Broadcasts → New → Video/Playlist → format → destinations → schedule → Create.
  Run **Preflight** from the ⋯ menu to confirm everything is ready.
* **Live from OBS:** Broadcasts → New → *Live (OBS)* → after saving, copy the server and key into OBS (Settings → Stream →
  Custom). Press **Go live** (or let the schedule arm it), then start streaming in OBS.
  Recommended OBS output: 1920×1080 (or 1080×1920 vertical canvas), 30 fps, x264 CBR 4500–6000 Kbps, keyframe 2 s, AAC 160 Kbps.
* **Alerts:** Settings → Alerts → paste a Discord/Slack webhook or `https://ntfy.sh/<your-topic>` and install the ntfy app.

## Bandwidth & cost

Your server uploads one copy of the stream **per destination**.

| Example | Estimate |
|---|---|
| 1080p ≈ 6.2 Mbps per output, 3 outputs, 1 hour | ≈ 8.4 GB |
| Same, 4 hours a day for 30 days | ≈ 1 TB / month |
| 720p (Settings → quality) ≈ 3.7 Mbps per output | ≈ 40 % less |

A $24–48/month VPS with 4–5 TB transfer covers most personal use. Converting video is the main CPU cost and
happens once per upload.

## Operations

```bash
docker compose logs -f engine        # broadcast + conversion logs
docker compose ps                    # health
./scripts/backup.sh                  # database + .env backup (add --with-media for videos)
git pull && docker compose up -d --build   # update (live broadcasts resume automatically)
```

Data lives in the `studio-data` Docker volume: `studio.db`, `originals/`, `processed/`, `thumbnails/`.

## Local development

Requires Node.js ≥ 22.13, ffmpeg and a MediaMTX binary.

```bash
MEDIAMTX_BIN=/path/to/mediamtx COOKIE_SECURE=false npm run dev   # → http://localhost:8080
npm test
```

`ALLOW_PRIVATE_DESTINATIONS=1` lets destinations point at a local RTMP server for testing (for example a second
MediaMTX instance acting as a fake platform).

## Limits & honest notes

* Destinations use **stream keys**, not platform OAuth. YouTube and Facebook go live automatically with auto-start
  and persistent keys, but titles/descriptions are set on the platform. Creating YouTube broadcasts via the
  YouTube Live API is a natural next step.
* Platform rules on pre-recorded and looped "live" content vary and change. Check each platform's current policy
  before scheduling replays; the TikTok gate exists for this reason.
* Outputs connect a couple of seconds after playback starts, so the very first ~2 s of a pre-recorded programme
  may not reach viewers (platforms take a few seconds to show a stream as live anyway). Leave a short intro.
* Live input passes your encoder's video through unchanged; configure OBS for the format you want.
