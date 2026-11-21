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
                description NULL, avatar_json, banner_json, keywords_json,   -- built; how the
                links_json, brand_fetched_at NULL   -- channel presents itself: bio, logo and
                -- cover in the sizes offered, keywords, header links; written by every read
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
transfer_saves  idea_key PK, template, saved_at   -- built; ideas the owner saved as
                -- transfer opportunities, kept by the words of their title template
video_transcripts video_id PK, language NULL, auto_generated,   -- built; a video's captions,
                segments_json NULL, fetched_at   -- read once; NULL lines: it had none then
video_details   video_id PK, title NULL, description, tags_json,   -- built; from the official
                duration_s NULL, source (api|web), fetched_at   -- API or the watch page
video_storyboards video_id PK, levels_json, fetched_at   -- built; the sizes of a video's
                -- sprite sheets of frames; an empty list means it has none
video_studies   (video_id, kind) PK, engine, notes,   -- built; what an engine wrote about a
                frame_source NULL, frames_available NULL, studied_at   -- video: kind 'watch'
                -- (seen and heard) or 'frames' (its frames, from 'file' or 'preview')
```

The four `video_` tables (migrations 11 and 12) do not refer to `videos`: a video can be
read by its id before any crawl has stored its channel. Lists are kept as JSON and
checked against a schema again when read; a stored picture address that is not on
its pinned host is dropped.

`videos` has a second index, on `published_at` alone, for reading the recent
videos of every channel at once, which the transfer list does on each read.

There is no HTTP cache table; freshness is decided from `fetched_at` (a channel
younger than 24 hours is served from the store with no request).

Migration 13 adds the idea lab's four tables. `concept_batches` is what one run
of concepts rests on (centre channel, picked video ids, the ids whose opening is
to be modelled, the title format with its text as it read then, the owner's
angle, the length); `concepts` are its concepts (`ON DELETE CASCADE` from the
batch; a twist or a more-like-this names its parent concept); `title_formulas`
are the formulas kept per centre channel and window; `hook_labels` is the name an
engine gave to one video's way of opening, per centre channel. Every read and
write goes through the centre channel id: see "Idea lab, trending formats and
the hook library".

**Not built.** The original plan had `topic_runs`, `topics`, `topic_titles` and
`fact_claims` for a topic writer that stored its runs. The one-press "Video
ideas" answer comes from an AI engine on demand (see "Ask AI") and is not
stored; the idea lab's concepts are.

`video_snapshots` exists so that true views-per-day can be computed once a video
has been seen twice. That data calibrates the age ramp below and replaces the
"views on recent uploads" proxy for 30-day views.

A re-read adds a row to `video_snapshots` each time, so view history builds up.
Channels, videos and recommendation edges are updated in place: only the latest
reading of each is kept (`edge_crawls` records when a channel's edges were last
read).

`breakdown_parts` (migration 13) holds the parts of each channel's breakdown,
one row per channel and part: `channel_id`, `part` (`basis`, `titles`,
`thumbnails`, `scripts`, `picture`, `strategy`, `plan`, `master`), `engine`
(who wrote it; `jgtube` for the part worked out in code), `notes` (the text),
`problem` (why it could not be written, when it could not) and `written_at`. A
new run replaces a row. Like `video_studies` it refers to no other table.

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

### One channel's share of a feed

A channel with a series that is working used to fill the feed: on one map a single
channel held 17 of the 60 look-alike places. A feed now holds at most four videos
per channel (`MAX_BREAKOUTS_PER_CHANNEL`): enough to show a series and not one
lucky video, and a full feed is then at least fifteen channels wide. The limit is
applied after the videos are sorted and before the feed is cut to its length, so
the places it frees go to the next strongest videos of other channels. It is
applied again each time a stored map is read (`applyOwnerChoices`), which only
removes: a feed frozen before the limit existed was already cut to 60, so nothing
is left to fill the gaps with. Maps frozen under the earlier rules (format 3) are
therefore rebuilt from the store when read, which gives them a full feed.

### Rising channels

A channel is "rising" when its first long-form upload is under 90 days old and
either its views on uploads from the last 30 days exceed 20× its subscriber count,
or it has two or more videos above 10×.

### Taken off, rising, and the mix among look-alikes

Built (`packages/core/src/map/mix.ts`). The owner asked that the channels like
theirs be shown as roughly 70% channels that have already taken off and 30% that
are rising. The matching rules (below) decide who is a look-alike and are not
touched; this decides each look-alike's group and the order they are listed in.
Nothing in it reads a title or a subject: every number is about views, uploads
and dates, and it was checked on a map in a niche unlike any fixture.

Each channel on a map is in exactly one group:

| Group       | Rule                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taken-off` | Of its uploads in the last 90 days, 3 or more have 10,000 views or more; together they have 100,000 or more; and that is at least its subscribers |
| `rising`    | Not taken off, and "rising" as above: first upload under 90 days ago and already far above its size                                               |
| `neither`   | The rest. It stays a look-alike                                                                                                                   |

"Taken off" is asked first, so a young channel that already meets the bar has
taken off, and rising is what the owner asked for: new, first signs, small totals
so far.

| Constant                             | Value   | Why                                                                                                                                |
| ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `MIX_TAKEN_OFF_PERCENT`              | 70      | The owner's own number                                                                                                             |
| `TAKEN_OFF_WINDOW_DAYS`              | 90      | The window the niche list judges demand over: one month swings with a single video                                                 |
| `TAKEN_OFF_MIN_VIDEO_VIEWS`          | 10,000  | The floor the niche list sets for a video that means something; under it a few hundred people decide the number                    |
| `TAKEN_OFF_MIN_VIDEOS`               | 3       | One can be luck and two a coincidence; three in three months is a pattern                                                          |
| `TAKEN_OFF_MIN_WINDOW_VIEWS`         | 100,000 | Ten times the floor for one video: three uploads at the floor come to 30,000, so it takes real hits or a body of work              |
| `TAKEN_OFF_MIN_VIEWS_PER_SUBSCRIBER` | 1       | Uploads seen fewer times than the channel has subscribers mean an audience that has stopped watching. A hidden count is not judged |

**The order** (`mixOrder`). Look-alikes are sorted by title match as before, then
the two groups are interleaved so that the first _n_ listed hold `round(0.7 × n)`
that have taken off: never more than one channel away from seven in ten, at any
length (six shown: 4 and 2; twelve: 8 and 4; eighteen: 13 and 5). Each group
keeps its title-match order. When one group runs out the other fills its
places; the channels in neither group follow at the end. If a map does not have
enough of one group, what there is is shown and the actual split is stated.

Where it applies: the channel list of a map (`buildMapView`, so the stored
snapshot, the "Radar benchmarks" list, the thumbnail board's channel order and
`get_map` follow it); each ring of the radar, which shows only its first few
channels and so mixes its own share again (`radarLayout.ts`); and again whenever
a stored map is read (`applyOwnerChoices`), over the look-alikes the owner sees:
a kept channel joins its group, and a removed one is listed after them so that
it holds no place in the mix.

