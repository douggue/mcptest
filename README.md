# Jgtube

Jgtube is a research tool for a YouTube creator. Give it your channel and it
finds the channels like yours, the videos on them that took off, the thumbnails
that worked, and new or small channels in niches worth watching. An AI you
already use (Antigravity, Claude or Codex) can then read all of it and tell you
what to make next.

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
- **"Ask AI" uses your AI plans.** Each press of a button in that section runs
  Antigravity, Claude Code or Codex on your computer, whichever is ready first,
  and counts against that plan's allowance, the same as a chat would. Google
  says its consumer plans do not support using Antigravity this way, and OpenAI
  recommends a paid key for Codex instead; see "Ask AI" below before you rely
  on either.

## First run

You need about ten minutes and a Mac, Windows or Linux computer.

1. **Install Node.js 22.** Download the "LTS" installer for version 22 from
   <https://nodejs.org> and run it. Use version 22: newer versions may need extra
   build tools (see "If `npm install` fails" below).
2. **Get Jgtube.** With git:

   ```
   git clone --branch claude/sharp-pascal-bfajgw https://github.com/douggue/mcptest.git
   cd mcptest
   ```

   Without git: on the repository's page on GitHub, open the branch menu, choose
   `claude/sharp-pascal-bfajgw`, press **Code → Download ZIP** and unzip it. The
   branch matters: the default branch does not hold the project yet.

3. **Open a terminal in that folder.**
   - Mac: open Terminal, type `cd ` (with a space), drag the folder onto the
     window, press Enter.
   - Windows: open the folder in File Explorer, click the address bar, type
     `powershell`, press Enter.
4. **Install.** Type `npm install` and wait for it to finish (a minute or two).
   Newer versions of npm may print a notice about "install scripts" for
   `better-sqlite3` and `esbuild`. Those are the database and the page builder
   Jgtube uses, both already approved in the project; the notice needs no action.
5. **Create your settings file.**
   - Mac or Linux: `cp .env.example .env`
   - Windows: `copy .env.example .env` (`cp` does not exist in the Windows
     command prompt)

   This step is only needed for the optional settings; Jgtube starts without it.

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
- **Ask AI**: three one-press questions (thumbnail review, video ideas, and
  judging the same-topic channels). Under each answer it says which AI gave it.
  See below for what it needs.
- **New niches to watch**: new or small channels, from everything Jgtube has
  read, with a recent video that took off. With an API key you can also search
  YouTube by keyword here. Press **Watch** to keep a channel on the list.
- **View history / Refresh now**: reads stored channels again so that growth
  over time builds up.

## Ask AI, and using Jgtube in a Claude chat

Both let an AI you already pay for do the judging. Jgtube has no AI of its own.

### The Ask AI buttons

The buttons can use three programs. You need at least one of them installed on
the same computer and signed in. Claude Code is the main one. If it cannot
answer (missing, signed out, out of allowance for now, too slow, or it stopped
with an error), Jgtube moves on to Antigravity and then Codex, and tells you
under the answer who was passed over and why.

**The AI switch.** Above the buttons there is a switch: Automatic, Claude Code,
Antigravity, Codex. Automatic is the behaviour above. Choosing one engine means
only that engine answers and nothing else is tried, so you decide whose plan
allowance is used. The page remembers your choice.

Watching a video is the exception to the order: Antigravity goes first there,
because it can open a video file with picture and sound.

