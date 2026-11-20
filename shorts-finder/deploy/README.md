# Putting Shorts finder on a server

This takes you from nothing to your first Telegram message. Allow about an
hour the first time. You do not need to be a programmer; you do need to copy
commands exactly as written.

> **Not yet run on a server.** The scripts in this folder (`setup.sh`,
> `update.sh`, `backup.sh`, `shorts-finder-cli.sh`) and the service files have
> been checked for mistakes in their writing (`bash -n`, `shellcheck`,
> `systemd-analyze verify`), and `backup.sh` has been tried on a test store on
> a development machine. None of them has been run on a real droplet yet. The
> first run is the test: go one step at a time and read what each prints.

What you will have at the end: a small server that runs Shorts finder all
day, restarts it if it stops, copies its store every night, and sends you a
Telegram message for each finding, a summary each day and a line each day
saying it is still running.

Lines in grey boxes are commands. Type them (or paste them) and press Enter.

## 1. Get a YouTube API key

1. Go to <https://console.cloud.google.com/> and sign in.
2. Create a project (any name).
3. In "APIs and services", choose "Library", find **YouTube Data API v3** and
   press "Enable".
4. In "APIs and services", choose "Credentials", then "Create credentials",
   then "API key".
5. Open the new key and, under "API restrictions", restrict it to
   **YouTube Data API v3**. Later, when your server has an address (step 3),
   come back and under "Application restrictions" choose "IP addresses" and
   add the server's address.
6. Keep the key somewhere private. Never put it in a chat, an email or the
   code.

## 2. Make a Telegram bot and find your chat number

