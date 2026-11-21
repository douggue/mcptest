/**
 * The fixed questions a channel breakdown puts about one video: one for the
 * engine that watches it, and one for the engine that goes through its
 * frames. The questions of the seven written parts are in
 * `breakdownPartQuestions.ts`.
 *
 * Nothing here is about any one channel or kind of channel. The only things
 * put into a question from outside are a channel in its fixed form and video
 * ids, each checked to be an id first. Titles, descriptions, transcripts and
 * what another engine wrote never go into a question: they reach an engine
 * as tool results only.
 */
import { CHANGES_SEEN_LINE, FRAMES_LOOKED_AT_LINE } from '@jgtube/core';
import { isVideoId } from './engines/videoId';

/** The one tool a frame study may use. */
export const FRAME_STUDY_TOOLS = ['view_video_frames'] as const;

/**
 * A frame study walks every sheet of one video, several sheets a call. The
 * longest video the downloader hands over (just under twenty minutes) is
 * about fifty sheets cut from the file; measured at around ten seconds a
 * sheet, so the limits allow for that with room to spare.
 */
export const FRAME_STUDY_MAX_TURNS = 40;
export const FRAME_STUDY_TIMEOUT_MS = 20 * 60 * 1000;
/**
 * The most words asked of one frame study, so that it is stored whole and a
 * later run can read three of them. A study of eight preview sheets came to
 * about 2,300 words when left unbounded.
 */
export const FRAME_STUDY_MAX_WORDS = 5000;

function checkedIds(ids: readonly string[]): readonly string[] {
  const bad = ids.find((id) => !isVideoId(id));
  if (bad !== undefined) throw new Error('A question may only name YouTube video ids');
  return ids;
}

/** What the engine that watches a video is asked. It has no tools: only what it sees and hears. */
export const WATCH_QUESTION = [
  'Go through the video second by second where it matters and write these sections, giving the time in the video for every point.',
  'VOICE: who speaks (one person, several, or a synthetic voice if you can tell), how fast, in what tone, and where that changes.',
  'MUSIC: when it starts and stops, its mood, how loud it is against the voice, and where it changes.',
  'SOUND EFFECTS: each kind you hear, with example times, and what on screen it goes with.',
  'TRANSITIONS AND CUTS: the kinds of cut and transition used, with example times, and about how many seconds pass between cuts in the opening, the middle and the end.',
  'ILLUSTRATION TYPE: what kinds of picture carry the video, and roughly what share of the time each takes.',
  'ON-SCREEN TEXT: its style, where on screen it sits, and quoted examples with times.',
  'PACING CHANGES: where the video speeds up or slows down, and how (voice, cuts, music).',
  'FIRST 30 SECONDS: second by second, what is seen, what is said and what is heard.',
  'Say only what you saw and heard. Where you could not tell, say so.',
].join(' ');

/** What the engine that goes through one video's frames is asked. */
export function frameStudyQuestion(videoId: string): string {
  const [video] = checkedIds([videoId]);
  return [
    `For the video ${video}: look at every sheet of its frames, in order, with view_video_frames.`,
    'Call it with start_sheet 1. Each answer says where the frames came from (source), how many sheets and frames the video has (ofSheets, frames), which sheets it holds, and under next the start_sheet to ask for next. Keep calling with that number until an answer says last. Do not stop early and do not skip a sheet.',
    'Describe only sheets you were shown: a sheet that was not shown, or that could not be loaded, must be named as not seen and not described.',
    'Write one entry for each sheet, headed by its start and end time from its caption: what is on screen; the kind of picture (for example filmed footage, stock footage, screen recording, map, diagram, drawn or generated illustration, photograph, text card, a person talking to the camera); any words on screen, quoted; at which frames the picture changes; and how many times it changes on that sheet.',
    `Keep the whole study under ${FRAME_STUDY_MAX_WORDS} words. With few sheets, go frame by frame; with many, put neighbouring frames that show the same thing into one line with their times.`,
    'Then write four sections. WHAT REPEATS: visual devices used again and again, with times. HOW OFTEN THE PICTURE CHANGES: for the opening, the middle and the end, how many changes you can see between neighbouring frames on a sheet; say that a change quicker than the gap between two frames cannot be seen. OPENING: the first 30 seconds, frame by frame. ENDING: what the last sheet shows.',
    `End with three lines in exactly this form. ${FRAMES_LOOKED_AT_LINE}: X of Y, where Y is the number of frames the tool said the video has and X is the number of frames on the sheets you were shown. ${CHANGES_SEEN_LINE}: N, where N is the number of places, over all the sheets you were shown, where a frame shows a different picture from the frame before it: add up the changes you counted on each sheet, and write the number alone. SOURCE: the tool’s own words for where the frames came from.`,
    'Say only what the pictures show. Do not guess at sound, music or the exact cut between two shots: frames cannot show them.',
  ].join(' ');
}
