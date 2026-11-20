# Shorts finder

A service that watches YouTube Shorts on a list of subjects and countries
through the official YouTube Data API, and reports when a new or small channel
has a Short that is gaining views unusually fast.

Status: step 1 of the plan only. There is no service to run yet. What exists is
the groundwork the later steps stand on:

| Part                           | Where                                             |
| ------------------------------ | ------------------------------------------------- |
| Settings                       | `src/config.ts`                                   |
| Store, migrations, backups     | `src/db/`                                         |
| Official-API reader            | `src/youtube/dataApi.ts`, `src/youtube/client.ts` |
| Allowance ledger and plan      | `src/quota/ledger.ts`, `src/repos/`               |
| One reader at a time (a lease) | `src/lease.ts`                                    |
| Earnings range for Shorts      | `src/scoring/earnings.ts`                         |

This folder is self-contained: it has its own `package.json` and imports
nothing from outside itself, so it can be moved to a repository of its own.

## Set-up

Node 22 or later.

```
npm install
cp .env.example .env   # then put your YouTube Data API key in it
```

The `.env` file is never committed. The key is sent to Google in a request
header only and is stripped from every error message.

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
