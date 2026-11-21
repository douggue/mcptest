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
  analysed, picture and sound, Jgtube first downloads a copy of it to your
  computer (at 720p when yt-dlp and ffmpeg are installed), uses that file, and
  deletes it afterwards. Downloading
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
- **What changed** (just under your channels): for the channel on screen, what
  is new among the channels like it since you last looked: videos that newly
  broke out (with their pictures and links, and what they were before), channels
  that newly count as taken off or rising or dropped out, channels new on the map
  or gone from it, and title wordings that several new winners share. Press
  **Mark as seen** when you have read it; next time it shows only what came
  after. You can also look at **Since yesterday** or **Since 7 days**. When
  nothing changed it says so in one line. It works only from what Jgtube has
  already read, so it is only as fresh as the last refresh; the line at its foot
  says when these channels were last read, with a link to **Refresh now**. No AI
  is used.
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
- **Trending formats**, **Hook library**, **Idea lab** and **Script writer**:
  title wordings that several winning videos share, how the winning videos open
  in their own words, an AI that writes ten video ideas from videos you pick,
  and a script for one of them in three steps. See
  [Idea lab, trending formats and the hook library](#idea-lab-trending-formats-and-the-hook-library).
  takes one channel apart in seven parts, down to a production plan, a thumbnail
  prompt and a master prompt saved as text files. Under each answer it says
  which AI gave it. See below for what it needs.
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
and a run started by Jgtube cannot answer, so the tool is quietly refused. To
set it up, open a terminal in the Jgtube folder and type:

```
npm run engines -- --allow-antigravity
```

That adds one line to Antigravity's own settings file (`settings.json` in the
folder `.gemini`, then `antigravity-cli`, inside your home folder), keeps a copy
of the file as it was beside it, and changes nothing else. Jgtube only touches
that file when you run this command. To do it by hand instead, make sure the
file has this:

```json
{
  "permissions": {
    "allow": ["mcp(jgtube/*)"]
  }
}
```

If the file already has an `"allow"` list, add `"mcp(jgtube/*)"` to it. Until the
line is there, Antigravity is passed over and the next engine is used.

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

The fourth card in Ask AI takes one channel apart, in detail, so that you could
make videos like its best ones and beat it. Pick a channel in the list (the
channel you want to be like, your own, any look-alike on the map, another
channel you saved, or one from the niche lists) and press **Break down this
channel**. The same button is in the panel that opens when you click a channel
on the radar, and on each niche card.

**What you get.** Seven parts, written one after another, each saying which
videos and which numbers it rests on:

1. **Titles.** At least 20 of the channel's titles, from the most viewed to the
   least, each with its views and score. What the high ones share and the low
   ones lack, counted: length, opening words, numbers, names, emotional words.
   The formulas as fill-in templates, where the channel's own formula failed,
   and **better formulas for you**, each argued from that ranking, with what to
   avoid.
2. **Thumbnails.** Each top thumbnail described in detail next to ordinary
   ones: layout, colours, faces, the words and their size. What repeats, what
   differs, what you should improve, and a **thumbnail prompt** you can paste
   into an image generator, with a slot for the subject and a slot for the
   words.
3. **Scripts.** For each of the three best videos: the first minute quoted and
   explained (what it promises, what question it opens), a beat sheet with
   times, the pace in words per minute overall and for each beat, where tension
   is raised and paid off, sentence style, recurring phrases, calls to action
   and the ending. Then what the three share.
4. **Picture and sound.** The kinds of shot and how often the picture changes,
   from the frame studies. Sound, music and transitions only if a video was
   watched; otherwise it says NOT WATCHED.
5. **Strengths, weaknesses and strategy.** What the channel does well and badly,
   each resting on named videos and numbers, and a strategy to beat it: what to
   copy, what to do better, where it is weak or absent.
6. **Production plan.** How the channel appears to make its videos (marked as a
   guess from the evidence), then a step-by-step plan for one video: research
   and fact-checking, title, thumbnail, script, voice, pictures, sound and
   music, edit, publish, with the numbers to hit (length, words, pace, picture
   changes). For each step it says how to do it with AI, naming the kind of tool
   (a voice generator, an image generator, an image-to-video tool, a stock
   library, an editor; a product name is only ever an example you can swap), or
   by hand where that is better, with ready prompts.
7. **Master prompt.** One prompt you can give to any AI to write a video in this
   channel's style with the improvements built in. It tells that AI to mark
   every fact it did not get from you as `[CHECK: ...]`.

Before the seven parts there is **What this rests on**: which videos were
studied and how, worked out by Jgtube itself, with no AI.

