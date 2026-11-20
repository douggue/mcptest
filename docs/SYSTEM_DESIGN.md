# System design

Data model, algorithms and contracts. Architecture is in `ARCHITECTURE.md`; the
crawl itself is in `CRAWL.md`.

## Data model

Every table below exists today (`packages/core/src/db/sqlite.ts`, applied as
numbered migrations tracked in `PRAGMA user_version`). The tables planned for a
stored topic writer were never built; see "Not built" at the end of this section.

```
channels        id PK (UC…), handle, title, subscribers NULL, subs_hidden,   -- built
                video_count, fetched_at        (language: planned)
                created_at NULL, country NULL, total_views NULL,   -- from the official API;
                facts_fetched_at NULL          -- set once the API has been asked
                read_failures, read_failed_at NULL   -- reads that failed in a row, so a
                -- refresh backs off from a channel that is gone
videos          id PK, channel_id FK, title, views, duration_s,
                published_at, published_precision (day|week|month|year),
                published_raw ("2w ago"), fetched_at                    -- built
video_snapshots video_id FK, captured_at, views   -- built; PK (video_id, captured_at)
rec_edges       from_channel FK, to_channel (no FK: the target may not be stored yet),
                sampled, hits, share                                   -- built
edge_crawls     channel_id PK, region, crawled_at   -- built; latest reading only, no history
maps            id PK, center_channel FK, model_channel NULL, depth, region,  -- built
                created_at,
                snapshot_json   -- the map as it was when made: scores, tiers, peers
map_channels    map_id FK, channel_id FK, steps, position             -- built; position keeps
                -- the order channels were added in
map_removals    center_channel FK, channel_id, removed_at             -- built; the owner's
                -- "not a competitor" choices, kept across new maps of the same centre
map_keeps       center_channel FK, channel_id, kept_at                -- built; the owner's
                -- "keep as a competitor" choices; a channel is never in both tables
niche_watchlist channel_id PK FK, watched_at                          -- built; channels the
                -- owner marked on "New niches to watch"; not tied to any map
                (source crawl|search|manual and judged relevance: planned)
refresh_runs    id PK, started_at, finished_at, refreshed, failed,    -- built; one row per
                stopped_early                  -- finished refresh, whoever started it
work_leases     name PK, owner, expires_at        -- built; the right to read YouTube,
                -- held by one piece of work at a time across every program
```

There is no HTTP cache table; freshness is decided from `fetched_at` (a channel
younger than 24 hours is served from the store with no request).

**Not built.** The original plan had `topic_runs`, `topics`, `topic_titles` and
`fact_claims` for a topic writer that stored its runs. Video ideas now come from
Claude on demand (see "Ask Claude") and are not stored.

`video_snapshots` exists so that true views-per-day can be computed once a video
has been seen twice. That data calibrates the age ramp below and replaces the
"views on recent uploads" proxy for 30-day views.

A re-read adds a row to `video_snapshots` each time, so view history builds up.
Channels, videos and recommendation edges are updated in place: only the latest
reading of each is kept (`edge_crawls` records when a channel's edges were last
read).

### Keeping the store safe

- **Backup before upgrade.** When an existing store with data has pending
  migrations, a dated copy (`<name>.backup-v<version>-<UTC time>.db`, written with
  `VACUUM INTO`) is made first; if the copy fails, nothing is migrated. `npm run
backup` makes one on demand.
- **One reader of YouTube at a time, across processes.** A crawl, a refresh and a
  keyword search each take the `work_leases` row before starting, whether they run
  in the web server, the connector or the command line. The lease is renewed every
  30 seconds while work runs and expires after two minutes, so a process that died
  does not block the next one. Inside the server the same rule is the job slot.
- **Channels that are gone.** A read that fails is counted on the channel. The
  refresh waits 20 hours before trying it again, doubling up to 14 days, and puts
  failed channels last, so a deleted channel cannot starve the rest.

## Algorithms

### Outlier score

```
score(v)    = v.views / (baseline(v) * ramp(age_days(v)))
baseline(v) = median views of the channel's other long-form videos
              published in the last 90 days
ramp(t)     = 1 - exp(-(t + 1) / 4.5)        # 0.20 at day 0, 0.83 at day 7, ~1 by day 21
```

The 90-day window and the ramp constant were chosen by a grid search against the
scores in Makina's export: mean error 8% across eight channels, 2 to 5% on most.
An earlier draft (median of videos older than 14 days) matched one channel and
missed the others by 23 to 46%. Once `video_snapshots` has data, refit the ramp
from real view growth. Implemented in `packages/core/src/scoring/outlier.ts`.

Guards:

- If fewer than 3 other videos fall inside 90 days, compare against the 10 most
  recent others instead.
