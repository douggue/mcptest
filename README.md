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

- **Your channels.** Every channel you look up is kept. They are listed in a row
  above the radar: press one to see its map again at once, with nothing read from
  YouTube. Looking up a new channel never removes an earlier one. The small cross
  on a channel deletes it and its map, after asking you; the videos Jgtube read
  stay, because the niche list and the transfer ideas use them.
- **The radar** shows the channels around yours. **Like yours** is the filtered
  list; **Everything** is every channel that was read. Click a channel for
  details. You can remove one that is not a competitor, or keep one the filter
  left out.
  Each channel shows its own logo once Jgtube has read it since logos were
  added; a map made before that shows initials until you press **Refresh now**
  or make the map again.
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
  pictures as files on your computer and tells you the folder. **Download
  transcripts** saves what is said in the channel's videos that took off (up to
  six) as text files, and tells you the folder.
- **Ask AI**: three one-press questions (thumbnail review, video ideas, and
  judging the same-topic channels), and **Channel breakdown**, a longer job that
  takes one channel apart. Under each answer it says which AI gave it. See below
  for what it needs.
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

### Channel breakdown

The fourth card in Ask AI takes one channel apart so that you could make a video
like its best ones. Pick a channel in the list (the channel you want to be like,
your own, or any look-alike on the map) and press **Break down this channel**.
The same button is in the panel that opens when you click a channel on the radar.

**What you get.** Nine sections, each saying which videos it rests on:

- **What this rests on**: how many videos were studied, and how each was studied.
- **Channel identity**: logo, cover, bio, keywords and links.
- **Title formula**: the patterns in the best titles as fill-in templates, next
  to ordinary titles that used the same pattern and did not take off.
- **Thumbnail style**: what the best thumbnails look like against ordinary ones.
- **Description template**: how the descriptions are built.
- **Script**: the opening 30 seconds quoted, the structure with times, the length
  and the pace in words per minute (counted by Jgtube from the captions).
- **Picture, frame by frame**: the kind of pictures, how often the picture
  changes, the words on screen.
- **Sound and editing**: voice, music, sound effects, cuts and transitions.
- **How to make one like it**: a checklist that follows from the rest.

**What it studies.** Always the same, whatever the channel:

- The channel's **five videos furthest above its usual views**: their titles,
  thumbnails, descriptions and transcripts. A channel with fewer has all of them
  studied, and the breakdown says how many that was.
- The **three best of those in depth**. For each one Jgtube looks for the video
  as a file, in this order: a file you gave it, then yt-dlp, then its own
  built-in download. With a file, Antigravity watches it with sound, and ffmpeg
  cuts one frame for every second so that Claude Code or Codex can go through
  the whole video picture by picture. Jgtube downloads each video once, uses
  that one copy for both, and deletes it afterwards. A file you gave is never
  deleted.

**It is slow.** A breakdown is a job, not a quick answer: the page shows which
video it is on and what it is doing. Where this was tried, with no video file
and nothing to watch with, it took five and a half minutes: about a minute and a half for each of the three frame studies and for the writing. Watching three videos adds up
to 12 minutes each, so half an hour or more is normal. Keep the page open. Only
one breakdown or other Ask AI question runs at a time.

**What it needs.**

- Claude Code or Codex, because the breakdown looks at pictures. Antigravity
  alone cannot write it.
- For the deepest breakdown, two free programs: **yt-dlp** (downloads the video)
  and **ffmpeg** (cuts the frames). On Windows: `winget install yt-dlp.yt-dlp`
  and `winget install Gyan.FFmpeg`. On a Mac with Homebrew:
  `brew install yt-dlp ffmpeg`. Then close and reopen the terminal and start
  Jgtube again. `npm run engines` says whether each is found.
- To hear a video: Antigravity (it opens the file), or a `GEMINI_API_KEY` (the
  Gemini API watches a public video from its link).

**What happens when something is missing.** The breakdown still runs, and says
plainly what it could not do:

- No video file (not downloaded, too long, or no ffmpeg): Claude Code or Codex
  study **YouTube's own preview frames** instead. These are the small pictures
  you see when you drag along a video's timeline, one every few seconds. The
  breakdown says so, and says how many frames were looked at out of how many
  there were. It never claims to have seen every frame of the video.
- Nothing can watch (no Antigravity and no Gemini key): the **Sound and editing**
  section says NOT WATCHED and that the sound, music and transitions are
  unknown. It does not guess them from the transcript or the pictures.
- A video longer than about 19 minutes 47 seconds is not downloaded: its smallest
  copy would be over the 95 MB that can be handed to an engine.

**When a video cannot be downloaded, give Jgtube the file.** YouTube sometimes
refuses downloads from a computer for a while. The breakdown then lists each
video it could not get, with its title and its YouTube link. If you have the
video as an MP4 file:

- Press **Choose the video file** next to it and pick the file. The page shows
  how far it has got and then the file's size. Files up to 2 GB are taken.
