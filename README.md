# mcptest

Planning for **Scout** (working name): a research tool that tells a YouTube
creator what to make next, based on what is breaking out on competing channels.
It is designed to run as a connector inside Claude first, with a web app later.

## Try it

Requires Node 22.

```
npm install
npm run scout -- ingest @somechannel
```

This reads the channel's latest long-form videos (up to 100), stores them in
`scout.db`, and prints them ranked by outlier score: each video's views against
what the channel usually gets at that age. A second run within 24 hours uses the
stored copy; add `--refresh` to fetch again.

To map the channels around one channel:

```
npm run scout -- map @somechannel
```

This follows YouTube's recommendations two steps out and lists each channel
with its closeness tier, how closely its titles match the centre's, its size,
views on recent uploads, best recent breakout and whether it is rising. A full
map is a few hundred requests and takes a few minutes; `--depth 1`,
`--sample N` and `--max-channels N` make it smaller. Readings are reused for a
week, so repeating a map is fast.

Settings (both optional): `SCOUT_DB_PATH` (default `scout.db`) and `SCOUT_REGION`
(default `US`).

Checks: `npm run typecheck`, `npm run lint`, `npm test`.

Channel data is read from YouTube's web interface rather than the official API.
See [the crawl document](docs/CRAWL.md) for what that means and its risks.

## Plan

Built so far: ingest, outlier scoring and the competitor map (phases 0 to 3 of the
[task list](docs/TASK_LIST.md)). The full plan is in `docs/`:

| Document | What it covers |
|---|---|
| [PRD](docs/PRD.md) | Problem, users, goals, user stories, risks, open questions |
| [Architecture](docs/ARCHITECTURE.md) | Components, stack, repository layout, data flow |
| [System design](docs/SYSTEM_DESIGN.md) | Data model, scoring and relevance algorithms, model and tool contracts, testing |
| [Crawl](docs/CRAWL.md) | How the recommendation map is gathered, with evidence, request budget and risks |
| [UI design](docs/UI_DESIGN.md) | The owner's design (stored in `design/`), and how each screen maps to real data |
| [Task list](docs/TASK_LIST.md) | Phased build order with a check for each phase |
