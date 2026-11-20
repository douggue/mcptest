# Task list

Each phase ends with something that can be checked. Tests are written first in
every phase; coverage floor is 80%.

## Phase 0: scaffold

- [ ] npm workspaces: `packages/core`, `packages/mcp`
- [ ] TypeScript strict, ESLint, Prettier, Vitest with coverage
- [ ] Env validation at startup (`ANTHROPIC_API_KEY`, optional `YOUTUBE_API_KEY`)
- [ ] CI: typecheck, lint, test

**Done when:** `npm test` passes on an empty suite in CI.

## Phase 1: sources and ingest

- [ ] `YouTubeSource` interface: `resolveHandle`, `getChannel`, `listVideos`, `getSidebar`, `search`
- [ ] `InnertubeSource` on `youtubei.js`, with parsers for both list-item shapes
- [ ] Relative-date parser returning `{ date, precision, raw }`
- [ ] Short-count parser (`1.5M` → 1500000)
- [ ] Rate limiter, backoff, HTTP cache
- [ ] SQLite schema and repositories for channels, videos, snapshots
- [ ] Record fixtures from three channels (large, small, empty)

**Done when:** `ingest("@handle")` stores a channel and up to 100 videos, and a second call makes zero requests.

## Phase 2: scoring

- [ ] Baseline, age ramp and outlier score with all guards
- [ ] Rising-channel rule
- [ ] "Views on recent uploads" and, where snapshots exist, true 30-day views

**Done when:** scores for one channel from the Makina export are reproduced within 15%.

## Phase 3: crawl and map

- [ ] BFS crawl to depth 2 with sampling, floors and top-15 cut
- [ ] `rec_edges`, `maps`, `map_channels` repositories
- [ ] Progress events
- [ ] `DataApiSource` for channel and video data (no sidebars)

**Done when:** a live crawl of one channel finishes inside the request budget in `CRAWL.md` and its 1-step set overlaps a Makina export of the same channel by at least half.

## Phase 4: discovery and relevance

- [ ] Title-frame extraction
- [ ] Search-based candidate discovery
- [ ] Cheap relevance pass (TF-IDF, language, duration)
- [ ] Judged relevance pass (batched model call)
- [ ] Closeness tiers; filtered-out list; manual add and remove

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

## Phase 7: web UI

- [ ] Design tokens and components from `UI_DESIGN.md`
- [ ] Topics, Map, Channel detail, run progress
- [ ] Star, hide, copy; competitor remove and restore
- [ ] Follow-up chat over a stored run
- [ ] Keyboard and screen-reader pass; phone layout

**Done when:** the full flow works on a phone and passes an accessibility audit.

## Phase 8: product hardening (only if selling)

- [ ] Accounts, usage metering, billing
- [ ] Postgres, job queue, worker
- [ ] Remote MCP over HTTP with OAuth
- [ ] Legal review of data sourcing
- [ ] Prediction tracking: compare stated ranges with actual results

## Order and dependencies

Phases 0 to 3 are strictly sequential. Phase 4 needs 3. Phase 5 needs 2 and 4.
Phase 6 can start after 2 with `research_channel` alone and grow as later phases land.
Phase 7 needs 5.
