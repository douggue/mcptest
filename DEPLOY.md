# Running Cutroom on a server

This is the server edition: the same app, behind a password, using the Claude and Gemini APIs. Things that need your own computer (the flow-mcp connector, copying to a synced folder) are not part of it.

Two limits to know first:

- **Video links may not work.** YouTube and similar sites often block downloads from datacenter addresses. Upload source videos from your computer instead.
- **Size the server for rendering.** 2 CPUs / 4 GB works but is slow; 4 CPUs / 8 GB is comfortable. The image is about 3 GB, so allow 10 GB of free disk for the first build.

## 1. Create the server

Any provider works. On DigitalOcean: create a Droplet with **Ubuntu 24.04**, and add your SSH key or a long password. Note its IP address.

## 2. Install Docker and get the code

Connect (`ssh root@YOUR_IP`), then:

```bash
curl -fsSL https://get.docker.com | sh
git clone -b ccr-803f6c72-tutx3u https://github.com/douggue/mcptest.git cutroom
cd cutroom
```

## 3. Choose how you will reach it

### Option A: a domain with HTTPS (recommended)

1. Point a domain or subdomain at the server: an **A record** for, say, `clips.example.com` → `YOUR_IP`.
2. Create the settings file:

   ```bash
   cat > .env <<'END'
   CUTROOM_DOMAIN=clips.example.com
   CUTROOM_PASSWORD=choose-a-long-password
   ANTHROPIC_API_KEY=
   GEMINI_API_KEY=
   END
   ```

3. Start it:

   ```bash
   docker compose -f docker-compose.server.yml up -d --build
   ```

The first build takes several minutes. Then open `https://clips.example.com` and sign in. The HTTPS certificate is issued automatically.

### Option B: no domain, private tunnel

Without a domain there is no HTTPS, and a password sent over plain HTTP can be read on the way. Keep the app private instead and reach it through SSH:

```bash
echo "CUTROOM_PASSWORD=choose-a-long-password" > .env
docker compose up -d --build
```

Then, on your own computer, open a tunnel and leave it running:

```bash
ssh -L 8000:127.0.0.1:8000 root@YOUR_IP
```

and browse to `http://127.0.0.1:8000`.

## Day to day

| Task | Command (in the `cutroom` folder) |
|---|---|
| See logs | `docker compose logs -f cutroom` |
| Update to the newest code | `git pull && docker compose -f docker-compose.server.yml up -d --build` |
| Stop | `docker compose -f docker-compose.server.yml down` |
| Change the password | edit `.env`, then run the start command again |
| Back up your work | everything is in the `cutroom-data` Docker volume |

Use the plain `docker compose …` form of each command if you chose option B.

AI keys can go in `.env` or be saved later under Settings → AI. Signing in lasts 30 days per browser; **Sign out** is on the Settings page. After eight wrong passwords from one address, sign-in is paused for five minutes.
