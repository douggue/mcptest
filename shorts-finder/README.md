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
| Subjects and which are due         | `src/subjects/`                                   |
| Search cycle, channel reads        | `src/discover/`                                   |
| Read cycle, tiers, views per hour  | `src/track/`                                      |
| Findings as stored, and their text | `src/findings/`, `src/repos/sqliteFindingRepo.ts` |
| Telegram alerts and daily messages | `src/alerts/`                                     |
| The loop that runs the cycles      | `src/schedule/scheduler.ts`                       |
| The service, and its entry point   | `src/service.ts`, `src/main.ts`                   |
| Commands run by hand               | `src/cli/run.ts`, `src/cli.ts`                    |
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
npm run subjects -- add "a keyword" [--regions US,GB] [--every 24]
npm run subjects -- list
npm run subjects -- disable 3              # and: enable 3
npm run status                             # units spent, subjects, tracked videos, last runs
```

All three load `.env` if it is there (`node --env-file-if-exists=.env`) and
run the TypeScript directly through `tsx`; there is no build step, so what
runs is what is in `src/`. `subjects` and `status` need no key or token.

The service writes one line of JSON per event to standard output and nothing
else; under systemd that is the journal. It stops on SIGTERM or SIGINT by
letting running work finish and closing the store. It exits with 78 when a
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
the calendar day in Pacific time, when Google resets the allowance.

## How the day runs

- Every hour, every tracked video that is due is read, fifty to a request. A
  video is read hourly until 72 hours after publication, every six hours until
  day 14, then no longer. A video the API leaves out twice in a row is deleted.
- Whenever subjects are due, each is searched once (short videos of the last
  seven days). New videos of three minutes or less are stored and tracked;
  their channels' facts are read at most once in 24 hours.
- A search and the read of its results cost 101 units of the search share, so
  the default plan pays for 59 searches a day.
- Once a day, readings older than 14 days are thinned to the last of each day.
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
  again later (after the pause Telegram names, or 15 minutes).
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
