# Checking the new questions against the old ones

The questions Jgtube puts to an AI were rewritten (see `docs/PROMPT_AUDIT.md`).
Nobody has yet seen whether the answers are better: no AI was asked anything
while they were rewritten. This page is how to find out on one channel, at
the cost of about ten runs of your plan.

## How to compare

The answers already kept in the app for your channel were written by the old
questions. So for each feature below:

1. Open the answer you have now and copy it somewhere (or leave it open in a
   second window). That is OLD.
2. Run the same feature again on the same channel, video or concept, with the
   same AI. That is NEW.
3. Go down the feature's list and mark each line OLD, NEW or SAME.

Use one channel and one AI throughout. Where you have no old answer, run the
new one alone and use the list as a pass or fail.

If you want a true side-by-side on fresh data, the old questions are at
commit `3d58b0e`; ask whoever maintains the app to run that version once
beside this one.

## What good looks like, everywhere

Mark an answer down, old or new, when it does any of these:

- gives advice that would fit any channel;
- names a technique without the line, the time or the video that shows it;
- gives a number you cannot trace to a video or a measurement;
- predicts views;
- says something is "untried" or "open" on YouTube;
- shows a tag such as `<task>` in the answer (report this: it should never
  happen).

## 1. Script writer (the most important check)

Pick a concept and a length you would really make, with a fact sheet.

**Draft length.** After "Write the draft", read the word count the page
shows against the target.

| Check                                                        | Old            | New |
| ------------------------------------------------------------ | -------------- | --- |
| Words written as a share of the target (aim: 90% to 110%)    | about 77% in one test |     |
| The shortest section as a share of its own share of the length |              |     |
| Sections that just repeat an earlier point to fill space (should be none) |   |     |
| Facts with neither `[CHECK: …]` nor `[F#]` after them (should be none) |      |     |

If a section is under 85% of its share, the Draft step lists it with the
words it has and the words it was to hold. Press "Write the short sections
again" once and check:

- a beat the draft left out is listed as "missing from the draft", and
  after the run it stands in its place between the others;
- only the listed sections changed (the hook and the others read as before);
- the rewritten sections tell more, not the same thing twice;
- a section that stays short says something true and stops. That is the
  intended result when the fact sheet has no more to give; run research
  again if the sheet is thin.

**Hooks and beats.**

- Does each of the three hooks open in a clearly different way, or are they
  three wordings of one?
- Read each hook aloud against a clock: is the promise of the title in the
  first sentence, is there something at stake and a question left open by
  about 15 seconds, and a turn or surprise by about 30?
- Does every beat say what it holds back for the next one?
- Is the stored beat count equal to what the AI wrote? Count the beats on the
  page. If a notice above the script says a beat was shortened or beats were
  left off, read that beat and put back what matters. (Before this fix, a
  real run wrote nine beats and the app kept two without saying so.)
- Is each beat one line of about 45 words or fewer, naming its facts by their
  markers such as [F3]?
- Do the beat times look like a real video's, with more time where there is
  more to tell?

**Tighten.** Is the tightened script within a tenth of the draft's length,
with every `[CHECK]`, `[F#]` and picture cue still there?

## 2. One video, in depth

Pick a video you know well, ideally one you compared with another AI before.

- Count the lines quoted word for word with a time. More is better.
- Is the opening taken apart against the clock (5, 15, 30 seconds), with the
  lines quoted?
- Is there a list of numbers (length, words, words a minute, seconds between
  changes of picture), each saying where it comes from, and "not measured"
  where there is none?
- Is the structure a list of timed segments, each with its job?
- Does it name where each open question is answered?
- Paste the script prompt into any AI with a topic of yours. Does what comes
  back follow the video's structure and come out at the length you asked?
- Is anything about sound described when nobody watched the video? (It should
  say NOT HEARD.)

## 3. Video ideas and Packaging concepts

- How many of the ideas could you start on today, without asking "but about
  what, exactly"?
