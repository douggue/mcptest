# Jgtube

Jgtube is a research tool for a YouTube creator. Give it your channel and it
finds the channels like yours, the videos on them that took off, the thumbnails
that worked, and new or small channels in niches worth watching. Your own Claude
can then read all of it and tell you what to make next.

It runs on your own computer. Nothing is uploaded anywhere, and there is no
account to create.

## Before you use this

Three things to know first.

- **How it reads YouTube.** Jgtube reads YouTube's public pages the way a browser
  does, not through an official door. That is outside YouTube's terms of service,
  it can break when YouTube changes its pages, and YouTube can refuse the requests
  for a while. No YouTube account is involved, so there is nothing of yours to
  ban. [The crawl document](docs/CRAWL.md) has the details.
- **The numbers are estimates.** Scores compare a video with its own channel's
  usual views. Earnings are a rough range from typical ad rates applied to the
  views on a channel's recent uploads; Jgtube cannot see whether a channel is
  monetised or where its viewers live.
- **"Ask Claude" uses your Claude plan.** Each press of a button in that section
  runs Claude Code on your computer and counts against your plan's allowance, the
  same as a chat would.

## First run

You need about ten minutes and a Mac, Windows or Linux computer.

1. **Install Node.js 22.** Download the "LTS" installer for version 22 from
   <https://nodejs.org> and run it. Use version 22: newer versions may need extra
   build tools (see "If `npm install` fails" below).
2. **Get Jgtube.** On the repository's page on GitHub press **Code → Download ZIP**
   and unzip it, or run `git clone` if you use git. Put the folder somewhere you
   will keep it.
3. **Open a terminal in that folder.**
   - Mac: open Terminal, type `cd ` (with a space), drag the folder onto the
     window, press Enter.
   - Windows: open the folder in File Explorer, click the address bar, type
     `powershell`, press Enter.
4. **Install.** Type `npm install` and wait for it to finish (a minute or two).
5. **Create your settings file.**
   - Mac or Linux: `cp .env.example .env`
   - Windows: `copy .env.example .env`

   You can leave it as it is. To search for niches by keyword, open `.env` in a
   text editor and add your YouTube API key on the `YOUTUBE_API_KEY` line (remove
   the `#` at the start of that line). Restrict the key to "YouTube Data API v3"
   in Google Cloud.

6. **Start it.** Type `npm start`. When it says
   `Jgtube is running at http://127.0.0.1:4317`, open that address in your browser.
   Leave the terminal window open while you use Jgtube; closing it stops Jgtube.
7. **Make your first map.** Paste your channel's handle or link and press
   **Find competitors**. A first map takes a few minutes. After that it opens
   instantly from the copy stored on your computer.

To start it again another day, open a terminal in the folder and type `npm start`.

### If `npm install` fails

Jgtube uses one component that is built for your computer. On Node 22 a ready-made
copy is downloaded. If you see errors mentioning `better-sqlite3`, `node-gyp` or a
compiler:

- check `node --version` prints `v22.` something; if not, install Node 22;
- on a Mac, run `xcode-select --install`, then `npm install` again;
- on Windows, install "Visual Studio Build Tools" with the "Desktop development
  with C++" option, then `npm install` again.

## What is on the page

- **The radar** shows the channels around yours. **Like yours** is the filtered
  list; **Everything** is every channel that was read. Click a channel for
  details. You can remove one that is not a competitor, or keep one the filter
  left out.
- **Channel you want to be like** (optional): name a channel you are modelling
  yourself on and the map is measured against it instead of your own videos.
  Useful while your channel is new.
- **Depth and size** control how far the map reaches. Bigger takes longer.
- **Breaking out right now**: recent videos far above their channel's usual
  views, each with what the score rests on.
- **Same topic, different wording?**: channels that fit on size and pace but word
  their titles differently. Keep the ones that really make your kind of video.
- **Thumbnails that worked**: winners next to ordinary ones from the same
  channels, and your own.
