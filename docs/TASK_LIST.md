# Task list

Each phase ends with something that can be checked. Tests are written first in
every phase; coverage floor is 80%.

## Phase 0: scaffold

- [x] npm workspaces: `packages/core` (`packages/mcp` is added in phase 6)
- [x] TypeScript strict, ESLint, Prettier, Vitest with coverage
- [x] Env validation at startup (store path, region, language; API keys join when first used)
- [x] CI: typecheck, lint, test

**Done when:** `npm test` passes on an empty suite in CI.

## Phase 1: sources and ingest

- [x] `YouTubeSource` interface: `resolveChannelId`, `fetchChannel`, `getSidebar` (`search` joins in phase 4)
- [x] `InnertubeSource` on `youtubei.js`, with parsers for both list-item shapes
- [x] Relative-date parser returning `{ date, precision, raw }`
- [x] Short-count parser (`1.5M` → 1500000)
- [x] Rate limiter with backoff; freshness check instead of an HTTP cache
- [x] SQLite schema and repositories for channels, videos, snapshots
- [x] Alarm when YouTube lists videos or recommendations but none can be read (page format changed)
- [ ] Record fixtures from a small and an empty channel (one large channel recorded)

**Done when:** `ingest("@handle")` stores a channel and up to 100 videos, and a second call makes zero requests.

## Phase 2: scoring

- [x] Baseline, age ramp and outlier score with guards
- [x] Rising-channel rule
- [x] "Views on recent uploads"
- [ ] True 30-day views from stored snapshots
- [x] Baseline, sample size, channel age and hit rate shown beside each score, with a caution mark when the usual is taken from few videos or is very small

**Done when:** scores for one channel from the Makina export are reproduced within 15%. (Met: a test checks the median error on an exported channel.)

## Phase 3: crawl and map

- [x] BFS crawl to depth 2 with sampling, floors and top-15 cut
- [x] `rec_edges`, `maps`, `map_channels` repositories
- [x] Progress events
- [x] Channel budget, reuse of fresh readings, early stop after repeated failures
- [x] Map view: closeness tiers, recent views, best breakout, rising flag
- [ ] `DataApiSource` for channel and video data (no sidebars). Deferred: only needed if the web source is blocked.

**Done when:** a live crawl of one channel finishes inside the request budget in `CRAWL.md` and its 1-step set overlaps a Makina export of the same channel by at least half.

## Phase 4: discovery and relevance

- [ ] Title-frame extraction
- [ ] Search-based candidate discovery
- [x] Cheap relevance pass: TF-IDF title similarity anchored on the closest look-alikes, plus size, publishing-rate and video-length checks. The app shows "like yours" by default (language check still to add)
- [x] Title match reads the reference as a format profile (words by the share of its titles that use them), so shared subjects no longer pass for a shared format; pinned by a 40-channel fixture from the owner's map
- [ ] Judged relevance pass (batched model call). Needed for channels within a point or two of the title threshold, which titles do not settle
- [x] Closeness tiers; filtered-out list ("Everything" view); manual remove and restore, kept across new maps
- [x] Keep as a competitor: the owner pulls a rejected channel in; it then counts as a peer on the radar, in the breakout feed and on the thumbnail board, across new maps, until undone (`POST /api/competitors` with `status` `kept`, `removed` or `auto`)
- [x] Each map stored as it was when made; schema migrations
- [x] Seed from a model channel: the crawl also explores from it and "like yours" is measured against it
- [x] Depth 1 to 3 and a channel limit of 150, 300 or 600 chosen on screen; when the limit cannot fit every candidate, places go first to channels recommended by look-alikes
- [ ] Manual add
- [x] New niches to watch: every stored channel that is new (first upload within 90 days) or small (10,000 subscribers or fewer) and has a recent video that outperforms, less large, clip, film and non-Latin channels; a watchlist that outlives maps (`GET /api/niches`, `POST /api/niches/watch`)

**Done when:** for the owner's channel, at least 8 of the top 12 competitors are judged same-format by the owner, and the closest look-alike from the export is included.

## Phase 5: topic writer

- [ ] Evidence pack builder
- [ ] Prompt, output schema and id-integrity validation with one retry
- [ ] Cold-start mode
- [ ] View range from peer-size evidence
- [ ] Novelty check
- [ ] Fact check with web search
- [ ] Persist runs, topics, titles, claims

**Done when:** a run returns five topics whose every number traces to a stored row, and the owner rates at least three as usable.

## Phase 6: MCP server

- [x] `packages/mcp`: stdio connector on the engine the local API uses, same store; `npm run mcp`
- [x] Nine tools with Zod input schemas: `get_map`, `get_breakouts`, `get_thumbnail_board`, `view_thumbnails` (real thumbnail images), `get_channel_videos`, `get_near_misses`, `set_competitor_status`, `list_niches`, `make_map`
- [x] Progress notifications on `make_map`
- [x] Compact outputs with ids; lists capped with a count of what was left out
- [x] `thumbnail_review` prompt
- [x] Install instructions for Claude (`docs/CONNECTOR.md`)
- [ ] Try it in the Claude desktop app and Claude Code on the owner's computer (so far driven by a test client over stdio)
- [ ] `suggest_topics` and `find_lanes` (need phase 5); manual add of a competitor

**Done when:** "What should my next video be?" in Claude produces topics through the connector with no manual steps.

## Phase 7: web UI (design received, stored in `design/`)

- [x] Theme from `design/DESIGN.md`; app shell (top bar, left rail)
- [x] Local API (`packages/server`): stored maps, crawl jobs with progress
- [x] Competitor radar screen on real crawl data: radar, channel details, breakout feed, channel list, export
- [ ] Results feed and topic streams (need phase 5)
- [ ] Channel detail, run progress
- [x] Competitor remove and restore; keep and undo for a channel the filter left out
- [x] Thumbnail board: per channel like yours, the thumbnails that took off beside ordinary ones and the owner's own, with a switch between winners only and winners next to ordinary (`GET /api/maps/latest/thumbnails`)
- [x] "New niches to watch" section: a card per channel with why it is listed, its numbers, the thumbnails that took off and its hit rate; filters for new, small and watched
- [ ] Thumbnail patterns in words on the screen: a model looks at the board's winners and ordinary videos and says what to copy (available in Claude through the connector's `view_thumbnails`)
- [ ] Star, hide, copy
- [ ] Follow-up chat over a stored run
- [ ] Keyboard and screen-reader pass; phone layout

**Done when:** the full flow works on a phone and passes an accessibility audit.

## Phase 8: product hardening (out of scope: personal tool)

- [ ] Accounts, usage metering, billing
- [ ] Postgres, job queue, worker
- [ ] Remote MCP over HTTP with OAuth
- [ ] Legal review of data sourcing
- [ ] Prediction tracking: compare stated ranges with actual results

## Order and dependencies

Phases 0 to 3 are strictly sequential. Phase 4 needs 3. Phase 5 needs 2 and 4.
Phase 6 is built on phases 2 to 4 and grows as later phases land.
Phase 7 needs 5.