**Check the facts yourself.** An AI wrote these parts from titles, captions and
pictures. Captions made by YouTube mishear names and numbers, and an AI can
state things that are not true. Before you publish, check every name, number,
date and claim against a real source; that is what `[CHECK: ...]` in the master
prompt is for. Read YouTube's own rules on reused content, misleading titles
and thumbnails, and labelling AI-made content: Jgtube has not checked your
video against them and cannot.

**The four text files.** When a breakdown finishes, Jgtube saves four plain
text files you can open in Notepad, in `downloads/breakdowns/<channel name>/`
(the page shows the full path):

- `breakdown.txt`: the whole breakdown, every part in order.
- `production-plan.txt`: the production plan.
- `thumbnail-prompt.txt`: only the thumbnail prompt, ready to paste.
- `master-prompt.txt`: only the master prompt, ready to paste.

On the page, the production plan, the thumbnail prompt and the master prompt
each have a **Copy** button and a **Download .txt** button. If the AI did not
mark a prompt the way Jgtube asked, Jgtube saves no file for it and says so; it
never guesses where a prompt begins and ends.

**It is kept.** A finished breakdown is stored. Pick the channel again, today
or next month, and it is shown at once with the day it was written, each part
as a section you open. **Run again** studies the videos and writes everything
again. If a part could not be written, **Write the missing parts** writes only
those. Pressing **Break down this channel** again when nothing about the
channel has changed starts no AI and shows what is stored; after a refresh has
brought new numbers, or after you gave Jgtube a video file, it writes the parts
again from the studies it kept.

**What it studies.** Always the same, whatever the channel:

- The channel's **titles**: the 20 most viewed and, when it has more, up to 20
  of the least viewed. A channel with fewer than 20 stored has all of them
  studied, and the breakdown says so.
- The channel's **five videos furthest above its usual views**: their
  thumbnails, descriptions and transcripts, next to up to five ordinary videos.
- The **three best of those in depth**. For each one Jgtube looks for the video
  as a file, in this order: a file you gave it, then yt-dlp, then its own
  built-in download. With a file, Antigravity watches it with sound, and ffmpeg
  cuts one frame for every second so that Claude Code or Codex can go through
  the whole video picture by picture. Jgtube downloads each video once, uses
  that one copy for both, and deletes it afterwards. A file you gave is never
  deleted.

**It is slow.** A breakdown is a job, not a quick answer: the page shows what
it is doing ("Writing part 3 of 7: the scripts"). Where this was tried, with no video file and nothing to watch with, a whole breakdown took twelve and a half minutes: about a minute and a half for each of the three frame studies, then between 40 seconds and two minutes for each of the seven parts. Watching
three videos adds up to 12 minutes each, so half an hour or more is normal.
Keep the page open. Only one breakdown or other Ask AI question runs at a time.
Each part is a run of your AI plan, so a breakdown uses about as much of your
plan's allowance as ten long questions.

**What it needs.**

- Claude Code or Codex for the thumbnail part and the frame studies, because
  they look at pictures. Antigravity can write the other six parts; if you
  choose Antigravity alone on the switch, the breakdown says that the thumbnail
  part was not written and why.
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
  there were. It never claims to have seen every frame of the video. How often
  the picture changes is then "at most every so many seconds": a change quicker
  than the frames are apart cannot be seen.
- Nothing can watch (no Antigravity and no Gemini key): the picture and sound
  part says NOT WATCHED and that the sound, music and transitions are unknown,
  and the production plan and the master prompt say the same. Nothing guesses
  them from the transcript or the pictures.
- One part cannot be written (the AI hit its plan limit, or took too long): the
  other parts are still written, the page says which part is missing and why,
  and **Write the missing parts** tries again later.
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

**What is reused.** What an engine wrote about a video (its watch notes and its
frame study) is stored, as are the transcripts and the seven parts. A frame
study made from preview frames is made again once the video's file can be had.
Tick **Start again from nothing** to have everything made afresh.

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

## Idea lab, trending formats and the hook library

These three parts of the page work as one flow. All three use only the channels
on the map of the channel on screen. If you have looked up several channels in
different niches, an idea or a hook from one never shows up for another.

### Trending formats

Press **Find formats** and an AI reads the titles of the videos doing unusually
well on this map (from the last 30 or 90 days; 90 unless you choose) and groups
them into formulas with named slots, such as a wording where only the place
and the thing change. Under each formula is one line on why it works and the
videos behind it, with their real thumbnails, views and score.

- It is an AI run: two to three minutes, and it uses some of that AI's plan
  allowance. The AI is the one chosen on the switch under **Ask AI**.