- **Ask Claude**: three one-press questions (thumbnail review, video ideas, and
  judging the same-topic channels). See below for what it needs.
- **New niches to watch**: new or small channels, from everything Jgtube has
  read, with a recent video that took off. With an API key you can also search
  YouTube by keyword here. Press **Watch** to keep a channel on the list.
- **View history / Refresh now**: reads stored channels again so that growth
  over time builds up.

## Ask Claude, and using Jgtube in a Claude chat

Both let your own Claude do the judging, on the Claude plan you already have. No
extra API key is needed.

- **The Ask Claude buttons** need [Claude Code](https://code.claude.com) installed
  on the same computer and signed in. Each press takes up to a couple of minutes.
  This has been checked on macOS and Linux. On Windows it works only if the
  `claude` command can be started directly; if the buttons say Claude Code is not
  installed, use the chat route below instead.
- **In a chat**, the connector gives Claude the same information as tools, so you
  can ask follow-up questions. Setting it up in the Claude desktop app or Claude
  Code takes a few minutes: see [the connector guide](docs/CONNECTOR.md).

## Keeping your research safe

Everything Jgtube has read lives in one file, `jgtube.db`, in the Jgtube folder.
Deleting or replacing the folder deletes it.

- To keep the file somewhere safer, set `JGTUBE_DB_PATH` in `.env` to a full path
  outside the Jgtube folder, such as a folder that your computer backs up.
- `npm run backup` writes a dated copy of the file.
- Run one copy of Jgtube at a time. The app, the connector and `npm run refresh`
  can all open the same file, but two of them reading YouTube at once doubles the
  traffic and raises the chance of being refused.

## Settings

All optional, in `.env`:

| Setting                | What it does                                                          | Default                          |
| ---------------------- | --------------------------------------------------------------------- | -------------------------------- |
| `JGTUBE_DB_PATH`       | Where the store file lives                                            | `jgtube.db` in the Jgtube folder |
| `JGTUBE_REGION`        | Two-letter country that recommendations are read from                 | `US`                             |
| `JGTUBE_PORT`          | The port in the address you open                                      | `4317`                           |
| `YOUTUBE_API_KEY`      | Your YouTube Data API key, for keyword search and exact channel dates | none                             |
| `JGTUBE_REFRESH_HOURS` | Read stored channels again every this many hours while Jgtube runs    | off                              |

## Command line

The same engine without the page:

```
npm run jgtube -- ingest @somechannel   # read one channel and rank its videos
npm run jgtube -- map @somechannel      # map the channels around it
npm run refresh                         # read the stalest stored channels again
npm run backup                          # write a dated copy of the store
npm run mcp                             # start the Claude connector by hand
```

`map` accepts `--depth 1`, `--sample N` and `--max-channels N`. `refresh` accepts
`-- --max N`.

## For developers

- `npm run api` and `npm run web` in two terminals give a live-reloading page at
  http://127.0.0.1:5173.
- Checks: `npm run typecheck`, `npm run lint`, `npm test`.
- The app is only reachable from your own computer and has no login. Do not put it
  on a server without adding one.

| Document                               | What it covers                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| [PRD](docs/PRD.md)                     | Problem, users, goals, user stories, risks, open questions                      |
| [Architecture](docs/ARCHITECTURE.md)   | Components, stack, repository layout, data flow                                 |
| [System design](docs/SYSTEM_DESIGN.md) | Data model, scoring and matching rules, routes, connector tools, testing        |
| [Connector](docs/CONNECTOR.md)         | Adding Jgtube to the Claude desktop app or Claude Code, and what to ask         |
| [Crawl](docs/CRAWL.md)                 | How the recommendation map is gathered, with evidence, request budget and risks |
| [UI design](docs/UI_DESIGN.md)         | The owner's design (stored in `design/`), and how each screen maps to real data |
| [Task list](docs/TASK_LIST.md)         | What is built and what is not                                                   |
