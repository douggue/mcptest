# Shorts niche finder: plan

Status: plan only. Nothing here is built. Four decisions are the owner's and are
listed under "Open decisions"; the parts that depend on them are marked.

## Goal

A service that runs all day on a small server, watches YouTube Shorts on a list
of subjects and countries through the official YouTube Data API, and sends an
alert when a new or small channel has a Short that is gaining views unusually
fast. Findings are kept with an earnings range at the owner's Shorts rate
($0.10 to $0.50 per 1,000 views) and, where the same idea is winning in another
country, language or category, as a transfer opportunity.

## What carries over from Jgtube

| Part                                              | Use                                                               | Change needed                                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `db/sqlite.ts`, `db/backup.ts`                    | Store, numbered migrations, backup before upgrade                 | New tables (below)                                                                              |
| `repos/`                                          | Channels, videos, readings, watchlist, leases                     | A reading repository that can prune and roll up                                                 |
| `sources/dataApi.ts`                              | Search and channel facts; key in a header, stripped from errors   | Add video statistics, playlist items, region and language on search, and a count of units spent |
| `niches/outperform.ts`, `niches/niches.ts`        | "New or small channel with a recent video that outperforms"       | Thresholds re-derived for Shorts (see "Rules")                                                  |
| `niches/growth.ts`                                | Views gained between stored readings                              | A per-hour version over a short window                                                          |
| `scoring/earnings.ts`                             | Earnings range; Shorts rate is already the owner's                | The Shorts test (60 seconds) is out of date; replaced by the Shorts check below                 |
| `refresh/refresh.ts`, `lease.ts`                  | Scheduled re-reading, back-off for failures, one reader at a time | Reads go through the official API, not the page reader                                          |
| `discovery/keyword.ts`                            | Channels found by keyword                                         | It reads each channel through the page reader today; needs an official-API reader               |
| `packages/server`, `apps/web`, `design/DESIGN.md` | API envelope, security headers, page in the owner's design        | A login, or no public address at all (see "Security")                                           |
| `packages/mcp`                                    | The owner's Claude reads findings                                 | Remote access is an open decision                                                               |

Not on the branch: `packages/core/src/transfer` (title templates and transfer
opportunities). The plan does not depend on it until the owner confirms it has
been merged.

The largest piece of new engine work is the one Jgtube deferred as
`DataApiSource`: reading a channel and its videos through the official API.
Jgtube's ingest uses the unofficial page reader, which data-centre addresses are
refused first, so the server cannot rely on it.

## What is new

1. **Official-API reader.** `videos.list` (statistics, length, language,
   category; 1 unit per 50 videos), `playlistItems.list` (a channel's uploads;
   1 unit per 50), `search.list` with `regionCode`, `relevanceLanguage` and
   `videoDuration=short` (100 units).
2. **Allowance ledger.** Every call records its cost. The scheduler spends from
   a daily plan and stops before the allowance does, so a refusal never happens
   mid-cycle. Resets at midnight Pacific time.
3. **Watch list of subjects.** Keyword, country, language, how often. Seeds come
   from the owner; later, subjects found in winning titles can be proposed, never
   added silently.
4. **Shorts check.** The API has no "is a Short" flag. First cut: three minutes
   or less (the current Shorts limit). Confirmation, to be tested before
   anything is built on it, in this order:
   - the channel's Shorts-only uploads list read through the official API (an
     undocumented list id; if it works it costs 1 unit and needs no page read);
   - failing that, one request per candidate to the video's Shorts address,
     which is an unofficial page read and may need a residential proxy from a
     data-centre address.

   Only candidates that would otherwise alert are confirmed, never every video.

5. **Views per hour.** Tracked videos are read on a tier: hourly for the first
   three days, every six hours to day 14, then dropped. Rank is views gained per
   hour over the last readings, not totals.
6. **Alerts.** One message per finding, with the reason, the numbers and a link;
   a daily digest; a daily "still running" line, so silence means a fault. No
   repeat alert for the same video. Channel is an open decision.
7. **Service wrapper.** A long-running process with a scheduler, started by
   systemd, restarted on failure.

## Rules (to be set on evidence, not on one channel)

The long-video niche rule cannot be copied as it stands:

- "At most 14 uploads a week" would reject most Shorts channels, which post
  daily or more.
- A 10,000-view floor is low for Shorts, where views are cheap.
- "5× the channel's usual" needs a usual; a week-old channel has none, so the
  views-per-subscriber path and the per-hour rate carry more weight.
- The Latin-letter check assumes the owner reads only Latin alphabets; with
  several languages watched it becomes a per-subject setting.