- Does a new batch repeat a subject you already have? A card that says
  "Close to an idea you already have" is the app's own check: read both.
- Across the batch: do the titles open on different words, and do the
  overlays sit in different places, unless the answer says the winners all
  do the same?
- Is each opening at most two short sentences: the promise, then the open
  question?
- For each title: can you say from the title alone what the video gives you?
- Are the two alternates really different pulls, or the same title reworded?
- Does the overlay add something the title does not say, in four words or
  fewer?
- Does every idea show its proof (channel, views, score) and say when the
  proof is weak?
- Is any title a competitor's title with one word changed? (It should not be.)

## 4. Thumbnail review, and a concept's thumbnail prompt

- Could a designer rebuild each winning style from the words alone (what sits
  where, how large, which colours, how many words)?
- Does it say where winners and ordinary thumbnails look the same, so the
  thumbnail was not the reason?
- Paste the prompt into your image tool. Does the result have one clear
  subject you can read at phone size? Does it show a real person, a logo or
  a flag? (It should not.)

## 5. Channel breakdown

Run it again on a channel you have a breakdown of (seven runs).

- Scripts part: does it quote the line at the end of each beat that pulls
  into the next, with its time?
- Titles part: are the ten ready titles whole titles you could publish, each
  naming its formula?
- Strategy part: is each list in order of importance, and is every item
  something you could do on your next video?
- Master prompt: paste it into any AI with a topic and a length. Does the
  script come out at the length asked? The same for the script prompt of the
  scripts part, of "One video, in depth" and of a teardown's plan: each now
  has a [LENGTH IN MINUTES] slot.
- Ten ready titles: is every fact, name or number no tool returned followed
  by (check)?
- Did the plan and the scripts part finish, and are they whole? (Their ready
  prompts and quoted openings no longer count against their length.)
- Are all three prompts (thumbnail, style lock, master) still lifted out with
  their Copy buttons? (If one is missing, report it.)

## 6. Production teardown

- Did every stage come back? A stage with one field too long is now kept:
  under its heading it says "To keep it, the app shortened or left out: …".
  Read what it names. A stage that still says "Not made" is the thing to
  report, with its reason.
- Techniques: is each one named, with at least one quoted line and its time?
- Hook: does the summary end with a pattern you could reuse on another topic?
- Plan: is the script prompt a complete brief, with the chapters and their
  share of the length?

## 7. The rest, briefly

| Feature                  | Look for                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Fact sheet               | About one fact for every 60 words of the script (at least 12), each one sentence with a source you can open; the things your hook and beats mark [CHECK] looked up; any "Fact N was left off the sheet" line under what was not found |
| Trending formats         | Each slot named for the kind of thing that goes in it; the WHY says which words do the pulling |
| Hook styles              | Names you could give to a hook on any subject, the same name for the same way of opening   |
| What viewers ask for     | Each finding exact enough to become a title or a line in a script                          |
| Check before publishing  | Promises the title or thumbnail makes that the script pays late, in part or never          |
| Suggest a mix            | The summary names the weakest slot and what would strengthen it                            |
| Format Bible             | It comes back whole; "Shortened or left out by the checks" lists anything cut; rules you can check a video against |
| Your own question        | The answer first, then the videos and numbers behind it                                    |

## What to send back

For each feature: OLD, NEW or SAME, and one example line that shows why. For
the script draft, the two word counts. That is enough to decide what to keep,
what to put back and what to fix in code.

## What is checked automatically

Run `npm test`. Without asking any AI, it checks that every question says who
the AI is, has its task, its rules on evidence and its answer form, in order;
that an answer written exactly to each form is read by the app; that a
teardown stage or a Bible filled to the stated lengths is accepted; that a
script's word budget adds up to the length asked; and it keeps a copy of
every question word for word, so any later change shows up for review
(`packages/server/test/promptLint.test.ts`, `promptSnapshots.test.ts`).
