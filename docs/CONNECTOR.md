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

## What Claude can do through it

| Tool                          | What it does                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `get_map`                     | Your latest map: the channels like yours, how closely each matches, each one's best recent video, and which calls are unsettled. |
| `get_breakouts`               | Recent videos far above their channel's usual views, with the numbers behind each score.                                         |
| `get_thumbnail_board`         | For each channel like yours, the videos that took off beside ordinary ones, and your own videos.                                 |
| `view_thumbnails`             | Fetches the real thumbnail pictures (up to 8 at a time) so Claude can look at them.                                              |
| `get_channel_videos`          | One channel's videos with scores.                                                                                                |
| `get_near_misses`             | Channels left out only because their titles use different words; Claude reads the titles and judges the topic.                   |
| `set_competitor_status`       | Records your decision to keep or remove a channel. Claude is told to do this only after you agree in the chat.                   |
| `list_niches`                 | New or small channels with a video far above their size.                                                                         |
| `list_transfer_opportunities` | Ideas that took off for another country and are untried or weak for yours, with each version's numbers.                          |
| `make_map`                    | Makes a new map by reading YouTube. Takes minutes; only one at a time.                                                           |

Only `set_competitor_status` and `make_map` change anything, and both only add to or
adjust your own Jgtube store; a decision can be undone by asking Claude to set the
channel back to automatic, or in the app.

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
