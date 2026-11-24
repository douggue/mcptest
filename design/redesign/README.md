# Jgtube redesign: five places, object pages, one look

The approved navigation and design proposal (24 Nov 2026). This folder is the
spec the redesign is built from: the tree, where every feature goes, the
approved decisions, the build order, and nine mockups in `mockups/`.

The mockups use sample data only. Every channel name, video title and line of
text in them is a placeholder; thumbnails are drawn gradients. Open any of them
in a browser. They expect the Geist font to be installed and fall back to the
system font.

## The idea

The app was organised by type of data (6 sections, 23 tabs). It is now
organised by what the owner is doing: check, find, make, shape a style, look at
their own channel. Five places, 13 tabs, two object pages (a Channel, a Video).
No feature is removed.

## The tree

```
TOP BAR   channel switcher · Search / paste a YouTube link · running jobs · Ask (panel) · Settings

1 TODAY       next step
              since your last look (What changed + alerts + Refresh)
              breaking out now
              mini map
              your channels / Add a channel

2 DISCOVER    Videos    one grid + filter bar + saved views:
                        Breaking out, All-time bank, 100×+, Small channels,
                        Other languages, collections, "Save this view"
              Channels  saved views: My competitors, New niches (with its
                        watchlist and sweeps), Same topic, Suggested to study
              Map       the Radar, unchanged

3 CREATE      Ideas     (Viewers ask is a source)
              Scripts   Hooks and beats → Draft → Tighten → Check
              Plan      the calendar

4 STYLE       My format
              Library   title formats + hooks + shelf, by layer
              Bible

5 MY CHANNEL  Overview · Videos · Results (Against your format + Pacing) · Breakdown

OBJECT PAGES  Channel page   Overview · Videos · Thumbnails · Breakdown
              Video page     Summary · Teardown · Thumbnail review · Hook and script (new)
```

## Where every feature goes

| Before | After |
| --- | --- |
| **Top bar** | |
| Channel switcher, Add a channel | Stays in the top bar. Add a channel is also on Today. |
| Working indicator (jobs) | Stays in the top bar. |
| AI chip (which AI answers) | Inside the Ask panel header, and in Settings. |
| Settings | Stays behind the gear. No change. |
| (new) Search, or paste a YouTube link | Top bar. A link opens that channel's or video's page. |
| **Home** | |
| Next step card | Today |
| Breaking out now | Today |
| Your channels | Today |
| Add a channel, Find competitors | Today (and the channel switcher) |
| **Channel** | |
| Overview (channel page) | My channel › Overview. Any other channel: its Channel page › Overview. |
| Radar | Discover › Map. A small live map also sits on Today. |
| What changed, alerts, Refresh | Today › "Since your last look". Alert rules behind the bell there. |
| Your videos, link to an idea | My channel › Videos |
| Against your format | My channel › Results |
| Pacing | My channel › Results |
| Calendar | Create › Plan |
| Viewers ask | Create › Ideas, as a source: "What viewers ask". |
| Competitors list, remove | Discover › Channels, saved view "My competitors". |
| Download this map | Discover › Map, in the "more" menu. |
| Monetization check | Channel page: the earning badge and "Earning signs" card. |
| **Research** | |
| Breaking out (with its filters) | Discover › Videos, saved view "Breaking out". |
| "Why N×" | "Why this score" on every video card and Video page. |
| Outlier bank, collections, export, Find more | Discover › Videos, view "All-time bank". Collections are saved views. Find more is the search box. |
| Transfers | Discover › Videos, view "Other languages". |
| New niches (all its filters) | Discover › Channels, view "New niches". |
| Same topic | Discover › Channels, view "Same topic". |
| Formats (title formulas), Find formats | Style › Library, layer "Titles". |
| Hooks | Style › Library, layer "Hooks". One video's hook: Video page › Hook and script. |
| Thumbnails board | Channel page › Thumbnails (yours: My channel › Videos). |
| Review one thumbnail | Video page › Thumbnail |
| **Create** | |
| Ideas (idea lab) | Create › Ideas |
| Script (list and writer) | Create › Scripts |
| Check before publishing | Step 4 of every script: Hooks → Draft → Tighten → Check. |
| Thumbnail prompt | On each idea, and Video page › Thumbnail. |
| Format: Shelf | Style › Library, filter "On my shelf". |
| Format: Your format, slots, Suggest a mix, Make active | Style › My format |
| Format Bible, export | Style › Bible |
| **Breakdown** | |
| Channel: pick one, "Suggested to break down" | Discover › Channels, view "Suggested to study". |
| Channel breakdown (7 parts, export) | Channel page › Breakdown |
| One video teardown from a link | Paste the link in Search → Video page › Teardown. |
| One video teardown from a file | Search box › "Add a video file" → Video page › Teardown. |
| **Ask AI** | |
| Question box, quick questions, last answer | The Ask panel, open from every screen. It knows what you are looking at. |