Each channel carries `group`, `ninetyDayViews` and `widelySeenUploads`. The list
and the channel panel label the group, the panel says what it rests on, and the
line under the "Like yours" toggle states the split ("21 like yours: 15 taken
off, 6 rising"). The stored snapshot gained these fields, so its format was
raised to 6 and older copies are rebuilt from the store when read; who is a
look-alike on them is unchanged.

On the map of a small established channel (172 channels, 21 look-alikes) the
split is 15 taken off, 6 rising, none neither; the first twelve listed are 8
and 4.

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
| Still uploading | Its newest stored upload is within the last 45 days                   | No upload in 45 days       |
| Publishing rate | At most 14 uploads a week over the last 14 days                       | Publishes many times a day |
| Video length    | Median within 0.4× to 4× of the centre's                              | Very different length      |
| Titles          | Anchored title match of at least 14%                                  | Titles unlike yours        |

A dormant channel (`PEER_DORMANT_AFTER_DAYS`, 45) is not competing for anyone's
viewers. Six weeks is past any ordinary gap: the slowest channels worth copying
publish monthly, and one missed month still leaves them inside it. A channel with
no stored video is not called dormant, and the owner can still keep a dormant
channel by hand. Frozen maps carry the reasons they were made with, so the
snapshot format was raised to 4 and older copies are rebuilt when read.

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
against itself (on the retro-technology map two direct neighbours that match the
centre's own titles at 10-11% lend theirs and come out at 24% and 46%).

**Settled or not** (`packages/core/src/map/settled.ts`). A call should follow from
the channel and the reference. It does not, quite: the borrowing and the rarity
count both look at the rest of the map, so the same channel can pass on one map
and fail on another. That is measured on every map and shown, not hidden:

```
half k (k = 1..40) = the channels whose hash(k, id) falls in the lower half,
                     plus the model channel when there is one
settled(channel)   = its call (peer or not) on the whole map equals its call
                     on every half it is in
```

- The halves depend on channel ids alone, so a map always gives the same ones.
- Forty halves (`SETTLED_HALVES`): a channel is in about twenty, so a call that
  changes on one half in ten is caught nearly nine times in ten.
- A channel ruled out by size, dormancy, pace or length is always settled; those
  checks look only at it and the reference. So is the model.
- The row, the stored map, the connector (`unsettled: true`, and a count) and the
  channel panel in the app carry the mark. The panel says the call is not a firm
  yes or no and to read the titles; it says nothing once the owner has kept or
  removed the channel.
- The calls themselves did not change. Stored maps gained the field, so the
  snapshot format was raised to 5 and older copies are rebuilt when read.
- Cost: the titles are read into numbered words once and each half is arithmetic
  on arrays; a 285-channel map takes about 0.2 s to view, a 150-channel one 0.08 s.
- The crawl's own use of `titleSimilarity` (which sources to follow) is the same
  function with the same results.

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
- **A dependence that is marked, not removed.** A channel's call depends on
  which other channels are on the map. Removing a random half of a map changed
  this share of the calls for the channels that stayed (forty seeded runs; the
  model channel always stays):

  | Map (channels)                 | Look-alikes | Unsettled: in / out | All calls changed, half / quarter removed | Settled calls changed, half / quarter |
  | ------------------------------ | ----------- | ------------------- | ----------------------------------------- | ------------------------------------- |
  | New inventions, model (285)    | 25          | 4 / 20              | 1.0% / 0.3%                               | 0.1% / 0.0%                           |
  | New inventions, no model (172) | 22          | 6 / 13              | 0.8% / 0.1%                               | 0.1% / 0.0%                           |
  | Companies in decline (175)     | 8           | 1 / 14              | 2.2% / 0.7%                               | 0.0% / 0.0%                           |
  | Ancient history (150)          | 32          | 14 / 15             | 5.2% / 3.4%                               | 0.2% / 0.1%                           |
  | Retro technology (166)         | 15          | 6 / 16              | 4.5% / 1.9%                               | 0.0% / 0.0%                           |

  Two things cause it, not one: which three channels lend their titles, and word
  rarity counted over the map (with no borrowing at all, map rarity alone still
  changed up to 2.6% of calls on the ancient-history map; rarity counted over
  the whole store changed none, but then the calls hang on what else is stored:
  with the store cut down to the map itself, 3.6% of them moved there).

- **Rules tried, and why none was adopted.** Each was measured on all five maps
  and on the three labelled fixtures; the target was at most 1% of calls changed,
  no more than about a tenth fewer look-alikes, and no new wrong ones.
  - _Own titles only, no borrowing._ Stable, but 32 look-alikes become 4 (9 with
    store rarity) on the ancient-history map and 15 become 7 on retro technology.
  - _More lenders with the same capped weight_ (the best 5, 10 or 20), or _every
    channel weighted by its first-pass match_ (or its square or cube). Either
    the many weak matches swamp the profile and outsiders come in (25 becomes
    30-35 on the model map), or the weight falls so fast that it is own titles
    again.
  - _Every shape-fitting channel that passes the line on the reference's own
    titles lends_, rarity from the store. The closest: 28 / 23 / 10 / 33 / 13
    look-alikes, 0.4% / 0.3% / 1.2% / 2.0% / 0.8% of calls changed. It drops
    five wrong look-alikes, adds four the titles had missed and five doubtful
    ones, all near the line. But a
    profile pooled from twenty lenders is diffuse and everything matches it a
    little more: the Tesla commentator and the aviation channel labelled as
    outsiders rise from 11-13% to 15%, over the line, on the fixture and on the
    full map. The labels are right, so the rule is wrong. With map rarity
    it is also unstable again (6.4% on ancient history).
  - _The match against each lender in turn, averaged_, which keeps the profile
    sharp. Outsiders stay out and 0.2-0.7% change on four maps, but look-alikes
    fall to 23 and 11 on the two varied niches (2.7% changed on one) and a
    labelled look-alike is missed.
  - _Iterating to a fixed point._ Drifts: 40 and 22 look-alikes on the varied
    niches, and up to 4.5% of calls still change.
  - _Lenders from the whole store._ Removing channels from a map then changes
    nothing by construction, and the calls on one map change when another map is
    crawled: the dependence moves to the store, it does not go.
  - _A lender not scored against its own titles._ Fixes the 24% and 46% above
    and steadies small maps (2.6% to 0.7% on the 40-channel fixture), but changes
    little on the large ones (5.3% and 3.1% on the varied niches) and drops one
    real three-video look-alike. Worth doing next; it changes calls, so it was
    left out of this step.
    The tension is real: a reference with one strong format needs few, close
    lenders or loud outsiders pass; a niche with varied titles needs many or its
    look-alikes are missed; and few lenders is what makes a call hang on who is
    on the map. On the ancient-history map titles do not separate the groups at
    all between 12% and 19%: history channels and engineering explainers alternate.
- **What was built instead.** The calls stay as they were and each says whether
  it is settled (see "Settled or not" above). A settled call changed in at most
  0.2% of cases on every map, against up to 5.2% for all calls. The unsettled
  ones are a twelfth to a fifth of a map and are what one would expect: look-alikes
  in a sister format (the same videos about Britain or Australia), channels a
  point or two either side of the line, and on the varied niches the mixed band
  just described. `packages/core/test/peerStability.test.ts` pins it on the three
  fixtures: no settled call for a labelled channel changes on any of six seeded
  halves, and the labelled channels that are unsettled are named there (three
  retro-technology look-alikes within two points of the line among them).
- **What the mark does not catch.** A channel that is wrong on every half: the
  two self-scored lenders above are settled, and at least one of them is wrong.

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

### Saved channels

Every map stays in the store when another channel is looked up, so each channel
a map was made for can be opened again without reading YouTube.
`listSavedChannels` (`packages/core/src/map/snapshot.ts`, `GET /api/maps`)
returns them, the most recently mapped first: id, title, handle, subscribers,
logo, when the latest map was made and how many channels it holds. The page
shows them as the "Your channels" row above the radar; choosing one loads its
stored map.

`POST /api/maps/delete {channel}` (a channel id) deletes every map made around
that channel together with the keep and remove choices made for it
(`MapRepo.deleteForCenter`, one transaction). The channels and videos that were
read stay, since the niche list and the transfer ideas draw on them. It is
refused with 409 while a map is being made, and the page asks before sending it.

A stored map gains each channel's logo on every read (`logoUrl` on the centre
and on each channel), from the branding stored when a channel is read; a frozen
copy never holds logos, so a map made before logos were stored shows them once
its channels have been read again.

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
The owner asked which thumbnails work on channels like theirs and which to copy. The
board shows the pictures and leaves the judgement to the owner's eyes: the browser
loads each thumbnail from YouTube by video id. Nothing is saved unless the owner
presses **Download thumbnails** on a channel, which writes that channel's winners and
ordinary thumbnails to disk (see "Downloaders and close reading").

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
- A channel in another alphabet is no longer left out. When under 80% of the
  letters in its 30 newest titles are Latin (`NICHE_MIN_LATIN_SHARE`) it is held to
  the same rule and listed with `otherLanguage: { script }`, the script named from
  the Unicode script of its letters (Cyrillic, Arabic, Devanagari, CJK, Korean and
  so on; null when it is not one of the named ones): an idea that works there may
  not have been made in the owner's language yet. The share tells alphabets apart,
  not languages (a channel in Spanish reads as Latin), and nothing is translated.

Each entry carries why it is listed (`reasons`: `new`, `small` or both), up to three
outperforming videos as `BoardVideo`s (so the screen shows the thumbnails that took
off), the hit rate over scored videos from the last 90 days (a one-off against a
pattern), views and uploads from the last 30 days, views per subscriber, days since
the first upload when the whole channel was read, and its three most viewed recent
titles. Beside the 30-day figures it carries the same over 90 days
(`ninetyDayViews`, `ninetyDayUploads`, `ninetyDayEarnings`; `NICHE_LONG_WINDOW_DAYS`):
the owner judges a niche by three months of uploads, since one month swings with a
single video. The order is views on the last 90 days' uploads, most first, then the
last 30: the niche with the most proven demand leads. Views per subscriber would
put a channel with one subscriber and 300 views on top.

```
NicheList { channelsChecked, smallMaxSubscribers, newMaxAgeDays,
  channels [{ id, title, handle, subscribers, recentViews, recentUploads,
              viewsPerSubscriber, channelAgeDays, reasons: ('new'|'small')[],
              outperformers: BoardVideo[], hitCount, scoredCount,
              sampleTitles: [{ videoId, title, views }], qualifies, watched,
              earnings, ninetyDayViews, ninetyDayUploads, ninetyDayEarnings,
              otherLanguage: { script: string | null } | null,
              growth: { views, days, since } | null,
              createdAt: string | null, country: string | null }] }
```

Each entry also carries `logoUrl`: the channel's stored logo at a size for showing
beside its name, or null until the channel has been read since logos were kept.

The owner can mark a channel as watched (`niche_watchlist`, one row per channel, no
map involved). A watched channel stays on the list after it stops qualifying, with
`qualifies: false`. On the page a watched channel is shown under **Watched** and
nowhere else: the All, New, Small and Other language views hold only what the owner
has not taken up yet, the intro sentence counts what the view on screen shows and
says how many are under Watched, and unwatching brings the channel back. That is the
page's doing (`apps/web/src/lib/niches.ts`): the stored list, the API and the
connector's `list_niches` still return every channel with its `watched` flag. `POST /api/niches/watch` takes `{ channel, watched }`, accepts
only a well-formed channel id of a stored channel (404 otherwise), and goes through
the same Host, Origin, content-type and size checks as every other write.

On the owner's 286-channel store the list holds 55 channels: 45 new and 10 small
ones that are older. It is computed on each request (about 0.2 s there) and is not
frozen with any map.

Not built: a model's reading of what the listed channels have in common, and a
language check beyond the alphabet.

### Niche transfer opportunities

Built (`packages/core/src/transfer/`, `GET /api/transfers`,
`POST /api/transfers/save`, the connector's `list_transfer_opportunities`). The
niche list is a list of channels; it leaves the owner to notice that several of
them are one idea made for different countries. This list goes through the
stored videos of the last 90 days and groups the ones that are the same idea or
the same title format.

It is read for one channel's map at a time. With a mapped channel on screen
(`centerChannelId`), only videos of the channels on that channel's latest map
are compared, and the owner's place is that channel's own (its titles, else its
country) or none: it is never borrowed from another channel's map. A store
that holds several looked-up channels holds several niches, and an idea from
one is not an idea for a channel in another. Only with no mapped channel on
screen is the whole store compared and the place worked out from the map
centres. The "Video ideas" question reads this list and the look-alikes'
breakouts for its channel and nothing store-wide (it no longer reads the niche
list), and is told that other channels in the store are other niches.

Nothing in it is chosen for one channel, one subject or one country. The place
words are a fixed list of every country (keyed by ISO code, which is also what
the official API gives as a channel's country), the adjective for its people where
English has a common one, thirteen regions and twelve US states
(`placeList.ts`). The owner's place is read from data or passed in. Titles that
name no place at all are grouped the same way, and their place is then the
channel's country.

**Template** (`template.ts`). A title is put in lower case, each place word
becomes `{place}` (possessives and plurals included: "Germany's", "Americans")
and each number or sum of money becomes `{n}`. A place counts only when written
with a capital ("turkey" is a bird); "US" only in capitals in a title that is not
all capitals. The template's _words_ are its slots and its words less the short
and common ones, through the same tokenizer the title match uses
(`tokenize` in `map/relevance.ts`).

**Same idea** (`ideas.ts`). Videos whose templates have the same words are one
idea, so the country-swapped copies of a title land together. "Nearly the same"
is the same words with a tag of at most two words in front or behind
("Breaking:", "- must watch"). An idea is listed once two channels have made it.

| Constant               | Value | Why                                                                                    |
| ---------------------- | ----- | -------------------------------------------------------------------------------------- |
| `IDEA_MIN_WORDS`       | 3     | Fewer words besides the slots is a phrase ("{place} news") that unrelated videos share |
| `IDEA_MAX_TAG_WORDS`   | 2     | The room a tag takes; three added words are a clause that can change the subject       |
| `IDEA_MIN_VIDEOS`      | 2     | One video is not an idea that travels                                                  |
| `IDEA_MIN_CHANNELS`    | 2     | One channel repeating itself is not either                                             |
| `TRANSFER_WINDOW_DAYS` | 90    | What the owner counts as "now"; it also bounds the work on a store that keeps growing  |

**Same format** (`formats.ts`). Each idea is filed under every way of blanking a
run of one or two of its words, written `{subject}`. Ideas that land under the
same blanked form share everything but the subject, so
"{place} new invention could make {subject} obsolete forever" collects carbon
fibre, subwoofers and solar panels. Each idea counts in one format: the form with
the most subjects.

| Constant                   | Value | Why                                                                                |
| -------------------------- | ----- | ---------------------------------------------------------------------------------- |
| `FORMAT_MAX_SUBJECT_WORDS` | 2     | A noun or a two-word noun phrase; longer blanks make unrelated titles look alike   |
| `FORMAT_MIN_FIXED_WORDS`   | 3     | The words around the subject must be a phrase of their own, as for an idea         |
| `FORMAT_MIN_SUBJECTS`      | 3     | Two subjects can be one channel trying twice; a third shows the wording is a frame |
| `FORMAT_MIN_CHANNELS`      | 2     | Worth learning from once more than one channel uses it                             |

**The owner's place** (`ownerPlace.ts`). In order: the place passed in
(`?place=`), the channel on screen (`?channel=`), then the channels maps were
made around, the centre of the most recent map deciding a tie. A channel's place
is the place at least half of its titles name first (`OWNER_PLACE_MIN_TITLE_SHARE`
0.5: under a majority the place is one subject among several), else its own
country, else unknown.

**The verdict** (`opportunity.ts`). A version's place is the one its title names
or, failing that, its channel's country. A version is _strong_ when it has
10,000 views or more and is 5x its channel's usual views or was seen by 10x its
subscribers: the niche list's rule for an outperforming video (`beatsItsChannel`)
without its 30-day limit.

| Status     | Meaning                                                                                        | Opportunity |
| ---------- | ---------------------------------------------------------------------------------------------- | ----------- |
| `open`     | A strong version elsewhere, none for the owner's place, every version's place known            | yes         |
| `weak`     | The owner's place has versions, none strong, the best under a tenth of the strongest elsewhere | yes         |
| `done`     | The owner's place has a strong version, or one within a tenth of the strongest elsewhere       | no          |
| `unproven` | No version is strong                                                                           | no          |
| `unplaced` | The owner's place is unknown, or a version that may be the owner's has no known place          | no          |
| `gone`     | A saved idea none of whose videos is recent enough to list                                     | no          |

`TRANSFER_WEAK_MAX_SHARE` is 0.1: channels of different sizes making the same
video ordinarily land within a few times of each other, so ten times less is the
version failing, not the channel being smaller. Opportunities shown to travel
(made for two or more places, `TRAVELLED_MIN_PLACES`) are listed ahead of plain
copies, the biggest winner first.

**What it cannot do.** It cannot tell a synonym from a subject: "Just Detected A
Fuel" and "Just Found A Fuel" are one idea to a reader and "Just Found An Engine"
is another, and all three differ by one word. Titles that differ by a word in the
middle are therefore separate ideas, and an open idea lists the one-word-different
titles made for the owner's place (`variants`, three at most) so the owner or
Claude can judge. It does not translate: a channel in another alphabet is marked
on the niche list instead. And a place slot in a news title ("Trump arrives in
{place}") is not an idea to carry over; such copies are made for one place only
and sort below ideas that have travelled.

**Bounded.** The store hands over only videos published in the last 90 days, as
light rows with what is needed of the channel (`listRecentVideos`, on a new index
on `videos.published_at`). Videos are dropped into buckets by their template's
words and ideas into buckets by their blanked forms; no title is compared with
another, so the work grows with the number of videos. A channel's full video list
is loaded, for its outlier scores, only when it takes part in a listed idea. A
test with 12,000 recent and 4,500 older videos over 300 channels checks that only
the fifty taking part are loaded and that it finishes inside a time no pairwise
comparison could. On a store of 432 channels and 15,092 recent videos it takes
about a second.

```
TransferList { ownerPlace: { key, name, source: 'given'|'titles'|'country' } | null,
  windowDays, videosChecked, ideaCount, opportunityCount, formatCount,
  ideas [{ key, template, opportunity, saved, versionCount, channelCount,
           verdict: { status, winner: Version | null, own: Version | null },
           versions: Version[], best, worst,
           places: [{ key, name, versions, bestViews }],
           variants: [{ videoId, title, channelTitle, views, word }] }],
  formats [{ key, template, subjectCount, channelCount, videoCount, bestViews,
             medianViews, places, subjects: [{ subject, videos, channels,
             bestViews, videoId, title, channelTitle }] }] }
Version { videoId, title, channelId, channelTitle, subscribers,
          place: { key, name, source: 'title'|'channel' } | null,
          views, score, ageDays, durationSeconds, strong }
```

At most 200 ideas, 50 formats, 12 versions an idea and 8 subjects a format are
handed over; the counts cover them all.

**Saved ideas on the page.** An idea the owner saved is shown under **Saved** and
nowhere else: it leaves Opportunities, and its subject leaves the format it belongs
to (a format with no subject left is not shown). Each format subject carries
`ideaKeys`, the ideas behind it, so the page can tell. The intro sentence counts the
opportunities not yet saved and says how many are under Saved; unsaving brings an
idea back. The API and `list_transfer_opportunities` still return every idea with its
`saved` flag.

**Saving.** `POST /api/transfers/save` takes `{ key, saved }`, where the key is the
idea's template words. It goes through the same Host, Origin, content-type and
size checks as `POST /api/niches/watch`, and answers 404 for an idea no recent
video has. A saved idea is kept in `transfer_saves` with its title as it read
then, and stays listed (as `gone`) after its videos have aged out.

### Downloaders and close reading

Built (`packages/core/src/video/`, `channel/`, `downloads/`, `sources/images.ts`,
`sources/videoPage.ts`, `sources/brandMapper.ts`). A breakdown of a niche needs more
than titles and view counts: what a video says, what it shows, how a channel
presents itself, and the descriptions and tags of its videos. Each of these is read
from the store when it is there and from YouTube when it is not, through the shared
rate limiter, and kept. They make a request or two, so they do not take the lease a
crawl or a refresh holds.

**One read of a video's page** (`YouTubeSource.fetchVideoPage`). The player is asked
for one video as the `ANDROID_VR` client, which answers in full when signed out:
description, length, storyboard and caption tracks in one request. (Asked as the web
client, the player answered "The page needs to be reloaded" with neither a storyboard
nor captions, and the library's own transcript call was refused with status 400;
both seen live in November 2026.) When the player will not answer, the watch page
and the library's `getTranscript()` are used instead. Whatever one read returns is
all stored, so a transcript read also saves the description and the storyboard.

| What             | Read from                                                                                                   | Kept in                  | Notes                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transcript       | The caption track of the original audio, from `https://www.youtube.com/api/timedtext` only, as timed JSON   | `video_transcripts`      | Read once. "No captions" is a normal answer, believed for 24 hours (`TRANSCRIPT_NONE_RETRY_HOURS`): automatic captions appear some hours after an upload  |
| Video details    | The official API's `videos.list` with `part=snippet`, fifty ids a request, when a key is set; else the page | `video_details`          | An API refusal falls back to the pages and is reported, not hidden. The API gives no length; one a page gave is kept                                      |
| Frames           | The storyboard: sprite sheets on `i.ytimg.com/sb/…` of small frames at a regular interval                   | `video_storyboards`      | Addresses are signed, so stored ones are used for 6 hours (`STORYBOARD_FRESH_HOURS`), and the page is read again once if every stored sheet fails to load |
| Channel branding | The channel page every ingest already fetches: logo, cover, bio, keywords, the link the header shows        | columns of `channels`    | No extra request. A channel stored before this is read again once when its branding is asked for                                                          |
| Thumbnails       | `https://i.ytimg.com/vi/<id>/maxresdefault.jpg` (1280 by 720), else `sddefault.jpg`, else `hqdefault.jpg`   | files, with `index.json` | `<downloads>/thumbnails/<channel id>/<video id>.jpg`; a file already there is not fetched again                                                           |
| Transcript files | The stored transcript, else one read as above                                                               | files, with `index.json` | `<downloads>/transcripts/<channel id>/<video id>.txt` for the channel's winners (the thumbnail download's), at most six (`TRANSCRIPT_FILES_MAX`)          |

**Frames.** No image-processing library is used: whole sheets are handed over, each
with a caption that says how to read it ("Sheet 1 of 7: a grid 5 across and 5 down,
in order left to right, then top to bottom. 25 frames, one every 10 seconds, from
0:00 to 4:00."). The size used is the widest whose frames are at most 160 pixels
wide (`STORYBOARD_FRAME_WIDTH`): large enough to tell a talking head from a diagram,
and twenty-five to a sheet. The sheets asked for are spread evenly across the video,
both ends included.

**Pictures** (`sources/images.ts`, one implementation for the engine and the
connector). Every picture address is checked before any request: plain https, no
port, no name or password, and one of a short list of hosts. Redirects are refused,
every read has a 10 second limit and a size cap, and a failure is a short reason
with no network detail in it.

| Rule                | Host                        | Kinds           | Cap    |
| ------------------- | --------------------------- | --------------- | ------ |
| Thumbnail           | `i.ytimg.com`               | JPEG            | 400 KB |
| Storyboard sheet    | `i.ytimg.com`, under `/sb/` | JPEG, WebP      | 400 KB |
| Channel logo, cover | `yt3.googleusercontent.com` | JPEG, PNG, WebP | 1 MB   |

`yt3.googleusercontent.com` is the only host seen for channel pictures, in the
recorded fixture and in the live read alike; a picture on any other host is not
stored and not fetched. The page's Content-Security-Policy allows that one host
beside `i.ytimg.com`, for the logo on a niche card.

**Files on disk** (`downloads/folder.ts`). Everything saved besides the store goes
under one folder: `JGTUBE_DOWNLOADS_PATH`, or `downloads` beside the store file.
Paths are built with `node:path` from validated ids, and `pathInside` refuses any
that would land outside the folder.

**A video as a file** (`downloads/videoFile.ts`, `ytDlp.ts`, `builtInVideo.ts`,
`downloadVideo` in core's index). A tool that watches a whole video, sound included,
needs it as a local file. `downloadVideo(video, { root, source })` returns
`{ ok: true, path, bytes, durationSeconds, format, via }` or
`{ ok: false, kind, message, via }` with `kind` one of `not-available`, `too-large`
and `unreadable`.

- **Which file.** The best picture up to 720 lines (`VIDEO_TARGET_HEIGHT`, the
  owner's choice) and never under 240 (`VIDEO_MIN_HEIGHT`). YouTube offers sharp
  pictures apart from their sound, so with ffmpeg found yt-dlp is asked first for
  the best H.264 picture and AAC sound joined into one MP4
  (`--ffmpeg-location`, `--merge-output-format mp4`), then for any picture and
  sound joined, then for one file that holds both (in practice the 360p MP4).
  Without ffmpeg only the last is asked for, and a video with no such file fails
  with a message that says ffmpeg is what is missing. Seen on the owner's
  computer: every video failed as "no single file" until the joined kinds were
  asked for.
- **Size.** A fetched file may be up to 1,000 MB (`MAX_DOWNLOAD_BYTES`). Nothing
  over 95 MB is handed to an engine to watch (`MAX_VIDEO_BYTES`; the tool that
  watches refuses media over 100 MB): a larger file is first made smaller with
  ffmpeg for the watch only (`shrinkVideo.ts`), at the sharpest of 720, 480 or
  360 lines that the size limit can carry cleanly for the video's length
  (`SHRINK_TIERS`), while the frames are cut from the file as fetched. The built-in route decides from the size the
  player reports, before fetching a byte. A file is never cut to fit: the failure
  says about how many minutes would have fitted. At the bitrate seen (a 15:48 video
  listed at 75.2 MB) the limit is about twenty minutes.
- **How.** `yt-dlp` when it is on the PATH: found by looking in the PATH's absolute
  folders (`yt-dlp.exe` on Windows), never by running anything; started without a
  shell, arguments as a list, the video id validated first, output confined to the
  temporary folder. Otherwise, or when yt-dlp cannot read the video, the library's
  own download call on the chosen file. The answer says which was used.
- **yt-dlp's JavaScript runtime.** Since late 2026 yt-dlp warns that reading
  YouTube without a JavaScript runtime is deprecated, and looks only for deno. It
  is started with `--js-runtimes node:<the Node running Jgtube>` as one argument;
  a yt-dlp too old to know the option ("no such option") is started once more
  without it.
- **A video id that begins with a dash** reaches yt-dlp only as the value of
  `--output` and inside a full link after `--`; it never reaches ffmpeg or an
  engine except inside an absolute path or a link.
- **Refused by YouTube.** A fourth kind of failure, `refused`: YouTube turned
  this computer away whatever the video (yt-dlp's "confirm you're not a bot",
  403 and 429; the built-in route's non-2xx answer). It is said in plain words,
  the other route is still tried, and when both fail the refusal is the answer
  kept.
- **Housekeeping.** Files go to `<downloads>/video-temp/`. A copy fetched for the
  server (`videoCopies.ts`) comes with the way to remove it: the watcher calls
  it when the watch is over, however it ended, a breakdown when the video's
  steps are done, and any copy still on disk when the engine closes is removed
  then. Files older than a day are cleared before each download. A signal stops
  a running yt-dlp when Jgtube closes.
- **What was seen live.** The player listed the file, and YouTube's video servers
  then answered 403 to the built-in route, by address and by range alike; yt-dlp
  was refused from the same network with "confirm you're not a bot". So no file
  has been confirmed to arrive by either route.

Downloading a video is outside YouTube's terms of service, as reading its pages
this way is. The copy is temporary and stays on the owner's computer.

**Routes and commands.** `POST /api/thumbnails/download {channel}` (a channel id of
a stored channel; 404 otherwise) saves that channel's thumbnails and answers
`{channel, folder, indexFile, total, saved, alreadyThere, failed}`, through the same
Host, Origin, content-type and size checks as every other write.
`POST /api/transcripts/download {channel}` does the same for the transcripts of its
winners and answers `{channel, folder, indexFile, saved, noCaptions, failed}`. On
the command line: `transcript <video>`, `transcripts <channel>`,
`thumbnails <channel> [--per-group N]`, `brand <channel>` and `video <video>`.
`npm run engines` also says whether yt-dlp and ffmpeg are found.

Saved files go into a folder named after the channel
(`channelFolderName`: the title without the characters a file system refuses,
at most 80 characters; the channel id when nothing usable is left or the name
is one Windows keeps). When a folder of that name already belongs to another
channel, which its `index.json` says, the channel id is added in brackets.
Thumbnails saved to disk are the largest size YouTube has for the video; the
pictures shown to a model through `view_thumbnails` stay the small ones.

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
see whether a channel is monetised or where its viewers live. The same is worked
out for the uploads of the last 90 days.

One rate for every channel overstates those whose audience is outside the
highest-paying countries, so the long-video rate is scaled by a tier for the
channel's country when the official API has given one (`rateTierFor`,
`RATE_TIER_MULTIPLIER`). The tiers are rough rules of thumb, not measurements:

| Tier        | Countries                                                                     | Share of the rate |
| ----------- | ----------------------------------------------------------------------------- | ----------------- |
| `top`       | US, CA, GB, AU, DE, NZ, IE, CH, NO, SE, DK, NL, AT                            | 1.0               |
| `developed` | The rest of Europe; JP, KR, SG, HK, TW, IL, AE, QA, KW, SA                    | 0.5               |
| `emerging`  | Every other country: most of Africa, South Asia, Latin America, the Caribbean | 0.2               |
| `unknown`   | No country stored: the top rate is assumed, and the card says so              | 1.0               |

The Shorts rate is not scaled. The estimate carries `rateTier` (`id`, `multiplier`,
`country`) and the niche card says which was used. The country is where the channel
is run from, which is only often where its viewers are: a channel run from a lower
tier that makes videos for a top-tier audience is under-counted.

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

| Tool                          | Input                                                                                   | Returns                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_map`                     | `channel`, `include_others?`, `limit?` (30)                                             | Latest map: centre, model channel, counts, look-alikes (id, title, subs, match, tier, rising, best breakout)                                                                                                                                                         |
| `get_breakouts`               | `channel`, `lookalikes_only?` (true), `limit?` (15)                                     | Recent videos far above usual, with score, views, usual, sample, hit rate, channel age, caution                                                                                                                                                                      |
| `get_thumbnail_board`         | `channel`, `channels?` (8), `per_channel?` (4)                                          | Per look-alike with a winner: winners and ordinary videos (id, title, views, score); the centre's own videos                                                                                                                                                         |
| `view_thumbnails`             | `video_ids` (1 to 8)                                                                    | The thumbnails as image content, each under a line naming its video; a failed one is a line of text                                                                                                                                                                  |
| `get_channel_videos`          | `channel`, `order?`, `limit?` (20)                                                      | One stored channel's videos with scores (`buildVideoReport`)                                                                                                                                                                                                         |
| `get_near_misses`             | `channel`, `limit?` (25)                                                                | Channels left out on titles alone (`outsideReason: 'titles'`, not kept or removed) with five recent titles                                                                                                                                                           |
| `set_competitor_status`       | `center`, `channel`, `status` (kept, removed, auto)                                     | Records the owner's choice (`setCompetitorStatus`) and says whether the channel now counts as a look-alike                                                                                                                                                           |
| `list_niches`                 | `limit?` (15), `watched_only?`                                                          | New or small channels with a video that took off (`listNiches`)                                                                                                                                                                                                      |
| `list_transfer_opportunities` | `channel?`, `place?`, `show?` (opportunities, formats, saved, all), `limit?` (10)       | Ideas open or weak for the owner's place with up to five versions each, or the title formats (`listTransfers`)                                                                                                                                                       |
| `make_map`                    | `channel`, `model?`, `depth?` (1..3), `max_channels?` (10..600)                         | Crawls a new map, then the same summary as `get_map` plus warnings                                                                                                                                                                                                   |
| `get_transcript`              | `video` (id or link), `start_seconds?`, `max_chars?` (12,000; 1,000..40,000)            | A line of JSON (`lang`, `auto`, `lines`, `lastLineAt`, `cut`), then the captions as text with the time every half minute; `captions: false` when there are none                                                                                                      |
| `view_video_frames`           | `video`, `sheets?` (4; 1..6), `start_sheet?` (from 1)                                   | A line of JSON (`source`, `ofSheets`, `frames`; with `start_sheet` also `from`, `to` and `next.start_sheet` or `last`), then each sheet as image content                                                                                                             |
| `get_channel_brand`           | `channel`, `images?` (true)                                                             | A line of JSON (`bio`, `keywords`, `links`, `logo`, `cover`), then the logo and the cover as image content                                                                                                                                                           |
| `get_video_details`           | `video_ids` (1 to 10), `description_chars?` (1,500; 200..5,000)                         | Per video: title, description, tags, `secs`, views, score; `problems` for a video that could not be read                                                                                                                                                             |
| `get_video_watch`             | `video`                                                                                 | A line of JSON (`watched`, `by`, `at`), then the stored notes of an engine that watched the video; `watched: false` when nobody has                                                                                                                                  |
| `get_frame_study`             | `video`                                                                                 | A line of JSON (`studied`, `by`, `at`, `source`, `framesAvailable`), then the stored study of the video's frames; `studied: false` when there is none                                                                                                                |
| `get_idea_brief`              | `channel`, `batch`                                                                      | What the owner chose for one batch of concepts: `picked`, `length`, `modelOpenings`, `format` (`wording`, `from`); never the angle                                                                                                                                   |
| `get_concept`                 | `channel`, `concept`                                                                    | A line of JSON (`concept`, `batch`, `length`, `restedOn`), then the stored concept in its labelled lines                                                                                                                                                             |
| `get_script`                  | `channel`, `concept`, `part?` (plan, draft, tightened)                                  | A line of JSON (`voice`, `targetSeconds`, `targetWords`, `hookWords`, `modelHooks`, `frameStudies`), then the concept, the chosen hook, the beats and the asked-for text                                                                                             |
| `get_hooks`                   | `channel`, `video_ids?` (1 to 12)                                                       | A line of JSON (`built`, `seconds`, `hooks`, `noWords`), then per hook a line of JSON (`video`, `title`, `score`, `style`, `how`) and its first-minute words                                                                                                         |
| Tool                          | Input                                                                                   | Returns                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_map`                     | `channel`, `include_others?`, `limit?` (30)                                             | Latest map: centre, model channel, counts, look-alikes (id, title, subs, match, tier, rising, best breakout)                                                                                                                                                         |
| `get_breakouts`               | `channel`, `lookalikes_only?` (true), `limit?` (15)                                     | Recent videos far above usual, with score, views, usual, sample, hit rate, channel age, caution                                                                                                                                                                      |
| `get_thumbnail_board`         | `channel`, `channels?` (8), `per_channel?` (4)                                          | Per look-alike with a winner: winners and ordinary videos (id, title, views, score); the centre's own videos                                                                                                                                                         |
| `view_thumbnails`             | `video_ids` (1 to 8)                                                                    | The thumbnails as image content, each under a line naming its video; a failed one is a line of text                                                                                                                                                                  |
| `get_channel_videos`          | `channel`, `order?` (strongest, newest, views), `limit?` (20)                           | One stored channel's videos with scores (`buildVideoReport`)                                                                                                                                                                                                         |
| `get_near_misses`             | `channel`, `limit?` (25)                                                                | Channels left out on titles alone (`outsideReason: 'titles'`, not kept or removed) with five recent titles                                                                                                                                                           |
| `set_competitor_status`       | `center`, `channel`, `status` (kept, removed, auto)                                     | Records the owner's choice (`setCompetitorStatus`) and says whether the channel now counts as a look-alike                                                                                                                                                           |
| `list_niches`                 | `limit?` (15), `watched_only?`                                                          | New or small channels with a video that took off (`listNiches`)                                                                                                                                                                                                      |
| `list_transfer_opportunities` | `channel?`, `place?`, `show?` (opportunities, formats, saved, all), `limit?` (10)       | Ideas open or weak for the owner's place with up to five versions each, or the title formats (`listTransfers`)                                                                                                                                                       |
| `make_map`                    | `channel`, `model?`, `depth?` (1..3), `max_channels?` (10..600)                         | Crawls a new map, then the same summary as `get_map` plus warnings                                                                                                                                                                                                   |
| `get_transcript`              | `video` (id or link), `start_seconds?`, `max_chars?` (12,000; 1,000..40,000)            | A line of JSON (`lang`, `auto`, `lines`, `lastLineAt`, `cut`), then the captions as text with the time every half minute; `captions: false` when there are none                                                                                                      |
| `view_video_frames`           | `video`, `sheets?` (4; 1..6), `start_sheet?` (from 1)                                   | A line of JSON (`source`, `ofSheets`, `frames`; with `start_sheet` also `from`, `to` and `next.start_sheet` or `last`), then each sheet as image content                                                                                                             |
| `get_channel_brand`           | `channel`, `images?` (true)                                                             | A line of JSON (`bio`, `keywords`, `links`, `logo`, `cover`), then the logo and the cover as image content                                                                                                                                                           |
| `get_video_details`           | `video_ids` (1 to 10), `description_chars?` (1,500; 200..5,000)                         | Per video: title, description, tags, `secs`, views, score; `problems` for a video that could not be read                                                                                                                                                             |
| `get_video_watch`             | `video`                                                                                 | A line of JSON (`watched`, `by`, `at`), then the stored notes of an engine that watched the video; `watched: false` when nobody has                                                                                                                                  |
| `get_frame_study`             | `video`                                                                                 | A line of JSON (`studied`, `by`, `at`, `source`, `framesAvailable`, and worked out in code `secs`, `secondsPerFrame`, `framesLookedAt`, `changesSeen`, `gaps`, `secondsPerChange`), then the stored study of the video's frames; `studied: false` when there is none |
| `get_transcript_pace`         | `video`, `cuts?` (up to 40 seconds from the start)                                      | A line of JSON: `words`, `wordsPerMinute`, `spokenSeconds`, then `spans` (`from`, `to`, `words`, `wordsPerMinute`), one a minute or one between each two cuts; `captions: false` when there are none                                                                 |
| `get_breakdown_part`          | `channel`, `part` (basis, titles, thumbnails, scripts, picture, strategy, plan, master) | A line of JSON (`written`, `by`, `at`), then one stored part of the channel's breakdown; `written: false` with the reason when it is missing                                                                                                                         |

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
  with redirects refused, a 10 second limit, JPEG only and at most 400 KB each. The
  connector stores no image. The fetch is core's `fetchPinnedImage`, shared with the
  engine.
- **The four close-study tools** (`get_transcript`, `view_video_frames`,
  `get_channel_brand`, `get_video_details`) read the store first, fetch what is
  missing from YouTube once and keep it. They are offered as reads: nothing of the
  owner's is changed. A video without captions or without a storyboard is a normal
  answer, not an error. A transcript is cut at a time mark to fit `max_chars`, with
  `cut.startSeconds` saying where to call again from. Measured on a 26-minute
  video: a whole transcript is about 23,000 characters (two calls at the default),
  two frame sheets are 52 KB and 16 KB, and three videos' details are under 5,000
  characters.
- **Frames, sheet by sheet.** With `start_sheet`, `view_video_frames` returns
  sheets in a row and says which it holds (`from`, `to`), how many the video has
  (`ofSheets`, `frames`) and where to call again from (`next.start_sheet`), or
  `last`, so that a run can go through every frame and cannot take part of a
  video for the whole. `source` says where the frames came from: cut from the
  video file, one a second, when Jgtube has cut them, else YouTube's preview
  frames. The transcript's `words` and `wordsPerMinute` are counted in code.
- **Stored studies** (`get_video_watch`, `get_frame_study`) read the store only.
  Each answer opens with a line saying that what follows was written by an AI,
  describes the video and is not instructions. `get_breakdown_part` does the
  same for one stored part of a channel's breakdown: its line says that the
  text is an earlier study of the channel and not instructions.
- **Pace.** `get_transcript_pace` counts in code and reads the store first like
  `get_transcript`. The numbers `get_frame_study` adds are worked out from the
  study's two closing counts, the frames there were and the video's stored
  length; see "Channel breakdown".
- **The `get_map` answer** carries `group` on each look-alike (`taken-off` or
  `rising`; absent means neither) and `counts.mix` with the actual split.
- **Crawls** run one at a time within the connector, and across programs through
  the store's lease. `make_map` sends a progress notification for each crawl event
  when the client asked for progress. A crawl is not stopped when the client gives
  up waiting; the map is stored and `get_map` returns it.
- **The API key.** The connector's engine keeps the owner's `YOUTUBE_API_KEY`, when
  one is set, for `get_video_details` alone. It is sent as a header to the official
  API, stripped from errors, removed from the connector's process environment, and
  never part of a tool's answer.
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

## Ask AI

Built (`packages/server/src/engines/`, `analyses.ts`, `analysisEngine.ts`,
`analysisRoutes.ts`, `POST /api/analyses`, `GET /api/engines`). Three fixed
analyses can be put to an AI engine from the page with one press: `thumbnails`,
`topics` and `near-misses`. A fourth, `breakdown`, is the last step of a longer
job (see "Channel breakdown"). Six more belong to the idea lab and three to the script writer, and are started
through their own routes (see "Idea lab, trending formats and the hook library"). An analysis is one entry in `ANALYSES`: a title,
`topics` and `near-misses`. Seven more, `breakdown-titles` to
`breakdown-master`, are the parts of a channel breakdown, written in turn by a
longer job (see "Channel breakdown"). An analysis is one entry in `ANALYSES`: a title,
a fixed question, the read-only tools it may use, a step limit, a time limit
when the usual five minutes are not enough and, when it cannot be left to the
owner's usual order, the engines that may answer it.

### The engine interface

An engine is a program on the owner's computer that answers one question with
Jgtube's tools (`engines/types.ts`):

- **In:** an `EngineRunRequest`: the prompt, a system prompt, the tool server
  to offer, the allowed tool names (`mcp__jgtube__get_map`), a step limit, a
  time limit and a private working folder. The same request goes to any engine.
- **Out:** the answer as text, or an `EngineRunError` with one of five reasons:
  `not-installed`, `not-signed-in`, `limit`, `timeout`, `failed`.
- Every engine also has `check`, which says whether it is installed and signed
  in and its version, by asking the program only about itself.

Shared by all engines (`process.ts`): the owner's API keys are withheld from
the program's environment (`ANTHROPIC_API_KEY`, `CODEX_API_KEY`,
`OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `YOUTUBE_API_KEY`), so the
owner's login is used and no key is billed; the names are matched whatever
their capitalisation, since Windows ignores it. The run is stopped with SIGTERM
and, two seconds later, SIGKILL when it passes its time limit, prints more than
two million characters, or Jgtube is closing, and the failure is reported once
the program has gone, so tidying up its folder does not race it. A program that
exits while something it started holds its output open is given a second, then
its answer is taken as printed. Work folders left by a run cut short are
removed, a day later, the next time an engine is started.

### Choosing and falling back

`JGTUBE_ENGINES` (default `claude,agy,codex`) names the engines Jgtube may use:
the main one first, then its backups. Claude Code is the main engine by the
owner's choice; watching a video is the exception, where Antigravity goes first
whatever the order says. For one analysis the engines are tried in that order
(`engines/fallback.ts`):

- Any failure (`not-installed`, `not-signed-in`, `limit`, `timeout`, `failed`,
  or an error that is not the engine's own) passes the engine over and the next
  is tried. The others are backups, and an engine that hangs or cannot read its
  own reply says nothing about whether the next can answer.
- Jgtube closing ends the whole attempt.
- When no engine answered, the failure lists each one's reason, and its kind is
  the most telling of them: a limit, then a missing sign-in, a timeout, a plain
  failure, not installed.

The request may name one engine (`engine`): the owner's choice on the page's
switch. Then only that engine is asked and there is no backup; if the analysis
cannot be done by it, or the setting leaves it out, the reply says so without
starting anything. The page keeps the choice in the browser's local storage.

`thumbnails` names its own engines, Claude Code and Codex, tried in the owner's
order: the pictures arrive as tool results, and nothing documents that
Antigravity passes a tool's pictures to its model. An engine the owner's
setting leaves out is never used.

The connector an analysis starts is given `JGTUBE_TOOLS`, the bare names of the
tools that analysis may use, and registers no others. So the limit on tools
holds at Jgtube's own layer, whatever an engine does with its own allow-list
(`enabledTools` for Antigravity and `enabled_tools` for Codex are still
written, but nothing depends on them being honoured).

`POST /api/analyses {analysis, channel, engine?}` waits for the answer (up to
five minutes) and returns `{analysis, text, engine, skipped}`, where `skipped`
lists the engines passed over with the reason. One runs at a time (409
otherwise).
The channel must parse as a handle, link or id, and goes into the question as
`@handle` or the id, never as typed. Failures map to a status and a plain
message: not installed or not signed in 503, a plan limit 429, a timeout 504,
anything else 502.

`GET /api/engines` returns `{engines, order}`: for `agy`, `claude`, `codex` and
`gemini-api`, whether it is installed, whether someone is signed in (null when
that cannot be told without asking it a question), its version, whether Jgtube
would use it, and one sentence when something needs doing. The answer is reused
for a minute. `npm run engines` prints the same; with `-- --try` it puts one
question that needs one tool (`list_niches`) to each installed engine.

### Claude Code (`engines/claude.ts`)

```
claude -p <prompt> --output-format json --max-turns <n> --system-prompt <text>
  --strict-mcp-config --mcp-config <json> --setting-sources project
  --permission-mode dontAsk --tools "" --allowedTools <tools...>
  --disallowedTools <built-in tools...>
```

The connector is its only tool server, it has no built-in tools at all, only
the allowed tools may be called, and the owner's other Claude settings are not
read. A reply saying to run `/login` maps to `not-signed-in`, a plan limit in
Claude's words to `limit`. `check` runs `claude --version` and, from version 2.1,
`claude auth status`, of which only "signed in or not" is kept.

### Codex CLI (`engines/codex.ts`)

Built to the documentation for v0.171.0; never run from here.

```
codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config
  --sandbox read-only -C <folder>
  -c web_search="disabled" -c features.shell_tool=false -c features.view_image=false
  -c mcp_servers.jgtube.command="node" -c mcp_servers.jgtube.args=[...]
  -c mcp_servers.jgtube.env={ JGTUBE_DB_PATH = "..." }
  -c mcp_servers.jgtube.required=true -c mcp_servers.jgtube.startup_timeout_sec=30
  -c mcp_servers.jgtube.default_tools_approval_mode="approve"
  -c mcp_servers.jgtube.enabled_tools=[...] -
```

- The prompt goes to the program's input, with the system prompt ahead of it:
  Codex has no flag for one. The `-c` values are TOML written by `toml.ts`,
  because Windows paths are full of backslashes.
- `codex login status` is asked first; a non-zero exit is `not-signed-in`.
- The output is one JSON event per line. The answer is the text of the last
  `item.completed` whose item is an `agent_message`. A `turn.failed`, or a bad
  exit code, is a failure with the message of the last `turn.failed` or `error`.
- Box: no user configuration, read-only sandbox, no shell tool, no web search,
  no opening of image files, the connector as the only and required tool
  server with only the allowed tools. Not prevented: Codex still reads the
  owner's `AGENTS.md`, and has no step limit.
- Caveats from its documentation: a non-interactive run refuses a tool that is
  not marked read-only unless its approval is set ahead of time (hence
  `default_tools_approval_mode`); a picture in a tool result is dropped when the
  result also has structured content (the connector's picture tool sends none);
  it takes pictures but not video; OpenAI recommends an API key for use from a
  program and describes using the ChatGPT login only for trusted private
  automation.

### Antigravity CLI (`engines/agy.ts`, `agyReply.ts`)

Built to the documentation for v1.5.12; never run from here.

```
agy -p <system prompt + prompt> --output-format json --sandbox
  --print-timeout <minutes>m [--model <name>]
```

- `agy` has no flag for tool servers. It reads `.agents/mcp_config.json` in its
  working folder, so that file (`{"mcpServers": {"jgtube": {"command", "args",
"env", "enabledTools"}}}`) is written into a fresh folder made for the one
  run and removed with it.
- A tool with no rule is "ask", and a headless run cannot ask: the call is
  quietly refused, the run goes on and exits 0. The documented way to allow it
  is the rule `mcp(jgtube/*)` under `permissions.allow` in the owner's own
  `settings.json` (`.gemini/antigravity-cli` in the home folder). The
  documentation shows no settings file for a single folder. Jgtube never writes
  the owner's file. It reads it: while the rule is missing the engine is passed
  over before anything is spent (reported as `not-signed-in`: one step for the
  owner to take in the program), with the line to add. If a run is refused its
  tools all the same (a `denied_actions` entry or a notice on its error output
  that names the server or MCP), the run fails with the same line.
- A run without a saved sign-in ends with "authentication required":
  `not-signed-in`.
- Box: only the allowed tools are offered; `--sandbox` keeps commands off the
  network and away from files outside the working folder where the sandbox
  exists (not on Windows 10); what would have to ask (web pages, files outside
  the folder) is refused. Not prevented: the owner's other tool servers,
  plugins and hooks load as in any session; since v1.5.7 a run may edit files
  in its working folder and run commands inside the sandbox without asking.
  Deny rules for those exist only in the owner's settings, where they would
  apply to every use of `agy`.
- Google's FAQ says wrapping `agy` in other applications "is not supported
  under consumer plans" and recommends an API key. The owner has been told.

### Watching a video (`engines/agyVideo.ts`, `geminiVideo.ts`, `videoWatch.ts`)

A second capability beside "answer with tools": watch one video, picture and
sound, and answer a question about it: `engine.watchVideo(videoId, question,
options?)`. The channel breakdown uses it for the videos it studies in depth.

- **Antigravity, a file on this computer.** A headless run watches a local file
  named with `@` in the prompt; the owner has done it with
  `agy -p "Watch @clip.mp4 and say ..." --output-format json`. Jgtube copies the
  file into a fresh folder as `clip.mp4`, so nothing from outside reaches the
  prompt, runs `agy -p <prompt> --output-format json --print-timeout 12m` there
  and removes the copy. Only `.mp4` is taken; a file over 95 MB (`agy` refuses
  over 100 MB) or one whose MP4 boxes do not add up to a whole file (a download
  that stopped part-way) is refused before the run. A run that times out says
  the video may be too long for one pass. None of this is in `agy`'s
  documentation; the assumptions are listed at the top of `agyVideo.ts`.
- **The Gemini API, a public YouTube link.** With `GEMINI_API_KEY` set, a POST
  to `https://generativelanguage.googleapis.com/v1beta/interactions` with the
  key in the `x-goog-api-key` header and the body `{"model", "input": [{"type":
"text", "text": <question>}, {"type": "video", "uri": <link>}],
"system_instruction", "store": false}`. The answer is the text in the content
  of the reply's `model_output` step when `status` is `completed`. 429 is
  `limit`, 401 and 403 `not-signed-in`, 504 `timeout`. The default model is
  `gemini-4-hydrogen`, the one in Google's examples. Limits, from Google's
  "Video understanding" page: public videos only; 8 hours of YouTube video a
  day on the free tier; about an hour of video per request at the usual detail.
  Never called with a real key.
- **Order.** Antigravity when it is installed and the downloader hands back a
  whole file; otherwise the Gemini API when a key is set; otherwise
  `not-installed`, "No engine on this computer can watch a video", so the
  caller can fall back to frames and a transcript. A timeout or failure of the
  engine that ran is reported, not retried on the other.
- **The downloader** is core's `downloadVideo`, connected in `engine.ts` through
  `videoCopies.ts` (root `downloadsRoot(config)`, the engine's own connection to
  YouTube for the built-in route): `(videoId, stop) => Promise<{ok: true, path,
remove?} | {ok: false, reason}>`, the reason being core's plain sentence. The
  file stays the downloader's: the watcher copies it and calls `remove` once the
  watch is over, whichever way it went. A caller that already has the file (a
  breakdown) passes its own `download` for that one watch. A test may put a
  stand-in in `EngineOptions.downloadVideo` or `fetchVideoFile`.
- **A YouTube link given to Antigravity** with no file is unproven: `agy` reads
  a link as a web page. It is off unless `JGTUBE_AGY_YOUTUBE_LINKS=on`, and
  `npm run engines -- --try --youtube <link>` asks a question only someone who
  watched could answer, so the owner can check first.

### Channel breakdown (`breakdownEngine.ts`, `breakdownStudies.ts`, `breakdownWriting.ts`, `breakdownParts.ts`, `breakdownPartQuestions.ts`, `breakdownBasis.ts`, `breakdownStore.ts`, `breakdownRoutes.ts`)

Built. A longer job that takes one channel apart and writes the result in
seven parts, each kept. It works for any channel: the owner's model, a
look-alike, a channel from the niche list. Nothing in the code or the questions
is fitted to a channel or a niche: the only things put into a question from
outside are the channel in its fixed form, video ids, each checked first, and
counts worked out in code.

**What is chosen, in code** (`core/src/breakdown/picks.ts`):

- `BREAKDOWN_TOP_VIDEOS = 5`: the channel's videos furthest above its usual
  views, best first (`buildVideoReport`; a video too new or too alone to score
  comes after the scored ones, by views). A channel with fewer has all of them.
- `BREAKDOWN_DEEP_VIDEOS = 3`: the first three of those, studied in depth.
- `BREAKDOWN_TITLES = 20`: the titles a title study rests on at least. The 20
  most viewed and, of the rest, up to 20 of the least viewed, most viewed first
  (videos with the same views in one fixed order, by id); so 21 to 40 stored
  videos are all studied, and a channel with more has its middle left out. A
  channel with fewer than 20 has all of them studied and the answer says that
  the patterns rest on few titles. The ranking is cut into thirds by place, in
  code: the first third is the HIGH group, the last third the LOW group, and the
  question carries those two ranges as numbers.
- `BREAKDOWN_ORDINARY_VIDEOS = 5`: videos scored at or under
  `ORDINARY_MAX_SCORE` and at least `ORDINARY_MIN_AGE_DAYS` old, newest first,
  none of them a top video: set beside the top ones.
- `WATCH_MAX_SECONDS = floor(MAX_VIDEO_BYTES / WATCH_BYTES_PER_SECOND)` = 1,187
  seconds: a video longer than that is not downloaded, because its smallest
  watchable copy (YouTube's 360p file, about 80 kB a second) would be over the
  95 MB that is handed over. A video whose length is not stored is tried.

**The steps** (`breakDown`):

1. Read the channel (stored, or read from YouTube once with its branding) and
   the captions of the top five. A video without captions is recorded as such.
   A channel with no videos stored fails here with a plain sentence and starts
   no engine.
2. For each of the three deep videos, in turn (`breakdownStudies.ts`):
   - **A file.** The owner's own (`<downloads>/my-videos/`, a file named
     `<id>.mp4`, else any `.mp4` whose name holds the id), then one download
     (yt-dlp, then the built-in route). A file is looked for only when
     something would use it: an engine that watches files (Antigravity,
     installed and in the owner's order) or ffmpeg. One copy serves both and is
     removed afterwards on every path; the owner's file is only read.
   - **A watch** (`WATCH_QUESTION`): Antigravity on the file, else the Gemini
     API on the link. Sections: voice, music, sound effects, transitions and
     cuts, illustration type, on-screen text, pacing changes, the first 30
     seconds. A file over 95 MB is first shrunk for the watch
     (`shrinkForWatching`: 360 lines, the bitrate worked out from the length so
     that picture and 64 kbit sound come to nine tenths of the limit; one
     attempt), in the temporary folder, removed afterwards.
   - **A frame study** (`frameStudyRequest`): its own boxed-in run of an engine
     that sees pictures (Claude Code or Codex, in the owner's order or the one
     chosen on the switch), with the one tool `view_video_frames`. With a file
     and ffmpeg the frames are cut from the file, one a second
     (`cutFrameSheets`); otherwise they are YouTube's preview frames; with
     neither, the study is recorded as not done. The run walks every sheet in
     order and ends with three lines: `FRAMES LOOKED AT: X of Y`,
     `PICTURE CHANGES SEEN: N` and the tool's source line.
3. **What it rests on** (`breakdownBasis.ts`): written in code, with no engine.
   The channel, how many titles are studied and by what rule, each top video
   with its views, score, length and what its captions come to (words and words
   a minute, counted), the ordinary videos, and for each deep video where its
   frames came from, how many there were, the gap between two frames, the
   picture changes counted and what they come to, and whether it was watched.
   It is stored as the part `basis`, written by `jgtube`.
4. **The seven parts** (`breakdownWriting.ts`), one engine run each, in order,
   each stored as soon as it is written:

   | Part         | Tools                                                                             | Reads earlier parts                           | What it holds                                                                                                                                                                                                                                                                                                                                                            |
   | ------------ | --------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `titles`     | `get_channel_videos`, `get_video_details`                                         | none                                          | The titles studied, numbered with views and score; word patterns counted in the HIGH and LOW groups (length, opening words, numbers, names, emotional words, punctuation); the formulas as fill-in templates; where the formula failed; what the low ones lack; better formulas for the owner, each argued from the ranking, and what to avoid; the description template |
   | `thumbnails` | `get_channel_brand`, `get_channel_videos`, `view_thumbnails`                      | none                                          | Channel identity; composition thumbnail by thumbnail (layout, colours, faces, words, devices) for the top and the ordinary videos; what repeats; winners against ordinary; improvements for the owner; a thumbnail prompt between marker lines, with the slots `[SUBJECT]` and `[OVERLAY TEXT]`                                                                          |
   | `scripts`    | `get_transcript`, `get_transcript_pace`, `get_channel_videos`                     | none                                          | For each deep video: length and pace, the hook (first minute quoted, what it promises, the question it opens), a beat sheet with times and each beat's counted pace, tension raised and paid off, sentence style, recurring phrases, calls to action, the ending; then what they share                                                                                   |
   | `picture`    | `get_frame_study`, `get_video_watch`, `get_channel_videos`                        | none                                          | What was looked at; kinds of shot with counts; how often the picture changes (the counted figure, or the study's own estimate, labelled); on-screen text; what repeats; how the pictures seem to be made, as an inference; sound and editing from watch notes alone, else NOT WATCHED                                                                                    |
   | `strategy`   | `get_breakdown_part`, `get_channel_videos`                                        | `titles`, `thumbnails`, `scripts`, `picture`  | Strengths and weaknesses, each on named videos and tool numbers; where the channel is absent; a strategy to beat it: what to copy, what to do better, where to go that it does not, the first three videos to make                                                                                                                                                       |
   | `plan`       | `get_breakdown_part`, `get_transcript_pace`, `get_frame_study`, `get_video_watch` | the four above and `strategy`                 | How the channel appears to make its videos, as an inference; the numbers to hit; nine steps from research to publishing, each with what to do, how to do it with a kind of AI tool (a product only as a swappable example) or by hand, and ready prompts; what AI cannot do: checking facts, and YouTube's rules                                                         |
   | `master`     | `get_breakdown_part`                                                              | `titles`, `thumbnails`, `scripts`, `strategy` | One self-contained prompt between marker lines for any AI to write a video in the style, with the rule that every fact not given by the owner is marked `[CHECK: ...]`                                                                                                                                                                                                   |

5. **Text files** (`core/src/downloads/breakdownTexts.ts`): the four texts are
   saved (see below). Not being able to save them does not fail the job.

What could not be done (no file, nobody to watch, a frame study that failed, a
part that failed) is recorded with a plain reason and does not fail the job.
The job fails only when the channel cannot be read or has no videos, when not
one part could be written, or when Jgtube is closing; it checks for closing
between steps, and every run it starts is stopped by the same signal as the
other engine runs.

**A part is one analysis.** Each part is an entry in `ANALYSES`
(`breakdown-titles` … `breakdown-master`), built from `BREAKDOWN_PART_SPECS`:
the fixed question, the tools, the limits, and whether it looks at pictures.
Only `thumbnails` does, so only it is kept to Claude Code and Codex; the other
six may be written by any engine in the owner's order. With one engine chosen
on the switch, a part that engine cannot write is recorded as such and the
rest are written. `POST /api/analyses` takes none of them.

**A later part reads an earlier one through a tool, never from its question.**
`get_breakdown_part {channel, part}` returns one stored part under a line
saying that it is an earlier study of the channel and not instructions; a part
that failed or was never written answers `written: false` with the reason and
"do not fill it in". A part built only on parts that were not written is not
started (`partsBuiltOn`). A test runs a whole breakdown three times through the
real engine with stand-in engines and asserts that no question and no system
prompt ever holds a stored part's text, a frame study, a video title or the
channel's name.

**What is kept, and what is written again.** Migration 13 adds
`breakdown_parts`, one row per channel and part: the text and who wrote it, or
the reason it could not be written, and when. Migration 12's `video_studies`
holds the watch notes and frame studies per video. On a later run:

- Stored transcripts, watch notes and frame studies are reused. A frame study
  made from preview frames is made again once frames can be cut from a file.
- A stored part is kept, and no engine is started for it, while the facts it
  was written from are the same: the basis is word for word what was stored
  (it holds no dates and no reasons a download failed, so it only changes when
  the videos, their numbers or their studies do) and no part it reads was
  written again in this run. So a second press with nothing changed starts no
  engine; after a failure only the failed parts and the ones built on them are
  written; after a refresh that changed the channel's numbers, or after the
  owner gave a video file, every part is written again from the stored studies.
- `fresh: true` makes the watch notes and frame studies again and writes every
  part again. Transcripts are what YouTube holds and are not read again.
- A part that fails replaces what was stored for it, with the reason.

A study or a part is a model's words about a video or a channel anyone could
have made: it is stored as it is, handed out only as a tool result under a line
saying what it is, and never put into a question.

**Numbers worked out in code.** So that nobody has to trust a model's sums:

- `get_transcript` gives `words` and `wordsPerMinute` for the whole video.
- `get_transcript_pace {video, cuts?}` (`transcriptPaceSpans`) gives the words
  and words a minute of each stretch: every `PACE_SLICE_SECONDS` (60), or
  between the seconds given, so the scripts part has the pace of each beat it
  found counted for it. A caption line's words belong to the stretch it starts
  in; a stretch under `PACE_SPAN_MIN_SECONDS` (15) has no pace.
- `get_frame_study` adds `secs`, `secondsPerFrame` (one for frames cut from a
  file; else the video's length over the frames there were), `framesLookedAt`
  and, when the study ends with its count of picture changes, `changesSeen`,
  `gaps` (one fewer than the frames looked at) and `secondsPerChange` (the time
  the gaps span over the changes). A change quicker than the gap between two
  frames cannot be seen, so that figure is the most seconds there can be
  between changes, and the answer says so. A study without the count, or with
  more changes than gaps, gets no figure and a line saying its pace is the
  study's own estimate (`frameStudyNumbers`).

**The four text files.** When a breakdown finishes, and from the store at any
time (`breakdownTexts`):

| File                   | What it is                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `breakdown.txt`        | Every part in order under its own heading, a part not written saying why               |
| `production-plan.txt`  | The `plan` part as written                                                             |
| `thumbnail-prompt.txt` | What stands between `=== THUMBNAIL PROMPT START ===` and `... END ===` in `thumbnails` |
| `master-prompt.txt`    | What stands between `=== MASTER PROMPT START ===` and `... END ===` in `master`        |

A prompt is lifted out only when the part holds exactly one opening line and
exactly one closing line after it, each on a line of its own, with something
between them (`splitMarked`). Anything else gives no file and a sentence saying
so: a prompt is never guessed at. The files go to
`<downloads>/breakdowns/<channel name>/` (`channelFolder`, `pathInside`) with
an `index.json` that carries the channel id, so a second channel of the same
name gets a folder of its own; a text that could not be made is not written and
an older copy of it is removed.

**Frames from a file** (`core/src/downloads/frameSheets.ts`). ffmpeg is found on
the PATH like yt-dlp (`findProgram`, nothing is run to find out) and started
without a shell, arguments as a list, both paths absolute so neither can pass
for an option, with a ten-minute limit and a cap on what it may print:

```
ffmpeg -hide_banner -nostdin -nostats -y -i <file> -an -sn
  -vf fps=1,scale=288:162:force_original_aspect_ratio=decrease,
      pad=288:162:(ow-iw)/2:(oh-ih)/2,tile=5x5
  -frames:v 80 -q:v 5 <folder>/sheet-%03d.jpg
```

One frame a second (`FRAME_EVERY_SECONDS`), 25 to a sheet (5 by 5), each frame
288 by 162, so a sheet is 1440 by 810: the largest a model is shown without
being shrunk first. At most 80 sheets (2,000 frames). The sheets and an
`index.json` (which seconds each sheet shows; the count of frames comes from the
length ffmpeg prints) sit in `<downloads>/video-temp/frames-<id>/`, are checked
to be JPEGs, and are removed with the video; leftovers go with the day-old
copies. `readVideoFrames` serves them in place of preview frames when they are
there, found by video id and sheet number alone: no tool ever reads a path it
was handed.

**Limits of the runs.** Each part's turn and time limits are in
`BREAKDOWN_PART_SPECS`; the frame study's are 40 turns and 20 minutes, asked to
stay under 5,000 words. Measured with Claude Code on a copy of a real store
(November 2026), a channel of 41 stored videos, no video file and nothing to
watch with:

| Step                                    | First run (everything) | Second run (parts only) | Limit            |
| --------------------------------------- | ---------------------- | ----------------------- | ---------------- |
| Frame study, 181 preview frames         | about 95 s             | kept                    | 40 turns, 20 min |
| Frame study, 94 preview frames          | 72 s                   | kept                    | 40 turns, 20 min |
| Frame study, 121 preview frames         | 75 s                   | kept                    | 40 turns, 20 min |
| Part 1, titles (40 titles)              | 113 s                  | 110 s                   | 12 turns, 10 min |
| Part 2, thumbnails (10 thumbnails)      | 43 s                   | 40 s                    | 16 turns, 6 min  |
| Part 3, scripts (3 videos)              | 111 s                  | 98 s                    | 40 turns, 12 min |
| Part 4, picture and sound               | 46 s                   | 48 s                    | 20 turns, 6 min  |
| Part 5, strengths, weaknesses, strategy | 57 s                   | 70 s                    | 20 turns, 6 min  |
| Part 6, production plan                 | 66 s                   | 62 s                    | 40 turns, 8 min  |
| Part 7, master prompt                   | 61 s                   | 78 s (in a third run)   | 16 turns, 6 min  |
| Whole job                               | 747 s (12 min 27 s)    | about 430 s             |                  |

The time limits are five to eight times what a part took, so a slow day or a
slower engine still fits; the turn limits are at least twice the tool calls a
part's question asks for (2, 4, about 13, 7, 6, about 15 and 5). The turns a
run really used were not recorded.

**Routes.** `POST /api/breakdowns {channel, engine?, fresh?}` starts the job and
answers `{jobId}` (202); its steps and outcome are read at `/api/jobs/:id`. A
breakdown and an analysis share one slot (409 while either runs); breakdowns
have a `JobStore` of their own, so they do not take the slot crawls and
refreshes share. `engine` is the owner's switch for the frame studies and the
parts; watching always starts with Antigravity. Progress is
`{step, text, supply}`: the step in plain words ("Video 1 of 3, “title”:
cutting one frame a second from the file", "Writing part 3 of 7: the scripts"),
and the videos found so far that the owner can supply a file for. The outcome
is `{channel, storedVideos, titles, top, deep, supply, ownVideosFolder, parts,
breakdown, notSaved}`: `parts` says, per part, whether it was written (by which
engine, which were passed over, in how many seconds), kept or failed (with the
reason); `breakdown` is the stored breakdown as below.

`GET /api/breakdowns?channel=` returns a channel's stored breakdown without
starting anything: `{channel, writtenAt, parts, files, folder}`, each part with
`state` (`written`, `failed`, `missing`), its `body` (the text without a marked
prompt), its `prompt` (lifted out, or null), who wrote it and when; `files`
says which of the four texts there are, or why not; `folder` is where they were
saved, when they are on disk. A channel with nothing stored answers 200 with
no data: the page asks for every channel that is picked, and a 404 there would
show as an error in the browser.

`GET /api/breakdowns/texts/<name>?channel=` hands over one of the four texts as
`text/plain` to save (`content-disposition: attachment`, named after the
channel), put together from the store, so it works whether or not the files on
disk still are. Only the four fixed names are taken. Both reads pass the same
Host check as every other route.

`PUT /api/breakdowns/videos/:videoId` takes the owner's own copy of a video and
saves it as `my-videos/<videoId>.mp4`. The id is checked before it touches a
path; the Host and Origin checks are those of every other route; only
`video/mp4` is taken; the cap is 2 GB (`MAX_OWN_VIDEO_BYTES`), refused from the
announced length when there is one and enforced while writing; one upload at a
time (409). The body is streamed to `<name>.part-<random>` in the same folder,
checked to be a whole MP4 (`isWholeMp4`) and only then renamed, so a half-sent
file is never used; on any failure the part is removed. The server hands the
route the request body as a stream for this one path.

**The page.** Picking a channel in the breakdown card shows the breakdown
stored for it: when it was written, "Run again" (everything again), "Write the
missing parts" when some are failed or missing, and each part as a section that
opens, set out by the same `Answer` component as the one-press answers. The
production plan, the thumbnail prompt and the master prompt each have "Copy"
and "Download .txt"; the prompts are shown as they stand, apart from the part's
text. Under the parts: the folder the files were saved in. After a run it also
says how each part went and how long it took.

**Order for each deep video**, as the owner reads it: the owner's own file, then
yt-dlp, then the built-in download; with none, YouTube's preview frames for the
frame study, the Gemini API for watching if a key is set, and the video listed
as one the owner can supply.

**What was run for real, and what was not.**

Run through the routes on a copy of a real store with Claude Code, for a
channel with 41 stored videos, no video file and nothing to watch with:

- A whole breakdown started from nothing: three preview-frame studies, each
  ending with its count of picture changes, then all seven parts, the four
  text files saved. Every part said NOT WATCHED where sound was concerned.
- After the questions were changed, the same channel again without starting
  from nothing: the frame studies were kept and, the basis having changed,
  the parts were written again. Part 7 failed for real, on the plan's usage
  limit; it was stored as failed with that reason, the other six were kept,
  and `master-prompt.txt` was not written.
- A third press wrote only the missing part 7 (the other six: kept) and saved
  all four files.
- The page at 1440 and 390 wide against that stored breakdown: the parts as
  sections, Copy read back from the clipboard for the three texts, a download
  whose content equals what was copied, no sideways scroll, no console error.

Not run for real: a part written by Antigravity or Codex (stand-ins only); a
video file downloaded, cut and studied (YouTube refused the download from that
network), and so the seconds between picture changes from frames a second
apart; an engine watching a video, and so any part written from watch notes;
a channel with fewer than 20 or more than 40 stored videos; Windows.

### Idea lab, trending formats and the hook library (`ideaEngine.ts`, `formulaEngine.ts`, `hookEngine.ts`, `labRoutes.ts`, `labAnalyses.ts`)

Built. Six more analyses, none offered on `POST /api/analyses`: `concepts`,
`concept-twist`, `concept-more`, `where-else`, `title-formulas` and
`hook-styles`. Each is a fixed question, read-only tools and limits
(`labAnalyses.ts`), started through `/api/lab/...` as a job read at
`/api/jobs/:id`. An AI run takes the one slot the analyses and the breakdown
share (409 otherwise); the lab's jobs have a `JobStore` of their own.

**Scope.** Everything is for one centre channel, by its channel id, and never
reaches past the channels on that channel's latest map (`core/src/lab/mapVideos.ts`).
Concepts, batches, formulas and hook labels are stored with the centre channel
id and every repo method takes it, so one channel's cannot be listed, kept,
changed or handed to an engine for another. Nothing in the code or the
questions is fitted to a channel or a niche: no word list, no example title,
no preset style names.

**What goes into a question.** A channel in its fixed form, video ids checked
to be ids, whole numbers (a batch, a concept, a window of days), a length, and
one free text: the owner's angle. The angle is one line of at most 200
characters; line breaks, control characters and the invisible marks that
reorder text are refused by the route (zod) and again by `quotedAngle`, which
also turns every kind of double quote inside it into a single one. It appears
once, between double quotes, introduced as the owner's own wording of a
subject area and stated not to be instructions. Everything else that is other
people's words or a model's reaches an engine only as a tool result: a picked
title format (`get_idea_brief`), a stored concept (`get_concept`), the hooks
(`get_hooks`).

**Concepts.** `POST /api/lab/concepts {channel, inspiration[1..5], hookModels?,
format?, angle?, length, engine?}`. Before anything runs, `conceptProblem`
checks against the store that every picked video is a stored video of a channel
on this channel's latest map, that each opening to model is one of the picked
videos, and that the format is this channel's: `{source: 'transfer', key}` must
be a template of its transfer list, `{source: 'formula', id}` a stored formula
of this channel. The batch row is stored first, so the engine can read it; a
run that stores nothing removes it again. The question asks for exactly ten
concepts as `CONCEPT n` then `TITLE:`, `ALT:` twice, `THUMBNAIL:`, `OVERLAY:`
(four words or fewer), `HOOK:` (one sentence), `HOOK STYLE:` (the library hook
whose way of opening it follows, or none), `RESTS ON:` and `NEEDS:`. Its rules:
one specific subject per title, in this channel's niche; never the owner's
angle set into a template; never a competitor's title word for word or with a
word changed; no forecast; every number from a tool; "not made on this map"
never passed off as "untried on YouTube"; no web access, so whatever real fact
a concept depends on goes under NEEDS; a library hook is a model for the way of
opening only, never its words, names, numbers or subject.

`parseConcepts` (core) is strict. It reads through the marks an engine adds
(`#`, `**`, `- `), takes a continuation line only directly under a labelled
line, and counts a concept as unread when a part is missing, given twice or
over its cap (title 100 characters, YouTube's limit). It never fills a gap. A
batch with fewer than ten is stored and shown with one plain sentence
(`batchNote`); a run with none that could be read fails, says why for the
first, and changes nothing. `RESTS ON` is shown as written, and the page links
only the ids in it that the owner really picked (`namedVideoIds`).

**Concepts not kept.** A new batch replaces them: when a batch is stored, every
concept of that channel that was not kept, from any earlier batch, is deleted
in the same transaction. A twist or a more-like-this adds to its concept's
batch and deletes nothing. `POST /api/lab/concepts/clear` deletes them on
request. Kept concepts are deleted by nothing.

**Twist and more.** `concept-twist` (three concepts, the same subject from
another angle) and `concept-more` (five, other subjects in the same vein) take
one stored concept's number; its text is read through `get_concept`.

**Where else.** `where-else` reads `get_map`, `get_breakouts` and
`list_transfer_opportunities` for this channel and suggests up to five moves to
another language and five to another category, each with `STARTS FROM`,
`EVIDENCE`, `MOVES TO`, `EXAMPLE TITLE`, `IN ENGLISH`, `SEARCH TO CHECK` and
`NOT CHECKED: Jgtube has not looked for this in ...`. It is told never to say
something is untried elsewhere, and the page prints its own fixed sentence to
the same effect above every answer, whatever the answer says.

**Title formulas** (`core/src/formulas/formulas.ts`). The engine reads the
breakouts of the map (and, for the 90-day window, up to eight look-alikes' own
lists) and proposes formulas as `FORMULA:`, `WHY:`, `VIDEOS:`. The code decides
what is kept (`verifyFormulas`):

| Constant                      | Value  | Why                                                               |
| ----------------------------- | ------ | ----------------------------------------------------------------- |
| `FORMULA_WINDOWS`             | 30, 90 | The breakout list's month, and what the transfer list calls "now" |
| `FORMULA_DEFAULT_WINDOW_DAYS` | 90     | Enough titles to see a pattern in                                 |
| `FORMULA_MIN_VIDEOS`          | 2      | One video is an example, not a format                             |
| `FORMULA_MIN_FIXED_WORDS`     | 2      | One fixed word around a row of slots is a shape any title fits    |
| `FORMULA_MAX_KEPT`            | 12     | More than a page of cards helps nobody choose                     |

A video id counts only when it is a stored video of a channel on this map
published inside the window (`videosOnMap`); a formula left with fewer than two
is dropped; so is one with no slot (a title, not a format), with an unclosed
or unnamed slot, or with fewer than two fixed words; a formula given twice is
kept once. Each drop is reported with its reason. The count of videos and of
channels, the average score and how many videos it was taken over, the views
and the scores are computed from the store on every read, never taken from the
answer. A run that keeps nothing fails and leaves the last run in place; a run
that keeps something replaces the formulas of that channel and window.

**Hook library** (`core/src/hooks/`). `HOOK_SECONDS = 60`: a hook is every
caption line that starts inside the first minute, each taken whole, so the cut
falls at the end of the last line that starts inside the window (`firstMinute`);
sound labels such as [Music] are left out. Captions made by YouTube's speech
recognition can mishear names and numbers, and the page says which hooks come
from such captions. `HOOK_LIBRARY_VIDEOS = 12`: the look-alikes' breakouts on
the map, highest score first (every breakout when no look-alike has one). The
words are cut from the stored captions on each read and are not stored a
second time. `POST /api/lab/hooks/build` reads the missing captions one video
at a time through the existing transcript reader and its rate limiter; it is
not an AI run and does not take the AI slot. A video without captions, or
whose captions were never read, is listed as such. `hook-styles` is the only
AI part: it reads `get_hooks` and answers `VIDEO:`, `STYLE:` (one to three
words), `HOW:` (one sentence). It is given no list of styles and no example
name, and is told to use exactly the same name for the same way of opening.
`parseHookLabels` keeps labels only for video ids that were sent, the first
for each; they are stored per centre channel and video.

**The phone cut-off.** `PHONE_TITLE_CHARS = 55` and `SHORTS_TITLE_CHARS = 40`
(core `concepts/parse.ts`) are where the page starts warning that a title may
be cut off, and what the concept question names as the part of a title that
shows. YouTube publishes no such number, only its limit of 100 characters;
title-checking tools put the cut between 45 and 60 characters depending on the
letters. It is a rule of thumb, stated as one on the page.

**Measured** with Claude Code on copies of two real stores (November 2026): a
batch of ten concepts 92 seconds; a twist 42; a more-like-this 57; where-else
57; title formulas for 90 days about two minutes; building a hook library of
twelve 20 to 25 seconds; naming its styles 37 to 90 seconds.

### Script writer (`scriptEngine.ts`, `scriptQuestions.ts`, `scriptRoutes.ts`, `core/src/script/`)

Built. One script per concept (migration 14, `scripts`, `ON DELETE CASCADE`
from its concept), read and changed only through the concept's centre channel.
Starting a script keeps its concept, and a concept with a script is never
cleared away, kept or not. Three more analyses, `script-hooks`, `script-draft`
and `script-tighten`, each a fixed question that names a channel in its fixed
form and a concept by its number and nothing else; the concept, the voice's
numbers, the chosen hook, the beat sheet and the draft are read through the
read-only tool `get_script`, the hooks through `get_hooks`. They are put to a
script writer (`SCRIPT_SYSTEM_PROMPT`), not to the usual analyst.

**The honesty rule** (`HONESTY_RULE`, carried by all three questions). The
engines have no web access. Every factual claim the engine cannot vouch for
(names, dates, numbers, places, quotes, what a product or a company does or
did) must be followed at once by `[CHECK: what to verify]`; a fact read in
another channel's transcript is that channel's claim and is marked too; a fact
is never invented to make the script flow. The code does not and cannot check
facts. What it does: counts the markers (`checkMarkers`), lists each with the
sentence it stands in, lists sentences that hold a digit and no marker
(`figuresWithoutCheck`: a help for the eye, not a judgement), keeps the
markers in the text and Markdown exports, and refuses to copy the clean
voiceover silently while markers remain. In the real run the engine wrote
real-world facts from its own memory and marked them, several as "written
from memory": such facts can be wrong or out of date, which is what the
markers are for.

**Text measures** (`core/src/script/measure.ts`, pure). A script is plain
text with three marks: a line starting `## ` is a heading, a line of the form
`[B-ROLL: ...]` is a picture cue, `[CHECK: ...]` is a marker. None is spoken,
so none counts. `countWords` counts what stands between spaces and holds a
letter or a digit; `spokenSeconds` is words over a rate; `readingGrade` is
Flesch-Kincaid, 0.39 x words per sentence + 11.8 x syllables per word - 15.59.
The syllable rule (`countSyllables`): each run of vowels (a, e, i, o, u, y) is
one syllable; a final "e" is not counted unless the word ends in a consonant
and "le" or has no other vowel; at least one. The grade is an estimate for
English only and is null for text under 30 words, text where under four fifths
of the letters are Latin (`LATIN_MIN_SHARE` 0.8), and text with no sentence
ends (over 60 words to a sentence on average), which is what captions made by
listening often are.

**Voice** (`core/src/script/voice.ts`). The voice channel is the model channel
when the map has one, else the centre, or any channel on this map the owner
picks; a channel off the map is refused. `VOICE_VIDEOS = 5`: its best videos by
the breakdown's rule. From their stored captions: the median pace
(`transcriptPace`), the median of each video's median sentence length, and the
median reading grade; sentence length and grade only from captions that have
sentence ends. Nothing is a preset: with no captions read there is no rate,
the stages are refused, and the owner reads the captions (`POST
/api/lab/voice/read`, a job, not an AI run) or types a rate.

**Length.** Long-form: the owner chooses within `lengthRange` of the
look-alikes' breakouts on this map: their stored lengths, Shorts (60 seconds
or under) left out, the shortest and longest tenth trimmed, at least three
needed; the default is the median. Shorts: `SHORTS_TARGET_SECONDS = 50`,
at most 59. The hook is `LONG_HOOK_SECONDS = 60` at the voice's rate (the
owner asked for one-minute hooks) and `SHORTS_HOOK_SECONDS = 10` for a Short.

**Stages.** `POST /api/lab/scripts/stage {channel, concept, stage, engine?}`
is an AI job in the shared slot. Hooks: three hooks in the form `HOOK n`,
`WAY:`, `MODEL:`, `TEXT:`, then `BEATS` and `BEAT: time | name | what
happens`; one hook per library hook the owner chose as a model (up to
`MAX_HOOK_MODELS = 3`, stored with the script; the concept's HOOK STYLE is
the first by default), else three the engine chooses from the library; a
model is for the way of opening only. Draft: the chosen hook, then every beat,
to `targetWords`, with cue lines and markers, headings `## `; cues at the rate
the picture really changes when `get_script` lists frame studies of the voice
channel, else where the subject changes, with no cut rate invented. Tighten:
the same script toward `targetGrade` (the voice's own), nothing added, every
marker and cue kept. `parseHooksAndBeats` and `scriptBody` read the answers;
an answer with no hook or no words changes nothing.

**Cues and exports** (`core/src/script/cues.ts`, `apps/web/src/lib/scriptWriter.ts`).
`parseCues` reads each `[B-ROLL: what | search | sound]` line and gives it a
start and an end computed from the words spoken before and under it at the
script's rate; a time written inside a cue is just words. `shotListCsv` has a
first row of column names and one row per cue; `toCsv` quotes cells that hold a
comma, a quote or a line break, doubles quotes, ends rows with CR LF, and puts
an apostrophe before a cell that starts with `=`, `+`, `-` or `@` so a
spreadsheet does not run it. `cleanVoiceover` is the spoken text only. The
page saves a change 600 ms after typing stops (`POST /api/lab/scripts`, body
up to four texts of 120,000 characters).

**Lifted phrases** (`core/src/hooks/lift.ts`). `LIFT_MIN_WORDS = 6`: a written
hook (a concept's, or one of a script's three) that shares six or more words in
a row with any hook of the library is flagged on the page with the phrase.

**Measured** with Claude Code on a copy of a real store (November 2026), for
one sixteen-minute script: reading five captions for the voice 6 seconds;
hooks and beats 69 seconds; draft 162 seconds (2,271 words spoken, 76 markers,
55 cues); tighten 72 seconds.

### Starting a program on Windows (`engines/executable.ts`)

`spawn` without a shell cannot start the `.cmd` file npm installs, and a prompt
is never handed to a shell as text. On Windows the program is looked for on the
path as `.exe`, `.cmd`, `.bat`: an `.exe` is started directly; an npm `.cmd`
shim is read for the script it runs, which is started with Node directly; any
other `.cmd` goes through `cmd.exe /d /s /c` with every argument quoted and its
special characters escaped, and is refused if an argument holds a line break.
Written for Windows, tested with a stand-in disk, never run on Windows.

### What does not change between engines

- The engine is asked to cite numbers the tools return and not to forecast. Its
  answer is plain text and is rendered as text.
- `set_competitor_status` and `make_map` are never on an analysis's allow list:
  an analysis cannot change stored choices or start a crawl.
- Each engine starts in a private folder of its own, inside one owner-only
  folder that is removed when Jgtube closes.

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
- **Engines:** each engine against a scripted stand-in process, and through a
  real child process (Node running a small script) for input, arguments and
  time limits. Claude Code's real command line was checked by hand before it
  moved behind the engine interface; Codex, Antigravity and the Gemini API have
  never been run for real. Windows start-up is tested with a stand-in disk.
- **Downloaders:** fixtures trimmed from live reads of a small established channel
  (a player answer with its storyboard and caption tracks, a timed-text answer, a
  channel page with a logo and nothing else); fakes for the network, for yt-dlp and
  for the library's download call; real files in a temporary folder.
- **Not covered by automated tests:** React components and hooks, the two
  `main.ts` entry points, the command line, the refresh timer in a running
  process, and a real run of any AI engine. These were exercised by driving the
  app in a browser and by running the commands against a copy of a real store.
- **ffmpeg** is run for real in two tests, on clips made by ffmpeg's own test
  picture inside the test's temporary folder: cutting sheets (their number, their
  times, that they are JPEGs) and making a smaller copy that fits a limit. Both
  are skipped on a computer without ffmpeg; the argument lists and every failure
  path are tested with a stand-in runner.
- **Tested with fakes only:** the official API's video details (no key was
  available), yt-dlp, a real video file arriving, and an engine watching one.