1. In Telegram, search for **@BotFather** (it has a blue tick) and open it.
2. Send it `/newbot`. It asks for a name (anything, such as "My Shorts
   finder") and a username that ends in `bot` (such as `my_shorts_finder_bot`).
3. BotFather answers with a **token**: a number, a colon and a long run of
   letters. Keep it private, like the key.
4. Open your new bot (BotFather gives a link) and press **Start**, then send
   it any message, such as "hello". A bot cannot write to you until you have
   written to it.
5. Find your chat number. On your own computer, open this address in a
   browser, with your token in place of `YOUR_TOKEN` (keep the word `bot`
   in front of it):

   ```
   https://api.telegram.org/botYOUR_TOKEN/getUpdates
   ```

   Look for `"chat":{"id":` followed by a number, such as `123456789`. That
   number is your chat id. (If the page shows `"result":[]`, send the bot
   another message and reload.) Close the page afterwards and clear it from
   your browser history, since the address contains your token.

   To get alerts in a group instead: add the bot to the group, send a
   message in the group, and use the group's number, which starts with `-`.

## 3. Create the droplet

1. At DigitalOcean, create a Droplet: **Ubuntu**, the newest **LTS** version,
   the **$6 a month** size (1 GB of memory).
2. Under "Authentication" choose **SSH key** and add yours. DigitalOcean's
   page explains how to make one. With a key, nobody can log in by guessing
   a password.
3. Create it and note its address (four numbers, such as `203.0.113.10`).

## 4. Log in

On your own computer, open a terminal and type, with your address:

```
ssh root@203.0.113.10
```

Everything from here on is typed in that window, on the server.

## 5. Put the code on the server

The code must be under `/opt`, not in your home folder: the service is not
allowed to read home folders.

```
git clone YOUR_REPOSITORY_ADDRESS /opt/shorts-finder-code
```

Put the address of the repository in place of `YOUR_REPOSITORY_ADDRESS`. If
the repository is private, GitHub will refuse: in the repository's settings,
add a read-only "deploy key" for this server first (GitHub's help page
"Managing deploy keys" has the steps), and use the address that starts with
`git@github.com:`.

## 6. Run the set-up

```
bash /opt/shorts-finder-code/shorts-finder/deploy/setup.sh
```

(If the Shorts finder folder is the whole repository, the path is
`/opt/shorts-finder-code/deploy/setup.sh`.)

It takes a few minutes and prints nine numbered steps. It:

- installs Node 22 and a few system packages;
- creates a user called `shorts` that the service runs as, which can write
  only to `/var/lib/shorts-finder`;
- adds 1 GB of swap space if the server has none, so installing does not run
  out of memory;
- closes the firewall to everything except SSH;
- turns on automatic security updates;
- installs the service and a nightly backup;
- creates the settings file `/etc/shorts-finder/env`, readable by root only,
  with `CHANGE_ME` where your key and token go.

It never asks for your key or token. If it stops with an error, read the last
lines: they say which step failed. It is safe to run again.

## 7. Put in your key and token

```
nano /etc/shorts-finder/env
```

Replace the three `CHANGE_ME` with your YouTube key, your bot token and your
chat number. No spaces around `=`, no quotes. Set `SHORTS_TIMEZONE` to your
own, such as `Europe/London`, so the daily messages come at your 6 pm.
Press Ctrl+O then Enter to save, Ctrl+X to leave.

## 8. Start it

```
systemctl start shorts-finder
journalctl -u shorts-finder -n 20
```

You should see a line with `"event":"started"`. If instead you see
`"event":"start_failed"`, the `reason` names the setting that is wrong; fix
it in the file and run `systemctl restart shorts-finder`.

## 9. Tell it what to watch

Nothing is searched until there is a subject. Add one or more:

```
shorts-finder subjects add "your keyword here"
shorts-finder subjects list
```

Each keyword is searched once a day in each country in `SHORTS_REGIONS`. A
search costs 100 of the day's 10,000 units, so four countries allow about 15
keywords a day.

## 10. Your first Telegram message

At the hour set in `SHORTS_DIGEST_HOUR` (6 pm by default, in your time zone)
you get two messages: the day's summary and "Shorts finder is still
running". If the service was started after that hour, they come within five
minutes. If they do not come:

```
journalctl -u shorts-finder -n 50 | grep -E 'alerts|daily|failed'
```

A line that says Telegram "did not accept the bot token", "cannot find the
chat" or "may not write to this chat" tells you which of the two settings to
correct. The most common cause is not having pressed Start in the bot's chat.

Alerts for findings come later: the rules that decide what counts as a
finding are a separate step of the project and are not part of this version.

## Day to day

| To                             | Type                                                             |
| ------------------------------ | ---------------------------------------------------------------- |
| See how it is doing            | `shorts-finder status`                                           |
| Read the last lines of its log | `journalctl -u shorts-finder -n 50`                              |
| Watch the log as it happens    | `journalctl -u shorts-finder -f` (Ctrl+C to leave)               |
| See only problems              | `journalctl -u shorts-finder -p err -n 50`                       |
| See today's log                | `journalctl -u shorts-finder --since today`                      |
| Stop it / start it             | `systemctl stop shorts-finder` / `systemctl start shorts-finder` |
| Turn a subject off / on        | `shorts-finder subjects disable 3` / `enable 3`                  |
| Update to the newest code      | `/opt/shorts-finder/deploy/update.sh`                            |
| Make a backup now              | `systemctl start shorts-finder-backup`                           |
| List the backups               | `ls -lh /var/lib/shorts-finder/backups`                          |

### Reading the log

Each line is one event. The parts that matter:

- `"event":"cycle"` with `"cycle":"read"`, `"search"`, `"channels"`,
  `"alerts"`, `"daily"` or `"rollup"`: one round of work, and `"result"` says
  `done`, `failed` or `skipped` (skipped means another command was reading
  YouTube at that moment; it is tried again).
- `"level":"error"`: something failed; `"reason"` says what, in words.
- `"event":"alerts_off"`: the Telegram settings are empty.

The key and the token never appear in the log.

### Backups

Every night a compressed copy of the store is written to
`/var/lib/shorts-finder/backups`, and copies older than 14 nights are
deleted, so the folder does not grow without end. If the disk is too full to
hold a copy, the backup stops and says so in
`journalctl -u shorts-finder-backup` rather than filling it. These copies
are on the same server: also turn on DigitalOcean's own weekly droplet
backups, so a lost server is not a lost store.

To go back to a copy: stop the service, unpack the copy over the store, start
it again.

```
systemctl stop shorts-finder
gunzip -c /var/lib/shorts-finder/backups/shorts-finder-20261120.db.gz > /var/lib/shorts-finder/shorts-finder.db
rm -f /var/lib/shorts-finder/shorts-finder.db-wal /var/lib/shorts-finder/shorts-finder.db-shm
chown shorts:shorts /var/lib/shorts-finder/shorts-finder.db
systemctl start shorts-finder
```

### If it goes quiet

A day with no "still running" message means something is wrong. Log in and
run `systemctl status shorts-finder` and `shorts-finder status`. If the
status says `code=exited, status=78`, a setting is wrong and the service is
waiting for you to fix the file and restart it.

## What is where

| Thing                  | Place                                                |
| ---------------------- | ---------------------------------------------------- |
| The code               | `/opt/shorts-finder` (a link to where you cloned it) |
| Settings, key, token   | `/etc/shorts-finder/env` (root only)                 |
| The store              | `/var/lib/shorts-finder/shorts-finder.db`            |
| Backups                | `/var/lib/shorts-finder/backups`                     |
| The service definition | `/etc/systemd/system/shorts-finder.service`          |