- No score if there are still fewer than 3 to compare against, or if their median
  is zero (`null`, shown as "new").
- Cap displayed scores at 9,999× and show the baseline beside any score above 500×,
  since tiny baselines produce absurd multiples. (Display rule; not built yet.)

### Evidence beside a score

A score alone misleads: 800× on a channel whose usual video gets 300 views is a
different thing from 60× on one that usually gets 7,000. Every breakout therefore
carries what it rests on:

- `baseline`: the channel's usual views (the median the score divides by)
- `sampleSize`: how many other videos that median was taken from
- `channelHits` / `channelScored`: of the channel's scored videos from the last 90
  days, how many scored 2× or more
- `channelAgeDays`: days since its oldest video, or null when the fetch hit the
  100-video cap and older ones may exist
- `caution`: `few-videos` when `sampleSize` is under 5, else `low-baseline` when the
  usual is under 500 views, else null

### Rising channels

A channel is "rising" when its first long-form upload is under 90 days old and
either its views on uploads from the last 30 days exceed 20× its subscriber count,
or it has two or more videos above 10×.

### Closeness tiers

| Tier   | Rule                                                                              |
| ------ | --------------------------------------------------------------------------------- |
| Close  | 1 step from centre with share ≥ 50%, or mutual recommendation, or relevance ≥ 0.8 |
| Medium | 1 step otherwise, or 2 steps with two or more inbound edges, or relevance ≥ 0.5   |
| Far    | Everything else that passes the relevance floor                                   |

Built so far: the rows for distance, share, mutual recommendation and inbound
edges. The relevance thresholds in this table arrive with the judged pass in
phase 4; until then the map shows a title-similarity "match" score and filters
nothing out.

### Peers ("channels like yours")

Built. A channel on the map counts as a peer of the centre when all of these hold;
otherwise it is kept but marked with the first reason it failed:

| Check           | Rule                                                                  | Reason shown               |
| --------------- | --------------------------------------------------------------------- | -------------------------- |
| Size            | At most 20× the reference's subscribers, never under 150K nor over 1M | Far larger                 |
| Publishing rate | At most 14 uploads a week over the last 14 days                       | Publishes many times a day |
| Video length    | Median within 0.4× to 4× of the centre's                              | Very different length      |
| Titles          | Anchored title match of at least 14%                                  | Titles unlike yours        |

**Title match** (`packages/core/src/map/relevance.ts`). The reference is the model
channel when the owner named one, otherwise the centre. A title is a format plus a
subject: "America's New Invention Could Replace … Forever" plus "Car Mirrors".
Look-alikes share the format and cover different subjects, so the two sides are
weighted differently:

```
profile(w)   = share of the reference's titles that use word w      # 0..1, format
candidate(w) = 1 + ln(times the candidate's 30 newest titles use w)  # damped
rarity(w)    = ln((channels + 1) / (channels using w + 1)) + 1       # over this map
match        = cosine(profile × rarity, candidate × rarity)          # 0..~1
```

- The profile is linear in the share. A word in half of the reference's titles is
  format; a word in one of a hundred is one video's subject and counts for almost
  nothing. With damped counts on this side too (the first version), a word used 18
  times weighed under twice a word used four times, and channels that merely touched
  the same subjects (aircraft, Tesla, batteries) matched as well as real look-alikes.
- The candidate stays damped. It may have only a handful of titles, too few to tell
  its format from its subjects; and with linear counts a single word it repeats in
  every title ("America") could carry the whole match.
- Rarity is counted on the map itself, where the niche is over-represented: on the
  285-channel map "America" is used by 80 channels and "new" by 129, so the format's
  commonest words are worth about 2 while a subject used once is worth about 6.
  That is why format has to be told from subject by repetition, not by rarity.
- A channel scored against itself comes out near 1, not exactly 1.

**Anchoring.** The reference alone is too narrow: a new channel has three titles,
and a model channel says "America" where its sister channels say "Britain". A first
pass scores every channel against the reference's own titles; the best three direct
neighbours whose shape fits (never the reference itself) then lend their titles, and
a second pass scores everyone against the merged profile. Each title is one vote,
except that the lent titles together get at most 30 votes, one channel's worth. So
a model with 30 titles keeps half the say, while a three-title centre is led by its
look-alikes.

**What it settles and what it does not.** On the owner's 285-channel map measured
against a model, the format profile took the list from 30 peers to 25: an aviation
news channel (647K), a Tesla commentator (479K), an off-grid home channel and two
how-it-works channels fell from 14-17% to 10-14%, and nothing was added. Outsiders
now thin out below 14% and clear look-alikes start at 18%. The channels near the
line are not settled by titles: a seven-video look-alike sits at 13% beside the
Tesla commentator, and an airline analyst at 15% stays in. Those need the judged
pass or the owner's own add and remove. The cases are pinned in
`packages/core/test/peerFixture.test.ts`, on 40 channels from that map.

