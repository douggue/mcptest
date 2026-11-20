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
- [ ] True 30-day views from stored snapshots (started: the niche list measures views gained between readings; it needs 30 days of refreshes to cover 30 days)
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
- [x] Each look-alike call says whether it is settled: the map is read again on 40 random halves and a call that differs on any of them is marked, in the stored map (format 5), the connector and the channel panel. Measured on five maps: all calls changed 0.8-5.2% with half a map removed, settled calls at most 0.2%
- [ ] A title rule whose calls do not depend on the rest of the map. Seven were measured (see "Checked in other niches"); none kept the look-alikes and kept loud outsiders out. Next to try: a lender not scored against its own titles, and word rarity from a fixed background
- [x] Closeness tiers; filtered-out list ("Everything" view); manual remove and restore, kept across new maps
- [x] Keep as a competitor: the owner pulls a rejected channel in; it then counts as a peer on the radar, in the breakout feed and on the thumbnail board, across new maps, until undone (`POST /api/competitors` with `status` `kept`, `removed` or `auto`)
- [x] "Same topic, different wording?": the channels left out on titles alone, listed with their numbers and newest titles for the owner (or their Claude) to keep (`GET /api/maps/latest/same-topic`)
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
- [x] "Same topic, different wording?" section on the map page: six channels at a time, one-press keep, a "Kept by you" row with undo
- [x] "New niches to watch" section: a card per channel with why it is listed, its numbers, the thumbnails that took off and its hit rate; filters for new, small and watched
- [x] Thumbnail patterns in words on the screen: the "Ask Claude" thumbnail review looks at the winners, the ordinary ones and the owner's own, and says what to change
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

## Niche finder

- [x] "New niches to watch": new or small channels across the whole store with a recent video that outperforms; watchlist
- [x] Channel facts from the official API (exact creation date, country, totals), with the owner's key
- [x] Those facts stored on channels and read for niche-list channels that lack them, after a refresh and after a keyword search (never on a page load); the card shows the account's year beside the first upload when they are more than 60 days apart, and the country
- [x] Keyword discovery: official search for recent most-viewed videos on a subject, channels read into the store; search box on the niches section
- [x] Earnings range per niche channel (long videos $2-8 per 1,000 views, Shorts $0.10-0.50; flagged under 1,000 subscribers)
- [x] Settings from a `.env` file, including `YOUTUBE_API_KEY`
- [x] Refresh so growth history builds up: the stalest stored channels are read again, 50 a run, watched and niche channels and map look-alikes first (`npm run refresh`, `POST /api/refresh`, a timer when `JGTUBE_REFRESH_HOURS` is set); "Refresh now" and the last run at the foot of the page
- [x] Measured growth on the niche card: views gained between a channel's first reading of the last 30 days and its latest, once it has been read twice
- [x] Niche transfer opportunities: every stored video of the last 90 days grouped by title template into ideas (the same title for different countries) and formats (the same words around a changing subject); each idea judged for the owner's place as open, weak, done, unproven or unplaced; saved ideas stay listed (`GET /api/transfers`, `POST /api/transfers/save`, the section above "New niches to watch")
- [x] The owner's place read from the map centres' titles or country, or passed in; titles that name no place use the channel's country
- [x] Channels in another alphabet listed on the niche list with a mark and the script's name, instead of left out
- [x] 90-day views, uploads and earnings on the niche card beside the 30-day ones; the list sorted by the 90-day views
- [x] Earnings scaled by a rough ad-rate tier for the channel's country, and the card says which tier was used
- [x] A breakout feed holds at most four videos per channel
- [x] A channel with no upload in 45 days is not a look-alike (reason `dormant`)
- [ ] Ideas grouped across wording: a synonym ("detected" for "found") or a translation is a separate idea today, shown as a one-word variant
- [ ] Channel countries for channels off the niche list (only niche-list channels are asked about), so more ideas without a place in the title can be judged
- [ ] Niche labels and "same topic, different wording" judged by Claude through the connector

## Claude's judgement

- [x] Claude connector (`packages/mcp`): ten tools and a thumbnail-review prompt
- [x] `list_transfer_opportunities`: the ideas, their versions and the formats, read-only (not yet offered to the "Ask Claude" analyses)
- [x] "Ask Claude" on the page: thumbnail review, video ideas, same-topic channels, each one boxed-in run of Claude Code
- [x] Thumbnail patterns in words (through Ask Claude and the connector; Claude sees the real images)
- [ ] Connector tried in the Claude desktop app on the owner's computer (checked here only through a test client and Claude Code)
- [x] Ask AI: Codex CLI and Antigravity CLI beside Claude Code behind one engine interface, tried in the owner's order (`JGTUBE_ENGINES`, default Antigravity, Claude, Codex), moving on from one that is not installed, not signed in or out of allowance; the answer names the engine and the ones passed over
- [x] `GET /api/engines` and `npm run engines`: which engines are installed and signed in; `-- --try` asks each one small question
- [x] Starting a program installed as a `.cmd` shim on Windows without a shell string (through Node, or `cmd.exe` with quoted arguments)
- [x] Watching a video: Antigravity on a local MP4 named with `@`, the Gemini API on a public YouTube link with the owner's key; `engine.watchVideo` picks between them
- [ ] Codex CLI run for real (built to its documentation, tested with stand-ins only)
- [ ] Antigravity CLI run for real, with tools and on a video file (same)
- [ ] Gemini API called with a real key (same)
- [ ] Ask AI on a real Windows computer (the start-up code is tested with a stand-in disk only)
- [ ] A video downloader connected to `EngineOptions.downloadVideo` (until then video is watched through the Gemini API only)
- [ ] An analysis or route that uses `watchVideo` (the niche breakdown)
- [ ] Whether Antigravity sees pictures returned by a tool (until known, the thumbnail review uses Claude Code or Codex)
- [ ] Whether Antigravity can watch a YouTube link without the file (`npm run engines -- --try --youtube <link>`; off unless `JGTUBE_AGY_YOUTUBE_LINKS=on`)
- [ ] Splitting a long video into parts for Antigravity (would need ffmpeg)
- [ ] The navigation link on the page still says "Ask Claude" (`Shell.tsx`); the section itself is "Ask AI"

## Safety, from the final reviews

- [x] Backup of the store before every upgrade, and `npm run backup`
- [x] One reader of YouTube at a time across the app, the connector and the command line
- [x] Refresh backs off from channels that can no longer be read
- [x] Engine runs: read-only tools only, a private working folder per engine, API keys withheld; what each program cannot be held to is written down per engine in the system design

## Not built from the original plan

- [ ] Stored topic runs, novelty check, fact check with web search, follow-up chat in the app (PRD stories 4 to 8); video ideas come from Claude on demand instead
- [ ] View ranges computed in code (the idea generator cites evidence at the owner's size instead of forecasting)
- [ ] Manual add of a competitor that the crawl did not reach
- [ ] Topic grouping across channels as a screen of its own
- [ ] Fixtures from a small and an empty channel
- [ ] Moving the engine into core so the connector no longer imports the server
