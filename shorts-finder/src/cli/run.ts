/**
 * The commands the owner runs by hand: the list of subjects, a look at how
 * the service is doing, and a report of what the searches have gathered. They open the same store as the service and read
 * nothing from YouTube or Telegram, so they need neither key nor token.
 */
import { parseArgs } from 'node:util';
import { sizeInWords, wholeNumber } from '../alerts/text';
import { loadStoreConfig, type StoreConfig } from '../config';
import { reasonOf } from '../cycleStop';
import { openDatabase } from '../db/sqlite';
import { buildEvidence, formatEvidence } from '../report/evidence';
import { SqliteQuotaRepo } from '../repos/sqliteQuotaRepo';
import { openStore } from '../repos/store';
import type { Store, Subject } from '../repos/types';
import { CYCLE_NAMES, gatherStats, readOutcome } from '../status';
import { expandAcrossRegions } from '../subjects/subject';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

export const USAGE = [
  'Usage:',
  '  npm run subjects -- add "<keyword>" [--regions US,GB] [--every 24] [--newest-every 24]',
  '  npm run subjects -- list',
  '  npm run subjects -- disable <id>',
  '  npm run subjects -- enable <id>',
  '  npm run status',
  '  npm run report',
].join('\n');

export interface CliDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Where the answer is written, a line at a time. */
  readonly out: (line: string) => void;
  /** Where a failure is written. */
  readonly err: (line: string) => void;
  readonly now: () => Date;
}

/** A command given wrongly: the usage is shown and nothing is done. */
class UsageError extends Error {}

interface Session {
  readonly config: StoreConfig;
  readonly store: Store;
  readonly quota: SqliteQuotaRepo;
  readonly deps: CliDeps;
}

const describeSubject = (subject: Subject): string =>
  `#${subject.id} "${subject.keyword}" in ${subject.region}, most-viewed every ` +
  `${subject.everyHours} hours, newest every ${subject.newestEveryHours} hours`;

/** A sweep interval in hours, without a tail of noughts. */
const hoursInWords = (hours: number): string => String(Math.round(hours * 10) / 10);

function wholeNumberFrom(text: string | undefined, name: string): number | undefined {
  if (text === undefined) return undefined;
  if (!/^\d{1,6}$/.test(text)) throw new UsageError(`${name} must be a whole number`);
  return Number(text);
}

function addSubject(session: Session, args: readonly string[]): number {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      regions: { type: 'string' },
      every: { type: 'string' },
      'newest-every': { type: 'string' },
    },
    allowPositionals: true,
  });
  const [keyword, ...extra] = positionals;
  if (keyword === undefined || extra.length > 0) {
    throw new UsageError('add takes one keyword; put it in quotes if it has spaces');
  }
  const regions = values.regions?.split(',') ?? session.config.regions;
  const subjects = expandAcrossRegions(keyword, regions, {
    language: session.config.language,
    everyHours: wholeNumberFrom(values.every, '--every'),
    newestEveryHours: wholeNumberFrom(values['newest-every'], '--newest-every'),
  });
  let failures = 0;
  for (const subject of subjects) {
    try {
      session.deps.out(`Added ${describeSubject(session.store.subjects.add(subject))}`);
    } catch (error) {
      failures += 1;
      session.deps.err(reasonOf(error));
    }
  }
  return failures === 0 ? EXIT_OK : EXIT_FAILED;
}

function listSubjects(session: Session): number {
  const subjects = session.store.subjects.list();
  if (subjects.length === 0) {
    session.deps.out('No subjects yet. Add one with: npm run subjects -- add "<keyword>"');
    return EXIT_OK;
  }
  for (const subject of subjects) {
    const searched = subject.lastSearchedAt?.toISOString() ?? 'never';
    const swept = subject.newestLastAt?.toISOString() ?? 'never';
    const state = subject.enabled ? 'on ' : 'off';
    // A subject whose sweeps come back full is swept more often than it was set to.
    const pace =
      subject.newestIntervalHours < subject.newestEveryHours
        ? ` (now every ${hoursInWords(subject.newestIntervalHours)} hours: its sweeps come back full)`
        : '';
    session.deps.out(
      `${state} ${describeSubject(subject)}${pace}, most-viewed last searched ${searched}, newest last swept ${swept}`,
    );
  }
  return EXIT_OK;
}