| Engine          | What to install and do once                                                       | Notes                                                                     |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Claude Code     | Install [Claude Code](https://code.claude.com), run `claude` once and sign in     | The main one, and the only one run with Jgtube from start to finish       |
| Antigravity CLI | Install it, run `agy` once and sign in, then add one line to its settings (below) | First backup; first for watching video. Not used for the thumbnail review |
| Codex CLI       | Install it, then type `codex login` and follow it                                 | Second backup                                                             |

To see what Jgtube finds on your computer, open a terminal in the Jgtube folder
and type:

```
npm run engines
```

It lists each engine, whether it is installed and whether someone is signed in.
To prove that each one really works, type `npm run engines -- --try`. That asks
each engine one small question through Jgtube's tools and prints the answer or
the reason it failed. It uses a little of each plan's allowance.

**The one line Antigravity needs.** Antigravity asks before it uses a new tool,
and a run started by Jgtube cannot answer, so the tool is quietly refused. Open
the file `settings.json` in the folder `.gemini`, then `antigravity-cli`, inside
your home folder (create it if it is not there) and make sure it has this:

```json
{
  "permissions": {
    "allow": ["mcp(jgtube/*)"]
  }
}
```

If the file already has an `"allow"` list, add `"mcp(jgtube/*)"` to it. Jgtube
never changes this file itself. Until the line is there, Antigravity is passed
over and the next engine is used.

**Changing the order.** Set `JGTUBE_ENGINES` in `.env` to the engines you want,
most preferred first, separated by commas: for example `JGTUBE_ENGINES=claude,codex`.
An engine you leave out is never started.

**What each run is allowed to do.** Every run is given only Jgtube's read-only
tools, a private empty folder to start in, and none of your API keys. How tightly
each program can be held to that differs:

- Claude Code: no other tools exist in the run at all, and your other Claude
  settings are ignored.
- Codex: no commands, no web search, read-only, and your other Codex settings are
  ignored. It still reads your own instruction file (`AGENTS.md` in Codex's
  folder) if you have one.
- Antigravity: only Jgtube's tools are offered and its sandbox is on, but it
  cannot be told to ignore your other Antigravity tools, plugins and hooks, and
  it may write files inside its private folder, which Jgtube deletes after every
  run. To hold it tighter you can add `"deny": ["command(*)", "write_file(*)",
"read_url(*)", "execute_url(*)"]` beside the `"allow"` list, but that applies
  to everything you do with Antigravity, not only to Jgtube.

**Watching a whole video.** Two engines can watch a video, picture and sound:

- Antigravity watches a video file on your computer. The file must be an MP4 of
  at most 95 MB, and long videos (beyond roughly 15 to 30 minutes) may be too
  much for one pass. To try it on a small file of your own:
  `npm run engines -- --try --video C:\path\to\small.mp4`
- The Gemini API watches a public YouTube video from its link, with no download.
  It needs a key: create one in Google AI Studio and put it on the
  `GEMINI_API_KEY` line of `.env`. Private and unlisted videos do not work, and
  the free tier allows 8 hours of video a day.

Antigravity is used when it is installed and a copy of the video is on the
computer; otherwise the Gemini API when a key is set. Nothing on the page uses
this yet: it is the groundwork for the full video breakdown.

**What is not known, said plainly.**

- Only Claude Code has been run with Jgtube. Codex and Antigravity were built
  from their documentation and tested against stand-ins, and the Gemini API was
  never called with a real key. `npm run engines -- --try` is how you find out.
- Whether Antigravity can see the pictures a tool returns is not documented, so
  the thumbnail review uses Claude Code or Codex only.
- Whether Antigravity can watch a YouTube video from a link alone, without the
  file, is unproven. To see for yourself:
  `npm run engines -- --try --youtube https://www.youtube.com/watch?v=...`
  It asks for the first sentence spoken and the first three seconds on screen.
  If the answer matches the video, you can set `JGTUBE_AGY_YOUTUBE_LINKS=on`.
- Google's FAQ says that running Antigravity from inside another application
  "is not supported under consumer plans" and recommends an API key. OpenAI
  recommends an API key for Codex used from a program, and describes using a
  ChatGPT login this way only for trusted private automation. Using them from
  Jgtube on your own computer is your call.
- On Windows a program installed through npm is started through Node or
  `cmd.exe` with every argument quoted. That part was written for Windows but
  has not been run on a Windows computer.

### In a chat

The connector gives Claude the same information as tools, so you can ask
follow-up questions. Setting it up in the Claude desktop app or Claude Code
takes a few minutes: see [the connector guide](docs/CONNECTOR.md).

## Keeping your research safe

Everything Jgtube has read lives in one file, `jgtube.db`, in the Jgtube folder.
Deleting or replacing the folder deletes it.

- To keep the file somewhere safer, set `JGTUBE_DB_PATH` in `.env` to a full path
  outside the Jgtube folder, such as a folder that your computer backs up.
- `npm run backup` writes a dated copy of the file.
- Before Jgtube upgrades the file to a new version, it writes a dated copy beside
  it first (`jgtube.backup-v…db`). You can delete old copies once you are happy.
- Only one thing reads YouTube at a time: a map, a refresh or a keyword search,
  in the app, in Claude or on the command line. If one is running, the next is
  refused with a message saying so; wait and try again.

## Settings

All optional, in `.env`:

| Setting                    | What it does                                                            | Default                          |
| -------------------------- | ----------------------------------------------------------------------- | -------------------------------- |
| `JGTUBE_DB_PATH`           | Where the store file lives                                              | `jgtube.db` in the Jgtube folder |
| `JGTUBE_REGION`            | Two-letter country that recommendations are read from                   | `US`                             |
| `JGTUBE_PORT`              | The port in the address you open                                        | `4317`                           |
| `YOUTUBE_API_KEY`          | Your YouTube Data API key, for keyword search and exact channel dates   | none                             |
| `JGTUBE_REFRESH_HOURS`     | Read stored channels again every this many hours while Jgtube runs      | off                              |
| `JGTUBE_ENGINES`           | Which AI engines Ask AI may use, most preferred first                   | `claude,agy,codex`               |
| `JGTUBE_AGY_MODEL`         | A model for Antigravity to use (`agy models` lists them)                | Antigravity's own choice         |
| `GEMINI_API_KEY`           | Your Gemini API key, for watching public YouTube videos                 | none                             |
| `JGTUBE_GEMINI_MODEL`      | The Gemini model that watches                                           | `gemini-4-hydrogen`              |
| `JGTUBE_AGY_YOUTUBE_LINKS` | `on` lets Antigravity try a YouTube link when it has no file (unproven) | `off`                            |

## Command line

The same engine without the page:

```
npm run jgtube -- ingest @somechannel   # read one channel and rank its videos
npm run jgtube -- map @somechannel      # map the channels around it
npm run refresh                         # read the stalest stored channels again
npm run backup                          # write a dated copy of the store
npm run mcp                             # start the Claude connector by hand
npm run engines                         # which AI engines are installed and signed in
```

`map` accepts `--depth 1`, `--sample N` and `--max-channels N`. `refresh` accepts
`-- --max N`. `engines` accepts `-- --try`, and with it `--video FILE` and
`--youtube LINK`.

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
