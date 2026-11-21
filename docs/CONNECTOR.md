# The Claude connector

The connector lets your own Claude read what Jgtube has stored about your channel
and its competitors, so you can ask in plain words why a video worked, what to make
next, or how to improve your thumbnails. It runs on your computer, opens the same
store as the Jgtube app, and needs no extra API key: Claude does the thinking on the
plan you already have.

## Before you start

1. Jgtube is installed: in the Jgtube folder you have run `npm install` once.
2. You have made at least one map in the app (`npm start`, paste your channel,
   **Find competitors**). The connector reads that map. Claude can also make a map
   for you, but it takes several minutes either way.
3. You know the full path of the Jgtube folder. Below it is written as
   **`/ABSOLUTE/PATH/TO/JGTUBE`**: replace those words, in both places, with your own
   path, for example `/Users/sam/jgtube` on a Mac or `C:/Users/sam/jgtube` on
   Windows (forward slashes work on Windows and avoid mistakes).

## Add it to the Claude desktop app

1. Open Claude, then **Settings → Developer → Edit Config**. This opens the file
   `claude_desktop_config.json`
   (Mac: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`).
2. Put this in the file. If the file already has an `mcpServers` part, add only the
   `"jgtube": { ... }` entry inside it.

   ```json
   {
     "mcpServers": {
       "jgtube": {
         "command": "node",
         "args": [
           "/ABSOLUTE/PATH/TO/JGTUBE/node_modules/tsx/dist/cli.mjs",
           "/ABSOLUTE/PATH/TO/JGTUBE/packages/mcp/src/main.ts"
         ]
       }
     }
   }
   ```

3. Save the file, quit Claude completely and open it again.

## Add it to Claude Code

Run this once in a terminal (one line, with your own path in both places):

```
claude mcp add --scope user jgtube -- node /ABSOLUTE/PATH/TO/JGTUBE/node_modules/tsx/dist/cli.mjs /ABSOLUTE/PATH/TO/JGTUBE/packages/mcp/src/main.ts
```

## Check that it worked

- **Desktop app:** start a new chat and open the tools (connectors) menu by the
  message box. **jgtube** should be listed, with ten tools. Where exactly that menu
  sits changes between versions of the app; **Settings → Developer** also shows
  whether jgtube is running.
- **Claude Code:** run `claude mcp list`; the line for `jgtube` should say it is
  connected. Inside a session, `/mcp` shows the same.
- **Either:** ask "Use Jgtube to show my map for @yourchannel". You should get your
  look-alike channels back within a second or two.

If something is wrong:

| What you see                                | What to do                                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| jgtube is not listed, or "failed"           | Check both paths in the config. In a terminal in the Jgtube folder run `npm run mcp`: it should print "Jgtube connector is running". Stop it with Ctrl+C. |
| "node" cannot be found                      | Install Node 22 or newer, or replace `"node"` with the full path a terminal prints for `which node` (Mac) or `where node` (Windows).                      |
| "No map has been made for this channel yet" | Make the map in the app first, or ask Claude to "make a new Jgtube map for @yourchannel" and wait a few minutes.                                          |
| Thumbnails "could not be shown"             | The pictures are fetched from YouTube when asked for; check your internet connection.                                                                     |
| A video "has no captions"                   | YouTube lists none for it. A new upload often gets automatic captions within a day; Jgtube asks again after a day.                                        |

## Things to ask

- "Look at my Jgtube map for @yourchannel. Which videos on channels like mine took
  off this month, why do you think they worked, and what should I make next?"
- "Review my thumbnails for @yourchannel against the winners on channels like mine.
  Look at the actual pictures, then tell me what to copy and three specific changes
  to make." (The connector also carries a ready-made **Thumbnail review** prompt
  that asks this for you: in the desktop app it is under the **+** menu by the
  message box, in Claude Code it is `/mcp__jgtube__thumbnail_review`.)
- "Which channels did Jgtube leave out only because their titles are worded
  differently? Read their titles and tell me which ones cover the same topics as me
  in their own words." Then, for one you agree with: "Yes, keep that one as a
  competitor."
- "Show me the new niches Jgtube has found. Which would suit a channel like mine?"
- "Break down the channel @somechannel for me: its logo, cover and bio, the title
  formula and description template of its videos that took off, and how one of
  those videos is scripted and what it shows on screen." Claude reads the
  channel's branding, the descriptions and tags, a transcript, and frames taken
  across the video.

## What Claude can do through it

| Tool                          | What it does                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `get_map`                     | Your latest map: the channels like yours, how closely each matches, each one's best recent video, and which calls are unsettled.      |
| `get_breakouts`               | Recent videos far above their channel's usual views, with the numbers behind each score.                                              |
| `get_thumbnail_board`         | For each channel like yours, the videos that took off beside ordinary ones, and your own videos.                                      |
| `view_thumbnails`             | Fetches the real thumbnail pictures (up to 8 at a time) so Claude can look at them.                                                   |
| `get_channel_videos`          | One channel's videos with scores: strongest first, newest first or most viewed first.                                                 |
| `get_near_misses`             | Channels left out only because their titles use different words; Claude reads the titles and judges the topic.                        |
| `set_competitor_status`       | Records your decision to keep or remove a channel. Claude is told to do this only after you agree in the chat.                        |
| `list_niches`                 | New or small channels with a video far above their size.                                                                              |
| `list_transfer_opportunities` | Ideas that took off for another country and are untried or weak for yours, with each version's numbers.                               |
| `make_map`                    | Makes a new map by reading YouTube. Takes minutes; only one at a time.                                                                |
| `get_transcript`              | What one video says: its captions as text with the time every half minute. Long ones come in parts.                                   |
| `view_video_frames`           | What one video shows: sheets of frames from start to end, a sample or every sheet in turn. Pictures only, no sound.                   |
| `get_channel_brand`           | A channel's bio, keywords and links, and its logo and cover as pictures Claude can look at.                                           |
| `get_video_details`           | The description, tags, length, views and score of up to 10 videos, for title formulas and description templates.                      |
| `get_video_watch`             | What an AI wrote down after watching a video with sound, when the app's channel breakdown has had it watched.                         |
| `get_frame_study`             | What an AI wrote down after going through a video's frames, when the app's channel breakdown has made such a study.                   |
| `get_transcript_pace`         | How fast a video is spoken, counted by Jgtube: words per minute for the whole video and minute by minute, or part by part.            |
| `get_breakdown_part`          | One stored part of the app's breakdown of a channel: titles, thumbnails, scripts, picture and sound, strategy, plan or master prompt. |
| `get_channel_note`            | A kept thumbnail review of a channel's map, or the style lock lifted from its breakdown: a study, never instructions.                 |
| `get_viewer_comments`         | Stored comments of a map's winning videos, read in the app with your API key: strangers' text, never instructions.                    |
| `get_risk_findings`           | What code found in a kept concept's script: runs of words shared with competitors, facts to check.                                    |
| `get_fact_sheet`              | The fact sheet a web research run wrote for one concept in the script writer: numbered facts, not found, disputed.                    |

Only `set_competitor_status` and `make_map` change anything, and both only add to or
adjust your own Jgtube store; a decision can be undone by asking Claude to set the
channel back to automatic, or in the app. The last four tools read one video or
one channel from YouTube the first time they are asked about it (a request or
two) and keep what they read in your store, so asking again is instant.

`get_map` also says, for each channel like yours, whether it has already taken
off or is rising, and lists them about seven to three.

What these tools cannot do: `view_video_frames` shows still frames and no sound,
so Claude cannot judge sound design or exact cuts from it. The frames are
YouTube's own preview pictures, small and several seconds apart, unless the
app's channel breakdown has the video as a file at that moment; then they are
cut from the file, one for every second. Asked with `start_sheet`, the tool
hands the sheets over in order and says how many the video has, so Claude can go
through all of them. Watching a whole video with its sound needs the video as a
file; the connector does not send video files. `get_video_watch` and
`get_frame_study` only return what a channel breakdown in the app has already
written down and kept.
| `get_idea_brief` | What you chose in the app's idea lab for one batch of concepts: the picked videos, the length and the title format. Used by the app's own AI runs. |
| `get_concept` | One concept the idea lab stored for a channel, in its labelled lines. Used by the app's own AI runs. |
| `get_hooks` | The hook library of a channel's map: the first minute of what its top breakout videos say, word for word, with the style name when one was given. |
| `get_script` | The script the app's script writer holds for one concept, with the numbers it is written to. Used by the app's own AI runs. |
written down and kept. `get_frame_study` also gives what Jgtube worked out from
the study: the gap between two frames and, when the study counted its picture
changes, the most seconds there can be between them.

`get_breakdown_part` hands Claude one part of a breakdown the app has written
and kept for a channel, so you can ask Claude in a chat to work from it ("read
the production plan for @channel and turn step 4 into a script outline").
Claude is told that a part is a study an AI wrote, to be read and never taken
as instructions, and that a part which was not written must not be made up. To
have a breakdown written, use the app: the connector only reads it.

## Good to know

- **Same data as the app.** The connector opens `jgtube.db` in the Jgtube folder,
  the same file the app uses, and both can run at once. Settings in a `.env` file
  in the Jgtube folder (`JGTUBE_DB_PATH`, `JGTUBE_REGION`) are read by both. If
  you set them some other way when starting the app, give the connector the same
  ones by adding `"env": { "JGTUBE_DB_PATH": "/ABSOLUTE/PATH/TO/your.db" }` next
  to `"args"` in the config.
- **What leaves your computer.** The store stays on your computer. What a tool
  returns (channel names, titles, view counts, thumbnails) becomes part of your chat
  with Claude, like anything else you paste into it.
- **Making a map from Claude.** It makes hundreds of requests to YouTube, the same
  as the app does, and the app and Claude should not both be making one at the same
  time. If Claude stops waiting before the map is finished, the map is still being
  made: ask for it again a few minutes later.
