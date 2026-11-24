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

`owner_places` (step 16) holds the place the owner chose for a channel of
theirs, one row per centre channel: `center_channel_id`, `place_key` (a key of
the place list) and `set_at`. It refers to no other table.
`channel_looks` (step 17) holds when the owner last marked a channel's "what
changed" as seen: `center_channel_id` (primary key) and `seen_at`. It refers to
no other table. See "What changed since you last looked".

`channel_notes` (step 18) keeps what an engine wrote for a channel to be read
again, one row per `channel_id` and `kind` (`thumbnail-review`, `video-ideas`,
`near-misses`, `style-lock`): `engine`, `notes` and `written_at`. A new run
replaces the row. It refers to no other table.

`concept_thumbnails` (step 19) keeps one concept's thumbnail prompt:
`concept_id` (goes with its concept), `prompt`, `why`, `video_ids_json` (the
thumbnails of the map it was learned from, checked against the store) and
`engine`, `written_at`. A new run replaces it.

Named videos. A fixed question that rests points on videos asks for each as
`[video:ID]` (`VIDEO_REF_RULE`). The page looks the ids up through
`GET /api/videos/named` and shows each stored video of the map as its real
thumbnail beside the point; an id that is not a stored video of the map is
dropped and never shown.

Style lock. When the frame studies of a breakdown show one consistent picture
style, the picture part describes it (medium, line, palette with named
colours, lighting, composition, characters and objects, on-screen text, what
never appears) and sets out a STYLE LOCK between `=== STYLE LOCK START/END ===`
lines: a style block to paste before every scene prompt, a negative list and
steps for consistency. It is lifted into `style-lock.txt`. The production plan
builds its scene prompts on it. "Use its style lock" keeps a copy for the
owner's channel in `channel_notes` (kind `style-lock`, first line `FROM
CHANNEL: <id>`); the script draft and a concept's thumbnail prompt read it
through `get_channel_note`. Routes: `GET/POST /api/style-lock`,
`POST /api/style-lock/stop`.

The path through the page. `GET /api/flow?channel=` counts, from the store,
the breakouts, title formulas, read hook openings, concepts, scripts and
breakdowns of channels on the map, for the flow strip. A batch of concepts may
take `formulasFrom` (a channel whose breakdown has a written titles part; the
question reads that part through `get_breakdown_part`), and an idea of the
transfer list may be its format.

Research before writing. "Research this subject" runs Claude Code once with
only its built-in WebSearch and WebFetch tools (`engines/webRun.ts`): no
Jgtube connector or other tool server (`--strict-mcp-config` with an empty
config), every file, shell and edit tool denied, a fresh private folder made
and removed per run, the owner's settings ignored and API keys withheld. Its
question carries the concept's title, its look-up line and the owner's angle,
each quoted, capped and refused when it holds a control or hidden character,
introduced as a subject to research. The answer is read as a fact sheet:
numbered one-sentence facts, each with one or two https sources (code keeps
only plain https addresses and never opens them), then NOT FOUND and DISPUTED
lines. It is stored in `concept_research` (step 25) and "Research
again" replaces it. Codex and Antigravity equivalents are written down and
marked unproven; they are not run.

The writing stages stay boxed with no web access. The hooks and draft stages
read the sheet through the read-only tool `get_fact_sheet`; a fact from it is
written plainly with its marker `[F3]`, a fact in neither the tools nor the
sheet is still marked `[CHECK: ...]` when marking is on, and structure, pace,
hook pattern, length and title format come from the stored study ("keep the
formula"). `[F3]` and `[FIXED: ...]` are never spoken or counted.

Claims check (optional). The remaining `[CHECK]` markers, each with the
sentence it stands for, go ten at a time to the same web-only run as a
numbered list of quoted statements to verify. This is a narrow, deliberate
exception to "a model's words reach a later step only through a tool": the
run has no Jgtube tools to read them through. Verdicts (CONFIRMED, WRONG,
UNSURE, one sentence, a correction for WRONG, one or two https sources) are
stored in `script_claims`; confirmed or wrong count only with a source, and
wrong only with a correction. The page shows each beside its marker; Accept
removes the marker, Apply the correction replaces the sentence and leaves a
visible `[FIXED: ...]` note; nothing changes without a press.

Length. The owner types minutes (12:30 allowed) or words; the two stay in
step through the words a minute, rounding to the nearest second or word,
halves up (`core/script/length.ts`). The last typed is kept in
`script_lengths`. Bounds: 20 seconds to 3 hours, 50 to 30,000 words; a Short
stays under a minute. `POST /api/lab/scripts/length`.

`alert_rules` and `alerts` (step 20) hold one alert rule per centre channel
(`min_score`, `taken_off`, `enabled`, `created_at`, `checked_at`) and the alerts
found (`kind` `breakout` or `taken-off`, `subject_id` the video or channel id, the
channel's and video's titles, score and views when found, `found_at`, `read_at`),
each kept once per centre channel, kind and subject. They refer to no other table,
so a deleted map leaves its rule and alerts; the page shows counts only for
saved channels. See "Alerts".

`concept_videos` (step 21) links a kept concept to the
published video it became: `concept_id` (primary key, `ON DELETE CASCADE` from
`concepts`), `center_channel_id`, `video_id` (unique per centre channel) and
`linked_at`. See "Your videos against the plan".

`concept_schedule` (step 22) holds a kept
concept's place in the upload calendar: `concept_id` (primary key,
`ON DELETE CASCADE` from `concepts`), `center_channel_id`, `status` (`idea`,
`drafting`, `ready`, `published`, or empty), `planned_date` (YYYY-MM-DD or empty)
and `updated_at`. See "Upload calendar".

`video_comments`, `comment_reads` and `comment_answers` (step 23,
numbered at merge) hold the top-level comments read for a video (`comment_id`,
`video_id`, `text` up to 2,000 characters, `likes`, `published_at`, `fetched_at`;
never who wrote them), when each video was read and whether its comments were
turned off, and each centre channel's latest checked "What viewers ask for"
(`video_ids_json`, `findings_json` checked again with a schema when read, `engine`,
`asked_at`). They refer to no other table. See "Comment mining".

`risk_checks` (step 24) holds a kept concept's
latest checked AI risk check: `concept_id` (primary key, `ON DELETE CASCADE` from
`concepts`), `center_channel_id`, `claims_json` and `notes_json` (checked again with
a schema when read), `engine`, `checked_at` and `script_updated_at`. What code works
out (overlaps, unchecked facts) is not kept: it is worked out at each look. See
"Check before publishing".

`channel_money_signs` (step 27) holds what one
read of a channel's watch page showed of its earning: `channel_id` (primary key),
`video_id`, `memberships` (a Join button), `ads` (`shown`, `none` or `unknown`) and
`checked_at`. It refers to no other table. See "Monetization signs".

`video_teardown_parts` (step 29) holds the
production teardown of one video, one row per video and part (`about`,
`measured`, `transcript`, `sheets` and the judged stages): the part as JSON with
who made it (`jgtube` for what code measured, else the engine), or why it could
not be made, and when; every JSON is checked again with a schema when read. The
pictures it names live in `<downloads>/teardowns/<video id>/`. It refers to no
other table. See "Production teardown".

`breakdown_parts.caveat_json` (step 30) holds, for a written part, what a reader
should know about how it was written: another engine wrote it in place of the
one chosen, and why; or it was written from pictures handed over as files and
names none of them. Null for most parts. See "Channel breakdown".

`formats` (step 32) keeps the formats the owner
builds: the channel it is a format of (null when made with no map open), a
name, a planned length, notes, one slot per layer (`slots_json`: an
ingredient's id and a note), the last suggested mix and the last Format Bible
(JSON, checked with a schema when read; what no longer reads is empty), and
the format it was copied from (a copy starts without a suggestion or a
Bible). `channel_formats` keeps each channel's active
format and goes with its format.

`outlier_bank_rows` (a view), `outlier_collections`, `outlier_collection_videos`
and `outlier_bank_finds` (step 33) are the outlier bank's: the
view reads every stored video with its channel and money signs, the tables keep
the owner's collections and each "Find more outliers" run for the daily cap.
See "Outlier bank".

`format_ingredients` (step 31) is the format builder's shelf: one row
per piece of a format taken from one source, unique per `(layer, source_kind,
source_key)`, with `name`, `source_label`, `center_channel_id`,
`channel_ids_json`, `details_json`, `evidence_json`, `media_json`, the owner's
`note` and `added_at`. The JSON is checked with a schema when read; a row that
no longer reads is left off. It refers to no other table. See "Format
builder".

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

### Background work

Every long run (a map, a refresh, a breakdown, an analysis, the idea lab's and
the script writer's AI runs, comment reading, the risk check, a thumbnail review,
a picture check) runs in the local server, not in the page. The page only
starts it and watches it.

- **Switching views.** The run goes on. The map, refresh, breakdown, analysis
  and idea-lab/script runs are watched from the app itself, so their progress
  stays on screen in every view. The views that watch their own runs (Viewers
  ask, Check, the thumbnail review, the picture check) stop polling when left;
  when reopened they ask `GET /api/jobs` for a run of theirs still under way and
  follow it again. A run that ended meanwhile left its result in the store, and
  the view reads it as it opens.
- **The Working indicator.** The top bar counts the runs under way and lists
  them with their step, how long they have run and a link to their view. It
  reads `GET /api/jobs` every 4 s while something runs and every 30 s
  otherwise (and on focus, and shortly after a press). A run that ends while
  the owner is on another view leaves a "Done: <title>" line there.
- **`GET /api/jobs`.** Read-only, behind the same Host check as every route. It
  gathers every job store (maps and refreshes, breakdowns, the idea lab, logos,
  the later features) and the analyses and picture checks a request is waiting
  on: id, kind, a plain title, the channel, concept, video or engine it belongs
  to, status, the step in words, and when it started and ended. Running runs
  come first; finished ones stay listed for half an hour (each store keeps its
  last 20). Each store runs one job at a time, so a second start of the same
  kind while one runs is answered 409 with a plain message.
- **Closing the tab.** The run goes on to the end and its result is stored.
  Reopening the page shows it in the Working list; the views above pick their
  runs up again, and so does the refresh. A breakdown's or the idea lab's
  step-by-step line does not come back after a reload, but the run is in the
  Working list and its result is read from the store when it ends.
- **Stopping the server.** Runs end with it: any AI engine running is stopped
  and work under way winds down before the store is closed, so nothing is cut
  off mid-write. Jobs live in memory only, so after a restart the list is
  empty; what finished before the stop is in the store, and an interrupted run
  must be started again.

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

**Logos for an older map.** The page does not wait for that. When it opens a
map on which a channel has no logo it sends `POST /api/logos {channel}`. The
server lists the map's channels whose branding was never read
(`channelsMissingLogos`, `packages/core/src/channel/logoBackfill.ts`): the
centre, then the look-alikes the owner still counts, then the rest, at most
`LOGO_BACKFILL_MAX_CHANNELS` (60) a run. A job (`logoRoutes.ts`,
`logoEngine.ts`) then reads each channel page once, with no videos
(`fetchChannel(id, 0)`: one request through the shared rate limiter), stores
its branding and reports the logos found so far, which the page puts on the
map as they arrive (`apps/web/src/lib/logos.ts`, `useLogos.ts`). A page that
shows no branding is stored as read, so it is not asked for again; three
channels in a row that cannot be read end the run. One such job runs at a
time. It holds the YouTube lease, is refused (409) while a map, a refresh or a
keyword search is running here or in another program, and stops after the
channel it is on the moment one of those is asked for (`standDown`), so the
owner never waits for logos. The page asks again for the next batch, or thirty
seconds later after a refusal, at most eight times per opening of a map.

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

### Review of one thumbnail

Built (`packages/core/src/thumbReview/`, `thumbReviewEngine.ts`, `thumbReviewQuestions.ts`,
`GET /api/thumbnail-review/videos?channel=`, `GET /api/thumbnail-review?channel=&video=`,
`POST /api/thumbnail-review/ask {channel, videoId, engine?}` as a job read at
`/api/extras/job`). The owner picks one video (their own stored videos newest first,
then the map's winners and ordinary videos) on **Thumbnails that worked**, or presses
**Review this thumbnail** under a video on a channel page (`#thumbnail-review-<id>`).
The engine proposes, code counts:

1. **Sample, in code** (`compare.ts`). Winners of the map's channels, same subject first
   (sharing a word of the title that carries the subject, short and common words left
   out), then the closest look-alikes' top winners, at most three per channel and twelve
   in all. Each winner is paired with an ordinary video of its own channel, each used
   once. The same store gives the same sample every time.
2. **Tag** (`thumbnail-tags`). An engine that sees pictures fills in a fixed checklist
   for each thumbnail not yet tagged, twelve to a run, as a JSON list (`tags.ts`): face
   (none, small, large), expression, number of overlay words, text size, text colour,
   background (photo, render, plain), one to three main colours from eleven, main
   subject size, arrow/circle/highlight, before-after or split, flag or map, logo,
   brightness, clutter (1 to 3) and a one-sentence description. Each entry is checked
   with zod (`.strict()`); anything off the checklist, missing or not asked about is
   recorded with the field it failed on, never kept or counted. Kept tags are reused by
   every later review (`thumbnail_tags`). Claude Code and Codex see the thumbnails
   through `view_thumbnails`; Antigravity as files (unless its last picture check
   failed).
3. **Count, in code** (`count.ts`). For every checklist value: winners showing it and
   in how many channels; its share among winners and among ordinary videos, each the
   average of the per-channel shares so every channel counts once; how many times as
   common among winners (with 0.05 added to both shares); whether the thumbnail under
   review shows it. A value one channel alone shows in two or more winners is that
   channel's **branding**; one whose shares differ by 0.15 or less is **the topic**.
   A value is **winning** when neither flag applies, its winner share is at least 0.4,
   two or more channels show it and it is at least 1.25 times as common among winners.
4. **Write** (`thumbnail-advice`). The engine is given only the counted comparison,
   through the read-only tool `get_thumbnail_comparison`, and writes WHAT YOUR THUMBNAIL
   DOES, WHAT THE WINNERS DO THAT YOURS DOESN'T (each point citing the counts and
   winners by `[video:ID]`), HOW TO IMPROVE IT (ranked, concrete), and a full prompt for
   an image tool for this video between the thumbnail prompt markers: 150 to 300 words,
   filled in for this video with suggested overlay words, no slots, no real people,
   logos, channels or countries ("a national flag"). This run needs no pictures, so any
   engine may write it. Numbers in the answer are to come from the count only.

The comparison and the answer are kept per centre channel and video
(`thumbnail_reviews`, store step 26); a new
review replaces both. The page shows the thumbnail large, the counted winning values
with their shares, lift and channel count (and a few flagged ones with the reason), the
winners compared as a strip with their scores, the advice, and the prompt with Copy.
The map-wide **Thumbnail review** in Ask AI stays as a second, broader option.

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

And `topic: { label, source }` (`packages/core/src/niches/topic.ts`): what the
channel is about, as one label from a fixed word table (Engineering & inventions,
Science & space, Geopolitics, Military, Cars, History, Finance, Tech & AI, Mysteries
& crime, Gaming, Food & health, Nature & animals, Travel & places). The store keeps
no YouTube video category, so the label is read, in order, from the channel's own
keywords and description (`source: 'keywords'`, from the stored brand read), then
from its name and titles (`'titles'`), each title word weighted by its rarity across
the listed channels as the title match weighs it,
ln((channels + 1) / (channels using it + 1)) + 1. Fewer than two word hits, or a
tie, is `Other` (`'none'`). The card shows the label as a tag whose tooltip names
the source. A word table misreads some channels (a fighter-jet channel whose titles
name China reads as Geopolitics); a judged labelling by an engine would do better
and is left as a TODO, since this view reads the store only.

The owner can mark a channel as watched (`niche_watchlist`, one row per channel, no
map involved). A watched channel stays on the list after it stops qualifying, with
`qualifies: false`. On the page a watched channel is shown under **Saved** and
nowhere else: **To look at** holds only what the owner has not taken up yet, the
intro sentence counts what the view on screen shows and says how many are saved,
and unwatching brings the channel back. That is the
page's doing (`apps/web/src/lib/niches.ts`): the stored list, the API and the
connector's `list_niches` still return every channel with its `watched` flag. `POST /api/niches/watch` takes `{ channel, watched }`, accepts
only a well-formed channel id of a stored channel (404 otherwise), and goes through
the same Host, Origin, content-type and size checks as every other write.

On the owner's 286-channel store the list holds 55 channels: 45 new and 10 small
ones that are older. It is computed on each request (about 0.2 s there) and is not
frozen with any map.

**Filters and order on the page** (`apps/web/src/lib/nicheBuckets.ts`,
`nicheFilters.ts`, `nicheSort.ts`, `nicheFilterSave.ts`). The old New, Small and
Other language tabs are folded into filters; only To look at / Saved stays a tab.
Every filter is worked out in the page from the list above and the stored
monetization verdicts; none asks the server for anything new. Within a group a
channel passes when it is in any option chosen; across groups it must pass all.
Each option shows how many channels it would keep given the other groups, the page
says "Showing 12 of 103", and the choice is kept in the browser
(`jgtube.nicheFilters.v1`, read back through a validator).

| Filter    | Options                                                                              | From                                                                                     |
| --------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Niche     | Each topic found, then Other                                                         | `topic` (below)                                                                          |
| Language  | Latin letters, then each alphabet found; shortcuts "Latin only" / "Other alphabets"  | `otherLanguage.script` (the alphabet of the titles; no language is detected beyond that) |
| Age       | Under 3 months, 3–6, 6–12, over a year, restarted, not known                         | `channelAgeDays`, else the account's age from `createdAt`; restarted as on the card      |
| Revenue   | Under $1K, $1K–3K, $3K–5K, $5K–10K, $10K+, no estimate (estimate)                    | Middle of the 30-day `earnings` range                                                    |
| RPM       | Under $0.50, $0.50–1, $1–2, $2–3, $3–5, no estimate (estimate)                       | The same estimate over the views it was made from, per 1,000                             |
| Monetized | Monetized, Likely, Not yet, No sign, Not checked; "Check N of them" beside the count | The stored verdicts; unchecked channels are an option, never dropped unseen              |
| Size      | Under 1K, 1K–10K, 10K–100K, hidden                                                   | `subscribers`                                                                            |
| Took off  | 5×, 10× or 50× or more (one at a time)                                               | The best `score` among `outperformers`                                                   |
| Uploads   | Under 1, 1–3, 3–7, 7 or more a week                                                  | `recentUploads` over 30 days                                                             |
| Country   | Each country found, then not known                                                   | `country`                                                                                |

The RPM bands stop at $5 because the estimate cannot go higher: long videos are
valued at $2–8 per 1,000 views times the tier (1, 0.5 or 0.2), so the middle tops
out at $5, and Shorts at $0.10–0.50. The orders are most 90-day views (the stored
order), biggest breakout, newest, most 30-day views, views per subscriber,
estimated revenue and estimated RPM; unknown values go last. Cards stand three to
a row on a wide screen, two on a tablet, one on a phone: logo, name, handle, money
badge and tags, one line of subscribers, 30-day views and best multiple, three
small thumbnails of the videos that took off, Open and Break down; the numbers,
the estimate with its RPM and the titles are behind Details.

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

**The place, checked.** The list carries `placeCheck` for the channel on
screen: the place the owner chose (`chosen`), the place most of its titles name
(`fromTitles`), its country from the official API (`fromCountry`, with the raw
`countryCode`), whether the API was ever asked (`countryAsked`) and whether
titles and country both say a place and differ (`disagree`). The owner's place
is taken in this order: a place named for one request (`given`), the owner's
stored choice (`owner`), the titles (`titles`), the country (`country`). The
page says which is in use and where it came from, always says what is known of
the country (and, with no API key, that it is not known and why), flags a
disagreement, and offers the whole place list to choose from.
`POST /api/transfers/place {channel, place}` stores the choice per channel in
`owner_places`; `place: null` removes it.

