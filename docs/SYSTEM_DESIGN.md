# System design

Data model, algorithms and contracts. Architecture is in `ARCHITECTURE.md`; the
crawl itself is in `CRAWL.md`.

## Data model

```
channels        id PK (UC…), handle, title, subscribers NULL, subs_hidden,
                language, avg_duration_s, video_count, fetched_at
videos          id PK, channel_id FK, title, views, duration_s,
                published_at, published_precision (day|week|month|year),
                published_raw ("2w ago"), fetched_at
video_snapshots video_id FK, captured_at, views            -- PK (video_id, captured_at)
rec_edges       from_channel FK, to_channel FK, sampled, hits, share,
                region, crawled_at                          -- PK (from, to, crawled_at)
maps            id PK, center_channel FK, depth, region, created_at
map_channels    map_id FK, channel_id FK, steps, source (crawl|search|manual),
                relevance (0..1), relevance_reason, tier, removed_at NULL
topic_runs      id PK, map_id FK, status, model, input_tokens, output_tokens,
                started_at, finished_at, memo_json
topics          id PK, run_id FK, rank, name, score, views_low, views_high,
                range_sample_n, rationale_json, nearest_video_id NULL,
                novelty (new|adjacent|covered), starred, hidden
topic_titles    id PK, topic_id FK, position, text, why_json, flags_json,
                starred, hidden
fact_claims     id PK, topic_id FK, claim, verdict (supported|unverified|wrong),
                source_url NULL
http_cache      key PK, body, fetched_at, ttl_s
```

`video_snapshots` exists so that true views-per-day can be computed once a video
has been seen twice. That data calibrates the age ramp below and replaces the
"views on recent uploads" proxy for 30-day views.

Rows are never mutated in place by the pipeline: a re-crawl inserts new edge and
snapshot rows, and derived values are computed from the latest ones.

## Algorithms

### Outlier score

```
score(v) = v.views / expected(v.channel, age_days(v))
expected(c, t) = baseline(c) * ramp(t)
baseline(c)    = median views of c's long-form videos older than 14 days,
                 from the last 50 uploads, excluding v itself
ramp(t)        = 1 - exp(-(t + 1) / 4.5)        # 0.20 at day 0, 0.83 at day 7, ~1 by day 21
```

The ramp constants are a fit to the baselines implied by Makina's export
(54 views expected on day 0 rising to about 286 by day 13 on one channel). They are
a starting point: once `video_snapshots` has data, fit the curve per size band.

Guards:

- No score if the channel has fewer than 8 qualifying videos (`null`, shown as "new").
- If fewer than 5 videos are older than 14 days, use the median of all videos
  with each one age-normalised first.
- Cap displayed scores at 9,999× and show the baseline beside any score above 500×,
  since tiny baselines produce absurd multiples.

### Rising channels

A channel is "rising" when its first long-form upload is under 90 days old and
either its views on uploads from the last 30 days exceed 20× its subscriber count,
or it has two or more videos above 10×.

### Closeness tiers

| Tier | Rule |
|---|---|
| Close | 1 step from centre with share ≥ 50%, or mutual recommendation, or relevance ≥ 0.8 |
| Medium | 1 step otherwise, or 2 steps with two or more inbound edges, or relevance ≥ 0.5 |
| Far | Everything else that passes the relevance floor |

### Relevance filter

The crawl alone is too noisy for small channels, so every candidate gets a
relevance score in two passes:

1. **Cheap pass (code).** TF-IDF cosine similarity between the candidate's last 30
   titles and the centre's titles plus its top competitors' titles; same language;
   average duration within 3× of the centre's. Drop candidates under 0.05.
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

| Tool | Input | Returns |
|---|---|---|
| `research_channel` | `handle`, `refresh?` | Channel summary, its videos with scores, top title frames |
| `map_niche` | `handle`, `depth?` (1..2) | Competitors with tier, relevance, size, best breakout; filtered-out list |
| `set_competitors` | `map_id`, `remove[]`, `add[]` | Updated competitor list |
| `suggest_topics` | `map_id`, `direction?` | Five topics with titles, evidence, range, novelty; the memo |
| `get_channel` | `channel_id`, `sort?` | One channel's stats and videos (latest, breakouts, popular) |
| `find_lanes` | `map_id` | Adjacent sub-niches ranked by fit with proof videos |

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