- Or copy the file yourself into the `my-videos` folder inside your downloads
  folder (the page shows the full path). The file's name must contain the
  video's id, the eleven letters after `v=` in its link; a name like
  `My title [wE5ETbiq1qQ].mp4` is fine.

Then press **Run the breakdown again**. Jgtube keeps the files you give it until
you delete them yourself. If your file is larger than 95 MB and ffmpeg is
installed, Jgtube makes a smaller copy for Antigravity to watch (360 lines high,
sized from the video's length to fit) and deletes that copy afterwards; the
frames are still cut from your original.

**Results are kept.** What an engine wrote about a video (its watch notes and
its frame study) is stored, as are the transcripts. A second press for the same
channel reuses them and only writes the breakdown again, which takes a minute or
two. A frame study made from preview frames is made again once the video's file
can be had. Tick **Start again from nothing** to have everything made afresh.

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
computer; otherwise the Gemini API when a key is set. The channel breakdown uses
this for the three videos it studies in depth, and keeps what was written.

**What is not known, said plainly.**

- Only Claude Code has been run with Jgtube. Codex and Antigravity were built
  from their documentation and tested against stand-ins, and the Gemini API was
  never called with a real key. `npm run engines -- --try` is how you find out.
- No real video has been watched by any engine through Jgtube, and no real video
  file has been downloaded: where this was built, Antigravity was not installed,
  there was no Gemini key, and YouTube refused the download. So the breakdown has
  been run for real with preview frames and the NOT WATCHED section, and with a
  test-pattern video given as a file (which proves the file is cut into frames
  and studied, not how good the study of a real video is).
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

## Downloads

Jgtube saves these files besides its store, all into one folder: a `downloads`
folder beside the store file, or the folder you name in `JGTUBE_DOWNLOADS_PATH`.

- **Thumbnails** you ask it to download: `downloads/thumbnails/<channel name>/`, one
  picture per video named by its video id, and an `index.json` listing each
  picture's video id, title, views and score. They stay until you delete them.
- **Transcripts** you ask it to download: `downloads/transcripts/<channel name>/`,
  one text file per video named by its video id, with the time marked every half
  minute, and an `index.json`. Up to six per channel: its videos that took off.
  They stay until you delete them.
- **Your own video files**, for a channel breakdown: `downloads/my-videos/`. Jgtube
  only reads them and never deletes them.
- **A temporary copy of a video**, when a whole video is to be watched or its
  frames cut: `downloads/video-temp/`. It is the smallest copy that is still
  watchable (360p, the one file YouTube offers with picture and sound together),
  never larger than 95 MB (about twenty minutes at that quality; a longer video
  is refused with a message, never cut short), deleted after use, and anything
  left behind is removed after a day. The frames cut from a video, and a smaller
  copy made of a large file of yours, sit in the same folder and are deleted
  with it.

For video files Jgtube uses the free program **yt-dlp** when it is installed on
your computer, and otherwise the YouTube library it already contains. The
built-in way is the one most likely to stop working when YouTube changes
something; where this was tried, YouTube refused it. If a video cannot be
fetched, install yt-dlp (<https://github.com/yt-dlp/yt-dlp>; on Windows,
`winget install yt-dlp.yt-dlp`) and try again. YouTube can also refuse yt-dlp
from a connection for a while ("confirm you're not a bot"); Jgtube then says so
in plain words, and you can give it the file yourself (see Channel breakdown).

Downloading YouTube videos is outside YouTube's terms of service, as reading its
pages this way is. The copies stay on your computer and are not shared.

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
| `JGTUBE_DOWNLOADS_PATH`    | The folder for downloaded thumbnails, transcripts, your own video files | `downloads` beside the store     |

## Command line

The same engine without the page:

```
npm run jgtube -- ingest @somechannel   # read one channel and rank its videos
npm run jgtube -- map @somechannel      # map the channels around it
npm run jgtube -- transcript <video>    # print a video's captions and store them
npm run jgtube -- transcripts @somechannel  # save the transcripts of its videos that took off
npm run jgtube -- thumbnails @somechannel   # save its winning and ordinary thumbnails
npm run jgtube -- brand @somechannel    # its logo, cover, bio, keywords and links
npm run jgtube -- video <video>         # download one video as a small temporary file
npm run refresh                         # read the stalest stored channels again
npm run backup                          # write a dated copy of the store
npm run mcp                             # start the Claude connector by hand
npm run engines                         # which AI engines, and yt-dlp and ffmpeg, are found
```

`map` accepts `--depth 1`, `--sample N` and `--max-channels N`. `refresh` accepts
`-- --max N`. `engines` accepts `-- --try`, and with it `--video FILE` and
`--youtube LINK`. `-- --max N`. `<video>` is a video id or a link to one video. `transcript` reads
a video once: the next time it prints the stored copy without asking YouTube,
and a video without captions is reported as such. `thumbnails` and `transcripts`
need a channel already in the store (run `ingest` or make a map first) and print
the folder; `thumbnails` accepts `--per-group N`. `video` prints where the file is and how
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
