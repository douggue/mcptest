# UI design

Status: **the owner's design has arrived and is the design of record.** It was
made in Stitch and is stored in [`design/`](../design):

| File | What it is |
|---|---|
| `design/DESIGN.md` | The "Obsidian Radar" design system: colour, type, radius and spacing tokens, plus component rules |
| `design/screens/*.html` | Seven desktop screens as static HTML (Tailwind via CDN, Geist, Material Symbols) |
| `design/stitch-walkthrough.md` | The generated walkthrough of the seven screens |

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

| Screen | Build | Backed by |
|---|---|---|
| Competitor radar (`/map`) | **First.** Data exists. | Crawl, tiers, outlier scores |
| Results feed (`/results`) | With the topic writer | Topic runs (phase 5) |
| Topic streams (`/topics`) | After results | Themes from the topic run |
| Map chat (`/map-chat`) | Through the Claude connector | Phase 6 |
| YT dashboard (`/yt-dashboard`) | **Not built.** Owner's decision. | Would need the owner's YouTube Analytics login |
| Creator toolkit (`/tools`) | Deferred | Needs transcripts and image analysis |
| Plan and credits (`/plans`) | **Not built.** | Personal tool: no billing |

### Competitor radar: element by element

| In the design | In the build |
|---|---|
| Orbital map with Close / Mid / Distant orbits | Tiers close / medium / far from the crawl |
| Lines weighted by link strength | Recommendation share on each edge |
| "Audience overlap 84.2%" | Not measurable from outside. Replaced by recommendation share ("next to 7 of your 10 videos") and title match |
| "Breakout velocity 83× peak" | Best recent outlier score |
| "Meshing … 98%" progress | Crawl progress events |
| Depth L1 / L2 / L3 | Depth 1 or 2 (3 is not supported) |
| "Breaking out right now" feed with multiplier filters | Recent videos across the map ranked by outlier score, filtered by multiple and channel size |
| Radar benchmarks list | Map members; watch and remove |
| "Niche velocity index +28.4% this week" | Deferred until view snapshots cover a few weeks |
| Thumbnails | Standard YouTube thumbnail URLs by video id |

### Results feed: element by element

| In the design | In the build |
|---|---|
| Topic cards with viability score, range, title packages, star / hide / copy | Topic run output (phase 5) |
| "Maybe on YouTube" flag | Novelty check, shown with the nearest existing video |
| Strategic veins, small-channel proof | Themes and evidence videos from the run |
| Viewer psychology, title identity formula | Memo sections of the run |
| Fact-check dossier | Fact-check step with sources |
| "Target reach 32.4K avg / vid", "3,420 peer competitor vectors" | Shown only where computed from stored videos |

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
- Works at phone width: the rail collapses, the radar gives way to a list.

## Earlier exploration (superseded)

Three directions (Control room, Tabloid, Deep field) were sketched on a design
canvas before the owner's design arrived. They are not being taken forward.
