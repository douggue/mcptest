/**
 * The picture check: proves on the owner's computer that an engine looks at
 * picture files it is handed, before any picture question is left to it.
 *
 * Antigravity's CLI passes on only the text of a tool's results, so it is
 * shown pictures as files in its run folder, named in the prompt as `@name`;
 * its documentation says the agent reads such a file when it needs to. The
 * check hands it two small PNGs, each one solid colour picked at random from
 * eight clearly different ones, and asks for the two colour names. Code
 * checks the answer: both right, in order, passes. A guess is right one time
 * in 8 × 7 = 56, under 2%; the prompt never names a colour.
 */
import type { AnalysisSettings } from './analyses';
import type { EngineRunRequest, RunFile } from './engines/types';
import { solidPng, type Rgb } from './solidPng';

export interface CheckColour {
  /** The name the answer must give. */
  readonly name: string;
  readonly rgb: Rgb;
  /** Other words for it that also count. */
  readonly also: readonly string[];
}

export const CHECK_COLOURS: readonly CheckColour[] = [
  { name: 'red', rgb: [220, 20, 20], also: [] },
  { name: 'orange', rgb: [255, 140, 0], also: [] },
  { name: 'yellow', rgb: [255, 230, 0], also: [] },
  { name: 'green', rgb: [20, 160, 40], also: [] },
  { name: 'blue', rgb: [20, 60, 220], also: [] },
  { name: 'purple', rgb: [130, 30, 170], also: ['violet'] },
  { name: 'grey', rgb: [128, 128, 128], also: ['gray'] },
  { name: 'black', rgb: [0, 0, 0], also: [] },
];

export type ShownColours = readonly [CheckColour, CheckColour];

/** The pictures' size: large enough to be plainly one colour. */
const SIDE = 64;
const FILE_NAMES = ['picture-1.png', 'picture-2.png'] as const;
const CHECK_TIMEOUT_MS = 3 * 60 * 1000;
const CHECK_MAX_TURNS = 4;

const colourAt = (colours: readonly CheckColour[], random: () => number): CheckColour => {
  const index = Math.min(colours.length - 1, Math.floor(random() * colours.length));
  return colours[index] as CheckColour;
};

/** Two different colours from the list; `random` is Math.random but for tests. */
export function pickColours(random: () => number = Math.random): ShownColours {
  const first = colourAt(CHECK_COLOURS, random);
  const second = colourAt(
    CHECK_COLOURS.filter((colour) => colour !== first),
    random,
  );
  return [first, second];
}

/** The two pictures as files for the run's folder. */
export const checkFiles = (colours: ShownColours): readonly RunFile[] =>
  colours.map((colour, index) => ({
    name: FILE_NAMES[index] ?? `picture-${index + 1}.png`,
    bytes: solidPng(SIDE, SIDE, colour.rgb),
  }));

/** The check as a run: two files, no tools, one short line back. */
export function pictureCheckRequest(
  colours: ShownColours,
  settings: Pick<AnalysisSettings, 'workDir'>,
): EngineRunRequest {
  const [first, second] = FILE_NAMES.map((name) => `@${name}`);
  return {
    prompt: `Open the two picture files ${first} and ${second} in your folder and look at them. Each is filled with one colour. Answer with the two colour names only, the first picture's first, separated by a comma.`,
    systemPrompt:
      'You are checking that you can see pictures. Answer in one short line of plain text.',
    mcpServers: {},
    allowedTools: [],
    maxTurns: CHECK_MAX_TURNS,
    timeoutMs: CHECK_TIMEOUT_MS,
    cwd: settings.workDir,
    files: checkFiles(colours),
  };
}

/** The colour a word names, if it names one of the list. */
const colourNamed = (word: string): CheckColour | undefined =>
  CHECK_COLOURS.find((colour) => colour.name === word || colour.also.includes(word));

/** Whether the answer names exactly the two colours shown, in order, and no other. */
export function checkPictureAnswer(answer: string, shown: ShownColours): boolean {
  const named = (answer.toLowerCase().match(/[a-z]+/g) ?? []).flatMap((word) => {
    const colour = colourNamed(word);
    return colour ? [colour] : [];
  });
  return named.length === 2 && named[0] === shown[0] && named[1] === shown[1];
}
