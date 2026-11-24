/**
 * A niche sweep: for each active keyword on the owner's watchlist, least
 * recently swept first, a search and the channels behind what it found; then
 * the snowball from the channels newly found to be niches. Everything read
 * goes into the store through the usual ingest, where New niches and the
 * outlier bank judge it like any other channel.
 *
 * It widens where Jgtube looks; it does not read faster. Every request goes
 * through the same paced connection as the rest of Jgtube, a day's budget
 * bounds what it may ask for, and a refusal from YouTube ends it for the day.
 * Nothing here rotates, switches or retries addresses.
 */
import { keywordShare, type Pots } from './budget';
import { sweepKeyword, type KeywordTurn, type ReadingDeps } from './keywordTurn';
import { sweepReader, type Stop, type SweepReader } from './reader';
import { snowball, type NicheNow, type SnowballTurn } from './snowball';
import type {
  KeywordSummary,
  SweepRepo,
  SweepStarter,
  SweepStop,
  SweepSummary,
  WatchKeyword,
} from './types';
import type { FindVia } from '../bank/cost';

export { SWEEP_MAX_FAILURES_IN_A_ROW } from './reader';

export interface SweepDeps extends ReadingDeps {
  readonly sweeps: SweepRepo;
  /** The channels that qualify as niches now, most proven demand first. */
  readonly niches: () => readonly NicheNow[];
}

export interface SweepRequest {
  readonly startedBy: SweepStarter;
  /** What is left of today's budget. */
  readonly left: Pots;
}

export interface SweepProgress {
  readonly text: string;
  readonly done?: number;
  readonly total?: number;
}

export interface SweepOutcome {
  readonly sweepId: number;
  readonly via: FindVia;
  readonly stopped: SweepStop;
  readonly message: string | null;
  readonly spent: Pots;
  readonly summary: SweepSummary;
}

export const NO_KEYWORDS = 'Add a keyword or topic to the watchlist first, or resume a paused one.';

const minus = (a: Pots, b: Pots): Pots => ({ pages: a.pages - b.pages, units: a.units - b.units });

/** Active keywords, never swept first, then swept longest ago, then in the order added. */
export function sweepOrder(keywords: readonly WatchKeyword[]): readonly WatchKeyword[] {
  const time = (entry: WatchKeyword): number => entry.lastSweptAt?.getTime() ?? 0;
  return keywords.filter((entry) => !entry.paused).sort((a, b) => time(a) - time(b) || a.id - b.id);
}

interface Turn {
  readonly turn: KeywordTurn;
  readonly spent: Pots;
}

async function keywordTurns(
  deps: SweepDeps,
  reader: SweepReader,
  active: readonly WatchKeyword[],
  reserve: Pots,
  onProgress: (progress: SweepProgress) => void,
): Promise<{ readonly turns: readonly Turn[]; readonly stop: Stop | null }> {
  const turns: Turn[] = [];
  for (const [index, entry] of active.entries()) {
    onProgress({
      text: `Searching for “${entry.keyword}” (${index + 1} of ${active.length})`,
      done: index,
      total: active.length,
    });
    const before = reader.spent();
    const turn = await sweepKeyword(deps, reader, entry, reserve);
    if (turn.searched) deps.sweeps.markSwept(entry.id, deps.now());
    if (turn.searched || turn.failed > 0)
      turns.push({ turn, spent: minus(reader.spent(), before) });
    if (turn.stop) return { turns, stop: turn.stop };
  }
  return { turns, stop: null };
}

function keywordSummary({ turn, spent }: Turn, isNew: (id: string) => boolean): KeywordSummary {
  return {
    keywordId: turn.entry.id,
    keyword: turn.entry.keyword,
    channelsFound: turn.channelsFound,
    channelsRead: turn.read.length,
    alreadyKnown: turn.alreadyKnown,
    failed: turn.failed,
    qualified: turn.read.filter((one) => isNew(one.channelId)).length,
    requests: spent.pages,
    apiUnits: spent.units,
  };
}

/** Says which sweep first brought each new channel into the store, and how. */
function recordFinds(
  deps: SweepDeps,
  sweepId: number,
  turns: readonly Turn[],
  snow: SnowballTurn,
  qualifies: (id: string) => boolean,
): void {
  const foundAt = deps.now();
  for (const { turn } of turns) {
    for (const one of turn.read.filter((read) => read.wasNew)) {
      deps.sweeps.recordFind({
        channelId: one.channelId,
        sweepId,
        source: 'keyword',
        keywordId: turn.entry.id,
        keyword: turn.entry.keyword,
        fromChannelId: null,
        qualified: qualifies(one.channelId),
        foundAt,
      });
    }
  }
  for (const one of snow.read) {
    deps.sweeps.recordFind({
      channelId: one.channelId,
      sweepId,
      source: 'snowball',
      keywordId: null,
      keyword: null,
      fromChannelId: one.fromChannelId,
      qualified: qualifies(one.channelId),
      foundAt,
    });
  }
}

