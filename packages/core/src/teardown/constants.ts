/**
 * The fixed numbers a production teardown is measured with. Each is named
 * here once, so the method a number on screen was measured by can say it.
 * None is fitted to a channel or a niche: they are the usual broadcast and
 * editing yardsticks.
 */

/** ffmpeg's scene score above which a frame starts a new shot (0 to 1). */
export const SCENE_THRESHOLD = 0.3;
/** A stretch quieter than this, in dBFS, is a quiet dip. */
export const QUIET_DB = -32;
/** A quiet dip lasts at least this long, in seconds. */
export const QUIET_MIN_SECONDS = 0.4;
/** A window whose peak is louder than this, in dBFS, after a quieter one, is a peak impact. */
export const PEAK_DB = -12;
/** The shortest window the peaks are measured in, in seconds. */
export const PEAK_WINDOW_SECONDS = 0.5;
/** Peaks are measured in at most this many windows; a longer video has longer windows. */
export const MAX_PEAK_WINDOWS = 2000;
/** The rate audio is read at for the peak windows. */
export const PEAK_SAMPLE_RATE = 48_000;
/** The most keyframes kept: one per shot, spread across the video when there are more shots. */
export const MAX_KEYFRAMES = 40;
/** A keyframe as kept and shown, in pixels wide. */
export const KEYFRAME_WIDTH = 640;
/** The tiny copy of a keyframe its colours are counted from. */
export const COLOUR_SAMPLE_WIDTH = 48;
export const COLOUR_SAMPLE_HEIGHT = 27;
/** The colours a palette is grouped into before small ones are dropped. */
export const PALETTE_GROUPS = 8;
/** A colour under this share of the runtime is left out of the palette. */
export const PALETTE_MIN_SHARE = 0.02;
/** The opening the hook sheet shows, one frame a second. */
export const HOOK_SECONDS = 36;
export const HOOK_COLUMNS = 6;
export const HOOK_ROWS = 6;
/** One frame on a contact sheet: six across make a sheet 1440 pixels wide. */
export const SHEET_TILE_WIDTH = 240;
export const SHEET_TILE_HEIGHT = 135;
/** A chapter's sheet: this many frames, evenly spread across the chapter. */
export const CHAPTER_COLUMNS = 5;
export const CHAPTER_ROWS = 4;
/** The most chapters a teardown keeps a sheet for. */
export const MAX_CHAPTERS = 10;
/** A "hammer" sentence has at least and at most this many words. */
export const HAMMER_MIN_WORDS = 2;
export const HAMMER_MAX_WORDS = 5;
/** The most hammer sentences kept. */
export const MAX_HAMMERS = 40;
/** The longest a measurement may run before it is stopped. */
export const MEASURE_TIMEOUT_MS = 10 * 60 * 1000;