## Three rules

1. **Everything links to a page.** A channel name always opens the Channel
   page. A video card always opens the Video page.
2. **The same three buttons everywhere.** Add to ideas, Add to format, Save.
3. **One main button per screen.** The cyan one. It is always the next step.

On a phone: a bottom bar with the same five places; Ask and Search are icons at
the top; tabs and saved views scroll sideways as one row; side panels fold
under the content; rows open on tap instead of carrying small buttons.

## Design direction: the whole app looks like the Radar

- **Colour.** Navy-black ground (`#05070E`), slightly lighter cards
  (`#0F1626`). Cyan (`#00D2FF`) = the one main button and "you are here". Sky
  (`#38BDF8`) = links and the AI label. Amber (`#FBBF24`) = breakout scores
  only (269×), never anything else. Green (`#34D399`) = done or earning. Red
  (`#F87171`) = failed. Muted (`#9EABBB`) = the second line.
- **Type (Geist).** Channel name 40/48 · page title 30/38 · card title 22/30 ·
  video or idea title 18/26 · AI answers 18/29 · body 16/24 · small notes
  14/20. Nothing smaller than 13. No capital-letter labels.
- **Space and shape.** 24 px between cards and inside them (16 on a phone).
  Cards 16 px corners, buttons 12, pills only for chips. No card inside a card.
- **The pieces.** Card: one title, rows inside, one link top right. Row: logo,
  name, one grey line, one thing on the right. Video card: thumbnail, amber
  score top left, length bottom right, title (2 lines), channel · views · age,
  three actions. Number: label, big number, one line saying what it rests on.
  Badges: score, Close / Medium / Far, earning, Proven, Estimate (dashed).
- **AI answers.** Start with "In short", two or three sentences. Videos and
  channels appear inline as small chips. Then numbered points or a picture,
  never a wall of text. Always signed "The AI's reading". Numbers come from
  code.
- **States.** Empty = one line and one button. Loading = what is happening and
  how long, with grey shapes. Error = what happened, what is safe, one way out.

`mockups/09-design-system.html` is the design sheet.

## Mockups

| File | Screen |
| --- | --- |
| `01-today.html` | Today |
| `02-discover.html` | Discover › Videos |
| `03-channel-page.html` | Channel page |
| `04-video-page.html` | Video page |
| `05-create-ideas.html` | Create › Ideas |
| `06-create-script.html` | Create › Scripts, one script |
| `07-style-format.html` | Style › My format |
| `08-assistant.html` | The Ask panel over Discover |
| `09-design-system.html` | Colours, type, buttons, badges, rows, states, video card |

## Build order: five steps, each one safe on its own

Only the screens move. Stored data, maps, scripts and breakdowns are not
touched in any step. After each step the app is usable and every old address
still opens its screen.

1. **New frame.** The 5-place menu, the top bar with Search and Ask, the phone
   bottom bar, the design system's shared pieces. The old screens are re-housed
   under the new places. Old addresses (`#/radar`, `#/hooks`, `#/breakouts`…)
   open the same screen in its new place.
2. **Channel and Video pages.** The Video page is built. Channel breakdowns and
   video teardowns move into tabs. Every card and name links to its page.
   `#/breakdown/<channel>` opens that channel's Breakdown tab;
   `#/video-breakdown` opens the list of studied videos.
3. **Discover.** One grid, one filter bar, saved views. Lists are moved one at
   a time; an old list is removed only when its view shows the same results.
   `#/breakouts`, `#/niches`, `#/same-topic`, `#/transfers` each open their
   saved view.
4. **Style and Create.** Formats + Hooks + Format builder become Style. Check
   becomes step 4 of a script. Calendar becomes Plan. `#/formats` and `#/hooks`
   open the Library on that layer; `#/format` opens My format; `#/risk` opens
   the script's Check step.
5. **Today, My channel, polish.** Today gets changes, alerts and the map. My
   channel gets Results. Phone pass on every screen. Old leftovers removed.
   Old in-page links (`#idea-lab`, `#concept-12`) keep working.

## Approved decisions

1. **The five places.** Today · Discover · Create · Style · My channel.
   Breakdown and Ask AI leave the menu (tabs of a channel or video, and a
   panel).
2. **Where the Map lives.** Discover opens on the video grid; the Map is one
   tab away and a small map sits on Today.
3. **Ask as a panel.** Opens over any screen and knows what is on it. Panel
   only, with an "open large" button; no menu entry.
4. **The names.** Today (was Home), Discover (was Research), Style (was
   Formats, Hooks and Format).
5. **Roll-out.** Step by step, the app usable after each, old links kept.

Smaller choices folded in: Check is the last step of a script; Calendar moves
to Create as Plan; "Viewers ask" is a source inside Ideas; competitors are a
saved view in Discover › Channels.
