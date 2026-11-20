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
- [ ] Judged relevance pass (batched model call)
- [x] Closeness tiers; filtered-out list ("Everything" view); manual remove and restore, kept across new maps
- [x] Each map stored as it was when made; schema migrations
- [ ] Manual add; seed from a model channel

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

- [ ] Six tools from `SYSTEM_DESIGN.md` with Zod input schemas
- [ ] Progress notifications on long tools
- [ ] Compact outputs with ids
- [ ] Install instructions for Claude

**Done when:** "What should my next video be?" in Claude produces topics through the connector with no manual steps.

## Phase 7: web UI (design received, stored in `design/`)

- [x] Theme from `design/DESIGN.md`; app shell (top bar, left rail)
- [x] Local API (`packages/server`): stored maps, crawl jobs with progress
- [x] Competitor radar screen on real crawl data: radar, channel details, breakout feed, channel list, export
- [ ] Results feed and topic streams (need phase 5)
- [ ] Channel detail, run progress
- [x] Competitor remove and restore
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
Phase 6 can start after 2 with `research_channel` alone and grow as later phases land.
Phase 7 needs 5.
