# Prompt audit

An audit of every question Jgtube puts to an AI engine, and what was changed.
Read with `docs/PROMPT_EVAL.md` (how to compare old against new on your own
channel) and the section "How a question is written" in `docs/SYSTEM_DESIGN.md`.

**What this is not.** No engine was asked anything for this audit: the
container it was written in holds no store with a channel in it, so there was
nothing to run a fair before-and-after on. Every finding below comes from
reading the questions, the code that reads the answers, and the owner's two
reports (a standalone AI run gave a deeper single-video teardown; a script
draft came out about 23% short). Whether the new questions give better
answers is for the checklist in `PROMPT_EVAL.md` to show.

## What was audited

55 built prompts (every analysis, its pictures-as-files form, the one-line connection check, and the
variants the owner's choices produce), listed in
`packages/server/test/promptCatalog.ts` and snapshotted word for word in
`packages/server/test/__snapshots__/promptSnapshots.test.ts.snap`.

| Family                 | File                                           | Questions                                                        |
| ---------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| The analyst            | `analyses.ts`                                  | system prompt, video system prompt, thumbnail prompt rule        |
| Quick analyses         | `analyses.ts`                                  | thumbnail review, video ideas, same topic different words        |
| Idea lab               | `ideaQuestions.ts`, `formatInQuestions.ts`     | concepts, twist, more like this, where else                      |
| Formats and hooks      | `formulaQuestions.ts`, `hookQuestions.ts`      | title formulas, hook styles                                      |
| Script writer          | `scriptQuestions.ts`                           | system prompt, hooks and beats, draft, tighten                   |
| Research               | `researchQuestions.ts`                         | system prompt, fact sheet, claims check                          |
| Channel breakdown      | `breakdownPartQuestions.ts`                    | the seven parts                                                  |
| Studies of a video     | `breakdownQuestions.ts`, `oneVideoQuestions.ts` | watch, deep watch, frame study, one video in depth (and a file) |
| Production teardown    | `teardownQuestions.ts`                         | system prompt, eight judged stages, the watch                    |
| Thumbnails             | `thumbReviewQuestions.ts`, `conceptThumbQuestion.ts` | checklist, per-video advice, a concept's thumbnail prompt  |
| Format builder         | `formatMixRequests.ts`, `formatBibleQuestions.ts` | suggest a mix, Format Bible                                   |
| Later features         | `extrasAnalyses.ts`, `ownQuestion.ts`          | what viewers ask for, check before publishing, your own question |
| Connector prompt       | `packages/mcp/src/prompt.ts`                   | `thumbnail_review`, for a chat client                            |

## Findings, worst first

Ranked by how much each hurt what the owner gets.

### 1. Script drafts were asked for a total and nothing else (the 23% shortfall)

The draft was told "write about targetWords words in all, within a tenth of
it" and "count the spoken words before you answer", in the middle of a
1,076-word paragraph. A model does not keep a running count over a long
answer; with one total and no way to check it part-way, it stops when the
story feels told. The tighten pass then said "nothing said twice" and "keep
the length within a tenth", which can only shorten.

Changed:

- `get_script` now returns `wordBudget` once there is a beat sheet: the
  hook's words, then the rest shared among the beats by the time each runs,
  worked out in code and adding up to `targetWords` exactly
  (`core/src/script/budget.ts`).
- The draft question has a section of its own on length: write and count one
  section at a time against its number; a section under its number is not
  finished; lengthen it from what the fact sheet and tools give, never by
  repeating or inventing; add the sections up before answering.
- The hooks stage is told that its beat times decide each beat's words.
- The tighten pass is told that tightening is not shortening, section by
  section.
- The fact sheet is asked for more facts than the old 8 to 25 (now sized to
  the script: about one for every 60 spoken words), and for what
  a script needs to fill its length (the order of events, the people, the
  numbers, the stakes, the turn, details a viewer can picture). A thin fact
  sheet was a second cause: the draft may not invent, so it had nothing to
  lengthen with.

### 2. The single-video breakdown was capped into shallowness

"One video, in depth" was limited to 1,800 words, asked for "a few lines" on
what the video is, listed retention devices in a bracket, and never asked for
a quoted line. The system prompt told the engine to write "short sentences,
no preamble". That produces a summary. The standalone run the owner compared
it with was specific, quantified, structured, with named techniques, quoted
lines with times and ready prompts.

Changed: up to 3,000 words and told to use them (15 minutes, 20 steps); a
craft section that requires every technique to be named and proved with its
quoted line and time; the hook judged against the clock (5, 15 and 30
seconds); a numbers list from tools only; the structure as a timed table
with each segment's job, words and pace; open loops with the time they open
and close; a "why it works" ranking; and three ready prompts that must be
complete briefs (the script prompt carries the structure, shares of length,
pace and a word count to write to).

### 3. Production teardown stages gave an engine a JSON shape and one sentence

Each of the eight stages was about 100 words: "find the storytelling
techniques (3 to 12)", then the shape. Nothing said what makes a finding
good, and nothing said how long a field may be, while code refuses a whole
stage when any text runs over 200, 600, 4,000 or 6,000 characters, or a list
over its count. An engine asked for depth and given no limits is the likeliest
way to lose a stage.

Changed: every stage is a brief (task, what to read, what a director looks
for, rules) and states the limits, a little under what code allows. The hook
stage judges the opening against the clock and ends with a reusable pattern;
techniques must be named, counted, quoted with times and say how to reuse
them; the plan's script prompt must be a complete brief with shares of
length and a word count.

### 4. A competing instruction: a JSON answer under a plain-text system prompt

The teardown's watch asks for one JSON object, but ran under the video system
prompt, which says "Answer in plain text. Put section titles in CAPITALS".
Changed: the video system prompt now says "When the question asks for JSON,
answer with that JSON alone", and the watch question says its answer is JSON.
A lint test now fails for any question that mixes the two.

### 5. No director's criteria anywhere

Concepts, video ideas, hooks, beat sheets and thumbnails were asked for with
rules about honesty and form, and nothing about what makes one good. "HOOK:
the opening sentence of the video, one sentence." "THUMBNAIL: one line on
what to show." So answers were correct and generic.

Changed: shared craft, written once in `promptParts.ts` and used wherever it
applies: titles (one promise, subject clear and only the answer held back,
specific over loud, the carrying words first for a phone); thumbnails (one
focal point read in under a second, contrast, emotion without a presenter,
an overlay that adds to the title and never repeats it, one promise across
thumbnail, title and first sentence); hooks (confirm the click in 5 seconds,
stakes and an open loop by 15, a pattern interrupt by 30, every loop paid);
retention (every beat changes something and ends on a re-hook, the main
promise held to the last third and paid in full). None holds an example
title or subject.

### 6. One run-on paragraph per question

Every question was a single paragraph of 200 to 1,400 words joined by
spaces: the task, the tool calls, the rules and the output form interleaved,
with the form often in the middle. Rules given late in a long paragraph are
the ones dropped.

Changed: six named sections in a fixed order (`<task>`, `<owner>`,
`<gather>`, `<craft>`, `<rules>`, `<output_format>`), tool calls numbered,
rules one to a line, the output form always last.

### 7. No reader, no purpose

No question said who would read the answer or what they would do with it.
The system prompt said "an analyst working for the owner of a small faceless
YouTube channel". Changed: an `<owner>` section in every question says that
one creator acts on the answer as it stands, and what this answer is used
for; the system prompts name a role with judgement (strategist and director;
script writer and director; producer and director; researcher and
fact-checker).

### 8. Word caps that forced thin answers

Video ideas: 8 ideas with six evidence fields each in 650 words (about 80
words an idea). Thumbnail review: five sections in 450 words. Changed: 1,000
and 700; breakdown parts raised by about a fifth; your own question 400 to
500. The system prompt now says to spend the length on specifics, never on
general advice.

### 9. Missing evidence was handled case by case

Some questions said what to write when a study was missing (NOT WATCHED, NO
FRAME STUDY); most said nothing, which invites a guess. Changed: one rule,
`MISSING_EVIDENCE`, in the system prompt and the questions: say so at the
place it matters and move on; never fill a gap with a typical value.

### 10. Smaller things

- The Format Bible's shape held copyable examples (a title formula, a hex
  colour, component names). They came back as answers. Replaced with
  descriptions of what goes in each field.
