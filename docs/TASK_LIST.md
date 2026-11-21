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
- [x] Look-alikes labelled taken off, rising or neither, and listed about seven taken off to three rising (the list, each ring of the radar, `get_map`); the split is stated beside the "Like yours" toggle; stored maps are format 6
- [x] A watched niche channel is shown under "Watched" only, and a saved idea under "Saved" only; each intro sentence counts what its view shows
- [x] "Download thumbnails" on each channel of the thumbnail board and on the owner's own row (`POST /api/thumbnails/download`); a channel's logo on its niche card once read
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

- [x] Claude connector (`packages/mcp`): sixteen tools and a thumbnail-review prompt
- [x] `get_transcript`, `view_video_frames`, `get_channel_brand`, `get_video_details`: one video's captions, frames across it, a channel's branding, and descriptions and tags, each read once and kept (not yet offered to the "Ask Claude" analyses)
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
- [x] The video downloader connected to the watcher (`videoCopies.ts`): core's `downloadVideo` with the engine's own connection; the copy is removed when the watch is over, however it ended, and at shutdown
- [x] An analysis and a route that use `watchVideo`: the channel breakdown (below)
- [ ] Whether Antigravity sees pictures returned by a tool (until known, the thumbnail review uses Claude Code or Codex)
- [ ] Whether Antigravity can watch a YouTube link without the file (`npm run engines -- --try --youtube <link>`; off unless `JGTUBE_AGY_YOUTUBE_LINKS=on`)
- [ ] Splitting a long video into parts for Antigravity (ffmpeg is now used when installed, but only to cut frames and to shrink a large file of the owner's)
- [x] The navigation link on the page says "Ask AI", like the section it leads to

## Channel breakdown

- [x] `POST /api/breakdowns {channel, engine?, fresh?}` as a job with progress in plain words; one breakdown or analysis at a time
- [x] The videos chosen in code by one rule for every channel: the top five by score (`BREAKDOWN_TOP_VIDEOS`), the best three in depth (`BREAKDOWN_DEEP_VIDEOS`)
- [x] Per deep video: a file (the owner's own, then yt-dlp, then the built-in route; one download used for everything, removed afterwards), a watch (Antigravity, then the Gemini API), a frame study in a run of its own
- [x] Frames cut from the file with ffmpeg: one a second, 5 by 5 at 288 by 162, with an index; YouTube's preview frames when there is no file or no ffmpeg
- [x] `view_video_frames` walks every sheet with `start_sheet` and says how many there are and where the frames came from
- [x] Watch notes and frame studies stored per video (`video_studies`, migration 12) and reused; `get_video_watch` and `get_frame_study`; "Start again from nothing"
- [x] `PUT /api/breakdowns/videos/:videoId`: the owner's own MP4, streamed to `my-videos/<id>.mp4`, checked whole, 2 GB cap, one at a time; "Choose the video file" on the page
- [x] A file of the owner's over 95 MB shrunk with ffmpeg for the watch only
- [x] The page: a fourth Ask AI card with a channel list, progress, the answer with how each video was studied, and "Break down this channel" in the channel panel
- [x] Run for real with Claude Code on a copy of a real store: no file and nothing to watch (NOT WATCHED, preview frames), and with a test-pattern MP4 given as a file (cut and studied end to end)
- [ ] A real video file downloaded and studied from its own frames (YouTube refused the download where this was built)
- [ ] A real video watched by Antigravity or the Gemini API through the breakdown (neither was available; tested with stand-ins)
- [ ] The frame study's limits checked on a real twenty-minute video from a file (about fifty sheets; measured only on preview sheets and on a test pattern)
- [ ] A check that a file the owner gives is the right video (its length against the stored one); today the writing engine is the only thing that notices
- [x] The breakdown kept after the page is closed: `breakdown_parts` (migration 13), `GET /api/breakdowns?channel=`, shown when the channel is picked, with "Run again"
- [x] The breakdown in seven parts, each its own fixed question, tools and engine run (`breakdown-titles` … `breakdown-master`): titles, thumbnails, scripts, picture and sound, strengths weaknesses and strategy, production plan, master prompt
- [x] At least 20 titles studied from the most viewed to the least, chosen in code (`BREAKDOWN_TITLES`), cut into a high and a low group by place in the ranking
- [x] What the breakdown rests on worked out in code and stored as the first part; a stored part kept while that is unchanged, written again when it changes or when a part it reads was
- [x] `get_breakdown_part`: a later part reads an earlier one as a tool result only; a test that no part's text, study, title or channel name is ever in a question
- [x] `get_transcript_pace` (words per minute per minute or per beat, counted in code) and the seconds between picture changes worked out from a frame study's closing counts
- [x] A part that fails is recorded with its reason and the rest are still written; "Write the missing parts"
- [x] Four text files per breakdown in `downloads/breakdowns/<channel name>/` with an index; a prompt lifted out only between its two marker lines, never guessed; `GET /api/breakdowns/texts/<name>`; "Copy" and "Download .txt" on the page
- [x] Run for real with Claude Code on a copy of a real store: every part written, the files saved, the page checked at 1440 and 390 wide
- [ ] The parts written by Antigravity or Codex for real (tested with stand-ins only)
- [ ] A breakdown with watch notes run for real, so the sound and music in the plan and the master prompt come from a watched video (the NOT WATCHED path is what was run)
- [ ] A way to have one part written again without the others (today: all of them, or the missing ones)

## Idea lab

- [x] Store: batches, concepts, title formulas and hook labels (migration 13), each read through its centre channel only
- [x] Concepts: one to five picked videos of the channel's own map, an optional format by key or id, an angle of one line, long or Shorts; ten concepts in a fixed labelled form, read strictly; a short batch shown with a plain note
- [x] The angle as the one free text: quoted, said to be a description, unable to break out
- [x] Twist angle and More like this, reading the concept through `get_concept`
- [x] Keep, and concepts not kept replaced by the next batch or cleared on request
- [x] Where else this could work: other languages and categories, each with the search to check and a NOT CHECKED line
- [x] Trending formats: formulas proposed by an engine, kept and counted in code; Remix into the idea lab
- [x] Hook library: the first minute of the map's top breakouts from stored captions; styles named by an engine with no preset list; search, filters, Copy hook, Use in idea lab
- [x] Feed preview with the title's length and a phone cut-off warning
- [x] Real runs on copies of two stores in different niches
- [ ] A check, in code, that a concept's title is not a competitor's title with a word changed (it is a rule of the question only)
- [ ] The phone cut-off measured, not taken from a rule of thumb: YouTube publishes no number

## Script writer

- [x] Store: one script per concept (migration 14), scoped by centre channel through its concept; a concept with a script is never cleared
- [x] Text measures in core, pure and tested: words, spoken time, Flesch-Kincaid grade with a stated syllable rule (English only, null otherwise), check markers, sentences with a figure and no marker
- [x] Voice from the channel's own captions (pace, sentence length, grade); length range from this map's winners; no presets
- [x] Three stages as jobs: one-minute hooks (one per chosen library model) and a beat sheet, the draft with picture cues, the tighten pass
- [x] The honesty rule in every stage; markers counted, listed and carried by the exports
- [x] Exports: clean voiceover to the clipboard (two presses while markers remain), .txt, .md, B-roll shot list .csv with times computed from the words
- [x] Hook library connected: models chosen from hook cards or the script writer; a concept's HOOK STYLE is the default model; lifted phrases flagged in code
- [x] One real run of all three stages on a copy of a real store
- [ ] Facts checked by anything but the owner: the engines have no web access, and Jgtube has no fact check
- [ ] Picture cues paced from a frame study: written and tested with stand-ins, but no frame study was stored for the voice channel in the real run
- [ ] A reading grade for languages other than English

## Downloaders

- [x] Transcripts: a video's captions read through the YouTube source and stored (`video_transcripts`); a video without captions is a normal answer; `npm run jgtube -- transcript`
- [x] Thumbnails to disk: a channel's winning and ordinary thumbnails with an `index.json`, under a downloads folder beside the store (`JGTUBE_DOWNLOADS_PATH`); `npm run jgtube -- thumbnails`
- [x] Transcripts to disk: the captions of a channel's videos that took off (up to six) as text files with an `index.json`; "Download transcripts" on the page; `npm run jgtube -- transcripts`
- [x] yt-dlp told to use Node as its JavaScript runtime, with one retry for a yt-dlp too old to know the option; a refusal by YouTube said in plain words
- [x] `npm run engines` says whether yt-dlp and ffmpeg are found
- [x] Frames across a video: storyboard sheets with a caption giving the grid and the time of each frame
- [x] Channel branding: logo, cover, bio, keywords and header links, stored on the channel by every read; `npm run jgtube -- brand`
- [x] Video details: description and tags from the official API when a key is set, else from the watch page; stored (`video_details`)
- [x] One video as a small temporary file with picture and sound, by yt-dlp when installed, else the built-in library; `npm run jgtube -- video`
- [ ] Either video route confirmed against YouTube: where it was tried the video servers answered 403 to the built-in route and asked yt-dlp to "confirm you're not a bot"
- [ ] A video longer than about twenty minutes as a file: the one single file YouTube offers (360p) is then over the 95 MB limit, and joining a smaller picture with sound needs a second program
- [ ] The official-API path for video details checked against the real API (tested with fakes only; no key was available)
- [ ] All of a channel's links (only the one its header shows is read)

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
- [x] Saved channels: every looked-up channel listed above the radar, opened from the store, deleted on request
- [x] Channel logos on the radar, the inspector and the channel list

## Following the channel over time

Scoped to the channel on screen and its own map; every number from stored data
or computed in code and labelled; no view forecasts; nothing published to YouTube.

- [x] What changed since you last looked: new breakouts, channels newly taken off, rising or dropped out, look-alikes new or gone, title formats newly seen in several breakouts; from stored readings, no AI (store step 17 `channel_looks`)
- [x] "Mark as seen", "since yesterday" and "since 7 days"; "nothing new" said plainly; when the look-alikes were last read, with a link to Refresh now
- [x] Checked on a copy of a real store after a real refresh of 30 channels, at 1440 and 390 wide
- [x] Alerts: a rule per saved channel (the owner's number for a look-alike video's outlier score, default 5×, range 2 to 100; a look-alike newly taking off, optional); checked in code after each refresh and before alerts are read; kept in store step 20 (`alert_rules`, `alerts`)
- [x] Alerts listed inside What changed with thumbnails and links, "Mark alerts read", a count of unread alerts on each of Your channels, and that an alert is only as fresh as the last refresh
- [x] Checked on a copy of a real store: a real refresh of 20 channels found one real alert (a new upload at 4.5×)
- [x] Your videos against the plan: link a kept concept (or its script) to the published video it became, checked to be a video of the centre channel, read once when not stored (store step 24 at merge, `concept_videos`)
- [x] Views and outlier score against the channel's usual; the concept's inspiration videos at the same age where stored readings allow, else said not comparable with the reason; a table of formats, hook styles and lengths with counts, median scores and a caution
- [x] Checked on a copy of a real store: two kept concepts linked to real videos, one inspiration comparable at the same age, one with a rough date, one never read near that age; the one-time channel read run for real
- [ ] Comparing at the same age rests on readings the store happens to hold; most inspiration videos have been read once, so most comparisons say "not comparable" until refreshes build history
- [x] Upload calendar: kept concepts and scripts with a status (idea, drafting, ready, published) and an optional planned date, by week from this one (store step 22, `concept_schedule`); a scripted concept keeps its status on its script; published ones link to their video and to Your videos against the plan
- [x] The median uploads a week of the look-alikes that took off on the map (the map's own 14-day measure), with how many channels it rests on; weeks planned under it are marked
- [x] Checked on a copy of a real store: 16 look-alikes taken off, median 4.5 a week; a date set through the page; a worked-out status kept worked out
- [x] Length and pacing against the winners: the channel's own lengths against the look-alikes' breakouts on the map (median and middle half, Shorts left out and counted), and words a minute where captions are stored, each with how many videos it rests on, in a plain SVG chart
- [x] Checked on a copy of a real store: 22 own videos against 78 breakouts of 22 look-alikes; words a minute from 5 own and 12 winning videos with stored captions
- [x] Comment mining: top-level comments of chosen winners of the map (at most 10, one unit each, stated before running) through `commentThreads.list`, key in the `x-goog-api-key` header only, read at the time of use; with no key the section says so (store step 23, provisional)
- [x] "What viewers ask for": one fixed question (`viewer-requests`), comments read through a new read-only connector tool that says they are strangers' text and never instructions; code keeps only quoted ids it handed out
- [x] Checked on a copy of a real store with stand-in comments: the real connector over its protocol, and the code check dropping a finding resting on an invented id
- [ ] The comments client checked against the real YouTube API: no key exists here, so it is built to the documented API and tested with stand-ins
- [ ] A real AI run of "What viewers ask for": tested with a stand-in answer only, as agreed
- [x] Check before publishing: for a kept concept's script, sentences sharing six or more words in a row with a stored competitor transcript (found in code, reusing the hook library's check), facts still marked to check (counted in code), and title or thumbnail claims the script does not support from one fixed question (`risk-check`), kept only when both quotes are really there; a new read-only tool, `get_risk_findings`; store step 42, provisional
- [x] A section in the Create group and a button in the script writer that jumps to it; no legal advice, no verdict
- [x] Checked on a copy of a real store: the real tightened script against 12 stored transcripts, 1 overlap and 76 facts still marked, found in code
- [ ] The one real AI run of the risk check: refused by the engine, whose plan limit was reached, until 24 Nov; the claims part is tested with stand-in answers only
