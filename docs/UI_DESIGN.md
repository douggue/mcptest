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
- **Type:** Geist throughout; tabular figures for numbers; see "Type and
  spacing" below (the 11 px uppercase labels of the original design are
  retired).
- **Shape:** cards 16 px corners, controls 12 px, pills only for chips and
  small buttons (see "Type and spacing").
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

## Design direction (November 2026)

The owner found the app dense and confusing: 19 menu entries, small capital
labels everywhere, many buttons per card, long notes, legal-sounding
warnings, and screens that end in a dead end. `docs/UX_AUDIT.md` ranks the
problems. The reference the owner likes is a calm, mobile-first research app:
large readable type, very few controls, plain conversational AI text with
small inline video and channel chips, almost no badges, one obvious next
step. These rules replace the earlier ones where they disagree.

### Information architecture

Six destinations in the rail (a tab bar at the foot of a phone), Settings behind the gear
in the top bar:

| Destination   | Opens                               | Tabs (each its own address)                                                               |
| ------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| **Home**      | `#/`                                | none: your channels, Find competitors, your next step                                     |
| **Channel**   | the map's channel, `#/channel/<id>` | Overview, Radar, What changed, Your videos, Calendar, Pacing, Viewers ask                 |
| **Research**  | `#/breakouts`                       | Breaking out, Outlier bank, Formats, Hooks, Same topic, Thumbnails, Transfers, New niches |
| **Create**    | `#/ideas`                           | Ideas, Script, Check, Format (`#/format`, the format builder)                             |
| **Breakdown** | `#/breakdown`                       | Channel (`#/breakdown/<id>` opens one channel), One video (`#/video-breakdown`)           |
| **Ask AI**    | `#/ask`                             | none                                                                                      |

- Every older address (`#/radar`, `#/hooks`, `#concept-12`) still opens its
  view; the view now shows as a tab of its destination. The destinations and
  their tabs are in `apps/web/src/lib/sections.ts`; a new view adds a line in
  `routes.ts` and one tab in `sections.ts`.
- A channel that is not the map's own (a competitor) opens its page with a
  back arrow and no tabs.
- A "Break it down" button anywhere in the app links with `breakdownHref(id)`
  (`lib/routes.ts`); it opens Breakdown on that channel, where the owner
  presses Break it down. The old `#breakdown` links open Breakdown, not Ask AI.
- The step strip (Research → Formats → Ideas → Script → Breakdown) is shown on
  Home only, as "Your next step". Inside a destination the tabs do the job.
- Ideas and Script are one flow: a concept's "Write the script" opens the
  Script tab; the Script tab with nothing open lists the kept concepts, each
  opening its script.

### Type and spacing

| Token          | Size / line | Use                                              |
| -------------- | ----------- | ------------------------------------------------ |
| `display`      | 40 / 48     | Rare: a channel's name on its page               |
| `headline-lg`  | 30 / 38     | A view's title                                   |
| `headline-md`  | 22 / 30     | A card's or panel's title                        |
| `title-md`     | 18 / 26     | A video or concept title in a list               |
| `body-lg`      | 18 / 28     | AI answers and the lead under a title            |
| `body-md`      | 16 / 24     | Body text (the default)                          |
| `body-sm`      | 14 / 20     | Meta lines (views · age), notes under numbers    |
| `label`        | 14 / 20     | A short label, **sentence case, never capitals** |
| `metric-badge` | 13 / 16     | The amber breakout multiple                      |

- Corners: `rounded` 12 px for controls and inner boxes, `rounded-lg` 16 px
  for cards and side panels, `rounded-xl` 24 px for sheets. `rounded-full`
  only for chips, avatars and small buttons. Never a pill-shaped card.
- Spacing: 16 px gutters on a phone, 24 px on a desktop; 24 px between cards,
  16 px inside a card on a phone and 24 px on a desktop.
- No cards inside cards. A card holds rows, not more cards.

### Controls

- **At most one primary button per screen** (filled accent). A card in a
  list may have one filled-quiet button for its main action; everything else
  is a text link or an icon button with a label.
- **Never a control that cannot work.** If it cannot work now, it is either
  hidden, or disabled with the reason in one line beside it, or it handles
  the case itself (for example, a choice the engine cannot serve goes to one
  that can, with a short note).
- A side panel has one `PanelAction` at its foot.

### Words

- A lead is one short sentence. An explanation is at most one sentence;
  anything longer sits behind "How this works", and only where the owner
  could need it.
- Warnings only when they change what to do, said once, next to the thing
  they are about. The note about reading YouTube's public pages lives in
  Settings, not under every view.
- Numbers come from stored or computed data only and carry a short label
  ("30× average · 15 videos"); the note under a number is one line at most.
  No forecasts.
- Empty states say in one line what to do next, with the button that does it.

### AI answers

- Rendered as readable prose at `body-lg`: bold lead-ins, short paragraphs,
  bullet lists, with videos and channels as small inline chips (thumbnail or
  logo, then the number) instead of links or ids. Long answers open on "In
  short" with the rest behind "Show more".

### One layout rule

- The title row (`ViewHeader`: title, one-line lead, one action) runs the
  full width at the top of every view, above any side panel; titles carry no
  icon.
- A view with a side panel (`SplitView`) uses the full content width. A view
  of one column (Home, Ask AI) is centred at a reading width (`max-w-4xl` or
  `max-w-3xl`).

### Layout pieces

The pieces are in `apps/web/src/components/layout/`; use them rather than new
one-off styles.

- `ViewPage` holds a view; `ViewHeader` gives it a title, one short lead, an
  optional back arrow and its one primary action.
- `SectionTabs` (drawn by the view host) shows the tabs of the destination.
- `SplitView`: controls in a side panel, results in the main area, at most two
  columns; below 1024 px the panel comes first.
- `Card` for one thing; `Details` for what is needed only sometimes, closed
  by default; `Notice` for a one-line note, work under way or a problem.
- `StatTile` / `StatRow` for a few labelled numbers; `ChannelRow` for a
  channel in a list (logo, name, coloured level, count, remove cross).
- `Segmented` for a choice of one.
- Every view works at 390 px wide with no sideways scroll.