Known weak spots: with no model and a three-title centre the first pass picks
look-alikes from very little, and one off-format look-alike can pull its subjects
in (on the 149-channel map without a model, three Tesla and SpaceX commentators
still match at 14-17%); and a look-alike that lent its titles is scored partly
against itself.

Maps are stored as they were when made, so a map frozen before this scoring keeps
its old matches and peers until it is made again.

The web app shows peers by default with a switch to everything, and the breakout
feed lists peers' videos separately so outsiders cannot crowd them out.

### Checked in other niches

A channel is only ever an example; the rules must not be fitted to one. They
were first worked out on one map, then checked on maps centred on small
established channels in unrelated niches (retro technology, companies in
decline, ancient history), with no model channel.

- **What held.** In each niche the look-alikes are the centre's kind of channel
  and channels from other niches stay out. Two of those maps are now permanent
  tests (`packages/core/test/peerOtherNiches.test.ts`), labelled by reading the
  titles, not from the scores.
- **The same weakness everywhere.** Channels that make the same videos in a
  different title format fall just under the line in every niche ("Rolex Is
  (Finally) Getting What They Deserve" beside "Lowe's $84 Billion Empire Is
  Collapsing"). Wording cannot settle those; the same-topic list and Claude's
  reading of it do.
- **A dependence still to remove.** A channel's score depends on which other
  channels are on the map, because the reference borrows titles from the three
  closest look-alikes on that map. Removing half of a map at random changed
  0% to 7% of look-alike decisions across five maps. Counting word rarity over
  the whole store instead of the map made no difference; the borrowing is the
  cause. Letting an established channel rely on its own titles alone made
  decisions stable (under 1% changed) but cost too many look-alikes in niches
  with varied titles (32 down to 4 on one map), so it was not adopted. A rule
  that keeps the look-alikes and removes the dependence is open work.

### The owner's say: keep and remove

Built (`packages/core/src/map/choices.ts`, `POST /api/competitors`). The filter is a
guess, and the owner can see every channel it rejected under "Everything". They can
overrule it both ways, per centre channel:

| Status    | Stored in      | Effect                                                                |
| --------- | -------------- | --------------------------------------------------------------------- |
| `kept`    | `map_keeps`    | Counts as a peer although the filter left it out                      |
| `removed` | `map_removals` | Never counts; its videos leave the breakout feed in both views        |
| `auto`    | neither        | No say: the filter decides. This is how a keep or a removal is undone |

The two choices exclude each other: the repository withdraws one when the other is
made, in one transaction. `POST /api/competitors` takes `{ center, channel, status }`
and accepts only a channel on the centre's latest map, never the centre itself.

Both are applied each time a map is read (`applyOwnerChoices`, called by
`loadMapSnapshot`) and never frozen into it, so a choice made today shows on a map
made last week and on every later map of the same centre. For a kept channel:

- `peer` becomes true and `kept` is true. `outsideReason` stays as the filter gave
  it, so the screen can say "Kept by you. The filter left it out: …".
- The channel list is put back in peers-first order; a kept channel follows the
  filter's own peers.
- Its videos join the peers' half of the breakout feed. A frozen feed keeps only the
  60 strongest outsiders, so on a large map a kept channel's videos are usually not
  in it at all (true of INGENIUM on the owner's 285-channel map). They are therefore
  read from the store as it is now, as the thumbnail board's are, merged with the
  frozen peer videos by score, and cut to the same 60.
- The thumbnail board lists peers from the same snapshot, so it shows the channel too.

Copies frozen before this existed carry no `kept` field; it is filled in on read, as
`removed` is. The snapshot format number is unchanged.

Not built: adding a channel that is not on the map at all (phase 4, "Manual add").

### Same topic, different wording

Built (`packages/core/src/map/sameTopic.ts`, `GET /api/maps/latest/same-topic`). Title
matching compares words, so a channel that covers the centre's subject in its own
words is rejected with `outsideReason: 'titles'` although its size, publishing rate
and video length fit. The owner asked to stay open to those. Whether two sets of
titles say the same thing is a judgement about meaning, so the tool does not make
it: it lists the candidates with the evidence and the owner, or their Claude
through the connector, keeps the ones that belong.

The list is worked out on each request from the map as the owner sees it
(`loadMapSnapshot`, so their keeps and removals are applied) and the videos in the
store. Nothing is added to the frozen snapshot and the peer rules are untouched.

| Field           | Holds                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `channels`      | Left out on titles alone, neither kept nor removed, strongest title match first                    |
| `kept`          | `{ id, title }` of channels left out on titles that the owner kept, so the keep can be undone here |
| `otherAlphabet` | How many were left out of `channels` for being written in another alphabet than the centre         |
| `minTitleMatch` | `PEER_MIN_TITLE_MATCH`, the match a channel needs without the owner's say                          |

```
SameTopicList { mapId, centerId, minTitleMatch, otherAlphabet,
  kept [{ id, title }],
  channels [{ id, title, handle, subscribers, titleMatch, recentViews, recentUploads,
              breakout: { videoId, title, views, score } | null,
              recentTitles: [{ videoId, title, views, publishedRaw }] }] }
```

`recentTitles` are the channel's four newest stored videos (`SAME_TOPIC_TITLES_SHOWN`):
what it is publishing now is what shows its subject.

A channel whose 30 newest titles are under 80% Latin letters is left out when the
centre's own titles are Latin (the niche list's `latinShare` check): its titles miss
because of the language, and the owner cannot weigh them. They are counted, not
hidden silently. When the centre is not written in Latin letters, or has no stored
titles, nobody is left out. A removed channel is not listed either: the owner has
already said no.

The screen shows six at a time with "Show more", each with a one-press "Keep as
competitor" that calls `POST /api/competitors` with `status: 'kept'`; the kept ones
move to a "Kept by you" row with Undo (`status: 'auto'`). On the owner's
285-channel map 122 channels were left out on titles alone: 106 are listed and 16
are in another alphabet.

### Model channel

A new channel has too few videos to describe itself: three titles and whatever
YouTube happens to show beside them. The owner can therefore name a model
channel, one they want to be like.

- The crawl reads the model, adds it to the map at step 1 and explores outwards
  from it at the first step alongside the centre, whatever the depth.
- Shape checks (video length) and title matching use the model's videos as the
  reference instead of the centre's. The model itself always counts as a peer, and
  is never one of the look-alikes that lend it titles.
- The model is stored on the map (`maps.model_channel`) and shown in the snapshot
  as `model`, so a reopened map says what it was measured against.

### Thumbnail board

Built (`packages/core/src/map/thumbnails.ts`, `GET /api/maps/latest/thumbnails?channel=`).
The owner asked which thumbnails work on channels like theirs and which to copy. This
first version shows the pictures and leaves the judgement to the owner's eyes; no
image is read, downloaded or stored. The browser loads each thumbnail from YouTube by
video id.

For each peer the owner has not removed, in the map's own order (closest title match
first):