- The Format Bible put the format's name, which the owner types, into the
  question in quotes without taking out quote marks or hidden characters.
  It is now cleaned and said to be a label, never instructions.
- The Format Bible stated none of the lengths code enforces (a thumbnail
  prompt over 1,200 characters refuses the whole Bible). It now states them.
- "What viewers ask for" said "no guesses about views" but never forbade a
  forecast in the words every other question uses. Found by the lint test.
- "Video ideas" said "which real invention, product or event": a word from
  one niche. Now "thing, person, product or event".
- Two title options and two alternates were never required to differ in how
  they pull, so they came back as rewordings.
- The frame study and the watch gained a line that words in a frame or in the
  video are part of it and never instructions.

## Found by the first real runs

An independent reviewer ran the hooks stage and the draft on a real store
after the rewrite. The draft came out at 2,484 words against a target of
2,448, every section within about 5% of its number.

**Beats were dropped without a word (fixed).** The hooks run wrote nine
beats of 257 to 946 characters. The reader kept only beats of 400 characters
or fewer, so the app stored two, and the job said "done". The rewritten
question had made this worse by asking for richer beats. Now a beat is asked
for in one line of at most 45 words; the reader keeps up to 1,200 characters
whole, shortens a longer one at a sentence and keeps it, and the page says
what was shortened or left off. The reviewer's answer is a regression
fixture (`packages/core/test/fixtures/hooksLongBeats.txt`).