- The AI only proposes. Jgtube keeps a formula only when at least two of the
  videos it names really are stored videos of this map inside the window. One
  video is an example, not a format. The average score, the count of videos and
  of channels, the views and the scores are worked out by Jgtube from what it
  has stored, never taken from the AI's answer. When it leaves a formula out it
  says which and why.
- **Remix in idea lab** takes a formula into the idea lab as its title format.
- The next run for the same window replaces the formulas of the one before.

### Hook library

A hook here is real: the first 60 seconds of what a winning video says, taken
word for word from its captions. No AI writes or rewrites it.

- **Build the hook library** reads the captions of the twelve strongest
  breakout videos on this map from YouTube, a request or two for each one not
  read before (about half a minute in all). A video without captions is listed
  as such.
- Captions that YouTube made by listening can mishear a name or a number. The
  card says when that is the case.
- **Name the styles** is the one AI part: it gives each opening a short name for
  the way it works (the AI chooses the names from what it reads; Jgtube gives
  it no list) and one sentence on how. One to two minutes. The filters above
  the cards are the names that came back. A hook that has no name yet is still
  shown.
- **Copy hook** copies the words. **Use in idea lab** adds that video to the
  idea lab's inspiration and marks it as an opening to model.
- A hook is a model for a way of opening. Do not reuse its words.

### Idea lab

1. Pick one to five videos as inspiration: **Use as inspiration** on a video
   under **Breaking out right now**, or **Use in idea lab** on a hook.
2. Optionally pick a title format (a trending format or one of the title
   formats of the transfer list), type your topic or angle in one line (at most
   200 characters), and choose long-form or Shorts.
3. Press **Write 10 concepts**. It takes two to four minutes and uses some of
   the AI's plan allowance.

Each concept is a title, two alternate titles, what the thumbnail shows, the
few words on it, and the opening sentence. The card also shows:

- **Rests on**: which of your picked videos it draws on, with links. If it
  names none of them, the card says so.
- **Look up before making it**: the AI cannot search the web, so it does not
  know real facts about a subject. This line says what you must check (which
  company, which product, what really happened) before you make the video. Take
  it seriously: a concept is an idea for a title, not a finding.
- The number of characters in each title, with a warning when a phone may cut
  it off. A hook that shares six words in a row with a real opening in the
  hook library is flagged too. The warning starts at 55 characters (40 for Shorts). YouTube
  publishes no such number, only its limit of 100; 55 is a rule of thumb from
  title-checking tools, which put the cut between 45 and 60.
- **Feed preview**: your draft beside two real videos that took off on this map.

On each concept: **Keep** keeps it. **Twist angle** asks for three other angles
on the same subject. **More like this** asks for five other subjects in the same
vein. Both take about a minute.

Kept concepts stay and are listed first, also after you close the page.
Concepts you did not keep are removed when the next batch arrives, or when you
press **Clear the ones not kept**.

### Script writer

Press **Draft** on a concept and its script opens under **Script writer**.
Starting a script keeps the concept. One script per concept; it is saved on
this computer as you type and is still there after you close the page.

**Every fact in a script must be checked by you.** The AI that writes the
script cannot look anything up. It does not know real facts about the subject:
what it writes about names, dates, numbers, places and what a company did comes
from the AI's own memory, which can be wrong or out of date, or from what other
channels said in their videos. It is told to put `[CHECK: what to verify]`
right after every such claim. The page counts these markers and lists them
beside the script, and also lists sentences that hold a number and no marker.
Check each one against a real source before you record, then delete the
marker. A video that states invented facts as true breaks YouTube's rules on
misleading content. A script with no markers is not a checked script.

Before the first step, set what the script is written to:

- **Voice**: the channel whose way of speaking the script follows. It starts
  as your model channel if you named one, else your own; you can pick any
  channel like yours on this map. Jgtube measures the voice from the captions
  of that channel's five best videos: words a minute, how long its sentences
  are, and a reading grade. If the captions have not been read yet, press
  **Read its captions** (a few seconds). Nothing here is a preset: if nothing
  can be measured, type the words a minute yourself.
- **Length**: for a long video, a slider within the range the winning videos of
  the channels like yours on this map really run. A Short is written to under
  a minute.

The three steps, each an AI run:

1. **Hooks and beat sheet** (about a minute): three hooks of one minute each
   at the voice's rate, each opening in a different way, then a beat sheet with
   times. You can choose up to three hooks from the hook library as models
   (the chips under the step, or **Model this in the script** on a hook card);
   with none chosen the AI picks from the library. A hook is a model for the
   way of opening only: if a written hook shares six words in a row with a real
   one, the page says so. Pick one hook; you can edit it and the beat sheet.