| List     | Rule                                                         | Order           | Shown |
| -------- | ------------------------------------------------------------ | --------------- | ----- |
| Winners  | Outlier score of 2× or more, from all stored videos          | Strongest first | 6     |
| Ordinary | Score of 1.2× or less, and published at least three days ago | Newest first    | 6     |

Videos between 1.2× and 2× are in neither list, and a video under three days old is
never called ordinary: its score is already adjusted for age, but so early it is
mostly noise. The centre's own six newest videos are listed too, with scores where
there are enough videos to score them. Each channel also carries `winnerCount` and
`scoredCount` over all its stored videos, so "12 of 38 took off" is not limited to
the six shown.

```
ThumbnailBoard { mapId, winnerMinScore, ordinaryMaxScore,
  center   { id, title, subscribers, videos: BoardVideo[] },
  channels [{ id, title, subscribers, winners: BoardVideo[], ordinary: BoardVideo[],
              winnerCount, scoredCount }] }
BoardVideo { videoId, title, views, score, publishedRaw, ageDays, durationSeconds }
```

Which channels are peers comes from the map as the owner sees it (`loadMapSnapshot`:
frozen when made, less their removals, plus the channels they kept). The videos and scores are read from the store
at request time. The board is therefore not part of the frozen snapshot, whose shape
is unchanged; after a later crawl refreshes a channel's videos, the board shows the
newer numbers while the frozen breakout feed does not.

Next step: have a model look at the same videos by `videoId` and say what the winners
share that the ordinary ones lack. The board's ids, scores and titles are the evidence
pack for that call.

### New niches to watch

Built (`packages/core/src/niches/`, `GET /api/niches`, `POST /api/niches/watch`). A
crawl reads hundreds of channels and a map shows only the ones like the centre. The
owner asked that a new or small channel with a video that outperforms be kept as a
possible niche, so this list goes through every stored channel, whichever map read it.

A channel is listed when all of these hold:

| Check                | Rule                                                                                                                                                                                                                          | Constant                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| New or small         | First stored upload within 90 days and the whole channel was read (under the 100-video cap), or 10,000 subscribers or fewer at any age. A hidden count cannot be shown to be small, so such a channel is listed only when new | `NICHE_NEW_MAX_AGE_DAYS`, `NICHE_SMALL_MAX_SUBSCRIBERS`                              |
| Outperforms          | At least one video from the last 30 days with 10,000 views or more that is either 5× the channel's usual views (outlier score) or seen by 10× its subscribers                                                                 | `NICHE_MIN_VIDEO_VIEWS`, `NICHE_MIN_OUTLIER_SCORE`, `NICHE_MIN_VIEWS_PER_SUBSCRIBER` |
| Not large            | 100,000 subscribers or fewer, new or not                                                                                                                                                                                      | `NICHE_MAX_SUBSCRIBERS`                                                              |
| Makes its own videos | At most 14 uploads a week, and a median length of an hour or less                                                                                                                                                             | `NICHE_MAX_UPLOADS_PER_WEEK`, `NICHE_MAX_MEDIAN_DURATION_SECONDS`                    |
| Readable             | At least 80% of the letters in its 30 newest titles are Latin                                                                                                                                                                 | `NICHE_MIN_LATIN_SHARE`                                                              |
| Not the owner's      | Never a channel a map was made around                                                                                                                                                                                         |                                                                                      |

Why these numbers:

- "New" is measured from the first upload, not the account's creation date: accounts
  are often years older than the channel that restarted on them.
- 10,000 is the line the breakout feed already calls small. Below it a channel cannot
  carry a video on its subscribers, so one that takes off did so on topic and
  packaging. 100,000 is where YouTube stops calling a channel small; a channel under
  90 days old past it is an established brand's new outlet (Fox News Clips: 876,000).
- The view floor is the answer to tiny baselines: 800× on a channel that usually gets
  a dozen views, or 300 views on a channel with one subscriber, is a few hundred
  people. 5× sits between the feed's 2×, which a good week reaches, and the rising
  rule's 10× twice over. The 10× subscribers path also catches a channel with too few
  videos to score.
- The Latin-letter share tells alphabets apart, not languages: a channel in Spanish
  passes. On the owner's store listed channels score 0.96 or more and the rest 0.73
  or less. No language detector was added.

Each entry carries why it is listed (`reasons`: `new`, `small` or both), up to three
outperforming videos as `BoardVideo`s (so the screen shows the thumbnails that took
off), the hit rate over scored videos from the last 90 days (a one-off against a
pattern), views and uploads from the last 30 days, views per subscriber, days since
the first upload when the whole channel was read, and its three most viewed recent
titles. The order is views on the last 30 days' uploads, most first: the niche with
the most proven demand leads. Views per subscriber would put a channel with one
subscriber and 300 views on top.

```
NicheList { channelsChecked, smallMaxSubscribers, newMaxAgeDays,
  channels [{ id, title, handle, subscribers, recentViews, recentUploads,
              viewsPerSubscriber, channelAgeDays, reasons: ('new'|'small')[],
              outperformers: BoardVideo[], hitCount, scoredCount,
              sampleTitles: [{ videoId, title, views }], qualifies, watched,
              earnings, growth: { views, days, since } | null,
              createdAt: string | null, country: string | null }] }
```

The owner can mark a channel as watched (`niche_watchlist`, one row per channel, no
map involved). A watched channel stays on the list after it stops qualifying, with
`qualifies: false`. `POST /api/niches/watch` takes `{ channel, watched }`, accepts
only a well-formed channel id of a stored channel (404 otherwise), and goes through
the same Host, Origin, content-type and size checks as every other write.

On the owner's 286-channel store the list holds 55 channels: 45 new and 10 small
ones that are older. It is computed on each request (about 0.2 s there) and is not
frozen with any map.

Not built: a model's reading of what the listed channels have in common, and a
language check beyond the alphabet.

### Filling a limited map

A map holds at most `maxChannels` channels (150 by default; the screen offers 150,
300 and 600, the API 10 to 600) and follows 1 to 3 steps. From the second step on
there are usually more candidates than places. Each recommendation is therefore
weighted by its source: `share × (0.25 + titleMatch(source, reference))`, where the
reference is the model channel or, without one, the centre, and `titleMatch` is the
unanchored title match described under Peers. Channels recommended by look-alikes
are read first; the rest are reported as left out.

### Keyword discovery