interface Ending {
  readonly stopped: SweepStop;
  readonly message: string | null;
}

/** How the sweep ended, in words: a keyword stop outranks the snowball's. */
function ending(keywordStop: Stop | null, snow: SnowballTurn, left: number, all: number): Ending {
  if (keywordStop && keywordStop.stopped !== 'budget') return keywordStop;
  if (snow.stop && snow.stop.stopped !== 'budget') return snow.stop;
  if (keywordStop) {
    return {
      stopped: 'budget',
      message: `Today’s reading budget is used. The sweep reached ${all - left} of ${all} keywords and takes up the rest, least recently swept first, at its next turn.`,
    };
  }
  return snow.stop
    ? { stopped: 'done', message: 'The snowball stopped at today’s reading budget.' }
    : { stopped: 'done', message: null };
}

interface Ran {
  readonly active: readonly WatchKeyword[];
  readonly turns: readonly Turn[];
  readonly keywordStop: Stop | null;
  readonly snow: SnowballTurn;
  readonly snowSpent: Pots;
}

/** What the sweep did, counted against the niche list as it stood before and stands now. */
function summarise(
  deps: SweepDeps,
  sweepId: number,
  nichesBefore: ReadonlySet<string>,
  ran: Ran,
): SweepSummary {
  const { turns, snow } = ran;
  const nichesNow = new Set(deps.niches().map((niche) => niche.id));
  const isNewNiche = (id: string): boolean => nichesNow.has(id) && !nichesBefore.has(id);
  recordFinds(deps, sweepId, turns, snow, (id) => nichesNow.has(id));
  const keywords = turns.map((turn) => keywordSummary(turn, isNewNiche));
  const snowQualified = snow.read.filter((one) => isNewNiche(one.channelId)).length;
  return {
    keywords,
    snowball: {
      sources: snow.sources,
      sidebarsRead: snow.sidebarsRead,
      channelsRead: snow.read.length,
      failed: snow.failed,
      qualified: snowQualified,
      requests: ran.snowSpent.pages,
      apiUnits: ran.snowSpent.units,
    },
    newNiches: keywords.reduce((sum, one) => sum + one.qualified, 0) + snowQualified,
    keywordsLeft: ran.active.length - turns.filter(({ turn }) => turn.searched).length,
    problems: [],
  };
}

const NO_SNOWBALL: SnowballTurn = { sources: 0, sidebarsRead: 0, read: [], failed: 0, stop: null };

/** The keywords' turns, then the snowball from the niches they newly found. */
async function read(
  deps: SweepDeps,
  reader: SweepReader,
  request: SweepRequest,
  nichesBefore: ReadonlySet<string>,
  onProgress: (progress: SweepProgress) => void,
): Promise<Ran> {
  const active = sweepOrder(deps.sweeps.keywords());
  const reserve = minus(request.left, keywordShare(request.left));
  const { turns, stop } = await keywordTurns(deps, reader, active, reserve, onProgress);
  const readNow = new Set(turns.flatMap(({ turn }) => turn.read.map((one) => one.channelId)));
  const sources = deps
    .niches()
    .filter((niche) => !nichesBefore.has(niche.id) && readNow.has(niche.id));
  const before = reader.spent();
  const snow =
    stop && stop.stopped !== 'budget'
      ? NO_SNOWBALL
      : await snowball(deps, reader, sources, (index, total) =>
          onProgress({ text: `Looking beside new niche ${index + 1} of ${total}` }),
        );
  return { active, turns, keywordStop: stop, snow, snowSpent: minus(reader.spent(), before) };
}

/** Sweeps the watchlist within what is left of today's budget and records what it did. */
export async function runSweep(
  deps: SweepDeps,
  request: SweepRequest,
  onProgress: (progress: SweepProgress) => void = () => {},
): Promise<SweepOutcome> {
  if (sweepOrder(deps.sweeps.keywords()).length === 0) throw new Error(NO_KEYWORDS);
  const sweepId = deps.sweeps.begin({
    startedBy: request.startedBy,
    via: deps.via,
    startedAt: deps.now(),
  });
  const nichesBefore = new Set(deps.niches().map((niche) => niche.id));
  const reader = sweepReader(request.left, (spent) => deps.sweeps.spend(sweepId, spent));
  const ran = await read(deps, reader, request, nichesBefore, onProgress);
  const summary = {
    ...summarise(deps, sweepId, nichesBefore, ran),
    problems: reader.problems(),
  };
  const end = ending(ran.keywordStop, ran.snow, summary.keywordsLeft, ran.active.length);
  deps.sweeps.finish(sweepId, { ...end, summary, finishedAt: deps.now() });
  return { sweepId, via: deps.via, ...end, spent: reader.spent(), summary };
}
