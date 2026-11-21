# UI design

Status: **the owner's design has arrived and is the design of record.** It was
made in Stitch and is stored in [`design/`](../design):

| File                           | What it is                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `design/DESIGN.md`             | The "Obsidian Radar" design system: colour, type, radius and spacing tokens, plus component rules |
| `design/screens/*.html`        | Seven desktop screens as static HTML (Tailwind via CDN, Geist, Material Symbols)                  |
| `design/stitch-walkthrough.md` | The generated walkthrough of the seven screens                                                    |

The owner's name was removed from the saved files. The screenshots in the
export are not stored; the HTML renders the same screens.

## Design system in brief

- **Mood:** dark mission-control. Deep navy-black ground, glass panels, hairline
  borders, a cyan signal colour, amber for breakout multipliers.
- **Colour:** ground `#05070E` / `#0B0F19`, cards `#0F1626`, primary `#00D2FF`,
  secondary `#38BDF8`, amber `#FBBF24`, text `#E1E2ED`, muted `#BBC9CF`.
- **Type:** Geist throughout; tabular figures for numbers; 11 px uppercase
  labels with wide tracking.
- **Shape:** pills for buttons, badges and inputs; 16 to 24 px corners on cards;
  circular channel nodes with ring outlines.
- **Layout:** top bar plus left rail; content up to 1360 px; a full-bleed radar
  canvas mode and a card-stream mode.

`design/DESIGN.md` holds the full token set and is the source for the theme.

## Screens against real data

The design shows many figures. Some the engine produces today, some it will
produce, and some it cannot honestly produce at all. The rule from the PRD
stands: every number on screen traces to stored data, so the last group is
replaced or left out rather than filled with invented values.

| Screen                         | Build                            | Backed by                                      |
| ------------------------------ | -------------------------------- | ---------------------------------------------- |
| Competitor radar (`/map`)      | **First.** Data exists.          | Crawl, tiers, outlier scores                   |
| Results feed (`/results`)      | With the topic writer            | Topic runs (phase 5)                           |
| Topic streams (`/topics`)      | After results                    | Themes from the topic run                      |
| Map chat (`/map-chat`)         | Through the Claude connector     | Phase 6                                        |
| YT dashboard (`/yt-dashboard`) | **Not built.** Owner's decision. | Would need the owner's YouTube Analytics login |
| Creator toolkit (`/tools`)     | Deferred                         | Needs transcripts and image analysis           |
| Plan and credits (`/plans`)    | **Not built.**                   | Personal tool: no billing                      |

### Competitor radar: element by element

| In the design                                         | In the build                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Orbital map with Close / Mid / Distant orbits         | Tiers close / medium / far from the crawl                                                                     |
| Lines weighted by link strength                       | Recommendation share on each edge                                                                             |
| "Audience overlap 84.2%"                              | Not measurable from outside. Replaced by recommendation share ("next to 7 of your 10 videos") and title match |
| "Breakout velocity 83× peak"                          | Best recent outlier score                                                                                     |
| "Meshing … 98%" progress                              | Crawl progress events                                                                                         |
| Depth L1 / L2 / L3                                    | Depth 1 or 2 (3 is not supported)                                                                             |
| "Breaking out right now" feed with multiplier filters | Recent videos across the map ranked by outlier score, filtered by multiple and channel size                   |
| Radar benchmarks list                                 | Map members; watch and remove                                                                                 |
| "Niche velocity index +28.4% this week"               | Deferred until view snapshots cover a few weeks                                                               |
| Thumbnails                                            | Standard YouTube thumbnail URLs by video id                                                                   |

### Results feed: element by element

| In the design                                                               | In the build                                         |
| --------------------------------------------------------------------------- | ---------------------------------------------------- |
| Topic cards with viability score, range, title packages, star / hide / copy | Topic run output (phase 5)                           |
| "Maybe on YouTube" flag                                                     | Novelty check, shown with the nearest existing video |
| Strategic veins, small-channel proof                                        | Themes and evidence videos from the run              |
| Viewer psychology, title identity formula                                   | Memo sections of the run                             |
| Fact-check dossier                                                          | Fact-check step with sources                         |
| "Target reach 32.4K avg / vid", "3,420 peer competitor vectors"             | Shown only where computed from stored videos         |

### Figures that will not be built

These appear in the design but have no honest source: audience demographics,
click-through and retention rates for other channels, cut frequency, thumbnail
contrast ratios, hook "stickiness", predictive CTR "accuracy", algorithm
affinity scores and live hourly views for competitors.