The crawl reaches only what YouTube recommends beside known channels. With the
owner's API key (`YOUTUBE_API_KEY` in `.env`), `POST /api/niches/discover
{keyword}` asks the official search for the most-viewed videos on a subject from
the last 90 days (one page of 50; 100 units of the key's 10,000 daily allowance),
ranks the channels behind them by how many of those videos are theirs, and reads
up to 25 into the store through the usual ingest. The niche list then judges
them like any other channel. One search runs at a time; without a key the route
answers 400 and the screen explains how to add one. The key is sent in a header,
never in an address, and is stripped from error text.

### Refresh and measured growth

Built (`packages/core/src/refresh/refresh.ts`, `packages/core/src/niches/growth.ts`,
`POST /api/refresh`, `GET /api/refresh`, `npm run refresh`). A channel is otherwise
read only when a crawl or a search touches it, so `video_snapshots` held one reading
per video and nothing could be measured. A refresh reads stored channels again
through `ingestChannel` with `refresh`, which stores a new reading for every video.

Which channels a run reads (`pickStalest`):

| Rule      | Value                                                                                                                                                                                          | Constant                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Due       | Last read 20 hours ago or more. Growth is read off daily readings; more often adds requests and no information. Twenty, not twenty-four, so a daily run that starts early still finds them due | `REFRESH_MIN_AGE_HOURS`            |
| Priority  | Watched channels, channels on the niche list, and each map's centre and look-alikes (the filter's and the owner's kept ones, less removed) go before the rest                                  | `refreshPriorityIds`               |
| Order     | Within each group, read longest ago first                                                                                                                                                      |                                    |
| Size      | 50 channels a run (1 to 500), read one at a time through the shared rate limiter                                                                                                               | `DEFAULT_REFRESH_MAX_CHANNELS`     |
| Giving up | Five failures in a row end the run; the rest stay due. One channel that cannot be read is reported and skipped                                                                                 | `REFRESH_MAX_CONSECUTIVE_FAILURES` |

Because a channel just read is no longer due, the priority group cannot starve the
rest: once it has been read today the next run moves on. Each finished run is
written to `refresh_runs`, so the screen can say when the last one was whether the
button, the timer or the command line started it.

Three ways in, one code path:

- `npm run refresh [-- --max N]` on the command line.
- `POST /api/refresh {maxChannels?}` starts it as a background job in the same
  `JobStore` as crawls and answers `202 {jobId}`; the job is polled at
  `/api/jobs/:id` and reports `{stage: 'refreshing', done, total}`. One job runs at
  a time across both kinds: a second refresh, or a new map, gets 409.
  `GET /api/refresh` answers `{last, channels, due, oldestReadAt, everyHours,
running, jobId}` from the store, so a page opened mid-run picks the job up.
- `JGTUBE_REFRESH_HOURS` (1 to 168, off by default) makes the server process start a
  refresh every that many hours by calling its own `POST /api/refresh`
  (`packages/server/src/schedule.ts`). The first turn is a minute after start; when
  a map is being made at its turn it tries again in 15 minutes.

The niche list then carries `growth` on each listed channel (`viewsGained`): of the
channel's readings from the last 30 days, the latest views of each video minus its
views at the channel's earliest reading. A video first seen after that reading
counts in full (it did not exist then); one seen only at it counts nothing; a count
that fell counts as zero. It is null until the channel has been read twice in the
window. The card shows it as "Gained 12.4K views in 3 days · measured", beside the
estimate, which stays: `recentViews` is views on recent uploads, `growth` is views
gained on everything, over however long the readings span.

```
growth: { views, days, since } | null
```

Not built: a views-per-day chart, and using the readings to calibrate the age ramp.

### Exact channel dates

Built (`packages/core/src/niches/facts.ts`, `packages/core/src/repos/sqliteFactsRepo.ts`).
The web pages do not show when a channel account was created, and "first upload" is
only the oldest video Jgtube has read. The official API gives the exact creation
date, the country the owner set and the total views, fifty channels per request at
one unit of the key's daily allowance (`fetchChannelFacts`).

- They are kept in four columns of `channels` (migration 7) that the web ingest
  never writes, so reading a channel again leaves them alone.
- `fillNicheFacts` asks only about channels on the niche list that have never been
  asked about, at most 200 at a time, and notes every channel asked, so one the API
  does not know is not asked about on every run.
- It runs after a refresh (button, timer or command line) and after a keyword
  search. Opening the page never calls the API: `GET /api/niches` reads stored
  columns only.
- Without `YOUTUBE_API_KEY` it is skipped and nothing is said. A refusal (allowance
  used up, no connection) does not fail the refresh or the search it follows: it
  comes back as `factsProblem` beside `factsAdded` in the refresh outcome and the
  search summary, with paths and control characters removed, and the channels are
  asked about again next time.

Each niche entry carries `createdAt` (ISO-8601 or null) and `country` (two letters or
null). The card says "Account from 2018, restarted 2 months ago" when the account is
more than 60 days older than the first upload and the whole channel was read,
"First upload about 2 months ago" otherwise, and the account's year alone when the
first upload is not known; the country's English name follows when it is one.

"New" on the niche list is still measured from the first upload, not from
`createdAt`: an old account that restarted is new as a channel, which is what the
owner is looking for.

### Earnings range

Each niche channel carries `earnings`: the views on its uploads of the last 30
days valued at $2-8 per 1,000 for long videos and $0.10-0.50 per 1,000 for
Shorts (60 seconds or less), in whole dollars, with `belowAdThreshold` set under
1,000 subscribers. It is a rule of thumb for comparing channels. The tool cannot
see whether a channel is monetised or where its viewers live.

### Relevance filter

The crawl alone is too noisy for small channels, so every candidate gets a
relevance score in two passes:

1. **Cheap pass (code).** Built as the title match and shape checks under "Peers"
   above; it marks channels rather than dropping them. Still to add: same language.
2. **Judged pass (model).** For the remaining candidates, one batched call: given
   the centre's titles and 15 titles per candidate, return
   `{ channel_id, same_audience: yes|maybe|no, reason }`. Map to 1.0 / 0.5 / 0.

Candidates under 0.5 are hidden by default and shown in a "filtered out" list the
user can restore from.

### Search-based discovery

Extract the centre's recurring title frames (for example "America Just …",
"… Could Replace … Forever") as n-grams that appear in at least a third of its
titles, or from its best competitors if it has under 10 videos. Search YouTube for
each frame, collect channels with two or more hits, and feed them into the
relevance filter with `source = search`.

### View range for a topic

Take the videos cited as evidence for the topic, keep those from channels within
0.2× to 5× of the centre's subscriber count, and report the 25th to 75th percentile
of their views with the sample size. If fewer than four such videos exist, show
"not enough peer data" instead of a range.

## Topic writer contract

Input is an **evidence pack** built by code, never raw crawl output:

```
center:      { id, title, subscribers, videos: [{ id, title, views, age_days, score }] }
competitors: [{ id, title, subscribers, tier, rising,
                top: [{ id, title, views, age_days, score }] }]   # top 15 by score, last 60 days