2. **The draft** (three to six minutes for a sixteen-minute video): the full
   script, with a picture cue before the words it covers, written
   `[B-ROLL: what to show | search phrase | sound]`.
3. **Tighten pass** (one to two minutes): the same script made easier to say,
   toward the voice channel's own reading grade, with no fact added.

Beside the editor: the words spoken, the spoken time at the words a minute
(headings, picture cues and markers are not counted), the reading grade against
the voice channel's own, the facts to check, and a checklist made from the beat
sheet. The reading grade is an estimate and only works for English.

**Export**:

- **Copy clean voiceover text**: only what is spoken, for a voice tool. If
  markers remain, the first press tells you how many facts are unchecked and
  the second press copies anyway.
- **Text file (.txt)** and **Markdown file (.md)**: the whole script with its
  headings, picture cues and markers. The Markdown file ends with the facts to
  check as a list.
- **B-roll shot list (.csv)**: one row per picture cue, with when it starts and
  ends, what to show, a search phrase or picture prompt, and the sound. The
  times are worked out by Jgtube from the words at the words a minute, never
  taken from the AI. It opens in Excel or Google Sheets.

How often the picture changes: if a channel breakdown has studied the frames
of the voice channel's videos, the draft sets cues at that rate. If not, the
page says so and cues are set where the subject changes; no cut rate is
invented.

### Where else

**Where else this could work** suggests other languages and other categories
the formats and ideas on this map could be made for, each with an example
title and the exact phrase to type into YouTube search. Jgtube has not looked
at YouTube in those languages or categories: every suggestion is a place to
check, never a finding that nobody has done it there. About a minute.

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
- **A channel breakdown's text files**: `downloads/breakdowns/<channel name>/`,
  four plain text files (`breakdown.txt`, `production-plan.txt`,
  `thumbnail-prompt.txt`, `master-prompt.txt`) and an `index.json` saying which
  channel they belong to. They are written again each time a breakdown of that
  channel finishes, and stay until you delete them.
- **Your own video files**, for a channel breakdown: `downloads/my-videos/`. Jgtube
  only reads them and never deletes them.
- **A temporary copy of a video**, when a whole video is to be watched or its
  frames cut: `downloads/video-temp/`. With yt-dlp and ffmpeg installed it is an
  MP4 at 720p (YouTube offers sharp pictures apart from their sound; yt-dlp
  fetches both and ffmpeg joins them). Without ffmpeg it is the one file YouTube
  offers with picture and sound together, usually 360p. A file is never larger
  than 1,000 MB and never cut short. The frames for Claude and Codex are cut
  from that file. Antigravity opens files only up to about 95 MB, so for it
  Jgtube makes a smaller copy with ffmpeg, as sharp as fits: 720p for a short
  video, 480p or 360p for a longer one. Everything here is deleted after use,
  and anything left behind is removed after a day.

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

| Setting                    | What it does                                                                | Default                          |
| -------------------------- | --------------------------------------------------------------------------- | -------------------------------- |
| `JGTUBE_DB_PATH`           | Where the store file lives                                                  | `jgtube.db` in the Jgtube folder |
| `JGTUBE_REGION`            | Two-letter country that recommendations are read from                       | `US`                             |
| `JGTUBE_PORT`              | The port in the address you open                                            | `4317`                           |
| `YOUTUBE_API_KEY`          | Your YouTube Data API key, for keyword search and exact channel dates       | none                             |
| `JGTUBE_REFRESH_HOURS`     | Read stored channels again every this many hours while Jgtube runs          | off                              |
| `JGTUBE_ENGINES`           | Which AI engines Ask AI may use, most preferred first                       | `claude,agy,codex`               |
| `JGTUBE_AGY_MODEL`         | A model for Antigravity to use (`agy models` lists them)                    | Antigravity's own choice         |
| `GEMINI_API_KEY`           | Your Gemini API key, for watching public YouTube videos                     | none                             |
| `JGTUBE_GEMINI_MODEL`      | The Gemini model that watches                                               | `gemini-4-hydrogen`              |
| `JGTUBE_AGY_YOUTUBE_LINKS` | `on` lets Antigravity try a YouTube link when it has no file (unproven)     | `off`                            |
| `JGTUBE_DOWNLOADS_PATH`    | The folder for downloaded thumbnails, transcripts, your own video files     | `downloads` beside the store     |
| `JGTUBE_YT_DLP_PATH`       | The full path of the yt-dlp program, when Jgtube does not find it by itself | found on the PATH                |
| `JGTUBE_FFMPEG_PATH`       | The full path of the ffmpeg program, when Jgtube does not find it by itself | found on the PATH                |

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
