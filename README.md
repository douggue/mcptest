# mcptest

**Jgtube** is a research tool that tells a YouTube
creator what to make next, based on what is breaking out on competing channels.
It is designed to run as a connector inside Claude first, with a web app later.

## Open the app

Requires Node 22.

```
npm install
npm start
```

Then open http://127.0.0.1:4317. Paste a channel handle or link and press
**Find competitors**. The radar shows the channels around it by closeness; click
one for details. The map starts on the channels **Like yours**; **Everything**
shows the ones the filter left out, and the details panel lets you keep one of
those as a competitor or remove one that is not. Below it is a feed of recent videos far above their channel's
usual views, and the full channel list. A first map takes a few minutes; after
that it opens instantly from the copy stored on your computer.

At the bottom, **New niches to watch** lists every new or small channel Jgtube
has read, on any map, that has a recent video far above its size or its usual
views. Press **Watch** on one to keep it there.

The app is only reachable from your own computer and has no login.

For development, run `npm run api` and `npm run web` in two terminals and open
http://127.0.0.1:5173.

## Use it inside Claude

`npm run mcp` starts the connector, which gives your own Claude the stored map,
the breakout videos and the thumbnails to look at, so you can ask it what to make
next or how to improve your thumbnails. Setting it up takes a few minutes:
see [the connector guide](docs/CONNECTOR.md).

## Command line

The same engine without the app:

```
npm install
npm run jgtube -- ingest @somechannel
```

This reads the channel's latest long-form videos (up to 100), stores them in
`jgtube.db`, and prints them ranked by outlier score: each video's views against
what the channel usually gets at that age. A second run within 24 hours uses the
stored copy; add `--refresh` to fetch again.

To map the channels around one channel:

```
npm run jgtube -- map @somechannel
```

This follows YouTube's recommendations two steps out and lists each channel
with its closeness tier, how closely its titles match the centre's, its size,
views on recent uploads, best recent breakout and whether it is rising. A full
map is a few hundred requests and takes a few minutes; `--depth 1`,
`--sample N` and `--max-channels N` make it smaller. Readings are reused for a
week, so repeating a map is fast.

Settings (all optional): `JGTUBE_DB_PATH` (default `jgtube.db`), `JGTUBE_REGION`
(default `US`) and `JGTUBE_PORT` (default `4317`).

Checks: `npm run typecheck`, `npm run lint`, `npm test`.

Channel data is read from YouTube's web interface rather than the official API.
See [the crawl document](docs/CRAWL.md) for what that means and its risks.

## Plan

Built so far: ingest, outlier scoring, the competitor map and its radar screen (phases 0 to 3 and
the first part of phase 7 of the
[task list](docs/TASK_LIST.md)). The full plan is in `docs/`:

| Document | What it covers |
|---|---|
| [PRD](docs/PRD.md) | Problem, users, goals, user stories, risks, open questions |
| [Architecture](docs/ARCHITECTURE.md) | Components, stack, repository layout, data flow |
| [System design](docs/SYSTEM_DESIGN.md) | Data model, scoring and relevance algorithms, model and tool contracts, testing |
| [Connector](docs/CONNECTOR.md) | Adding Jgtube to the Claude desktop app or Claude Code, and what to ask |
| [Crawl](docs/CRAWL.md) | How the recommendation map is gathered, with evidence, request budget and risks |
| [UI design](docs/UI_DESIGN.md) | The owner's design (stored in `design/`), and how each screen maps to real data |
| [Task list](docs/TASK_LIST.md) | Phased build order with a check for each phase |