dying:       [{ id, title, score }]                               # lowest scores, for "avoid"
title_frames:[{ frame, examples: [video_id], median_score }]
```

Output is validated against this schema (structured outputs):

```
memo:   { channel_state, niche, breaking_out: [{ theme, video_ids }],
          psychology, title_identity, projections }
topics: [{ name, score: 1..10, rationale, evidence_video_ids: [id],
           titles: [{ text, borrowed_from_video_id?, off_format: bool }],
           claims: [string] }]            # exactly 5 topics, 10 titles each
```

Rules enforced in code after the call:

- Every id in the output must exist in the evidence pack, or the run is retried once
  and then failed.
- The model never outputs view counts, subscriber counts or multiples. The UI
  renders those from stored rows by id.
- `views_low` / `views_high` are computed by code, not the model.
- If the centre has fewer than 5 scored videos, the prompt switches to cold-start
  mode: topics come from competitor breakouts only and the memo says so.

Model: `claude-opus-5-5`, adaptive thinking, streaming. Check `stop_reason` before
reading content. Follow the current SDK docs for structured outputs and server
tools at implementation time rather than this document.

### Novelty check

For each topic, search YouTube for its name and its first title. Classify the
nearest result by title similarity: `covered` (a near-duplicate exists),
`adjacent`, or `new`. Store the nearest video so the UI can show it and its score.

### Fact check

One call per run with the web search tool: for each topic's `claims`, return a
verdict and a source URL. Unverified claims are flagged on the card; titles that
depend on a `wrong` claim are hidden by default.

## MCP tools

Built as `packages/mcp`: a Model Context Protocol server over stdio
(`@modelcontextprotocol/sdk` 1.x), started with `npm run mcp`. It wraps the same
engine as the local API (`createEngine`) and opens the same store, so the owner's
Claude reads what the app shows. Setup for the owner is in
[CONNECTOR.md](CONNECTOR.md).

| Tool                    | Input                                                           | Returns                                                                                                      |
| ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `get_map`               | `channel`, `include_others?`, `limit?` (30)                     | Latest map: centre, model channel, counts, look-alikes (id, title, subs, match, tier, rising, best breakout) |
| `get_breakouts`         | `channel`, `lookalikes_only?` (true), `limit?` (15)             | Recent videos far above usual, with score, views, usual, sample, hit rate, channel age, caution              |
| `get_thumbnail_board`   | `channel`, `channels?` (8), `per_channel?` (4)                  | Per look-alike with a winner: winners and ordinary videos (id, title, views, score); the centre's own videos |
| `view_thumbnails`       | `video_ids` (1 to 8)                                            | The thumbnails as image content, each under a line naming its video; a failed one is a line of text          |
| `get_channel_videos`    | `channel`, `order?`, `limit?` (20)                              | One stored channel's videos with scores (`buildVideoReport`)                                                 |
| `get_near_misses`       | `channel`, `limit?` (25)                                        | Channels left out on titles alone (`outsideReason: 'titles'`, not kept or removed) with five recent titles   |
| `set_competitor_status` | `center`, `channel`, `status` (kept, removed, auto)             | Records the owner's choice (`setCompetitorStatus`) and says whether the channel now counts as a look-alike   |
| `list_niches`           | `limit?` (15), `watched_only?`                                  | New or small channels with a video that took off (`listNiches`)                                              |
| `make_map`              | `channel`, `model?`, `depth?` (1..3), `max_channels?` (10..600) | Crawls a new map, then the same summary as `get_map` plus warnings                                           |

One prompt, `thumbnail_review` (argument `channel`), tells the model to read the
board, look at the owner's thumbnails and the winners with `view_thumbnails`, and
give specific changes.

Rules the tools keep:

- **Channel references** are a handle, a youtube.com URL or a channel id, checked
  with `parseChannelRef` before anything is read. Video ids are checked against
  `VIDEO_ID_PATTERN`.
- **Answers** are one line of JSON with short keys, explained once in each tool's
  description. Absent optional values are left out (no nulls), scores are rounded
  to one decimal, and every list is capped with a count of what was left out
  (`more`, `moreLookalikes`, `moreChannels`).
- **Failures** are a protocol error result (`isError`) holding one plain sentence:
  the first line of the message only, with file paths and control characters
  removed. Input that breaks a rule is refused by the same Zod schema the tool
  list is generated from, with the rule as the message.
- **Thumbnails** are fetched only from `https://i.ytimg.com/vi/<id>/hqdefault.jpg`,
  with redirects refused, a 10 second limit, JPEG only and at most 400 KB each. No
  image is stored.
