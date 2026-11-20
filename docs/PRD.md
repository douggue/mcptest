# PRD: Jgtube

A research tool that tells a YouTube creator what to make next, based on what is
breaking out on the channels competing for their audience.

## Problem

Small channels pick topics by guessing. The evidence they need exists publicly
(which videos on similar channels beat their own baseline, and with which title
formats) but gathering it by hand takes hours and is out of date within days.

## Users

- **Primary:** a solo creator with a new or small channel (under 100K subscribers)
  in a format-driven niche. First user is the owner of this repo.
- **Later:** small teams running several channels in adjacent niches.

## Goals

1. From a channel handle, produce five ranked topic ideas with titles and the
   evidence behind each, in under five minutes.
2. Show the competitor set and let the user correct it before topics are written.
3. Be usable from inside Claude as a connector before any web UI exists.
4. Every number shown is traceable to a real video.

## Non-goals (v1)

- Accounts, billing and credits.
- Script writing, thumbnail generation, upload scheduling.
- Shorts.
- Anything that needs the user's YouTube login or private analytics.

## User stories

| # | As a creator I want to… | Acceptance |
|---|---|---|
| 1 | paste my channel and see who I compete with | A ranked list with closeness, size and best recent breakout appears within 4 minutes |
| 2 | remove channels that are not real competitors | Removed channels are excluded from every later step and stay removed |
| 3 | see what is breaking out right now | Videos are ranked by outlier score with age, views and channel size |
| 4 | get five topics I could film this week | Each has a score, an honest view range, a rationale citing videos, and five titles |
| 5 | know whether a topic is already covered | Each topic has a "found on YouTube" check with the closest existing video |
| 6 | trust the facts in a title | Each topic lists the claims it relies on with a source |
| 7 | ask follow-up questions | "More like #2", "why not X" and "titles for Y" work against the same research |
| 8 | find where else my format works | Adjacent sub-niches are ranked by fit with proof videos |

## What v1 improves on Makina

Observed in a real Makina run for a three-video channel:

| Weakness observed | Jgtube's answer |
|---|---|
| The map was mostly unrelated channels | Relevance filter: same-format check on every candidate |
| The closest look-alike channel was missing from the topic run | Search-based discovery merged with the crawl |
| View ranges as wide as 10K to 800K | Ranges come from peer-size channels only, with the sample shown |
| All five topics flagged "Maybe on YouTube" with no detail | Show the nearest existing video and its performance |
| "30-day views" was really views on recent uploads | Label it honestly; store snapshots to compute the real figure over time |

## Success measures

- Competitor precision: at least 8 of the top 12 competitors judged "same format"
  by the user.
- Time from handle to topics: under 5 minutes at the median.
- Zero numbers in output that cannot be traced to a stored video row.
- The owner uses a generated title for a real upload within two weeks.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Crawl violates YouTube ToS and may be blocked | High | Source abstraction, official-API fallback, see `CRAWL.md` |
| Predicted views are wrong and erode trust | Medium | Present ranges with their sample; track predictions against outcomes |
| Model invents statistics | Medium | Model cites video ids only; code fills numbers |
| Topic facts are wrong | Medium | Fact-check step with sources; unverified claims flagged |
| List-item format changes break parsing | Medium | Fixture tests, defensive parsing, alert on empty results |

## Decisions

| Date | Decision |
|---|---|
| 2026-11-20 | **Personal tool.** Single user, no accounts or billing. Phase 8 is out of scope. |
| 2026-11-20 | **The owner supplies the visual design.** The web UI (phase 7) waits for it; the engine and connector do not. |
| 2026-11-20 | **The product is called Jgtube.** It replaces the placeholder name everywhere, including the wordmark in the supplied design. |
| 2026-11-20 | **No YT dashboard.** The screen that needs the owner's YouTube Analytics login is dropped, not deferred. |

## Open questions

1. Which region and language should recommendations be read from by default?
