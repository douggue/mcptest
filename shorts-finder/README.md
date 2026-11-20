# Shorts finder

A service that watches YouTube Shorts on a list of subjects and countries
through the official YouTube Data API, and reports when a new or small channel
has a Short that is gaining views unusually fast.

Status: steps 1, 3, 5 and 6 of the plan. The service starts, searches, reads
and sends its daily messages, but nothing yet decides what is a finding, so
no finding alerts go out until that step is built. What exists:

| Part                               | Where                                             |
| ---------------------------------- | ------------------------------------------------- |
| Settings                           | `src/config.ts`                                   |
| Store, migrations, backups         | `src/db/`, `src/repos/`                           |
| Official-API reader                | `src/youtube/`                                    |
| Allowance ledger and plan          | `src/quota/ledger.ts`                             |
| One reader at a time (a lease)     | `src/lease.ts`                                    |
| Subjects, the two searches, pacing | `src/subjects/`                                   |
| Search cycle, channel reads        | `src/discover/`                                   |
| Followed channels and their feeds  | `src/discover/follow.ts`, `feedCycle.ts`, `followedUploads.ts`, `src/youtube/feed.ts` |
| Read cycle, tracking by promise, growth, views per hour | `src/track/`                 |
| Cohort statistics (positions only) | `src/rank/cohort.ts`                              |
| Findings as stored, and their text | `src/findings/`, `src/repos/sqliteFindingRepo.ts` |
| Telegram alerts and daily messages | `src/alerts/`                                     |
| The loop that runs the cycles      | `src/schedule/scheduler.ts`                       |
| The service, and its entry point   | `src/service.ts`, `src/main.ts`                   |
| Commands run by hand               | `src/cli/run.ts`, `src/cli.ts`                    |
| The evidence report                | `src/report/evidence.ts`                          |
| The one logger                     | `src/log.ts`                                      |
| Earnings range for Shorts          | `src/scoring/earnings.ts`                         |
| Server set-up                      | `deploy/` (see `deploy/README.md`)                |

Not built yet: the Shorts confirmation (step 2) and the rules that make
findings (step 4). Nothing here says what counts as "fast"; that is set later
from evidence across several niches. The rules plug in by calling
`store.findings.add(...)` with a `NewFinding` (`src/repos/types.ts`): its
`reason` carries the sentences and figures the alert shows.

This folder is self-contained: it has its own `package.json` and imports
nothing from outside itself, so it can be moved to a repository of its own.

## Set-up

Node 22 or later.

```
npm install
cp .env.example .env   # then put your YouTube Data API key in it
```

