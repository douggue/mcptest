# Shorts finder

A service that watches YouTube Shorts on a list of subjects and countries
through the official YouTube Data API, and reports when a new or small channel
has a Short that is gaining views unusually fast.

Status: steps 1 and 3 of the plan. There is no program to start yet: the
scheduler is a function a later step will run as a service. What exists:

| Part                              | Where                       |
| --------------------------------- | --------------------------- |
| Settings                          | `src/config.ts`             |
| Store, migrations, backups        | `src/db/`, `src/repos/`     |
| Official-API reader               | `src/youtube/`              |
| Allowance ledger and plan         | `src/quota/ledger.ts`       |
| One reader at a time (a lease)    | `src/lease.ts`              |
| Subjects and which are due        | `src/subjects/`             |
| Search cycle, channel reads       | `src/discover/`             |
| Read cycle, tiers, views per hour | `src/track/`                |
| The loop that runs the cycles     | `src/schedule/scheduler.ts` |
| Earnings range for Shorts         | `src/scoring/earnings.ts`   |

Not built yet: the Shorts confirmation (step 2), rules and findings, alerts,
the service itself. Nothing here says what counts as "fast"; that is set later
from evidence across several niches.

This folder is self-contained: it has its own `package.json` and imports
nothing from outside itself, so it can be moved to a repository of its own.

## Set-up

Node 22 or later.

```
npm install
cp .env.example .env   # then put your YouTube Data API key in it
```

The `.env` file is never committed. The key is sent to Google in a request
header only and is stripped from every error message. No script reads the
settings yet; the one that starts the service will load `.env` with Node's
`--env-file-if-exists=.env`.

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
