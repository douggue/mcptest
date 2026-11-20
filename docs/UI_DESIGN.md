# UI design

Status: **direction not chosen.** Three candidate directions for the same screen
are on the design canvas. Nothing below the "Directions" section depends on which
one wins.

## Directions

| | Name | Look | Best at | Main tradeoff |
|---|---|---|---|---|
| A | Control room | Black, hairlines, monospace numerals, one lime accent | Density: five topics, evidence and the niche on one screen | Reads as a tool for analysts; can feel cold |
| B | Tabloid | Yellow, black and red, huge condensed headlines, stickers | Energy: matches the thumbnail culture it serves | Loud all day; weak for long reading and tables |
| C | Deep field | Dark green-black, glowing channel map, soft panels | The map as the hero; the "see your niche" moment | Least information per screen; map needs real avatars to shine |

## Screens

| Screen | Purpose | Key content |
|---|---|---|
| Topics | The answer to "what next" | Lead topic, titles with copy, evidence videos, fact check, queue of the other four |
| Map | Who you compete with | Channels by closeness and breakout; in use, found by search, filtered out |
| Channel | Why a channel is working | Stats, a one-line read of its formula, videos by breakout, title-frame comparison |
| Run progress | Live status of a run | Steps with counts ("reading 14 of 88 channels") |
| Lanes | Where else the format works | Sub-niches ranked by fit with proof videos |

## Components

- **Outlier badge.** `N×` beside any video. One accent colour, reserved for this.
- **Evidence chip.** Thumbnail, short label, views, optional badge. Always links to the video row.
- **Title row.** Title text plus copy; star and hide on hover or long-press.
- **Topic header.** Rank, name, score, view range with its sample size, novelty.
- **Channel row.** Avatar, name, size, tier, best breakout, remove or restore.
- **Fact line.** Verdict and source for each claim a title relies on.

## Rules that hold in every direction

- Every number is rendered from stored data by id, never typed by the model.
- The breakout accent is used for breakouts only, so it keeps its meaning.
- Ranges show how many videos they are based on; no range without a sample.
- Real controls for everything clickable, 44 px touch targets, text contrast of at
  least 4.5:1, state shown by more than colour.
- Works at phone width: the queue becomes a horizontal pager, the map becomes a list.
- No decorative data. If a number does not help choose a topic, it is not shown.