Each threshold is chosen from readings of small established channels in at least
three unrelated niches and two languages, and held to niches it was not chosen
on, as Jgtube's look-alike rules are. No word list or number is fitted to one
channel.

## Daily allowance

10,000 units a day. A starting split:

| Use                            | Units | What it buys                                                                 |
| ------------------------------ | ----- | ---------------------------------------------------------------------------- |
| Searches                       | 6,000 | 60 a day: for example 30 subjects in 2 countries, or 20 in 3, once a day     |
| Readings of tracked videos     | 2,000 | About 3,000 fresh videos hourly plus about 6,000 older ones four times a day |
| Channel facts and upload lists | 1,000 | Several hundred channels a day                                               |
| Kept back                      | 1,000 | Retries, confirmation, a search asked for by hand                            |

Search is the scarce part: every extra country multiplies it. Subjects can
rotate (each searched every second or third day) to widen coverage at the cost
of finding things later. The plan assumes one key; asking Google for a larger
allowance is possible but slow and not assumed.

## Data model additions

```
subjects          id PK, keyword, region, language, every_hours, enabled, last_searched_at
subject_hits      subject_id FK, video_id FK, first_seen_at   -- which search found what
quota_ledger      day (Pacific), units_spent, by_kind JSON
video_tracking    video_id PK FK, tier (hourly|six_hourly|done), next_read_at,
                  is_short (yes|no|unknown)
findings          id PK, video_id FK, channel_id FK, kind (niche|transfer), reason JSON,
                  views_per_hour, earnings_low, earnings_high, found_at, alerted_at NULL
```

`video_snapshots` is reused for readings. Hourly readings are rolled up to one a
day after 14 days so the file stays small. Google's API terms limit how long API
data may be kept without being read again (to be checked against the current
policy text before the retention rule is fixed); tracked videos are re-read
often, and videos that leave tracking keep only what a finding needs.

## Deployment

- One droplet, Ubuntu LTS. The $6 size (1 GB) is recommended; the $4 size (512 MB)
  runs the service but is tight for installing and building.
- Node 22, the service under its own unprivileged user, `systemd` unit with
  `Restart=always`.
- Settings and the API key in a root-owned file readable only by the service
  (`chmod 600`), never in the repository. The key is restricted to the YouTube
  Data API and, once the droplet has an address, to that address.
