# Posting to YouTube

Cutroom can upload an exported short to your own YouTube channels, now or at a scheduled time, and read its views, likes and comments back into the Agency planner. It does this with your own Google Cloud OAuth client: there is no Cutroom account or server in between, and nothing is shared with anyone else.

## Set it up in Google Cloud (once, about ten minutes)

1. Open the [Google Cloud console](https://console.cloud.google.com/), create a project (or pick one), and enable **YouTube Data API v3** under *APIs and services → Library*.
2. Open *Google Auth platform* (the *OAuth consent screen*):
   - Audience: **External**. Fill in an app name (anything, for example "My Cutroom") and your email.
   - Data access (scopes): add `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly`.
   - Test users: add the Google account that owns your channels.
   - Publishing status: press **Publish app** to set it to **In production**. While it stays in *Testing*, Google ends the connection every 7 days and you must reconnect. You do not need Google's verification for your own use: Google shows "Google hasn't verified this app" when you connect; click *Advanced → Go to (your app)*.
3. Under *Clients* (*Credentials*), create an **OAuth client ID** of type **Web application**. Under *Authorized redirect URIs*, add the redirect URL that Cutroom shows in *Settings → YouTube*:
   - on your own computer: `http://127.0.0.1:8000/api/youtube/callback` (the port is the one Cutroom runs on);
   - on the server edition: `https://your-domain/api/youtube/callback`.

   On your own computer a client of type **Desktop app** also works, with no redirect URL to add.
4. Copy the client ID and client secret.

## Connect a channel

1. In Cutroom, open *Settings → YouTube*, paste the client ID and secret, and press **Connect channel**.
2. Google asks which account (and, for brand channels, which channel) to use, then asks you to allow access. Tick every box.
3. You come back to Settings with the channel listed. It is linked to an Agency account (platform YouTube Shorts): an account you picked, one with the same handle, or a new one.

Connect each channel separately. On the server edition, stay signed in to Cutroom in the same browser while you connect; Google sends you back to Cutroom, which only accepts the answer from a signed-in browser.

If a channel shows **Needs reconnecting** (you revoked access, changed your Google password, or the app is still in Testing), press **Reconnect**. Posts already made keep their records.

## Post

- In the editor: export the MP4, then use **Post to YouTube** in the Export panel. Title, description and hashtags come from the clip's post text. Choose who can see it, and post now or schedule a time.
- In the Agency planner: a planned post that has an export and is on an account linked to a connected channel shows a **Publish** button.

Each upload becomes (or fills in) an Agency post with the YouTube link. Public and unlisted uploads are marked posted; scheduled ones stay planned until YouTube makes them public, which Cutroom notices the next time views are refreshed. **Refresh views** in the planner reads connected channels through the YouTube API and everything else from the post link as before.

## Limits worth knowing

- **Unverified apps upload private videos.** Google keeps every video uploaded through an OAuth app it has not verified (any app created after July 2020) private until the app passes a YouTube API audit. A personal app normally stays unverified, so expect uploads to arrive as private, scheduled ones included. Make them public in YouTube Studio, or apply for the audit through the Google Cloud console (the *YouTube API Services audit and quota extension* form). Cutroom tells you when YouTube kept an upload private.
- **Quota.** Each Google Cloud project gets 10,000 units a day. An upload costs about 1,600 units, so about six uploads a day; reading statistics costs 1 unit per 50 videos. The quota resets at midnight Pacific time.
- **Made for kids** is off unless you turn it on for a video.
- Tokens and the client secret are stored in Cutroom's data folder (`db/settings.json`) and are never sent to the browser.

## For testing

Every Google address can be overridden, so a local stand-in can play Google:

| Variable | Default |
|---|---|
| `CUTROOM_GOOGLE_AUTH_URL` | `https://accounts.google.com/o/oauth2/v2/auth` |
| `CUTROOM_GOOGLE_TOKEN_URL` | `https://oauth2.googleapis.com/token` |
| `CUTROOM_GOOGLE_REVOKE_URL` | `https://oauth2.googleapis.com/revoke` |
| `CUTROOM_YOUTUBE_API_URL` | `https://www.googleapis.com/youtube/v3` |
| `CUTROOM_YOUTUBE_UPLOAD_URL` | `https://www.googleapis.com/upload/youtube/v3` |

`CUTROOM_YOUTUBE_CHUNK_BYTES` sets the upload chunk size (rounded to 256 KiB; default 8 MiB). `CUTROOM_PUBLIC_URL` (for example `https://clips.example.com`) fixes the address used for the redirect URL on a server; otherwise it is taken from the address the browser used, or can be typed under *Settings → YouTube → Use a different redirect URL*.