The `.env` file is never committed. The key is sent to Google in a request
header only and is stripped from every error message. Telegram is optional:
set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` together for alerts, or
neither to run without them (the service says so once when it starts).

## Running it

```
npm start                                  # the service; Ctrl+C stops it cleanly
npm run subjects -- add "a keyword" [--regions US,GB] [--every 24] [--newest-every 24]
npm run subjects -- list
npm run subjects -- disable 3              # and: enable 3
npm run status                             # units spent, subjects, tracked videos, last runs
npm run report                             # what the searches have found, for reading the evidence
```

`npm run report` prints, for each subject and country, how many videos were
found, how they spread over the age bands (the cohort sizes), the spread
(least, quartiles, most) of their views at 24 hours and of views at 24 hours
per subscriber, and how much each keyword's finds overlap between countries.
It sets no threshold: `src/rank/cohort.ts` returns positions in a group and
nothing else, and the cut-offs for "outperforms" are to be chosen from these
figures by a later step.

All of them load `.env` if it is there (`node --env-file-if-exists=.env`) and
run the TypeScript directly through `tsx`; there is no build step, so what
runs is what is in `src/`. `subjects`, `status` and `report` need no key or token.

The service writes one line of JSON per event to standard output and nothing
else; under systemd that is the journal. It stops on SIGTERM or SIGINT by
telling running work to stop, which it does between requests, and closing
the store. It exits with 78 when a
setting is wrong and 1 when it cannot start for another reason. Send the
signal to `node` itself: `npm` does not pass SIGTERM on to it (systemd starts
`node` directly for that reason).

## Checks

```
npm run typecheck
npm run lint
npm test          # with coverage; 80% is the floor
```

The tests never call YouTube. The API replies in `test/fixtures/` are written
by hand in the shape the API documents, with made-up channels and videos.

## The daily allowance

A new key has 10,000 units a day; a search costs 100, most other requests 1.
The ledger records every request before it is sent and refuses, by itself,
once a share of the day's plan is used: searches 60%, readings of tracked
videos 20%, channel facts and upload lists 10%, and 10% kept back. The day is
the calendar day in Pacific time, when Google resets the allowance. The
shares are hard walls, with one exception: in the last three hours of the
Pacific day, units the searches and the channel reads have not spent may be
spent on readings, since they would otherwise be lost at midnight. The 10%
kept back is never lent.

## How the day runs

- Every hour a round of readings is taken, fifty videos to a request. Each
  reading keeps the views, likes and comments. How often a video is read
  depends on its place in a group of comparable videos, not on its age
  alone. The group is the tracked videos of the same subject keyword and
  country in the same age band (0-6 h, 6-24 h, 24-72 h, 3-7 d, 7-14 d); when
  it holds fewer than 10 it widens to the country across all subjects, then
  to everything in the band. A video is read hourly while it is under 72
  hours old and in the upper half of its group by views per hour, otherwise
  every six hours. Tracking ends after three readings in a row in the slower
  half without speeding up, or at day 14. A video whose channel is in the top
  quarter of its group by subscribers is read only at about 24 and 72 hours,
  as a baseline. A new video starts on the tier its age calls for.
- A round's budget is what the reading share has left today divided by the
  hours left of the Pacific day (never less than one request). The most
  promising videos are read first; what does not fit is put off to the next
  round, not dropped, and the number put off is reported.
- Each tracked video has a growth summary: its views at 1 h, 6 h, 24 h, 72 h
  and 7 d after publication, each worked out once by a straight line between
  the two readings on either side of that age and left empty when there are
  not two (nothing is guessed beyond the readings). When tracking ends the
  summary is completed and the raw readings are removed.
- A video the API leaves out on two occasions at least six hours apart stops
  being tracked, marked as gone; nothing is deleted on a miss (such a video
  even keeps its readings), and a reply that is empty for many videos at once
  is not believed.
- Each subject is searched in two ways, each on its own clock. "Top recent"
  asks for the most-viewed short videos of the last 48 hours (`--every`,
  24 hours unless set). "Newest" asks for everything published since its last
  sweep, newest first (`--newest-every`, 24 hours unless set; a first or
  long-overdue sweep looks back 48 hours at most). A newest sweep that comes
  back with a full page of 50 halves that subject's own interval, down to 3
  hours; one under half full doubles it back towards what was set. Whenever
  searches are due, the longest-due go first, whichever kind. Every hit is
  stored with the kind of search, its place in the results and the video's
  age when found. A search's results are kept the moment it answers, so a failure
  while reading their details costs no search: the details are read in the
  next round. New videos of three minutes or less are stored and tracked;
  longer ones are remembered and not paid for again. Channels' facts are read
  at most once in 24 hours.
- A channel is followed once its facts are read and it is small (a known
  subscriber count at or under `SHORTS_FOLLOW_MAX_SUBSCRIBERS`, 100,000) or
  new (an account younger than `SHORTS_FOLLOW_MAX_ACCOUNT_AGE_DAYS`, 180).
  Both are starting values, to be revisited once real readings show where
  "small" and "new" sit. A followed channel is watched through its public
  Shorts feed, which needs no key and costs no units: at most every 30
  minutes, three feeds at a time, backing off a channel whose feed fails
  (30 minutes, doubling to a day) and pausing all feeds for an hour after five
  failures in a row. New Shorts a feed lists are stored as confirmed Shorts
  and tracked (their details cost 1 unit per 50, from the channel share); a
  video a search had found is marked confirmed when its channel's feed lists
  it; and the feed's view count is kept as a reading marked `feed` for videos
  already tracked. While a channel's feed is not answering, the newest page
  of its uploads list is read through the API instead, once a day, 1 unit,
  within the channel share. A followed channel with no tracked upload for 14
  days is let go.
- The feeds are not part of the documented API. Their shape was checked by
  hand on two channels from one address; whether YouTube keeps answering a
  server that asks for hundreds of them a day is not yet known, which is what
  the back-off, the pause and the fallback are for.
- A search and the read of its results cost 101 units of the search share, so
  the default plan pays for 59 searches a day: with both kinds at 24 hours,
  about 29 subject-and-country pairs.
- Once a day a clean-up ends the tracking of videos past 14 days that were
  always put off, so their growth is summed up like everyone else's; deletes
  videos whose tracking ended more than 30 days ago, unless a finding is
  about them (a finding keeps its own copy of what it needs in any case);
  and deletes channels with no video left that are not followed. The 30 days
  is a starting value: Google's API terms on how long API data may be kept
  must be checked before it is settled (`RETENTION_DAYS` in
  `src/track/cleanup.ts`). The day is marked done only when the clean-up
  succeeded.
- When a share of the allowance is spent, or Google says the day's is, a cycle
  stops and reports what it left; it does not fail.

## Alerts

- Each finding gets one Telegram message: why it is listed, views per hour,
  total views, age, the channel's size and age when known, an earnings range
  at the configured rate, the subject and country that found it, and links
  to the Short and the channel. Oldest first, at most
  `SHORTS_MAX_ALERTS_PER_DAY` (10) in a day of the owner's time zone.
- A finding is marked as sent only after Telegram accepts the message. When
  Telegram asks for a pause, or a message fails, sending stops and is tried
  again later (after the pause Telegram names, or 15 minutes). A finding
  whose message Telegram reads and refuses three times is set aside with the
  reason, so it cannot hold up the ones behind it.
- From `SHORTS_DIGEST_HOUR` (18) in `SHORTS_TIMEZONE` (UTC), once a day: a
  summary (the day's counts, units spent, the fastest findings the daily
  limit left out) and a "still running" line (videos tracked, readings
  overdue, searches, units by kind, the store's size, the last problem). The
  store remembers which day each went out for, so a restart does not repeat
  them. Findings told of in a summary do not get an alert of their own later.
- Titles and channel names are untrusted: every value put into a message is
  cut to length and HTML-escaped, and links are built only from ids of the
  right shape. The bot token is part of Telegram's address, so the address
  is never logged and the token is taken out of every error and log line.