- **Crawls** run one at a time within the connector. `make_map` sends a progress
  notification for each crawl event when the client asked for progress. A crawl is
  not stopped when the client gives up waiting; the map is stored and `get_map`
  returns it. The connector and the app do not know about each other's crawls.
- **Standard output** carries only the protocol. Diagnostics go to standard error.
- **Store location** is `loadConfig` (`JGTUBE_DB_PATH`, `JGTUBE_REGION`), after
  reading the project folder's `.env` as the app does. A path that is not absolute
  is taken from the project folder, because Claude starts the connector from
  another directory. `get_channel_videos` and the titles in
  `get_near_misses` read through a second connection to the same file (WAL mode),
  since the server's engine does not expose its repositories.

Not built: `suggest_topics` and `find_lanes` (they need the topic writer, phase 5;
until then the model on the other end of the connector does that judging from
`get_breakouts`), a manual add of a competitor, and remote access over HTTP.

## Ask Claude

Built (`packages/server/src/claudeRunner.ts`, `analyses.ts`, `analysisRoutes.ts`,
`POST /api/analyses`). Three fixed analyses can be put to Claude from the page:
`thumbnails`, `topics` and `near-misses`.

- `POST /api/analyses {analysis, channel}` waits for the answer (up to five
  minutes) and returns `{analysis, text}`. One runs at a time (409 otherwise).
  The channel must parse as a handle, link or id, and goes into the question as
  `@handle` or the id, never as typed.
- The server starts Claude Code once (`claude -p --output-format json`) with the
  connector as its only tool server (`--strict-mcp-config`), no built-in tools
  (`--tools ""`), an allow list of the connector's read-only tools,
  `--permission-mode dontAsk`, only project-level settings, a private working
  folder, and `ANTHROPIC_API_KEY` and `YOUTUBE_API_KEY` removed from its
  environment so that the owner's Claude login is used. It is stopped on a
  timeout or runaway output.
- Failures map to a status and a plain message: Claude Code not found 503, a plan
  limit 429, a timeout 504, anything else 502.
- Claude is asked to cite numbers the tools return and not to forecast. Its
  answer is plain text and is rendered as text.
- `set_competitor_status` and `make_map` are never on an analysis's allow list:
  an analysis cannot change stored choices or start a crawl.

## Testing

- **Parsers:** recorded InnerTube payloads as fixtures. Only a large channel is
  recorded; small and empty channel fixtures are still missing.
- **Scoring and matching:** table-driven unit tests, and a regression test built
  from 40 channels of a real map.
- **Crawl, refresh, discovery:** fake `YouTubeSource`, search and facts; asserts
  edges, limits, failure handling and request counts.
- **Server:** each route through `createApp`, and end-to-end tests that run the
  real engine and store against fake sources.
- **Connector:** tool handlers against a fake engine, and a real client connected
  over the SDK's in-memory transport.
- **Claude runner:** a stand-in process; the real command line was checked by hand.
- **Not covered by automated tests:** React components and hooks, the two
  `main.ts` entry points, the refresh timer in a running process, and a real
  Claude Code run. These were exercised by driving the app in a browser.