function setEnabled(session: Session, idText: string | undefined, enabled: boolean): number {
  const id = wholeNumberFrom(idText, 'The subject number');
  if (id === undefined) throw new UsageError('Give the number of the subject, as "list" shows it');
  if (!session.store.subjects.setEnabled(id, enabled)) {
    session.deps.err(`There is no subject #${id}`);
    return EXIT_FAILED;
  }
  session.deps.out(`Subject #${id} is now ${enabled ? 'on' : 'off'}`);
  return EXIT_OK;
}

function subjects(session: Session, args: readonly string[]): number {
  const [action, ...rest] = args;
  if (action === 'add') return addSubject(session, rest);
  if (action === 'list' && rest.length === 0) return listSubjects(session);
  if (action === 'disable' && rest.length === 1) return setEnabled(session, rest[0], false);
  if (action === 'enable' && rest.length === 1) return setEnabled(session, rest[0], true);
  throw new UsageError('Unknown subjects command');
}

function lastRuns(session: Session): readonly string[] {
  return CYCLE_NAMES.map((cycle) => {
    const outcome = readOutcome(session.store.state, cycle);
    if (outcome === null) return `  ${cycle.padEnd(8)} has not run yet`;
    const problem = outcome.problem === null ? '' : `: ${outcome.problem}`;
    return `  ${cycle.padEnd(8)} ${outcome.result} at ${outcome.at.toISOString()}${problem}`;
  });
}

function status(session: Session): number {
  const now = session.deps.now();
  const { config, store } = session;
  const stats = gatherStats(
    { quota: session.quota, tracking: store.tracking, state: store.state, ...config },
    now,
  );
  const kinds = stats.unitsByKind;
  const all = store.subjects.list();
  const on = all.filter((subject) => subject.enabled).length;
  const size = stats.storeBytes === null ? 'in memory' : sizeInWords(stats.storeBytes);
  [
    `Shorts finder at ${now.toISOString()}`,
    `YouTube API units spent today: ${wholeNumber(stats.unitsSpent)} of ${wholeNumber(stats.dailyUnits)}` +
      ` (searches ${wholeNumber(kinds.search)}, readings ${wholeNumber(kinds.reading)},` +
      ` channels ${wholeNumber(kinds.channel)}, kept back ${wholeNumber(kinds.reserve)})`,
    `Subjects: ${on} on, ${all.length - on} off`,
    `Videos tracked: ${wholeNumber(stats.tracked)} (${wholeNumber(stats.dueUnread)} due a reading)`,
    `Findings waiting to be sent: ${wholeNumber(store.findings.countWaiting())}`,
    `Store size on disk: ${size}`,
    'Last runs:',
    ...lastRuns(session),
  ].forEach((line) => session.deps.out(line));
  return EXIT_OK;
}

/** What the searches have gathered so far, for the owner to read the evidence off. */
function report(session: Session): number {
  const evidence = buildEvidence(session.store.report.subjectVideos(), session.deps.now());
  formatEvidence(evidence).forEach((line) => session.deps.out(line));
  return EXIT_OK;
}

function dispatch(session: Session, args: readonly string[]): number {
  const [command, ...rest] = args;
  if (command === 'subjects') return subjects(session, rest);
  if (command === 'status' && rest.length === 0) return status(session);
  if (command === 'report' && rest.length === 0) return report(session);
  throw new UsageError('Unknown command');
}

/** Runs one command and returns the program's exit code. Never throws. */
export function runCli(args: readonly string[], deps: CliDeps): number {
  try {
    const config = loadStoreConfig(deps.env);
    const db = openDatabase(config.dbPath, deps.now());
    try {
      return dispatch({ config, store: openStore(db), quota: new SqliteQuotaRepo(db), deps }, args);
    } finally {
      db.close();
    }
  } catch (error) {
    deps.err(reasonOf(error));
    // parseArgs throws a TypeError for an option it does not know.
    if (!(error instanceof UsageError) && !(error instanceof TypeError)) return EXIT_FAILED;
    deps.err(USAGE);
    return EXIT_USAGE;
  }
}