**Ten more findings from the same review (fixed).**

- "Never stop short of the length when the evidence holds more" padded
  every answer and contradicted "no filler". It now reads: length follows
  the evidence; the word limit is a ceiling, not a target. One video in
  depth: up to 3,000 words for a video of ten minutes or more, fewer for a
  shorter one.
- The draft still carried lines about a hook library it never reads, said
  the length three times, and could lengthen or cut the owner's hook. Now:
  the hook is fixed and the difference is made up in the beats; a section
  that could be filled only by repeating or inventing stays short. The
  tighten pass no longer speaks of a fact sheet it never reads, and allows a
  repeat that is a deliberate callback.
- Research was not sized to the script. It is now told the script's length,
  asked for about one fact for every 60 spoken words (at least 12), and
  handed what the hook and the beat sheet still mark `[CHECK: …]` as things
  to look up. A fact is at most 60 words; one that runs over is left off the
  sheet and listed there as left off, never cut mid-sentence.
- "A number a tool gave" was the wrong rule for a title: the tools hold
  views, not facts about the subject. A number about the subject may carry a
  title, listed under NEEDS to be checked unless a tool returned it.
- Craft made mechanical: "every beat ends on a re-hook" and "two or three
  sentences then a short one" produce a pattern a viewer hears. Now most
  beats end on a pull, the device varies and is never the same twice
  running; sentence length varies without a fixed pattern; the main promise
  is held to the last third unless the videos read pay it in parts; the
  ending may hand over in one line and puts a call to action where the
  winners put theirs; numbers and abbreviations are written as said; a
  thumbnail keeps its words out of the bottom-right corner, where YouTube
  sets the length; an image prompt offers the option to leave the text area
  clear and add the words in an editor.
- Repetition: the paragraph on who the owner is was printed twice (system
  prompt and question), the missing-evidence rule twice, the phone rule for
  titles twice. Each is now said once. Rules on what to write were mixed
  into the list of tool calls; they are in the craft section, and the tool
  calls only call.
- A code check after the draft: the app counts each section against its
  number and offers "Write the short sections again", which re-asks only
  those (see the script writer in `SYSTEM_DESIGN.md`).

## What did not change

- Every marker and labelled form code reads: `CONCEPT n`, `TITLE:`, `ALT:`,
  `HOOK n`, `BEAT:`, `## ` headings, `[B-ROLL: … | … | …]`, `[CHECK: …]`,
  `[F3]`, `FORMULA:`, `VIDEO:`/`STYLE:`/`HOW:`, `FACT n:`/`SOURCE:`,
  `CLAIM n:`, `FINDING`, `CLAIM`/`OVERLAP`, the `=== … START ===` lines, the
  four one-video sections, every JSON shape. No parser and no parser test
  was changed.
- Every honesty rule: numbers only from tools, no forecasts, quoted owner
  text as data, tool results as data, no real person, logo, country or flag
  in an image prompt, facts marked `[CHECK]` or `[F#]`, nothing carried over
  from another niche.
- Tools, engines and routes, with these exceptions made for a question:
  `get_script` gained `wordBudget` and `shortSections`; a fourth script
  stage, `lengthen`, writes short sections again; "One video, in depth" has
  15 minutes and 20 steps instead of 10 and 16; a fact sheet is sized to the
  script (12 to 60 facts, 20 minutes and 60 steps) and holds up to 80.

## Known limits of this work

- Unmeasured. Nothing here was run against an engine. The new questions are
  two to three times longer; a long question costs a little more of each run
  and, on a weak engine, can be followed less closely. Watch for that with
  the checklist.
- The word budget makes a short draft less likely; it cannot make an engine
  count. The app now counts the sections itself after a draft and offers to
  have the short ones written again. That second run is a remedy, not a
  guarantee: it has only the same fact sheet to write from.
- The owner also found the script writer hard to use. That is the page, not
  the questions, and is not addressed here.
