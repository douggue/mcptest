import type { Engine } from '../src/app';
import type { ExtrasEngine } from '../src/extrasTypes';
import type { LabEngine } from '../src/labTypes';
import type { ScriptEngine } from '../src/scriptTypes';

export const HOST = '127.0.0.1:4317';
export const CHANNEL_ID = 'UCHnyfMqiRRG1u-2MsSQLbXA';

const unused = (name: string) => (): never => {
  throw new Error(`${name} is not used in this test`);
};

/** The idea lab's part of an engine, failing loudly when a test reaches it. */
export const UNUSED_LAB: LabEngine & ScriptEngine = {
  listConcepts: unused('listConcepts'),
  setConceptKept: unused('setConceptKept'),
  clearConcepts: unused('clearConcepts'),
  conceptProblem: unused('conceptProblem'),
  makeConcepts: unused('makeConcepts'),
  growConcept: unused('growConcept'),
  whereElse: unused('whereElse'),
  listFormulas: unused('listFormulas'),
  findFormulas: unused('findFormulas'),
  hookLibrary: unused('hookLibrary'),
  buildHookLibrary: unused('buildHookLibrary'),
  labelHooks: unused('labelHooks'),
  findIdeaBrief: unused('findIdeaBrief'),
  findConcept: unused('findConcept'),
  findScriptView: unused('findScriptView'),
  openScript: unused('openScript'),
  scriptChangeProblem: unused('scriptChangeProblem'),
  saveScript: unused('saveScript'),
  stageProblem: unused('stageProblem'),
  runScriptStage: unused('runScriptStage'),
  voiceOf: unused('voiceOf'),
  readVoice: unused('readVoice'),
  findScript: unused('findScript'),
};

/** The later features' part of an engine, failing loudly when a test reaches it. */
export const UNUSED_EXTRAS: ExtrasEngine = {
  findChanges: unused('findChanges'),
  markChangesSeen: unused('markChangesSeen'),
  findAlerts: unused('findAlerts'),
  alertCounts: unused('alertCounts'),
  saveAlertRule: unused('saveAlertRule'),
  markAlertsRead: unused('markAlertsRead'),
  findPlan: unused('findPlan'),
  linkPlanVideo: unused('linkPlanVideo'),
  unlinkPlanVideo: unused('unlinkPlanVideo'),
  findCalendar: unused('findCalendar'),
  saveCalendarItem: unused('saveCalendarItem'),
};

/** An engine whose later features are these, failing loudly on any other. */
export const withExtras = (parts: Partial<ExtrasEngine>): Partial<Engine> => ({
  extras: { ...UNUSED_EXTRAS, ...parts },
});

/** An engine where every part a test does not replace fails loudly when reached. */
export function stubEngine(parts: Partial<Engine>): Engine {
  return {
    findSnapshot: unused('findSnapshot'),
    listSavedChannels: unused('listSavedChannels'),
    deleteSavedChannel: unused('deleteSavedChannel'),
    findThumbnailBoard: unused('findThumbnailBoard'),
    findSameTopic: unused('findSameTopic'),
    crawl: unused('crawl'),
    setCompetitorStatus: unused('setCompetitorStatus'),
    listNiches: unused('listNiches'),
    setNicheWatched: unused('setNicheWatched'),
    listTransfers: unused('listTransfers'),
    setTransferSaved: unused('setTransferSaved'),
    // Asked before any work that reads YouTube starts; no other program is reading unless a test says so.
    isReadingYouTube: () => false,
    canDiscover: unused('canDiscover'),
    discover: unused('discover'),
    refresh: unused('refresh'),
    refreshStatus: unused('refreshStatus'),
    analyse: unused('analyse'),
    watchVideo: unused('watchVideo'),
    engineStatus: unused('engineStatus'),
    breakDown: unused('breakDown'),
    findBreakdown: unused('findBreakdown'),
    breakdownText: unused('breakdownText'),
    ownVideosFolder: unused('ownVideosFolder'),
    saveThumbnails: unused('saveThumbnails'),
    saveTranscripts: unused('saveTranscripts'),
    findVideoStudy: unused('findVideoStudy'),
    findVideoSeconds: unused('findVideoSeconds'),
    findBreakdownPart: unused('findBreakdownPart'),
    readTranscript: unused('readTranscript'),
    readVideoFrames: unused('readVideoFrames'),
    readChannelBrand: unused('readChannelBrand'),
    readVideoDetails: unused('readVideoDetails'),
    canReadCountries: () => false,
    readCountries: unused('readCountries'),
    setOwnerPlace: unused('setOwnerPlace'),
    keepAnswer: () => null,
    listConceptThumbnails: unused('listConceptThumbnails'),
    findStyleLock: unused('findStyleLock'),
    flowCounts: unused('flowCounts'),
    useStyleLock: unused('useStyleLock'),
    stopStyleLock: unused('stopStyleLock'),
    writeConceptThumbnail: unused('writeConceptThumbnail'),
    findAnswer: unused('findAnswer'),
    namedVideos: unused('namedVideos'),
    findChannelNote: unused('findChannelNote'),
    missingLogos: unused('missingLogos'),
    fetchLogos: unused('fetchLogos'),
    ...UNUSED_LAB,
    extras: UNUSED_EXTRAS,
    ...parts,
  };
}

type App = (request: Request) => Promise<Response>;

export const get = (app: App, path: string, host = HOST) =>
  app(new Request(`http://${HOST}${path}`, { headers: { host } }));

export const post = (app: App, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app(
    new Request(`http://${HOST}${path}`, {
      method: 'POST',
      headers: { host: HOST, 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

/** The parts of the standard envelope a test reads. */
export interface Reply<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: string | null;
  readonly meta: null;
}

export const read = async <T>(response: Response): Promise<Reply<T>> =>
  (await response.json()) as Reply<T>;
