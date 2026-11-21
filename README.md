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
- **Watching a whole video means downloading it.** When a full video is to be
  analysed, picture and sound, Jgtube first downloads a small low-quality copy of
  it to your computer, hands that file over, and deletes it afterwards. Downloading
  YouTube videos is outside YouTube's terms of service, like the way Jgtube reads
  its pages. See "Downloads" below.

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
- **Taken off and rising.** Each channel like yours is labelled **Taken off** (its
  uploads of the last three months are widely seen again and again), **Rising**
  (under three months old and already far above its size) or **Neither**. They
  are listed about seven taken off to three rising, and the line under the
  **Like yours** button says the actual split, such as "21 like yours: 15 taken
  off, 6 rising". Who counts as like yours is not changed by this; only the order.
- **Channel you want to be like** (optional): name a channel you are modelling
  yourself on and the map is measured against it instead of your own videos.
  Useful while your channel is new.
- **Depth and size** control how far the map reaches. Bigger takes longer.
- **Breaking out right now**: recent videos far above their channel's usual
  views, each with what the score rests on.
- **Same topic, different wording?**: channels that fit on size and pace but word
  their titles differently. Keep the ones that really make your kind of video.
- **Thumbnails that worked**: winners next to ordinary ones from the same
  channels, and your own. **Download thumbnails** under a channel saves its
  pictures as files on your computer and tells you the folder.
- **Ask Claude**: three one-press questions (thumbnail review, video ideas, and
  judging the same-topic channels). See below for what it needs.
- **Niche transfer opportunities**: ideas that took off for another country and
  are untried or weak for yours. Press **Save** on one and it moves to **Saved**
  and leaves the other views; unsave it to bring it back.
- **New niches to watch**: new or small channels, from everything Jgtube has
  read, with a recent video that took off. With an API key you can also search
  YouTube by keyword here. Press **Watch** on a channel and it moves to
  **Watched** and leaves the other views, so those show only what you have not
  looked at yet; stop watching it to bring it back.
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
- Before Jgtube upgrades the file to a new version, it writes a dated copy beside
  it first (`jgtube.backup-v…db`). You can delete old copies once you are happy.
- Only one thing reads YouTube at a time: a map, a refresh or a keyword search,
  in the app, in Claude or on the command line. If one is running, the next is
  refused with a message saying so; wait and try again.

## Downloads

Jgtube saves two kinds of file besides its store, both into one folder: a
`downloads` folder beside the store file, or the folder you name in
`JGTUBE_DOWNLOADS_PATH`.

- **Thumbnails** you ask it to download: `downloads/thumbnails/<channel id>/`, one
  picture per video named by its video id, and an `index.json` listing each
  picture's video id, title, views and score. They stay until you delete them.
- **A temporary copy of a video**, when a whole video is to be watched:
  `downloads/video-temp/`. It is the smallest copy that is still watchable (360p,
  the one file YouTube offers with picture and sound together), never larger
  than 95 MB (about twenty minutes at that quality; a longer video is refused
  with a message, never cut short), deleted after use, and anything left behind
  is removed after a day.

For video files Jgtube uses the free program **yt-dlp** when it is installed on
your computer, and otherwise the YouTube library it already contains. The
built-in way is the one most likely to stop working when YouTube changes
something; where this was tried, YouTube refused it. If a video cannot be
fetched, install yt-dlp (<https://github.com/yt-dlp/yt-dlp>; on Windows,
`winget install yt-dlp.yt-dlp`) and try again.

Downloading YouTube videos is outside YouTube's terms of service, as reading its
pages this way is. The copies stay on your computer and are not shared.

## Settings

All optional, in `.env`:

| Setting                | What it does                                                          | Default                          |
| ---------------------- | --------------------------------------------------------------------- | -------------------------------- |
| `JGTUBE_DB_PATH`       | Where the store file lives                                            | `jgtube.db` in the Jgtube folder |
| `JGTUBE_REGION`        | Two-letter country that recommendations are read from                 | `US`                             |
| `JGTUBE_PORT`          | The port in the address you open                                      | `4317`                           |
| `YOUTUBE_API_KEY`      | Your YouTube Data API key, for keyword search and exact channel dates | none                             |
| `JGTUBE_REFRESH_HOURS` | Read stored channels again every this many hours while Jgtube runs    | off                              |
| `JGTUBE_DOWNLOADS_PATH` | The folder downloaded thumbnails and temporary video copies go into   | `downloads` beside the store     |

## Command line

The same engine without the page:

```
npm run jgtube -- ingest @somechannel   # read one channel and rank its videos
npm run jgtube -- map @somechannel      # map the channels around it
npm run jgtube -- transcript <video>    # print a video's captions and store them
npm run jgtube -- thumbnails @somechannel   # save its winning and ordinary thumbnails
npm run jgtube -- brand @somechannel    # its logo, cover, bio, keywords and links
npm run jgtube -- video <video>         # download one video as a small temporary file
npm run refresh                         # read the stalest stored channels again
npm run backup                          # write a dated copy of the store
npm run mcp                             # start the Claude connector by hand
```

`map` accepts `--depth 1`, `--sample N` and `--max-channels N`. `refresh` accepts
`-- --max N`. `<video>` is a video id or a link to one video. `transcript` reads
a video once: the next time it prints the stored copy without asking YouTube,
and a video without captions is reported as such. `thumbnails` needs a channel
already in the store (run `ingest` or make a map first), accepts
`--per-group N`, and prints the folder. `video` prints where the file is and how
big; delete it when you are done.

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