## Naming

The product is called **Jgtube**. The design carries the name and wordmark of
an existing product; the build replaces them with Jgtube.

## Rules that hold on every screen

- Every number is rendered from stored data by id, never typed by a model.
- Amber is used for breakout multiples only, so it keeps its meaning.
- Ranges show how many videos they are based on; no range without a sample.
- Real controls for everything clickable, 44 px touch targets, text contrast of
  at least 4.5:1, state shown by more than colour.
- Scraped titles and names are untrusted: escaped, length-capped, never used as
  markup.
- Works at phone width: the rail becomes a menu and no view scrolls sideways.

## Earlier exploration (superseded)

Three directions (Control room, Tabloid, Deep field) were sketched on a design
canvas before the owner's design arrived. They are not being taken forward.

## Views and navigation

- Each feature opens in a view of its own; only that view is drawn. The
  address names it after `#/` (`#/radar`, `#/ideas`, `#/script`,
  `#/settings`), so back, forward and reload keep it. The views and their
  titles are in `apps/web/src/lib/routes.ts`; an older in-page link
  (`#concept-12`) opens the view that holds the element and scrolls to it.
- The left rail opens the **Overview** (`#/`), then the views under
  **Research** (radar, what changed, breaking out, same topic, thumbnails that
  worked, transfer opportunities, new niches), **Create** (trending formats,
  hook library, idea lab, script writer, check before publishing) and
  **Study** (Ask AI and breakdowns, your videos against the plan, upload
  calendar, length and pacing, what viewers ask for), and marks the view on
  screen. The groups are in `apps/web/src/lib/sections.ts`; a new view adds a
  line in `routes.ts`, one in `sections.ts`, one icon in `RailLinks.tsx` and
  its drawing in the `*Views.tsx` table of its group. On a phone the rail is
  the Menu in the top bar.
- A channel anywhere (a chip of your channels, a node of the radar, a row of a
  list) opens its own view, `#/channel/<id>`: back arrow, logo, name and
  handle, labelled numbers from the store, its outliers and newest videos, the
  buttons into the other views for it, and its competitors as rows.
- The top bar says on every view which AI answers (on Automatic, the first
  engine that is ready) and lists each engine as ready or not set up; it
  opens Settings, where the choice is made. Each answer still says which
  engine gave it.
- The flow strip (Research → Formats and hooks → Ideas → Script → Breakdown)
  sits above the views on that path and opens each step's view.

## How a view is laid out

The pieces are in `apps/web/src/components/layout/`; use them rather than
new one-off styles.

- **One primary action per view**, at the right of its `ViewHeader` (title,
  one short line, optional back arrow) or at the foot of its side panel. Other
  buttons are quiet.
- **At most two columns.** `SplitView` puts the controls (what to make, from
  what, and the one button that makes it) in a side panel that stays in view,
  and the results in the main area. Below 1024 px the side panel comes first,
  above the main area. Lists of things go in one column of roomy `Card`s, not
  a grid of dense ones. Short cards of the same kind (hooks) may sit two to a
  row on wide screens.
- **Details closed by default.** What an owner needs only sometimes (where a
  thing came from, the sources, the prompt, the longer explanation) goes
  behind one `Details` per card or panel. Warnings that change what the owner
  should do (facts to check, a cut-off title, lifted words) stay visible.
- **No walls of text.** A lead is one line. Longer explanations sit behind
  "How this works". Labels are short capitals (`Label`, `Field`).
- **Numbers** go in `StatTile`s with what each rests on under it
  (`StatGrid` wraps to two columns on a phone). A working surface keeps its
  running counts in a slim `StatusBar` at the foot. In a narrow main area a
  few tiles share a card's width in a `StatRow` (`TileRow` draws tiles worked
  out in `lib/tiles.ts`). Long AI answers open on "In short", then one card
  per section with the rest of its points closed (`lib/longAnswer.ts`).
- **A side panel** starts with a `PanelTitle` and has one `PanelAction`: the
  full-width primary button with a short line under it.
- **Choices of one** are a `Segmented` control; channels in a list are
  `ChannelRow`s (logo, name, a coloured level, a count, a remove cross).
- The idea lab and the script writer are the worked examples: controls in
  the side panel, then "Concepts (n)" with one column of cards; and the
  script's steps as a segmented control with status, save and export at the
  right, the concept's title and thumbnail line, the step with its one button,
  and the footer of words, spoken time, reading grade and facts to check.
- Every view works at 390 px wide with no sideways scroll.
