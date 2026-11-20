# System design

Data model, algorithms and contracts. Architecture is in `ARCHITECTURE.md`; the
crawl itself is in `CRAWL.md`.

## Data model

Tables marked _built_ exist today (`packages/core/src/db/sqlite.ts`, applied as
numbered migrations tracked in `PRAGMA user_version`). The rest are the plan.

```
channels        id PK (UC…), handle, title, subscribers NULL, subs_hidden,   -- built
                video_count, fetched_at        (language: planned)
videos          id PK, channel_id FK, title, views, duration_s,
                published_at, published_precision (day|week|month|year),
                published_raw ("2w ago"), fetched_at                    -- built
video_snapshots video_id FK, captured_at, views   -- built; PK (video_id, captured_at)
rec_edges       from_channel FK, to_channel FK, sampled, hits, share   -- built
edge_crawls     channel_id PK, region, crawled_at   -- built; latest reading only, no history
maps            id PK, center_channel FK, model_channel NULL, depth, region,  -- built
                created_at,
                snapshot_json   -- the map as it was when made: scores, tiers, peers
map_channels    map_id FK, channel_id FK, steps                       -- built
map_removals    center_channel FK, channel_id, removed_at             -- built; the owner's
                -- "not a competitor" choices, kept across new maps of the same centre
                (source crawl|search|manual and judged relevance: planned)
topic_runs      id PK, map_id FK, status, model, input_tokens, output_tokens,
                started_at, finished_at, memo_json
topics          id PK, run_id FK, rank, name, score, views_low, views_high,
                range_sample_n, rationale_json, nearest_video_id NULL,
                novelty (new|adjacent|covered), starred, hidden
topic_titles    id PK, topic_id FK, position, text, why_json, flags_json,
                starred, hidden
fact_claims     id PK, topic_id FK, claim, verdict (supported|unverified|wrong),
                source_url NULL
```

Built so far: `channels`, `videos` and `video_snapshots`. There is no HTTP cache
table; freshness is decided from `fetched_at` (a channel younger than 24 hours is
served from the store with no request).

`video_snapshots` exists so that true views-per-day can be computed once a video
has been seen twice. That data calibrates the age ramp below and replaces the
"views on recent uploads" proxy for 30-day views.

Rows are never mutated in place by the pipeline: a re-crawl inserts new edge and
snapshot rows, and derived values are computed from the latest ones.

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
frozen when made, less their removals). The videos and scores are read from the store
at request time. The board is therefore not part of the frozen snapshot, whose shape
is unchanged; after a later crawl refreshes a channel's videos, the board shows the
newer numbers while the frozen breakout feed does not.

Next step: have a model look at the same videos by `videoId` and say what the winners
share that the ordinary ones lack. The board's ids, scores and titles are the evidence
pack for that call.

### Filling a limited map

A map holds at most `maxChannels` channels (150 by default; the screen offers 150,
300 and 600, the API 10 to 600) and follows 1 to 3 steps. From the second step on
there are usually more candidates than places. Each recommendation is therefore
weighted by its source: `share × (0.25 + titleMatch(source, reference))`, where the
reference is the model channel or, without one, the centre, and `titleMatch` is the
unanchored title match described under Peers. Channels recommended by look-alikes
are read first; the rest are reported as left out.

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

All return `{ success, data, error, meta }`.

| Tool               | Input                         | Returns                                                                  |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------ |
| `research_channel` | `handle`, `refresh?`          | Channel summary, its videos with scores, top title frames                |
| `map_niche`        | `handle`, `depth?` (1..2)     | Competitors with tier, relevance, size, best breakout; filtered-out list |
| `set_competitors`  | `map_id`, `remove[]`, `add[]` | Updated competitor list                                                  |
| `suggest_topics`   | `map_id`, `direction?`        | Five topics with titles, evidence, range, novelty; the memo              |
| `get_channel`      | `channel_id`, `sort?`         | One channel's stats and videos (latest, breakouts, popular)              |
| `find_lanes`       | `map_id`                      | Adjacent sub-niches ranked by fit with proof videos                      |

Tool descriptions state what each is for and when to call it. Long tools stream
progress notifications. Outputs are compact JSON with ids, so Claude can follow up
without another crawl.

## Testing

- **Parsers:** recorded InnerTube payloads as fixtures, including the old and new
  list-item shapes and an empty channel.
- **Scoring:** table-driven unit tests; one fixture reproduces scores from the
  Makina export to within 15%.
- **Crawl:** a fake `YouTubeSource` backed by a small graph; asserts edges, shares,
  floors, depth limits and request counts.
- **Topic writer:** a fake `TopicWriter` for pipeline tests; schema and id-integrity
  tests on recorded model output.
- **End to end:** one test runs the full pipeline against fakes and checks the
  envelope. A manual smoke test runs it live against one channel.