- Nightly dated backup of the store on the droplet; a weekly copy off it
  (the host's own droplet backups are the simplest).
- Updates: `git pull`, install, restart, as one script; the store is backed up
  before any migration, as today.

## Security

- Firewall closed except SSH; SSH by key only; automatic security updates.
- The service makes outbound calls only (YouTube API, the alert service).
- Preferred: **no public web page.** Alerts carry the findings; the page and
  API stay bound to 127.0.0.1 and are reached through a private link (Tailscale,
  free, or an SSH tunnel). This needs no login code at all.
- If a public address is wanted: HTTPS through Caddy on a domain, one
  owner password checked by the server (hashed, rate-limited, secure cookie),
  and every existing write check kept. This is more to build and to keep safe.
- Titles and channel names remain untrusted text everywhere, including in
  alerts.

## Claude's part

Open decision. Without it the service is rules and numbers only, and the owner's
Claude labels niches on request through the connector on their own computer,
with no extra bill. With it, the server calls the Claude API with an Anthropic
key (a separate, usage-priced bill) to name each finding's niche once; with a
small model and one short call per finding this is expected to be small, to be
measured before it is promised.

## Cost

| Item                                                             | Per month                 |
| ---------------------------------------------------------------- | ------------------------- |
| Droplet                                                          | $4 to $6                  |
| Droplet backups (optional)                                       | about $1 to $2            |
| YouTube Data API                                                 | free within the allowance |
| Telegram, Discord or email                                       | free at this volume       |
| Domain (only for a public page)                                  | about $1                  |
| Residential proxy (only if the page-read Shorts check is needed) | by use; to be priced      |
| Claude on the server (optional)                                  | usage-priced; small       |

## Risks

| Risk                                                  | Answer                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Search returns the biggest videos, not small channels | Search is only the net; ranking is by per-hour gain and channel size after reading          |
| The seed subjects decide what can be found            | Start narrow, review what each subject finds weekly, drop the empty ones                    |
| No reliable Shorts flag                               | Test the official list first; confirm only candidates; mark "unconfirmed" rather than guess |
| Allowance runs out                                    | Ledger and daily plan; searches are cut before readings                                     |
| Too many alerts, then ignored                         | A daily cap, a digest for the rest, thresholds tuned on the first two weeks                 |
| Rules fitted to one niche                             | Chosen and tested on small established channels in several niches and languages             |
| The droplet or the service dies quietly               | systemd restart, daily "still running" line, backups                                        |
| Search results vary between identical calls           | A video counts once seen; tracking, not search order, drives everything after               |

## Order of work (after the decisions)

1. Official-API reader and allowance ledger, with recorded replies as fixtures.
2. Shorts check: test both routes on small established channels in three niches.
3. Subjects, scheduler, tiered readings, per-hour rate.
4. Rules and findings; thresholds from evidence; earnings range.
5. Alerts and the daily digest.
6. Droplet set-up script, service unit, backups; a week's unattended run.
7. Page or connector access, as decided.

Each step is written tests-first and reviewed by a code reviewer, a senior
supervisor and a creator's-eye reviewer before the next begins.

## Changes from the design review (accepted, not yet built)

A senior review of the design after the search and read cycles were built found
that the plumbing is sound but the two things that decide what can be found are
aimed wrongly. These replace the matching parts of the plan above.

- **Search net.** `order=viewCount` over seven days returns the biggest videos
  of the week from big channels, and after day one finds few new ones. Instead,
  two kinds of search per subject: "top recent" (`order=viewCount` over the last
  48 hours, where total views roughly follow views per hour) and "newest"
  (`order=date` from the end of the previous sweep to now; a sweep that comes
  back full makes that subject's next sweep sooner).
- **How a video was found** is stored on each hit: search kind, rank in the
  results, and the video's age when found, so the mix can be judged on evidence.
- **Known channels' uploads.** The channel share is nearly unused. Spend it on
  each followed small channel's uploads list once a day (1 unit, against 100 for
  a search); it finds their new Shorts and builds each channel's own history.
  The Shorts-only list is tested here first.
- **Tracking by promise, not age.** Reading every found video hourly for three
  days runs the reading share out in week two (about 116 reads a video; 100,000
  reads a day). Hourly only while a video is in the top half of its group (same
  subject and region, same age band); finished after three readings in a row in
  the bottom half without speeding up; videos from channels too big to count as
  small are read only at about 24 and 72 hours, for the baseline. Each hour's
  cycle takes at most the share left divided by the hours left in the Pacific
  day, best candidates first, so readings never stop for hours late in the day.
- **More per reading.** Likes and comments are stored (the same request returns
  them), and each tracked video gets a growth summary (views at 1 h, 6 h, 24 h,
  72 h, 7 d) so group percentiles are a simple query and raw readings can be
  deleted when tracking ends. This replaces the 14-day roll-up.
- **"Outperforms" is a position in a group, not a number.** A finding needs, at
  the same age: speed in the top share of its group; views per subscriber in the
  top share; several times the channel's own median when it has about five
  tracked Shorts; a channel in the bottom share of its group by subscribers or
  age; the speed test holding on two readings in a row; and one money floor in
  dollars, which is the owner's choice. The shares are fixed only after two to
  three weeks of readings from about ten small established channels in each of
  three or more unrelated niches, chosen on two niches and checked on a third.
- **Earnings label.** A Short's public view count may include every start and
  replay while payment is on engaged views; to be checked against YouTube's
  current policy, and the range labelled an upper bound if so.
- **Regions.** Measure in week one how much each subject's results overlap
  between US, GB, CA and AU; where high, search the other three less often.
  Transfer across four English-speaking regions will be thin; the rule needs
  only stored hits with their rank, channel country and titles.
- **Unattended running.** Unspent search and channel units flow to readings late
  in the Pacific day; a daily clean-up removes videos and channels no longer
  read; the daily "still running" message reports units by kind, videos due but
  unread, tracked-set size and disk use; a swap file on the 1 GB droplet.

## Changes from the creator's-eye review (accepted, not yet built)

A review of the alerts, the commands and the set-up guide as a creator would use
them. Its main point: speed on a small channel detects a hit, not a niche. A
niche is a format that works more than once.

- **Repetition is the headline.** Every alert says whether the find looks
  repeatable or is one hit so far: how many Shorts the channel has, what its
  usual Short gets, how many of its last ten beat that several times over, and
  whether other small channels took off on the same subject this week. The
  followed channels' upload lists supply this.
- **Alert layout.** Title first, linked to the Short, so the phone notification
  says something; length in seconds; views per hour beside what is typical for a
  Short of that age from the same search; country names, not codes; a link to
  the channel's Shorts tab. An alert is held until its rate and reason exist.
- **Warning labels, not silent drops**, from what the API returns: made for
  kids, Music or News category, audio language, the same title on several
  channels, a very new channel with many uploads. Labels are shown so the owner
  sees what is flagged; none is fitted to a niche.
- **Earnings wording.** "At your rate, views like these are worth at most about
  $X to $Y", whole dollars, with "too small to be paid for Shorts yet" under
  1,000 subscribers; and a per-channel line from its last 30 days of Shorts.
- **One evening message** in plain words instead of a digest and a heartbeat:
  working or not, a problem line only when there is one, finds per subject, and
  the subjects that found nothing in a week. Engineering figures stay in
  `status`.
- **Best first.** Under the daily cap the best finds go out, not the oldest, and
  a command lists every find, so none is lost to the cap.
- **Subject commands** act on a keyword across all its countries, can remove a
  subject, show what each has found, and print the server's command names.
- **Set-up guide.** Says at the top what the service does and does not yet do;
  a command that sends a test message and prints the chat number; exact steps
  for logging in on Windows and Mac; one path, not two; how to choose the first
  subjects (a few known niches as controls, broad interests the owner has never
  worked in, and format words that cross topics; replace the emptiest weekly).
- **Countries against subjects.** If the first week shows the four countries
  return largely the same videos, more subjects in fewer countries finds more.

## Taken from the owner's "24/7 research workstation" plan

The owner supplied a master plan for a larger product (a $35-40 a month research
and scriptwriting studio on an 8 GB server, with an unofficial crawler behind
residential proxies, embeddings and seven screens) and asked that what is good
in it be adapted. What is taken, what is deferred and what is left out:

**Taken now**

- **Upload feeds for followed channels.** YouTube's public Atom feeds need no
  key and no allowance. Tested on 20 November 2026 from a data-centre address on
  two channels: `feeds/videos.xml?channel_id=UC…` returned the 15 newest uploads
  with views and publication times, and a Short's link is a `/shorts/` address;
  `feeds/videos.xml?playlist_id=UUSH…` returned Shorts only. This is the Shorts
  check and the daily read of followed channels at no cost, and gives their
  newest Shorts view readings every half hour. The reply is cacheable for 15
  minutes; no ETag was sent, contrary to that plan. Still to confirm on small
  channels in several niches, and how it behaves under steady polling.
- **Trimmed-median baseline.** A channel's usual Short is the median of its 15
  newest Shorts with the two highest and two lowest left out, so one fluke does
  not move it. This is the "channel's own record" in the outperform rule and the
  "its usual Short gets" line in the alert.
- **Off-site copy of the store.** Continuous replication to object storage
  (Litestream to Cloudflare R2's free tier), since nightly copies on the same
  disk do not survive losing the droplet. An optional step in the set-up guide.
- **Private access over Tailscale** when a page is built, as already preferred.

**Deferred, as options**

- **Format and "faceless / AI voice" labels** from the title, recent titles and
  three thumbnails: this is the owner's optional labelling (decision 4). It uses
  whichever model key the owner sets; that plan's choice was a low-cost Gemini
  model at about $2 a month.
- **Title formats** ("Why [thing] is quietly [outcome]"): grouping winners'
  titles into reusable templates is the transfer module's job. That plan's
  method (embeddings and clustering held in memory) needs the 8 GB server; a
  lighter word-pattern version, or the owner's Claude on request, fits the
  droplet.
- **Saved finds with notes**, a filterable page of finds and a status page, when
  the web page is built.
- **Unofficial discovery behind residential proxies** (that plan's main
  crawler). It removes the 100-units-a-search ceiling, at about $14 a month,
  against YouTube's terms, with breakage whenever YouTube changes its pages; no
  such crawler is "zero-ban". Decide after the first weeks show whether official
  search plus feeds finds enough. Its byte cap and circuit breaker are the right
  guards if it is added.

**Left out**

- The scriptwriter, voice profiles, ideation lab and seven-screen studio: a
  different product, mostly for long videos. Ideas and scripts can come from the
  owner's Claude reading the finds.
- Python, FastAPI and Next.js: the project stays in TypeScript.
- Fixed cut-offs (2.5 times the usual, 3 views per subscriber): they break the
  rule that no threshold is fitted; positions within a group are used instead.
- That plan's Shorts rate ($0.03-0.12 per 1,000): the owner's own $0.10-0.50 is
  kept, as a setting.
- Reading "is monetised" from the player page: an unofficial read, unreliable.
- Image embeddings and thumbnail search: need the larger server.

## Decisions (owner, 20 November 2026)

1. **Countries:** the ones with high ad rates. Start with US, GB, CA and AU in
   English, as a setting; four countries means about 15 subjects searched daily
   within the 60-search budget, or more on rotation.
2. **Alerts:** Telegram.
3. **A new project.** It lives in `shorts-finder/`, self-contained (its own
   `package.json`, no imports from `packages/`), so the folder can be moved to a
   repository of its own.
4. **Claude labelling:** an option, off by default; on only when an Anthropic
   key is set.

Still open: the first list of subjects (keywords) to watch.
