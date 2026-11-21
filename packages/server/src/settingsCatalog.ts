import { CONFIG_ENV_RULES, PROGRAM_PATH_RULE } from '@jgtube/core';
import type { z } from 'zod';
import { ENGINE_ENV_RULES } from './engines/settings';

/**
 * The settings the owner can change from the page, in the order the screen
 * lists them. Each is one line of the `.env` file, checked with the rule the
 * configuration itself is read with at start.
 */

export interface SettingSpec {
  /** The name the setting has in the `.env` file. */
  readonly name: string;
  /** What the screen calls it. */
  readonly label: string;
  /** One or two plain sentences: what it is for and what to put. */
  readonly help: string;
  /** A key: its value is never sent to the page, logged or put in a message. */
  readonly secret: boolean;
  /** Whether a change is in force as soon as it is saved, or only once Jgtube is started again. */
  readonly effect: 'now' | 'restart';
  readonly rule: z.ZodType;
}

export const SETTINGS: readonly SettingSpec[] = [
  {
    name: 'YOUTUBE_API_KEY',
    label: 'YouTube Data API key',
    help: 'Needed to look for niches by keyword and to read a channel’s country and start date. Create one in Google Cloud and restrict it to "YouTube Data API v3".',
    secret: true,
    effect: 'now',
    rule: CONFIG_ENV_RULES.YOUTUBE_API_KEY,
  },
  {
    name: 'GEMINI_API_KEY',
    label: 'Gemini API key',
    help: 'Lets a Gemini model watch a public YouTube video from its link. Create one in Google AI Studio.',
    secret: true,
    effect: 'now',
    rule: ENGINE_ENV_RULES.GEMINI_API_KEY,
  },
  {
    name: 'JGTUBE_ENGINES',
    label: 'AI engines, in order',
    help: 'Which AI programs Jgtube may use, the main one first: claude, agy, codex, separated by commas. One left out is never started. Empty means claude, agy, codex.',
    secret: false,
    effect: 'now',
    rule: ENGINE_ENV_RULES.JGTUBE_ENGINES,
  },
  {
    name: 'JGTUBE_AGY_MODEL',
    label: 'Antigravity model',
    help: 'The model Antigravity uses. Empty means Antigravity’s own choice; "agy models" in a terminal lists the names.',
    secret: false,
    effect: 'restart',
    rule: ENGINE_ENV_RULES.JGTUBE_AGY_MODEL,
  },
  {
    name: 'JGTUBE_MARK_FACTS',
    label: 'Mark facts to check in scripts',
    help: 'on or off. On, the AI that writes a script marks every fact it cannot vouch for, and the script writer counts and lists them. Off, scripts are written without the marks. Empty means on.',
    secret: false,
    effect: 'now',
    rule: CONFIG_ENV_RULES.JGTUBE_MARK_FACTS,
  },
  {
    name: 'JGTUBE_YT_DLP_PATH',
    label: 'yt-dlp program',
    help: 'The full path of the yt-dlp program file, when Jgtube does not find it by itself. It downloads a video so that it can be watched.',
    secret: false,
    effect: 'now',
    rule: PROGRAM_PATH_RULE,
  },
  {
    name: 'JGTUBE_FFMPEG_PATH',
    label: 'ffmpeg program',
    help: 'The full path of the ffmpeg program file, when Jgtube does not find it by itself. It cuts frames from a video file.',
    secret: false,
    effect: 'now',
    rule: PROGRAM_PATH_RULE,
  },
  {
    name: 'JGTUBE_DOWNLOADS_PATH',
    label: 'Downloads folder',
    help: 'The folder thumbnails, transcripts and breakdown texts are saved into, as a full path. Empty means a "downloads" folder beside the store.',
    secret: false,
    effect: 'restart',
    rule: CONFIG_ENV_RULES.JGTUBE_DOWNLOADS_PATH,
  },
  {
    name: 'JGTUBE_REFRESH_HOURS',
    label: 'Refresh every (hours)',
    help: 'Reads the stored channels again every this many hours while Jgtube runs, 1 to 168. Empty means only when you press Refresh now.',
    secret: false,
    effect: 'restart',
    rule: CONFIG_ENV_RULES.JGTUBE_REFRESH_HOURS,
  },
  {
    name: 'JGTUBE_REGION',
    label: 'Region',
    help: 'The two-letter country that recommendations are read from, such as US. Empty means US.',
    secret: false,
    effect: 'restart',
    rule: CONFIG_ENV_RULES.JGTUBE_REGION,
  },
];