Each version also carries `channelCountry` (its channel's country as a place)
and `elsewhere`: true when its title names one place and its channel is in
another country. The page shows the country beside the place and marks such a
version "made from elsewhere"; with either unknown it is never marked.

`countriesMissing` counts the channels the list rests on (the one on screen and
those behind the listed ideas) the API was never asked about. With a key set
(`canReadCountries` on the reply) the page sends
`POST /api/transfers/countries {channel}` once per channel on screen, which
reads them in one or two API requests (`readCountries`,
`packages/core/src/transfer/countries.ts`, at most 200 channels) and stores
them; without a key the route answers 400 with the reason. It reads no YouTube
page, so it takes no lease.

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

### What changed since you last looked

Built (`packages/core/src/changes/`, `packages/server/src/changesEngine.ts`,
`changesRoutes.ts`, `apps/web/src/lib/changes.ts`, `components/WhatChanged.tsx`).
For one centre channel and the look-alikes of its latest map (the filter's and
the owner's kept ones, less removed), worked out in code from stored readings;
no AI and no request to YouTube.

The earlier state is the store as it was at the earlier moment (`videosAsOf`):
each video with the views of its latest reading at or before then; a video with
no reading by then was not stored then. Both states are judged by the same
rules as the page: a breakout is a video of the last 30 days at 2× its channel's
usual views or more (`DEFAULT_BREAKOUT_WINDOW_DAYS`, `DEFAULT_MIN_BREAKOUT_SCORE`),
and a channel's group (taken off, rising, neither) is `channelMetrics`'. The
subscriber count is the latest in both states, since no history of it is kept.

| Finding                  | Rule                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New breakout             | A breakout now that was not one then: either below the bar then (its views and score then are shown) or not stored then. Strongest first, 12 shown, the count always given (`CHANGES_BREAKOUTS_SHOWN`) |
| Newly taken off / rising | The channel's group now differs from its group then                                                                                                                                                    |
| Dropped out              | Taken off or rising then, neither now                                                                                                                                                                  |
| Look-alikes new or gone  | The peer list of the latest map against that of the map that was latest then; only when both are stored in the current form, else the reason is said                                                   |
| Title formats newly seen | A wording (found as the transfer list finds formats) shared by 2 or more breakouts now (`CHANGES_FORMAT_MIN_BREAKOUTS`), not shared by 2 then, and including at least one new breakout; 6 shown        |

A look-alike with no reading by the earlier moment cannot be compared: nothing of
it is called new, and the section says how many there were.

The earlier moment is one of `last-look` (stored per centre channel in
`channel_looks`, step 17; moved to now by `POST /api/changes/seen {channel}`),
`yesterday` (24 hours back) or `week` (7 days back). With no last look stored,
`last-look` is answered for a week and the reply says so.

`GET /api/changes?channel=UC…&since=last-look|yesterday|week` answers
`{centerChannelId, since, now, asked, sinceKind, lastLookAt, changes, lookalikes,
freshness}`, 404 when the channel has no map. `freshness` is when the look-alike
read longest ago and the one read most recently were read, and when the last
refresh finished; the page calls the data stale when any look-alike was read more
than 24 hours ago and links to the existing "Refresh now".

### Alerts

Built (`packages/core/src/alerts/`, `packages/server/src/alertsEngine.ts`,
`alertsRoutes.ts`, `apps/web/src/lib/alerts.ts`, `components/AlertsPanel.tsx`).
One rule per centre channel, worked out in code on this computer; nothing is
sent anywhere and no AI is used.

| Rule part      | Value                                                                                                                                                               | Constant                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Video          | A look-alike video of the breakout window (30 days) whose outlier score is at or past the owner's number now and was not at the last check (or was not stored then) | `DEFAULT_ALERT_MIN_SCORE` = 5, range 2 to 100 (`ALERT_MIN_MIN_SCORE`, `ALERT_MAX_MIN_SCORE`) |
| Channel        | A look-alike whose group is taken off now and was not at the last check; optional per rule                                                                          |                                                                                              |
| Look-alikes    | The latest map's, as in "What changed since you last looked" (`lookalikeHistories`)                                                                                 |                                                                                              |
| Not comparable | A look-alike with no reading by the last check: nothing of it is told                                                                                               |                                                                                              |
| Once           | Each video or channel is told of once per centre channel (unique key)                                                                                               |                                                                                              |

The default 5× is well past the page's breakout bar (2×), so an alert is rarer
than a breakout; the owner chooses the number per channel. The earlier state is
the store as it was at the rule's `checked_at` (`videosAsOf`), so a new rule tells
only of what happens after it was saved.

When: `checkDueAlerts` checks every rule that is on and has a refresh finished
after its `checked_at`, then moves `checked_at` to now. It runs after each refresh
(the server's `refresh` and `npm run refresh`, one line each through
`checkStoredAlerts`), and before alerts are read, so a refresh that ran elsewhere is
caught up on. An alert is only as fresh as the last refresh, and the page says so.

Routes: `GET /api/alerts?channel=UC…` answers `{centerChannelId, rule,
defaultMinScore, minMinScore, maxMinScore, alerts, unread, lastRefreshAt}` (the 30
newest alerts, `ALERTS_SHOWN`; 404 with no map); `GET /api/alerts/counts` answers
`{counts: {channelId: unread}}` for the badges on "Your channels";
`POST /api/alerts/rule {channel, minScore, takenOff, enabled}` and
`POST /api/alerts/read {channel}` answer the same as the first.

### Your videos against the plan

Built (`packages/core/src/plan/`, `packages/server/src/planEngine.ts`,
`planRoutes.ts`, `apps/web/src/lib/plan.ts`, `components/OwnVideos.tsx`). For one
centre channel, from stored readings only; no AI, no forecast, no advice.

Linking (`linkVideo`): the owner pastes a video id or a youtube.com or youtu.be
link (`parseVideoRef`) beside a kept concept. The video must be stored and of
the centre channel; when it is not stored the server reads the centre channel
once (`ingestChannel` with `refresh`, under the store's lease) and looks again.
A video is linked to one concept per channel; linking a concept again replaces
its video.

Per linked video (`loadPlan`): its views and age now, its outlier score
(`buildVideoReport` on the channel's stored videos) and the views the channel's
videos usually have at that age (baseline × `ageRamp(age)`). For each of the
concept's inspiration videos (its batch's `inspiration`), its views at the same
age as the owner's video now (`viewsAtAge`):

| Rule           | Value                                                                                                                     | Constant                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Window         | A reading taken within a quarter of the age, never under a day; the closest one counts                                    | `SAME_AGE_SHARE`, `SAME_AGE_MIN_DAYS` |
| Date too rough | Either upload date's uncertainty (half its unit: hour, day, 3.5 days for a week, 15 for a month) is wider than the window | `DATE_SLACK_DAYS`                     |
| Not comparable | No reading in the window, a rough date, or the video no longer stored; said with its reason                               |                                       |

The page says the owner's views now and its age beside the inspiration's views
then and its age, and that views on channels of other sizes are not directly
comparable.

The table (`planTable`) counts linked videos by the batch's title format, the
concept's hook style (its name, without the video id the engine wrote before it)
and a length band (under 1, 1 to 8, 8 to 15, 15 to 25, 25 minutes or more;
`PLAN_LENGTH_BANDS`), with the median outlier score of those scored. Under it:
how many videos it rests on, and that a handful proves little.

Routes: `GET /api/plan?channel=UC…` answers `{centerChannelId, linked, table,
linkable}` (404 with no map); `POST /api/plan/link {channel, conceptId, link}`
answers the plan, or 400 (not a video link, another channel's video), 404 (not
found after one read, no kept concept, no map), 409 (the video is linked to
another concept) or 502 (YouTube could not be read), each with a plain reason;
`POST /api/plan/unlink {channel, conceptId}`.

### Upload calendar

Built (`packages/core/src/calendar/`, `packages/server/src/calendarEngine.ts`,
`calendarRoutes.ts`, `apps/web/src/lib/calendar.ts`, `components/UploadCalendar.tsx`).
One centre channel's kept concepts, from the store only.

Status shown, in order: `published` when a video is linked ("Your videos against
the plan"); else the status the owner set in the calendar; else its script's
status; else `idea`. Setting idea, drafting or ready on a concept with a script
writes the script's own status, so the script writer and the calendar agree;
`published`, and any status of a concept with no script, is kept in
`concept_schedule`. Changing only a date sends back the status the owner set
(`setStatus`), so a worked-out status is never frozen.

Weeks start on Monday and are counted from this computer's own date
(`localDate`). They run from this week for at least 8 weeks
(`CALENDAR_MIN_WEEKS`), or to the last planned week up to 26
(`CALENDAR_MAX_WEEKS`); concepts planned before this week or past the last week
are listed apart, and undated ones under "No date yet".

Pace (`winnersPace`): the median of `uploadsPerWeek` (the map's own measure,
over the last 14 days, `CADENCE_WINDOW_DAYS`) of the look-alikes on the latest
map whose group is taken off, with how many there are. A week with fewer videos
planned than that median is marked; with no look-alike taken off there is no
pace and no week is marked. A comparison, not a target.

Routes: `GET /api/calendar?channel=UC…` answers `{centerChannelId, today, pace:
{channels, medianPerWeek, windowDays}, weeks, undated, earlier, later}` (404 with no
map); `POST /api/calendar/item {channel, conceptId, status | null, plannedDate |
null}` answers the calendar, or 404 (no kept concept, no map) or 400 (not a real
date).

### Length and pacing against the winners

Built (`packages/core/src/pacing/`, `packages/server/src/pacingEngine.ts`,
`pacingRoutes.ts`, `apps/web/src/lib/pacing.ts`, `components/LengthPacing.tsx`,
`PacingChart.tsx`). For one centre channel and its latest map, from the store
only; no AI, no advice.

| Figure         | From                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yours          | Every stored video of the centre channel                                                                                                                               |
| Winners        | The look-alikes' breakouts as the breakout list takes them (`winnerVideos`): last 30 days, 2× usual views or more, at most 4 per channel (`MAX_BREAKOUTS_PER_CHANNEL`) |
| Length         | `durationSeconds`, Shorts (60 seconds or less, `SHORTS_MAX_SECONDS`) left out of both and counted                                                                      |
| Words a minute | `transcriptPace` of each video's stored captions (first caption line to the last), Shorts left out                                                                     |
| Spread         | Median and middle half (25th and 75th percentiles, linear between neighbours, `spreadOf`) with the count                                                               |

`GET /api/pacing?channel=UC…` answers `{centerChannelId, lengths: {own, winners},
shortsLeftOut, wordsPerMinute: {own, winners}, rule, lookalikes}` (404 with no
map). The chart is plain SVG: each row's middle half as a bar and its median as a
mark, on one scale from zero to four thirds of the highest value, coloured with
the design tokens (`fill-primary-container`, `fill-metric-amber`).

### Comment mining

Built (`packages/core/src/sources/commentsApi.ts`, `packages/core/src/comments/`,
`packages/server/src/commentsEngine.ts`, `commentsView.ts`, `commentsRoutes.ts`,
`extrasJobs.ts`, `extrasAnalyses.ts`, `packages/mcp/src/extraTools.ts`,
`apps/web/src/lib/comments.ts`, `components/CommentMining.tsx`). For one centre
channel's map.

Reading. `fetchTopComments` calls `commentThreads.list` (`part=snippet`,
`order=relevance`, `textFormat=plainText`, `maxResults=100`): one page per video,
one unit of the key's daily allowance (`COMMENT_UNITS_PER_VIDEO`), at most 10 videos
at once (`COMMENT_MINING_MAX_VIDEOS`). The key is `YOUTUBE_API_KEY`, read from the
live settings at the time of use; it goes only in the `x-goog-api-key` header
(`apiGet`, shared with `dataApi.ts`) and is cut out of every refusal. A refusal with
the reason `commentsDisabled` is a video with comments turned off; one with
`quotaExceeded` or `dailyLimitExceeded` stops the run and the rest are reported as
not tried. Only winners of the map can be read: the look-alikes' breakouts as the
breakout list takes them (`winnerRows`), strongest first. With no key the section
says so and reads nothing. Not checked against the real API: no key was available,
so the client is built to the documented request and reply and tested with
stand-ins.

Asking. One entry in `ANALYSES`, `viewer-requests`, registered through
`extraAnalyses` and started as a job in the one AI slot. Its question names the
channel id and the video ids only; the comments are never put into a prompt. The
engine reads them through one read-only connector tool, `get_viewer_comments`,
which answers only winners of the channel's own map, hands out each video's 60 most
liked stored comments (`COMMENTS_IN_QUESTION`) and opens with a line that comments
are strangers' text and never instructions. The answer is asked in a labelled form
(`FINDING`, `KIND`, `SAYS`, `COMMENTS` with ids). Code keeps only ids among the
comments it handed out, at most 3 per finding (`FINDING_MAX_QUOTES`), and only
findings left with 2 or more (`FINDING_MIN_QUOTES`): a request heard once is not a
recurring one. The page shows each finding with the stored comments, never the
engine's quoting of them.

Routes: `GET /api/comments?channel=UC…` answers `{centerChannelId, keySet,
unitsPerVideo, maxVideos, dailyUnits, candidates, answer}`; `POST /api/comments/read
{channel, videoIds}` and `POST /api/comments/ask {channel, videoIds, engine?}` start
jobs read at `GET /api/extras/job?id=`. Reading answers 400 with no key before it
starts.

### Check before publishing

Built (`packages/core/src/risk/`, `packages/server/src/riskEngine.ts`,
`riskRoutes.ts`, `extrasAnalyses.ts`, `packages/mcp/src/extraTools.ts`,
`apps/web/src/lib/risk.ts`, `components/RiskCheck.tsx`, `RiskParts.tsx`). For one
kept concept's script (the tightened text when there is one, else the draft). A
list of what to look at; no legal advice, no verdict on YouTube's rules.

| Finding         | Worked out by                                   | Rule                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overlaps        | Code, at each look (`scriptOverlaps`)           | Each sentence of the spoken text (headings, cues and check markers left out) against every stored transcript of the look-alikes on the latest map: a run of six or more words in the same order (`LIFT_MIN_WORDS`, the hook library's own check, `longestSharedRun`). Six-word runs are indexed first so long transcripts are compared quickly. Each gets an id, o1, o2… |
| Unchecked facts | Code, at each look (`checkMarkers`)             | Every [CHECK: …] left in the script, counted and listed                                                                                                                                                                                                                                                                                                                  |
| Claims          | One AI question, then code (`verifyRiskAnswer`) | A title, alternate title, thumbnail brief or overlay claim the script does not support. Kept only when its words are really in that part of the packaging and the script's words are really in the script (or NONE), compared in one case with single spaces and one kind of quote mark; at most 12                                                                      |
| Overlap notes   | The same question, then code                    | One sentence describing an overlap; kept only for an id code produced                                                                                                                                                                                                                                                                                                    |

The question is one entry in `ANALYSES`, `risk-check`, started as a job in the one AI
slot. It names the channel id and the concept number only, and reads through three
read-only tools: `get_concept`, `get_script` and `get_risk_findings`, which hands
over what code found under a line saying it was worked out in code and is to be
described, never judged. The checked answer is kept per concept with the time the
script last changed then, so a later change is said.

Routes: `GET /api/risk?channel=UC…&concept=N` answers `{centerChannelId, concepts,
check}` (the kept concepts with a script, and the chosen one's check); `POST
/api/risk/ask {channel, conceptId, engine?}` starts the job, read at `GET
/api/extras/job?id=`.

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

### Monetization signs

Built (`packages/core/src/money/`, `repos/sqliteMoneyRepo.ts`, `sources/watchHtml.ts`,
server `moneyEngine.ts`/`moneyRoutes.ts`, web `MoneyBadge`, `MoneyCheck`, `MoneyFilter`,
`ChannelMoney`). YouTube does not publish who is in the Partner Program (YPP), so
Jgtube never states a yes or no. It reads public signs, stores them with when they
were read, and the verdict names the sign it rests on.

| Sign                                       | Where it is read                                                                                                                             | Strength                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Join button (channel memberships)          | The watch page's `ytInitialData`: signed out, the button's tip aimed at `sponsorships-button`; signed in, a `sponsorButton` in the owner box | Strong. Memberships are a YPP feature (fan funding, from 500 subscribers) [1][2]. Absence is not proof: a member of YPP may not offer memberships.            |
| Ads in the player answer                   | `ytInitialPlayerResponse.adPlacements` / `playerAds`, only when the page is playable                                                         | Weak. Since the November 2020 "Right to Monetize" terms, YouTube can run ads on channels outside YPP and keep the money [3][4]. Shown as "Likely, not proof". |
| Subscribers against the 500 and 1,000 bars | The stored subscriber count                                                                                                                  | Eligibility only. YPP also asks for watch hours or Shorts views, which are not public, and a review [1][2].                                                   |

Not used: Super Thanks, Super Chat and the shopping shelf are YPP features too, but a
signed-out watch page carried no trace of them on any channel tried; members-only
videos are listed with a badge on some channel pages, but the library the crawl uses
drops it.

**Verdicts** (`moneyVerdict`): a Join button → "Monetized (sign: memberships)"; else
ads shown → "Likely monetized (ads shown; not proof)"; else, on a playable page with no ads, "Not monetized yet as
far as public signs show"; else, when ads could not be seen, "No public sign found
(ads could not be seen)" (badge "No sign"), never "not yet", since such a channel
may well be paid for ads; never checked → "Not checked". The bar: "1,000+ subscribers", "500 to 999 subscribers", "Under the
500 bar", or "Subscriber count hidden".

**When it is read.** Only on request: "Check monetization" on a channel's page, or
"Check N of them" (ten at most) beside a list's monetization filter. Each channel
costs one request: the watch page of its newest stored video, through the source's
rate limiter, redirects refused, at most 6 MB, under the same lease and job slot as a
map, a refresh or a keyword search (refused with 409 while one runs). A page whose
owner is another channel, or that carries no readable data (a consent page), stores
nothing. It is not read during a crawl or refresh: the crawl reads channel pages and
sidebars through the library, which drops the Join tip, so it would cost one more
page per channel, a third to a half more requests on a map of hundreds of channels.

**Store** (step 27): `channel_money_signs`
(`channel_id` PK, `video_id`, `memberships` 0/1, `ads` shown|none|unknown,
`checked_at`). A new check replaces the row. It refers to no other table.

**API**: `GET /api/money?channels=` (1 to 200 ids; store only) and
`POST /api/money/check` `{ channels }` (1 to 10). **Connector**: `get_channel_brand`
and each entry of `list_niches` carry `money` (`says`, `sign`, `at`, `bar`) from the
store; the connector reads no page for it. **Page**: a badge on niche cards, Same
topic cards, the radar inspector, competitor rows and the channel header ("$
Monetized", "$? Likely", "Not yet", "No sign", "Not checked") whose tooltip names the sign, the
day and the video read; a monetization filter on New niches, Same topic and Breaking
out ("Only monetized" keeps a sign of memberships, not ads alone; channels never
checked are left out of both filters, and the panel says how many). New niches has
its own Monetized filter with every verdict as an option, "Not checked" among them,
and the count of unchecked channels with "Check N of them" beside it.

**Verified here (November 2026, signed out, from a data-centre address).** The Join
tip was on two videos each of Linus Tech Tips, Markiplier and NileRed, and on none of
3Blue1Brown, Veritasium, Tom Scott, MKBHD or penguinz0. Every watch page answered
`LOGIN_REQUIRED` ("confirm you're not a bot"), so the ad signal could not be seen
here: it is read only from a playable page and is otherwise "unknown". The ad fixture
in the tests is built by hand in the documented shape, not captured.

Sources: [1] YouTube Help, "Overview of the expanded YouTube Partner Program",
support.google.com/youtube/answer/13429240; [2] YouTube Help, "Get started with
channel memberships", support.google.com/youtube/answer/7636690; [3] YouTube Help,
"I'm not a YouTube partner, so why am I seeing ads on my videos?",
support.google.com/youtube/answer/2475463; [4] Tubefilter, 18 November 2020,
"YouTube Will Now Serve Ads On Channels That Aren't Eligible For Its Partner Program".

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
| `list_niches`                 | `limit?` (15), `watched_only?`                                                          | New or small channels with a video that took off (`listNiches`), each with its stored `money` verdict                                                                                                                                                                |
| `list_transfer_opportunities` | `channel?`, `place?`, `show?` (opportunities, formats, saved, all), `limit?` (10)       | Ideas open or weak for the owner's place with up to five versions each, or the title formats (`listTransfers`)                                                                                                                                                       |
| `make_map`                    | `channel`, `model?`, `depth?` (1..3), `max_channels?` (10..600)                         | Crawls a new map, then the same summary as `get_map` plus warnings                                                                                                                                                                                                   |
| `get_transcript`              | `video` (id or link), `start_seconds?`, `max_chars?` (12,000; 1,000..40,000)            | A line of JSON (`lang`, `auto`, `lines`, `lastLineAt`, `cut`), then the captions as text with the time every half minute; `captions: false` when there are none                                                                                                      |
| `view_video_frames`           | `video`, `sheets?` (4; 1..6), `start_sheet?` (from 1)                                   | A line of JSON (`source`, `ofSheets`, `frames`; with `start_sheet` also `from`, `to` and `next.start_sheet` or `last`), then each sheet as image content                                                                                                             |
| `get_channel_brand`           | `channel`, `images?` (true)                                                             | A line of JSON (`bio`, `keywords`, `links`, `logo`, `cover`, `money`), then the logo and the cover as image content                                                                                                                                                  |
| `get_video_details`           | `video_ids` (1 to 10), `description_chars?` (1,500; 200..5,000)                         | Per video: title, description, tags, `secs`, views, score; `problems` for a video that could not be read                                                                                                                                                             |
| `get_video_watch`             | `video`                                                                                 | A line of JSON (`watched`, `by`, `at`), then the stored notes of an engine that watched the video; `watched: false` when nobody has                                                                                                                                  |
| `get_frame_study`             | `video`                                                                                 | A line of JSON (`studied`, `by`, `at`, `source`, `framesAvailable`), then the stored study of the video's frames; `studied: false` when there is none                                                                                                                |
| `get_idea_brief`              | `channel`, `batch`                                                                      | What the owner chose for one batch of concepts: `picked`, `length`, `modelOpenings`, `format` (`wording`, `from`); never the angle                                                                                                                                   |
| `get_concept`                 | `channel`, `concept`                                                                    | A line of JSON (`concept`, `batch`, `length`, `restedOn`), then the stored concept in its labelled lines                                                                                                                                                             |
| `get_script`                  | `channel`, `concept`, `part?` (plan, draft, tightened)                                  | A line of JSON (`voice`, `targetSeconds`, `targetWords`, `hookWords`, `wordBudget`, `modelHooks`, `frameStudies`), then the concept, the chosen hook, the beats and the asked-for text                                                                                             |
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
| `list_niches`                 | `limit?` (15), `watched_only?`                                                          | New or small channels with a video that took off (`listNiches`), each with its stored `money` verdict                                                                                                                                                                |
| `list_transfer_opportunities` | `channel?`, `place?`, `show?` (opportunities, formats, saved, all), `limit?` (10)       | Ideas open or weak for the owner's place with up to five versions each, or the title formats (`listTransfers`)                                                                                                                                                       |
| `make_map`                    | `channel`, `model?`, `depth?` (1..3), `max_channels?` (10..600)                         | Crawls a new map, then the same summary as `get_map` plus warnings                                                                                                                                                                                                   |
| `get_transcript`              | `video` (id or link), `start_seconds?`, `max_chars?` (12,000; 1,000..40,000)            | A line of JSON (`lang`, `auto`, `lines`, `lastLineAt`, `cut`), then the captions as text with the time every half minute; `captions: false` when there are none                                                                                                      |
| `view_video_frames`           | `video`, `sheets?` (4; 1..6), `start_sheet?` (from 1)                                   | A line of JSON (`source`, `ofSheets`, `frames`; with `start_sheet` also `from`, `to` and `next.start_sheet` or `last`), then each sheet as image content                                                                                                             |
| `get_channel_brand`           | `channel`, `images?` (true)                                                             | A line of JSON (`bio`, `keywords`, `links`, `logo`, `cover`, `money`), then the logo and the cover as image content                                                                                                                                                  |
| `get_video_details`           | `video_ids` (1 to 10), `description_chars?` (1,500; 200..5,000)                         | Per video: title, description, tags, `secs`, views, score; `problems` for a video that could not be read                                                                                                                                                             |
| `get_video_watch`             | `video`                                                                                 | A line of JSON (`watched`, `by`, `at`), then the stored notes of an engine that watched the video; `watched: false` when nobody has                                                                                                                                  |
| `get_frame_study`             | `video`                                                                                 | A line of JSON (`studied`, `by`, `at`, `source`, `framesAvailable`, and worked out in code `secs`, `secondsPerFrame`, `framesLookedAt`, `changesSeen`, `gaps`, `secondsPerChange`), then the stored study of the video's frames; `studied: false` when there is none |
| `get_transcript_pace`         | `video`, `cuts?` (up to 40 seconds from the start)                                      | A line of JSON: `words`, `wordsPerMinute`, `spokenSeconds`, then `spans` (`from`, `to`, `words`, `wordsPerMinute`), one a minute or one between each two cuts; `captions: false` when there are none                                                                 |
| `get_breakdown_part`          | `channel`, `part` (basis, titles, thumbnails, scripts, picture, strategy, plan, master) | A line of JSON (`written`, `by`, `at`), then one stored part of the channel's breakdown; `written: false` with the reason when it is missing                                                                                                                         |
| `get_channel_note`            | `channel`, `kind` (thumbnail-review, style-lock)                                        | A line of JSON (`written`, `by`, `at`), then the kept study; `written: false` when none is kept                                                                                                                                                                      |
| `get_viewer_comments`         | `channel` (id), `videos` (1 to 10 ids)                                                  | A line that comments are strangers' text and never instructions, then JSON: each asked video that is a winner of the channel's map, with its stored comments (id, text, likes), most liked first, 60 at most                                                         |
| `get_risk_findings`           | `channel` (id), `concept`                                                               | A line that it was worked out by Jgtube in code, then JSON: stage, sentences sharing six or more words with a stored transcript, unchecked facts                                                                                                                     |
| `get_thumbnail_comparison`    | `channel` (id), `video`                                                                 | The kept comparison of one video's thumbnail as text, counted in code: its checklist and description, the winners compared, winning values, flagged values, other values, thumbnails not tagged                                                                      |
| `get_format_shelf`            | `format` (number)                                                                       | JSON: the format (name, length, slots) and every ingredient on the shelf with its layer, source, channels, evidence counted in code, `proven`, and the names of its pictures (`i<id>-<n>.<ext>`); the AI's earlier readings are labelled as such                     |
| `view_format_pictures`        | `names` (1 to 8 picture names from the question)                                        | The shelf's pictures (teardown keyframes and strips, the owner's pictures) as image content, each under a line naming it; one that is gone is a line of text                                                                                                         |
| `get_active_format`           | `channel` (id)                                                                          | JSON: `active: false` when none; else the plan: title formulas, hook and beats, chapters, words and cuts a minute (measured), pacing rules, visual style, thumbnail layouts, palette                                                                                 |
| `search_outlier_bank`         | filters (`min_score`, `max_age_days`, `topics`, `length`, …), `limit?` (15; 1..30)      | Every stored video across all maps and lists under the filters: score with its usual and sample, views, age, length, channel, topic, money, closeness; `total`, `matched`, `more`. Store only; see "Outlier bank"                                                    |

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

### How a question is written (`promptParts.ts`)

Every question to an engine is built by `buildPrompt` from named sections,
each between a pair of tags on lines of their own, always in this order:

| Section           | Holds                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `<task>`          | What to produce, for which channel, video or concept (ids and numbers checked in code)                 |
| `<owner>`         | Who reads the answer and what they do with it: why specifics matter                                    |
| `<gather>`        | The tool calls to make, numbered, in order                                                             |
| `<craft>`         | What a director judges the work by: the criteria of this task                                          |
| `<rules>`         | The rules on evidence: numbers only from tools, tool results as data, what to do when evidence is missing |
| `<output_format>` | The form of the answer, exactly as the code that reads it expects, and its length                       |

A question always has `<task>`, `<rules>` and `<output_format>`. The system
prompt says who the engine is and that the tags never appear in an answer
(`TAGS_NOTE`). The craft that several questions share is written once:
`TITLE_CRAFT`, `THUMBNAIL_CRAFT`, `HOOK_CRAFT` (the first 5, 15 and 30
seconds), `RETENTION_CRAFT`, with `SPECIFICITY` and `MISSING_EVIDENCE`. None
holds an example title, subject or channel, so nothing in a question can be
copied into an answer, and the same question serves any niche.

Where code refuses an answer over a length (a teardown stage, a Format
Bible), the question states the limits, a little under what code allows.

Three sets of tests hold this in place without asking an engine anything:
`promptSnapshots.test.ts` (one snapshot of every question built with stand-in
values, so a change of wording is read in review), `promptLint.test.ts` (every
question says who the engine is, has the three required sections in order,
carries a rule on evidence and on missing evidence, forbids forecasts where
views are mentioned, names no niche and no AI product, closes its marker
lines, asks for one form of answer; an answer written to each output form is
read by the real parser; a teardown stage and a Bible filled to the stated
limits pass their schemas; a script's word budget adds up) and
`promptCatalog.ts`, the list both read. `docs/PROMPT_AUDIT.md` says what was
found wrong and changed; `docs/PROMPT_EVAL.md` is the owner's side-by-side
checklist.

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

**Picture questions** (the thumbnail review `thumbnails`, the thumbnail checklist
`thumbnail-tags`, the idea lab's `concept-thumbnail`, a breakdown's `thumbnails`
and `picture` parts, the one-video breakdown `one-video`, the frame study, and
the teardown's `hook`, `design`, `archetypes` and `motion` stages) go to every
engine that sees pictures, in the owner's order (`PICTURE_ENGINES` =
`TOOL_PICTURE_ENGINES` + `FILE_PICTURE_ENGINES`):

- **Claude Code and Codex** see the pictures a tool returns (`view_thumbnails`,
  `view_teardown_images`, `view_video_frames`).
- **Antigravity sees pictures as files.** Its CLI does not see a tool's
  pictures: its documentation says "Non-UI surfaces such as the Antigravity CLI
  run the same tools using their plain-text `content` results"
  (antigravity.google/docs/mcp), and of an `@file` mention that the agent gets
  the full path and "The agent reads it when it needs to"
  (antigravity.google/docs/at-mentions). So every picture question has a
  **files route** (`filesRoute`; a test fails for a picture question without
  one): code makes the same pictures the tool would have shown into files
  (`pictureSource.ts`), writes them into the run's own private folder and names
  them in the question with `@`, by role only; the picture tool is then not
  offered. What each question is handed (`PictureNeed`):

  | Question                           | Files                                                                                                                                                                                      |
  | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | Thumbnail review, thumbnail prompt | Thumbnails chosen from the board (`thumbnailFiles.ts`): the owner's latest four, two winners and two ordinary of the four closest channels, two winners of the next four, `thumb-<id>.jpg` |
  | Thumbnail checklist                | The named thumbnails                                                                                                                                                                       |
  | Breakdown, thumbnails part         | The top videos' and the ordinary videos' thumbnails, in two groups                                                                                                                         |
  | Breakdown, picture and sound part  | Each measured video's frame strips (6) and keyframes (4), 24 in all, `<id>-s-001.jpg`, `<id>-k-001.jpg`; none measured is an empty set, not a failure                                      |
  | Frame study                        | Every frame sheet (60 at most), `frames-01.jpg`, each listed with where its frames came from, its grid and the times of its frames, all from code                                          |
  | One video                          | Its thumbnail                                                                                                                                                                              |
  | Teardown picture stages            | The stage's own capped pictures (see the production teardown)                                                                                                                              |

  One shared helper (`pictureFiles.ts`) builds the listing, reads pictures from
  disk, and asks a text answer to start with a line `PICTURES OPENED:` naming
  the files it opened. Code then counts the given file names the answer names
  (`seen: {shown, named}`); an answer that names none **may not have seen the
  pictures**, and the page says so, with a rerun on another engine. A JSON
  answer (the checklist, the teardown stages) is not asked for the line.

**Antigravity is a picture engine by default.** The **picture check** is an
optional diagnostic in Settings: only an explicit failed check (its last result)
keeps Antigravity from picture questions; a check never run, or one that passed,
changes nothing. Settings and the AI line say so, with "Run the check again".

**No dead ends** (`pictureRoute.ts`). With an engine chosen on the switch, a
picture question goes to that engine first, then to every other engine that sees
pictures, in the owner's order. A chosen engine that failed the picture check or
that the setting leaves out is passed over with that reason before anything
starts; one whose run fails (a limit, a timeout, pictures that could not be
made into files) is passed over like any backup. The answer then carries
`standInFor: {engine, because}`, shown as "Written by X because Y could not: ...".
Nothing is written only when no engine that sees pictures could answer:
"<question> needs an AI that sees pictures (Claude Code, Codex or Antigravity),
and none is available here." A question without pictures keeps the rule below:
a chosen engine alone, no backup.

The **picture check** itself (`pictureCheck.ts`, `POST /api/engines/picture-check {engine}`):
two 64-pixel PNGs made in code (`solidPng.ts`, zlib only), each one solid colour
picked at random from eight clearly different ones (red, orange, yellow, green,
blue, purple, grey, black), are written into the run folder and named as
`@picture-1.png` and `@picture-2.png`; the prompt names no colour, the run has
no tools, and code checks the answer: both colours right and in order passes. A
guess passes one time in 8 x 7 = 56 (under 2%). The last result per engine is
kept in a small file beside the store (`<store>.picture-checks.json`,
owner-only, checked against a schema when read; anything unreadable counts as
never run), and `GET /api/engines` returns it as `pictureChecks`. A run that
fails (not installed, timed out) keeps nothing and the earlier result stands.
Claude Code and Codex are refused (400): they need no check. The check shares
the analyses' one-at-a-time turn (409). An engine the owner's setting leaves out
is never used.

The connector an analysis starts is given `JGTUBE_TOOLS`, the bare names of the
tools that analysis may use, and registers no others. So the limit on tools
holds at Jgtube's own layer, whatever an engine does with its own allow-list
(`enabledTools` for Antigravity and `enabled_tools` for Codex are still
written, but nothing depends on them being honoured).

`POST /api/analyses {analysis, channel, engine?}` waits for the answer (up to
five minutes) and returns `{analysis, text, engine, skipped, standInFor, seen}`,
where `skipped` lists the engines passed over with the reason, `standInFor` the
chosen engine another answered in place of (null otherwise) and `seen` how many
pictures handed over as files there were and how many the answer names (null
for a question that handed none). One runs at a time (409
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
     that sees pictures (in the owner's order, or the one chosen on the switch
     first and the others after it): Claude Code and Codex with the one tool
     `view_video_frames`, Antigravity with every sheet as a file and no tool. With a file
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
the fixed question, the tools, the limits, whether it looks at pictures, and
for those its files route (`files`: the tools less the picture tool, the
pictures that tool would have shown, the question naming them with `@`).
`thumbnails` and `picture` look at pictures and go to every engine that sees
them, Antigravity as files; the other five may be written by any engine in the
owner's order. With one engine chosen on the switch, a picture part it cannot
write is written by the next engine that sees pictures and stored with a
caveat saying so; a part without pictures that engine cannot write is recorded
as not written and the rest are written. `POST /api/analyses` takes none of them.

**What a reader should know** (store step 30, `breakdown_parts.caveat_json`):
a written part may carry `standInFor {engine, because}` (another engine wrote it
because the chosen one could not) and `unseen {shown}` (written from that many
pictures handed over as files, naming none of them). It is read back through a
check that keeps only those two things; the page shows "Written by X because Y
could not: ..." and "X may not have seen the pictures", with **Write it again on
another AI**.

**Writing one part again.** `POST /api/breakdowns` also takes `parts` (written
parts to write again) and `avoid` (an engine to leave out). Then nothing is
downloaded, watched, studied or measured: the deep videos are read back from
their stored studies, the basis is left as it is, the chosen parts are written,
then every part built on one written again (the strategy, the plan and the
master prompt read the parts before them), and every other part is kept as it
stands. The page offers **Write this part**
on every part that is not written (a part refused under the old rule that kept
picture parts from Antigravity among them) and **Write it again on another AI**
on one that may not have seen its pictures (with `avoid` set to its engine and
the choice left to Jgtube).

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

**The page.** (Now Breakdown's Channel tab; see "The Breakdown view".) Picking a channel shows the breakdown
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

Not run for real: a part written by Antigravity or Codex (stand-ins only; that
includes Antigravity opening the picture files it is handed, which no test here
can show); a
video file downloaded, cut and studied (YouTube refused the download from that
network), and so the seconds between picture changes from frames a second
apart; an engine watching a video, and so any part written from watch notes;
a channel with fewer than 20 or more than 40 stored videos; Windows.

### The Breakdown view (`breakdownCandidates.ts`, `breakdownHub.ts`, `breakdownHubRoutes.ts`, `oneVideoEngine.ts`, `oneVideoQuestions.ts`; web `BreakdownChannelTab.tsx`, `VideoBreakdownTab.tsx`, `lib/breakdownPicks.ts`, `lib/videoBreakdown.ts`)

Built. Breakdown is its own destination in the rail, between Create and Ask
AI, with two tabs; Ask AI keeps the quick questions only. Old breakdown
addresses (`#breakdown…`) open it.

**Channel tab** (`#/breakdown`, one channel at `#/breakdown/<id>`):

- _Paste a channel link_: an @handle, a youtube.com channel link or a `UC…`
  id, checked on the page and again on the server.
  `POST /api/breakdowns/channel {channel}` reads a channel that is not stored
  the way a map's centre channel is read (`readChannelBrand`: its page, its
  logo and up to 100 recent videos; no crawl), in the slot crawls and refreshes
  hold (409 while one runs or another program reads YouTube), and answers
  `{candidate}`. A read that fails is a plain 502.
- _Suggested to break down_ (`suggestedPicks` in `lib/breakdownPicks.ts`):
  up to three channels from stored data only: not the owner's own, at least
  `MIN_STORED_VIDEOS` (10) stored videos, something breaking out now, and never
  broken down or last broken down `STALE_DAYS` (90) or more ago; closest
  look-alikes first (closeness outweighs everything else), then the most
  breaking out, then the best recent score (capped at 20×). Each has a one-line
  reason built from the same facts.
- _Your breakdowns_: the channels with a kept breakdown, newest first, with
  logo, date and Open.
- _All channels_: the map's channels, the owner's channels and the niche
  lists, with a search (name or handle) and three filters (Close only, Has
  breakouts, Not broken down yet), twelve at a time. Every row shows the logo,
  name, subscribers, "N breaking out", Close / Medium / Far (map channels
  only), "Broken down <date>" and a strip of three of its best thumbnails with
  their scores, and the monetization badge (`MoneyBadge`, left out for a
  channel never checked) in the row's badge slot.
- `POST /api/breakdowns/candidates {ids}` (up to 800 channel ids) answers, per
  stored channel, `{id, title, handle, logoUrl, subscribers, storedVideos,
breakingOut, recentBest, top, brokenDownAt}`: breaking out is the feed's own
  rule (2× usual or more, last 30 days), `top` the three best videos by score,
  `brokenDownAt` the newest `breakdown_parts` row. Read from the store only.
- One channel opened shows its logo, numbers, three best thumbnails, the one
  primary button "Break it down" and its kept breakdown (`BreakdownStatus`, as
  before). The run is the existing job (`POST /api/breakdowns`), listed at
  `GET /api/jobs` as `breakdown`; a page opened while one runs (after a reload)
  finds it there and follows it again.

**One video tab** (`#/video-breakdown`): a deep breakdown of one video, from a
YouTube link or a video file.

- A file is sent with `PUT /api/video-breakdowns/files` (the same streamed,
  capped writing as the owner's own copies, `MAX_OWN_VIDEO_BYTES` 2 GB): MP4,
  WebM or MOV by its content type, checked to be whole (`isWholeMp4` for MP4
  and MOV, the EBML header for WebM), saved as `my-videos/<id>.<ext>` under a
  new random id of the same shape as a YouTube id (`newUploadKey`), answered
  `{file, bytes, kind}`. The server hands this path the body as a stream, as
  it does the other upload path.
- `POST /api/video-breakdowns {video | file, name?, engine?, fresh?}` starts a
  job (202 `{jobId, video}`), listed at `GET /api/jobs` as `video-breakdown`
  with its `videoId`; it takes the one slot every AI run shares (409
  otherwise). A bad link is 400 with the forms it takes; a file id no longer on
  disk 404.
- **The steps**: the production teardown below (`oneVideoEngine.ts`,
  `teardownEngine.ts`). A YouTube video's title, channel and length and its
  captions; a file: the owner's own copy, else one download (720p, yt-dlp then
  the built-in route; not for a video longer than `WATCH_MAX_SECONDS`), or the
  file given. No file is fetched when every part is kept from an earlier run.
  The job fails only when nothing at all could be measured or judged.
- **Kept** as teardown parts (`video_teardown_parts`) and, so the list of kept
  breakdowns stays as it was, one row in `video_breakdowns` (store step 28)
  holding the title, source, channel, how it was seen and the whole teardown as
  Markdown (`engine` = `jgtube`). `GET /api/video-breakdowns?video=<id>` gives
  the view with `teardown`: the report put together from the stored parts.
- **Before starting** the page says what it takes:
  `GET /api/video-teardowns/runs?video=<id>` answers `{runs, kept, watch}`: one
  AI run per stage not kept (8, or 9 with a watch); measuring in code is not an
  AI run.
- **The page** ("Production teardown and style bible") says how the video was
  seen, then eight sections: 1 measured numbers with their method; 2 the
  palette as swatches (hex and share of runtime), colour modes, type and motion
  signatures; 3 the component library as cards, each with its keyframe; 4 the
  hook sheet and a beat table (time, visual and camera, on-screen text,
  narration from the transcript, sound marked heard or measured); 5 the chapter
  timeline with cuts a minute, median shot, words a minute, transitions and
  animations per chapter, techniques with quotes (each marked found or not
  found in the transcript) and the hammer lines; 6 motion and transitions: the
  transition and camera mixes counted in code and the vocabulary as cards with
  their frame strips, frames and measured duration, easing and a rebuild
  recipe; 7 sound, saying plainly when it was not heard; 8 the pipeline table,
  components, steps, ready prompts with Copy, and what not to copy.
  "Download .md" (`GET /api/video-teardowns/<id>/teardown.md`) and "Download
  folder (.zip)" (`…/export.zip`: `teardown.md` with relative `images/` links,
  the pictures, `transcript.txt`, `measurements.json`). Pictures are served from
  the local store at `…/images/<name>`, the name checked against `k-###`,
  `s-###`, `hook`, `chapter-##` and the bytes against a JPEG header, so the
  page's `img-src 'self'` holds.

### Production teardown (`core/src/teardown/`, `teardownEngine.ts`, `teardownQuestions.ts`, `teardownRequests.ts`, `teardownStore.ts`, `teardownRoutes.ts`, `channelMeasure.ts`, `mcp/src/teardownTools.ts`)

The standard it is built to: a standalone run that watched one documentary
explainer produced a "production teardown and style bible": a metrics table
(runtime, words a minute, cuts with median and average shot, loudness, quiet
dips and peaks, each with how it was measured), colour modes with exact hex
values, type and reveal animations, a library of a dozen recurring visual
templates each with a still, a one-frame-a-second sheet of the opening with a
beat table (visual, on-screen text, narration, sound), the chapter structure and
rhetoric with quotes and times, the sound design, and a per-layer plan to make
videos in that style with ready prompts. Jgtube's teardown has the same
sections and more (every frame gone through for transitions and motion), but
every number is measured in code and labelled with its method; engines judge
only what code cannot.

**Measured in code** (`measure.ts`, `measureMotion.ts`; ffprobe and ffmpeg
started without a shell, absolute paths; constants in `constants.ts` and
`motionClassify.ts`):

| What                                                | How                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Length, size, frame rate, sound or not              | `ffprobe -show_streams -show_format`                                                                                                                                                                                                                                                                                                                          |
| Cuts, shots, median and average shot, cuts a minute | `select='gt(scene,0.3)',showinfo` (`SCENE_THRESHOLD`)                                                                                                                                                                                                                                                                                                         |
| Integrated loudness, range, true peak               | `ebur128=peak=true:framelog=verbose` (EBU R128)                                                                                                                                                                                                                                                                                                               |
| Quiet dips                                          | `silencedetect=noise=-32dB:d=0.4`                                                                                                                                                                                                                                                                                                                             |
| Peak impacts                                        | `astats` peak per 0.5 s window (longer for long videos); a window over −12 dBFS after one at or under it                                                                                                                                                                                                                                                      |
| Keyframes                                           | one per shot, its middle; over 40 shots, 40 runs of neighbours, each shown by its longest shot                                                                                                                                                                                                                                                                |
| Palette                                             | every keyframe shrunk to 48×27, pixels weighted by the seconds their shots last, k-means (8 groups, fixed farthest-point start), under 2% dropped: hex and share of runtime                                                                                                                                                                                   |
| Hook sheet                                          | the first 36 s, one frame a second, 6×6                                                                                                                                                                                                                                                                                                                       |
| Chapter sheets                                      | once chapters are named: 20 frames spread across each (10 chapters at most)                                                                                                                                                                                                                                                                                   |
| Words                                               | captions, else what the engine that watched heard (marked so): words, words a minute overall and per chapter, sentence length, 2–5 word hammer sentences                                                                                                                                                                                                      |
| Every frame                                         | shrunk to 160×90 grey and compared with the one before, streamed from ffmpeg: mean absolute difference, brightness, and the global shift and zoom from the row and column brightness profiles                                                                                                                                                                 |
| Transitions                                         | flash (40 grey levels brighter, back within 3 frames); fade to or from black or white (5+ frames ramping to ≤20 or ≥235); whip-like (2–10 frames changing 8%+); dissolve (0.4% above the usual change for 6 frames to 3 s, ends 8%+ apart and at least 0.6 of the summed change); cuts from the scene pass, one at the edge of a flash or fade folded into it |
| Holds, animation                                    | hold: under 0.06% change for 1.5 s; on-screen animation: 0.08% above the usual change for 3+ frames, camera still                                                                                                                                                                                                                                             |
| Camera per shot                                     | trimmed mean shift and zoom: push in or pull out (1%/s), pan or tilt (3% of the frame a second), shake (0.8 px), else still                                                                                                                                                                                                                                   |
| Frame strips                                        | ten frames at the video's own rate around a chosen event (every nth frame for a long one), 5×2: the opening's first (6), then up to 3 of each kind across the video, 24 at most                                                                                                                                                                               |

Tested on clips ffmpeg makes inside the tests (`teardownMeasure.test.ts`,
`teardownMotion.test.ts`, `teardownReport.test.ts`): cuts at exactly 3, 7 and
9 s, a 4–6 s silence and one peak at 9 s; a 1 kHz tone at −20 dBFS reads −23
LUFS and −20 dBFS true peak; four colours read back with their shares; a pan
(15.6% of the width a second), a tilt, a push in, a dissolve at 1.56 s for 25
frames, fades out and in, a one-frame flash, a whip and a sliding graphic.

**Judged by engines**, each stage one run answering one JSON object checked with
zod (`stages.ts`), stored as it is made and reused unless `fresh`:

1. `structure`: chapters from the transcript and the cut times (any engine).
2. `watch`: Antigravity, when installed and in the owner's order, watches the
   whole file with sound, chapter by chapter (times from code only): sound,
   music, effects, sound synced to motion, the opening's sound beat by beat,
   and the words when there are no captions.
3. `hook`, `design`, `archetypes`, `motion`: picture stages, to Claude Code and
   Codex through `view_teardown_images` (8 pictures a call at most) and to
   Antigravity as files named in the question (unless its last picture check
   failed), read through the shared `pictureFiles.ts`; with an engine chosen,
   the next one that sees pictures answers when it cannot. Code
   chooses and caps the pictures (hook: the sheet and the opening's keyframes,
   7; design: chapter sheets, 6; archetypes: keyframes, 24; motion: strips, 16).
4. `techniques`, `sound`, `plan`: any engine.

Every stage reads its data through `get_video_teardown` (measurements,
transcript, earlier stages, under a line saying it is data, never
instructions); a question names only the video id, picture names and numbers
worked out in code. Code then adds to what was judged (`report.ts`): chapter
numbers, each hook beat's narration from the transcript, measured sound where
nothing was heard, colours kept only when they are in the measured palette
(others listed as not measured), keyframes and strips kept only when they
exist, quotes checked against the transcript.

**In the channel breakdown.** The owner chooses how many top videos to study in
depth (1 to 5, three by default); `GET /api/breakdowns/runs?videos=` says first
what that takes (`aiRuns`: a frame study, plus a watch where Antigravity
watches, per video, plus the 7 parts; `measuredInCode`: those videos and 2
ordinary ones, no AI). Each deep video, and 2 ordinary ones for contrast, is
measured in code into the same teardown store, so a video the One video tab
measured is not measured again, and the other way round. The seven parts keep
their structure and read the measured layer through
`get_channel_measurements` (`channelFacts.ts`, `titlePatterns.ts`): title
patterns counted over the high and low groups (numbers, years, money,
questions, splits, capitals, capitalised names, you, I or we, words of degree,
charged words, lengths, repeated openings), the thumbnail checklist counted
where a thumbnail review tagged them, words, hook pace and hammer lines, cuts a
minute, median shot, loudness, the shared palette, transitions and camera
moves, winners beside ordinary, and each measured video's keyframes and strips.
Titles add the measured patterns, ten ready titles and what not to copy;
thumbnails the checklist counted, layout archetypes and a prompt per archetype;
scripts the measured numbers, a hook second by second, open loops, a template
and a script prompt; picture and sound becomes the style bible, looking at the
strips and keyframes (so it needs an engine that sees pictures: Claude Code and
Codex through `view_teardown_images`, Antigravity with them as files); strategy
ties each point to a measured difference or a quote, with gaps and risks; the
plan adds a per-layer pipeline with the measured loudness and pacing rules and
no made-up durations; the master prompt writes the measured rules in as
numbers. The style lock and the script writer read these parts as before.

**What was run for real.** The measurements, on generated clips (the tests
above, real ffmpeg 6.1), and the teardown page at 1440 and 390 wide on a seeded
teardown. Not run for real: a stage judged by any engine (stand-ins only), a
watch by Antigravity, a channel breakdown with the measured layer.

**What was run for real.** On a copy of a real store (1440 and 390 wide):
both tabs, a pasted channel refused in words, the filters, a channel opened,
no console error, no sideways scroll. One end-to-end run on a 12-second
generated test clip uploaded through the route: saved, frames cut with ffmpeg
(12), the frame study refused by Claude Code's plan limit, and the job failed
with that reason named; no breakdown was written. Not run for real: a written
one-video breakdown, a watch by Antigravity or the Gemini API, a WebM or MOV
converted for watching, a pasted channel read from YouTube.

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
to `targetWords` and, section by section, to `wordBudget`, with cue lines and
markers, headings `## `; cues at the rate
the picture really changes when `get_script` lists frame studies of the voice
channel, else where the subject changes, with no cut rate invented. Tighten:
the same script toward `targetGrade` (the voice's own), nothing added, every
marker and cue kept, and the length kept section by section (tightening is
not shortening).

**A beat is never dropped silently.** The question asks for each beat in one
line of at most 45 words. `parseHooksAndBeats` keeps a beat of up to
`MAX_BEAT_CHARS = 1200` characters whole (a real run wrote nine beats of 257
to 946 characters; under the old limit of 400 the app stored two of them and
said nothing). A longer beat is shortened at the end of a sentence (at a
word, with "…", when it has none) and kept, and a sheet of more than 120
beats keeps the first 120; each is said in `notes`, which the stage's outcome
carries (`ScriptOutcome.notes`) and the page shows above the script. `parseHooksAndBeats` and `scriptBody` read the answers;
an answer with no hook or no words changes nothing.

**The word budget** (`core/src/script/budget.ts`, `wordBudget`). A draft asked
only for a total came out about a quarter short in the owner's test: a count
is lost over a long answer. So once there is a beat sheet, `get_script` gives
`wordBudget`: the hook's words, then the rest of `targetWords` shared among
the beats by the time from each beat's start to the next (the last to
`targetSeconds`), in whole words that add up to `targetWords` exactly
(largest remainders first). A beat without a time, or times that do not
climb, share the rest evenly; with no length, no rate or no beat there is no
budget and the draft shares the words itself. The draft question has the
engine write and count one section at a time, lengthen any section under its
number from what the fact sheet and the tools give (never by inventing or
repeating), and add the sections up before answering.

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

### Format builder (`core/src/format/`, `sqliteIngredientRepo.ts`, `formatSources.ts`, `formatEngine.ts`, `formatRoutes.ts`; web `FormatView.tsx`, `AddToFormat.tsx`, `lib/formatShelf.ts`)

Built in four batches: ingredients, the "Add to format" buttons and the
shelf (1); formats with slots, fit and originality checks and "Suggest a mix"
(2); the Format Bible and its export (3); an active format per channel feeding
the Idea lab, Script writer, thumbnails and Your videos (4).

**Ingredient.** One piece of a format from one source, on one layer: title
formula, hook, structure, pacing, visual style, motion and transitions,
thumbnail layout, sound, other. It holds a short name, the source (kind, key,
label), the channels it comes from, `details` (what the source holds; an
engine's words only under `reading`, shown as "AI's reading"), `evidence`
and `media` (YouTube thumbnails, teardown keyframes and strips, a quote, the
owner's picture).

**Evidence comes from code only.** A button sends only what names the source
(`POST /api/format/ingredients`, zod-checked: a formula id and window, a hook's
video, a teardown section and item number, a breakdown part and optional
layer, a transfer key, a niche channel, a video and what it was used as, a
link, or the owner's note, picture or clip). The server reads the source from
the store (`resolveIngredient`) and builds the ingredient with the pure
builders in `core/src/format/`; a source that is not stored is answered 404 in
plain words and nothing is made up. Counts: a formula's videos, channels and
average score as verified; a transfer format's videos, channels and median
views; a transfer idea's versions, channels and mean score; a hook's style
counts every library hook given the same style name (case ignored), with the
opening's words and pace from its captions; a video its stored views, length
and outlier score; a teardown section the measured numbers with their methods
(pace, shot lengths, words a minute, palette hex and share, loudness,
transitions, chapters); a breakdown part counts one channel; the owner's own
count nothing.

**Proven.** `PROVEN_MIN_VIDEOS = 2` and `PROVEN_MIN_CHANNELS = 2`: at least two
videos from at least two channels. One lucky video, however high its score,
and one channel repeating itself are never proven. The "Proven first" order is
proven, then more channels, more videos, a higher score.

**Sources and buttons.** Formats (title formula and transfer format cards),
Hooks, Breaking out (the video as a raw source), Thumbnails ("Add layout"),
Transfers, New niches, Your videos (uploads and linked videos), each written
breakdown part (picture also as motion or sound, scripts also as hook or
pacing), and the teardown's sections (pacing, palette, typography, each
component, hook beats, structure, transitions, each motion item, sound; shown
only once the video is measured). "Add your own": a YouTube link (read from
the store when stored, else kept with its id only), a note, a picture (PNG,
JPEG or WebP, checked by its first bytes, at most 8 MB, streamed by
`PUT /api/format/images` and saved under a new name in
`<downloads>/formats/`, read back at `GET /api/format/images/<file>`), or a
clip (sent through the One video upload). A raw video's "Analyse it" fills the
One video tab's link (`lib/videoHandoff.ts`); the owner presses Break it down
there, so nothing runs on its own.

Other routes: `GET /api/format/ingredients`, `POST .../note`, `POST
.../remove`. A second add of the same source on the same layer answers the
one already there.

**Formats** (`core/src/format/formats.ts`, `sqliteFormatRepo.ts`; server
`formatBuilder.ts`, `formatBuilderRoutes.ts`; web `FormatBuilderPanel.tsx`,
`FormatPicker.tsx`, `FormatSlots.tsx`, `MixPanel.tsx`, `lib/formatBuilder.ts`).
A channel has several named formats (Long-form, Shorts…), each with a planned
length and notes; "Copy as next version" makes "… v2" (then v3), with the same
slots and no suggestion, on the same channel. Each layer is a slot filled from
the shelf (proven first), swapped, emptied, or noted. A slot naming an
ingredient taken off the shelf reads as empty. Routes: `GET
/api/format/formats?channel=`, `POST /api/format/formats` (name, length,
channel), `.../update`, `.../duplicate`, `.../remove`, `.../suggest`; bodies are
zod-checked.

**Checks** (`core/src/format/checks.ts`), worked out in code each time a
format is read; they flag and change nothing:

- _Hook length_: the hook's seconds (its counted words over its measured pace,
  or the end of its last beat) against the length planned: 10 s for a Short (a
  minute or less), else the longer of 60 s and a tenth of the video.
- _Pacing against motion_: cuts a minute of the pacing slot against those of
  the motion (else visual style) slot; more than twice apart is flagged.
- _Thumbnail promise_: the thumbnail and the hook come from different videos,
  so the opening may not pay off the promise.
- _Originality_: the channel most filled slots come from; more than 60 % of at
  least two filled slots from one channel says "This copies one channel", with
  the counts.
- _Unproven_: each filled slot whose ingredient is not proven.

**Suggest a mix** (`formatMixRequests.ts`, core `mix.ts`, `mixShelf.ts`). One
AI run, with the engine chosen in the header, in the one slot every AI run
shares, as a job (`format-mix`) listed in Working, so the page finds it again
after a reload. It may call only read-only tools: `get_format_shelf`, with a
map open `get_map` and `get_breakouts`, and for pictures
`view_format_pictures` and `view_thumbnails` (Antigravity gets the same
pictures as files, through the picture route the other picture runs use). The
answer is one JSON object, checked with zod: per slot a layer, an ingredient
id and a one-line reason citing the evidence. Code keeps only ingredients on
the shelf, on that slot's layer, one per layer, and lists what it dropped and
why; nothing is applied until the owner presses "Use" on a slot or "Use the
whole mix". The reasons and summary are shown as the AI's reading.

**Format Bible** (core `format/bible.ts`, `bibleFacts.ts`, `bibleSchema.ts`,
`bibleMarkdown.ts`, `paletteStrip.ts`; server `formatBible.ts`,
`formatBibleQuestions.ts`; web `BiblePanel.tsx`). "Write my Format Bible" is
one AI run in the shared slot, a job (`format-bible`) listed in Working, using
the same read-only tools and picture route as "Suggest a mix" (the shelf ask
carries `purpose: 'bible'`; more turns and time). It is written from the
filled slots only.

- _Facts, from code_ (`bibleFacts`): each filled slot with its evidence and
  the owner's note, every measured number with its method and source, the
  palette (hex and share from the slots' teardowns), title formulas with
  their counts, the hook's seconds, words a minute, the typography a
  teardown's AI reading named, and the slots' pictures. They are kept with
  the Bible, so its export does not change when the shelf does.
- _Words, from the AI_: core rules, visual system (a role may be given only to
  a measured hex code; any other is dropped and listed), typography,
  component kit, motion recipes, pacing rules, hook and chapter beats, title
  formulas with examples, thumbnail layouts with image prompts, sound
  targets, a pipeline per layer, a master prompt and what not to copy. The
  answer is one JSON object checked with zod (`checkBible`).
- _Numbers_: the Markdown's tables hold only the facts. Every number in the
  AI's words that no fact holds (hex codes and whole numbers up to 10, which
  are counts, aside) is listed per section under "Caveats", and the Format
  tab says how many there are.
- _Export_: `GET /api/format/formats/<id>/format-bible.md` (the production
  teardown's shape: 1 core rules to 12 what not to copy, then the evidence),
  and `.../format-bible.zip` with the Markdown, `palette.json` (measured
  colours, shares and sources; roles marked as the AI's reading),
  `palette.png` (a 600×80 strip, each colour as wide as its share), `fonts.txt`
  (the fonts the Bible names, as the AI's reading) and `images/` (the slots'
  pictures still on this computer).

**Active format** (core `format/plan.ts`, `titleFit.ts`, `followed.ts`;
server `formatInQuestions.ts`, `formatOwnVideos.ts`; web `FormatPicker.tsx`,
`AgainstFormat.tsx`, `lib/formatFollowed.ts`). A channel has at most one
active format (`channel_formats`), set with "Make active" on the Format tab
(`POST /api/format/active {channel, id | null}`); the list marks it.

- _Its plan_ (`formatPlan`) is what the other runs read through the
  read-only `get_active_format`: title formulas, the hook (name, how it opens,
  a quote, its seconds, its Bible beats), chapter beats, words and cuts a
  minute measured in the slots, pacing rules, the visual style (slot, Bible
  summary, components, motion), thumbnail layouts with prompts and the
  measured palette. Bible text is marked as an AI's reading.
- _Idea lab_: concept, twist and more-like-this runs write at least half of
  their titles in its title formulas (a title format picked in the brief comes
  first) and open the way its hook does.
- _Script writer_: a new script takes the format's measured words a minute
  and planned length in code (over the voice's rate and the winners' typical
  length; a Shorts batch keeps its own length); the hooks stage follows its
  hook and chapter beats, the draft its pacing rules and its visual style for
  picture cues (a kept style lock still comes first).
- _Thumbnail prompts_ build on its layouts and take colours from its measured
  palette.
- _Your videos against the plan_ (`GET /api/format/followed?channel=`): the
  channel's 50 newest stored videos, each checked in code against the slots
  code can check: the title fits one of its title formulas (fixed words in
  order around filled slots, `titleFits`); cuts a minute within 25 % of the
  pacing slot's, else words a minute within 15 %, from the video's teardown;
  its main colour within an RGB distance of 48 of a measured palette colour.
  Per slot: how many followed it, did not, or could not be checked (never
  measured), with the median outlier score of those that followed and those
  that did not. Shown on Your videos as "Against your format".
- _Breakdown parts_: adding a written breakdown part to the shelf now carries
  the channel's measured layer for the part's layer (`measuredForLayer`): the
  winners' medians with their methods (cuts a minute, median shot and words a
  minute for pacing; opening pace for the hook; loudness for sound;
  transitions, animations and cuts for motion; the shared palette and
  animations for visual style), so the checks and the Bible can use them.

**What was run for real.** The shelf at 1440, 768 and 390 wide on a seeded
store (nine ingredients, teardown pictures made with ffmpeg): no console error,
no sideways scroll, no broken picture; filter by layer and search; adding a
link and uploading a PNG through the running server. Not run for real: any
AI (batch 1 has none).

### Outlier bank (`core/src/bank/`, `repos/sqliteCollectionRepo.ts`, `repos/sqliteFindRepo.ts`, `sources/apiChannels.ts`, `sources/searchResults.ts`; server `bankEngine.ts`, `bankRoutes.ts`; connector `bankTool.ts`; web `OutlierBank.tsx`, `BankCard.tsx`, `BankFilterBar.tsx`, `BankFind.tsx`, `BankSave.tsx`, `BankCollections.tsx`, `lib/bank.ts`)

The owner asked for "a global breakout outlier bank": every stored video,
whichever map, saved channel, niche list, pasted channel or refresh read it,
not just the open map. Research → **Outlier bank** is the second tab, right
after Breaking out (the rail still opens Breaking out).

**Data, not a copy.** Store step 33 adds the
view `outlier_bank_rows`: every row of `videos` (its key is the video id, so
each video is there once) joined to its channel (title, handle, subscribers,
country, logo, keywords, description), the channel's stored money signs and
whether any map holds it, with `read_at`, when the video was last read. An
index `map_channels (channel_id)` serves that last test. Scores need each
channel's median, so they are worked out in code (`buildBank`): the channel's
videos go through `buildVideoReport`, the same score, baseline, sample size
and `cautionFor` as Breaking out. Per video: score (null when there are fewer
than three to compare against), views, age, length, Short (a minute or less,
`SHORTS_MAX_SECONDS`), views a day (views over days since upload, at least one:
an average, not a measured pace), and the channel's logo, subscribers,
country, topic label (`assignTopics`, the New niches word table), alphabet
(`latinShare`/`dominantScript` over its 30 newest titles), money verdict
(`moneyVerdict`) and closeness: the closest tier it has on any of the owner's
latest maps, with that map's centre (`closenessTable`). The built bank is kept
in memory until a fingerprint of the store changes (video count and newest
reading, channel, brand and facts readings, money checks, maps and the owner's
keeps and removals) or an hour passes; on the owner's store of 27,394 videos
the build takes about 1.5 s and a filtered page about 0.1 s.

**Filters** (`bank/filters.ts`, `bank/query.ts`, worked out on the server over
the whole bank; the page imports the same definitions by path, never the core
index). As on New niches, a video passes a group when it is in any option
chosen, every group in use must pass, and each option shows how many videos it
would keep given the other groups (one pass over the bank: a video failing no
group counts everywhere, one failing exactly one group counts in that group).
Groups: outlier score (2×, 5×, 10×, 50×, 100× or more, one at a time), views
(under 10K, 10K–100K, 100K–1M, 1M+), age (last 7, 30, 90, 365 days, one at a
time; none is all), length (Shorts, under 8, 8–20, 20+ minutes, not known),
channel size, niche (topic label), language (alphabet), country, monetized,
source (on my maps / elsewhere) and collections; then title contains (every
word) and title excludes (any word). Orders: highest ×, most views, newest,
most views a day. "Showing N of M" counts the whole bank. The choice is kept in
the browser (`jgtube.bankFilters.v1`) and read back through `parseBankQuery`,
the same checks the server makes. `GET /api/bank?<filters>&offset&limit`
answers one page (24 by default, 100 at most) with every option's count, the
collections and which of them each video on the page is in.

**Cards** stand one, two, three (and four on the widest screens) to a row: the
thumbnail with the amber multiple (its tooltip gives the usual it divides by,
the sample and any caution; `*` marks a caution), the title, the channel with
its logo linked to its page, subscribers and closeness, views · age · length
(and the usual beside any multiple over 500×), the topic tag and the money
badge. Presses: Add to ideas (the idea lab's picks), Add to format (the
`video` source), Break down (hands the video to One video, where the owner
presses the button) and Save (collections).

**Collections** (`outlier_collections`, `outlier_collection_videos`): named by
the owner, one per name whatever its case, at most 60 characters on one line.
A video is saved from its card, where a new collection can also be named. The
Collections filter shows one or several; each collection can be exported as
CSV (labelled columns: `outlier_score_x`, `usual_views_baseline`,
`videos_in_baseline`, `views_per_day_average` and so on; a cell that a
spreadsheet would run as a formula is opened with a quote mark) or Markdown (a
table with the score and its usual, and a line saying what the score is and
that nothing is a forecast), or deleted (its videos stay in the bank). Routes:
`GET /api/bank/collections`, `POST .../create`, `.../delete`, `.../add`,
`.../remove`, `GET .../export?id=&as=csv|md`.

**Find more outliers** (`bank/grow.ts`, `bank/cost.ts`). Only on the owner's
press: a keyword, or a topic (its label's words), and 5 to 25 channels (10 by
default). With a YouTube API key, the official Data API does all of it: one
search (most viewed in the last 90 days, 100 units), then each channel's
details, up to two pages of its uploads and their views and lengths (one unit
each; `fetchApiChannel`). The API cannot tell a Short from a long video, and
the store holds the long-form Videos tab, so uploads of three minutes or less,
and live or upcoming ones, are left out. Without a key, the signed-out reading
does it: one page of search results (popular videos of the last month,
`InnertubeSource.searchVideos`), then each channel through the usual ingest;
both go through `youtubeFetch` (so through the owner's proxy when one is set)
and the shared limiter at its usual pace. Channels are read most-found first;
one read in the last day costs nothing. Before starting, the panel says the
most it can cost ("Up to 51 page requests … 374 of today's 400 left") and the
route refuses (429) a run the day's cap cannot cover:
`BANK_FIND_DAILY_PAGE_REQUESTS` (400 page requests) or
`BANK_FIND_DAILY_API_UNITS` (1,500 units) in any 24 hours, counted from
`outlier_bank_finds` (each run's query, way, requests, units and channels
read). A signed-out run is charged the most a channel can take (five requests)
for each channel it read; an API run is charged what it counted. It holds the
store's lease and is refused while a map, a refresh, a keyword search or a
money check runs here or in another program, and they are refused while it
runs. It is a job (`bank-find`) in its own store, listed in Working and
followed again when the page is reopened (`GET /api/bank/find` names a run
under way). Nothing rotates, switches or retries addresses.

**Connector.** `search_outlier_bank` (read-only, store only): the filters as
arguments (`min_score`, `max_age_days`, `views`, `length`, `channel_size`,
`topics`, `alphabets`, `countries`, `monetized`, `source`, `collection` by
name, `title_has`, `title_lacks`, `sort`, `limit` up to 30, 15 by default);
answers `total`, `matched`, short rows and `more`. Ask AI's own question may
use it beside the map tools; "Suggest a mix" may use it as evidence to weigh
(never as an ingredient); the Format Bible is not offered it.

**What was run for real** (November 2026, a copy of the owner's store at
`user_version` 22, migrated on open): the bank held 27,394 videos from 432
channels; at 1440, 768 and 390 wide with score 10×, length 8–20 minutes, title
contains "how" and most views it showed 75 of 27,394, three, two and one
cards to a row, no console error and no sideways scroll; a video saved to a
new collection, the Collections filter, a CSV export, Add to ideas, Break down
handing the video to One video, and the cost line. One signed-out find of
"abandoned megaprojects" for five channels found 20 videos, read five channels
in 26 page requests and grew the bank to 27,786. The API path was tested with
fakes only (no key was available).

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

## Settings screen

Opened from the header (`Settings.tsx`). It reads and writes the `.env` file
beside where Jgtube is started, the one `process.loadEnvFile` reads.

| Setting                 | Name in `.env`                             | Takes effect |
| ----------------------- | ------------------------------------------ | ------------ |
| YouTube Data API key    | `YOUTUBE_API_KEY`                          | at once      |
| Gemini API key          | `GEMINI_API_KEY`                           | at once      |
| AI engines, in order    | `JGTUBE_ENGINES`                           | at once      |
| Antigravity model       | `JGTUBE_AGY_MODEL`                         | restart      |
| Mark facts in scripts   | `JGTUBE_MARK_FACTS`                        | at once      |
| yt-dlp and ffmpeg paths | `JGTUBE_YT_DLP_PATH`, `JGTUBE_FFMPEG_PATH` | at once      |
| Proxy for YouTube       | `JGTUBE_YOUTUBE_PROXY`                     | at once      |
| Downloads folder        | `JGTUBE_DOWNLOADS_PATH`                    | restart      |
| Refresh interval        | `JGTUBE_REFRESH_HOURS`                     | restart      |
| Region                  | `JGTUBE_REGION`                            | restart      |

- **Routes** (`settingsRoutes.ts`): `GET /api/settings` lists them;
  `POST /api/settings {changes: {NAME: value | null}}` saves;
  `GET /api/settings/programs` returns what `npm run engines` prints (asked
  afresh); `POST /api/settings/allow-antigravity` does what
  `npm run engines -- --allow-antigravity` does and returns its lines. All go
  through the Host check, and the POSTs through the Origin and JSON checks.
- **Keys.** A key's value is never sent to the page, logged or put in an
  error. A view says `set: true|false` and `value: null`; the page can replace
  or clear a key. A refusal names the setting, never the value.
- **Rules.** Each value is checked with the zod rule the configuration is read
  with (`CONFIG_ENV_RULES` in core's `config.ts`, `ENGINE_ENV_RULES` in
  `engines/settings.ts`, `PROGRAM_PATH_RULE` for the two program paths), and
  the whole result is passed through `loadConfig` and `loadEngineSettings`
  before anything is written, so a save can never leave Jgtube unable to start.
- **Writing** (`core/src/envFile.ts`, `settingsStore.ts`). Only the lines that
  set a changed name are touched; every other line, comment and the file's
  line endings stay. A new setting goes under its commented example when there
  is one. Each value is written in the first form (bare, then each kind of
  quote) that Node's own parser reads back unchanged. The text goes to a
  temporary file that is renamed over `.env`, and the file as it was is kept
  as `.env.backup` (one copy).
- **Without a restart** (`liveSettings.ts`). The configuration handed to the
  engine reads the two keys, the engine order and the mark-facts switch from
  the latest settings each time they are looked at; the helper program paths
  are read from the environment at each use. The rest is read at start, and
  the screen says "restart Jgtube".
- **Set outside the file.** A setting the environment already held when
  Jgtube started wins over the file. The screen says so, and a change is
  written to the file without touching the running value.

### Proxy for YouTube

One setting in Advanced, `JGTUBE_YOUTUBE_PROXY`: one address,
`http://host:port`, `https://host:port` or `socks5://host:port`, with an
optional `user:password@` before the host (percent-encoded where needed).
Help on the screen: "Sends Jgtube’s YouTube reading and downloads through this
address. Use an address in your own country, or your map’s recommendations
will be another country’s."

- **What goes through it.** Only Jgtube's own YouTube traffic, all of it
  through one helper, `youtubeFetch` (`core/src/sources/youtubeFetch.ts`): the
  InnerTube library (`Innertube.create({ fetch: youtubeFetch })`, so crawl,
  refresh, a pasted channel, sidebars, the player answer and the built-in
  video download), the watch page read for monetization signs, caption tracks,
  and pictures from `i.ytimg.com` and `yt3.googleusercontent.com`
  (`sources/images.ts`). yt-dlp is started with `--proxy <address>`.
- **What does not.** The official Data API (`dataApi.ts`, `commentsApi.ts`,
  on `googleapis.com`), the Gemini API and every other AI engine, and the
  browser's own loading of thumbnails on the page. A Gemini model that watches
  a video from its link is Google reading YouTube, not this computer.
- **Kept honest by a test.** `youtubeFetchPaths.test.ts` reads every source
  file of core, server and connector: only the helper and the three files
  above may use the global `fetch` (and those three may not name a YouTube
  host), every `Innertube.create` must be given `fetch: youtubeFetch`, and
  only the helper and the server's entry point may import a network module.
- **A secret.** It may hold a password, so the screen shows only Set or Not
  set, and the address and password are taken out of every message
  (`hideProxySecret`), yt-dlp's included. It is checked with
  `YOUTUBE_PROXY_RULE` (scheme, host, a port from 1 to 65535, nothing after
  the port) on save and at start, and a refusal never repeats it.
- **Applies on save.** The save writes the running environment as for every
  setting, and `youtubeFetch` reads the setting at each request, so the next
  request uses the new address; clearing it goes straight to YouTube again.
  An address changed by hand into a bad one stops YouTube reading with a
  plain error rather than going without the proxy.
- **Pace unchanged.** The limiter (`YOUTUBE_PACE` in `connection.ts`: two at
  a time, 300 to 600 ms apart, the same retries and caching) is the same with
  or without a proxy; a test checks it. Jgtube has one proxy and never
  rotates, switches or retries with another address; whatever a provider does
  behind its gateway is outside Jgtube.
- **Test** (`POST /api/settings/youtube-proxy-test`, `youtubeProxyCheck.ts`).
  Fetches one public watch page through the saved proxy, redirects not
  followed, 15 seconds at most, and answers `reachable`, `refused` (with the
  plain reason: nothing listening, host not found, password refused, a 403 or
  429 from YouTube) or `sign-in` (sent to a sign-in or consent page, or
  "confirm you're not a bot" on the page).
- **How.** `undici`'s `ProxyAgent` (HTTP CONNECT) and `Socks5ProxyAgent`
  (marked experimental by undici; it prints one warning the first time).
  Tested against small HTTP and SOCKS5 proxies run on this computer in the
  tests, user name and password included; no provider's proxy has been tried.
- **Seen here (November 2026).** Through a local HTTP proxy with a password,
  passed on through this sandbox's own data-centre egress, a channel page and
  30 of its videos were read through InnerTube, and Test said Refused: the
  watch page was sent to `google.com/sorry` ("unusual traffic"). A wrong
  password was reported as such, and an address with nothing listening as
  "Nothing answered".

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
