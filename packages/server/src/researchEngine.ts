/**
 * The script writer's research: a fact sheet for one concept from a web-only
 * run, and a check of the claims its script still marks, ten at a time.
 * Both runs have the web and nothing else (see engines/webRun.ts); both
 * answers are read strictly and stored with the concept. Nothing in a
 * script changes here: the owner accepts or applies a verdict on the page.
 */
import {
  MAX_CLAIMS_PER_RUN,
  checkMarkers,
  claimsToCheck,
  parseClaimVerdicts,
  parseFactSheet,
  type Claim,
  type ConceptRepo,
  type ResearchRepo,
  type ScriptRepo,
  type StoredClaim,
  type StoredFactSheet,
} from '@jgtube/core';
import type { EngineId, EngineRunResult } from './engines/types';
import type { WebRunRequest } from './engines/webRun';
import { RESEARCH_SYSTEM_PROMPT, claimsQuestion, researchQuestion } from './researchQuestions';
import type { Report } from './labTypes';
import { targetWordsOf } from './scriptLength';

/** Line breaks and control characters: a marker holding one is not put into a question. */
const NOT_ONE_LINE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/;

/** A fact sheet run searches and reads a dozen pages or more, and more for a long script. */
const RESEARCH_MAX_TURNS = 60;
const RESEARCH_TIMEOUT_MS = 20 * 60 * 1000;
const CLAIMS_MAX_TURNS = 40;
const CLAIMS_TIMEOUT_MS = 12 * 60 * 1000;
const NO_SUCH_CONCEPT = 'That concept is not one of this channel’s concepts.';
const ONLY_CLAUDE =
  'Research on the web needs Claude Code: its web search and fetch tools are the only ones Jgtube runs. Choose Claude Code or Automatic under Ask AI.';

export interface FactSheetView extends Omit<StoredFactSheet, 'writtenAt'> {
  readonly writtenAt: string;
}

export interface ClaimView extends Omit<StoredClaim, 'checkedAt'> {
  readonly checkedAt: string;
}

export interface ResearchView {
  readonly sheet: FactSheetView | null;
  readonly claims: readonly ClaimView[];
}

export interface ResearchOutcome {
  readonly kind: 'research';
  readonly conceptId: number;
  readonly sheet: FactSheetView;
  readonly engine: EngineId;
}

export interface ClaimsOutcome {
  readonly kind: 'claims';
  readonly conceptId: number;
  /** How many claims this run checked. */
  readonly checked: number;
  /** How many marked claims of the script are still not checked. */
  readonly remaining: number;
  readonly claims: readonly ClaimView[];
  readonly engine: EngineId;
}

export interface ResearchEngine {
  /** A concept's fact sheet and claims check; reads the store only. */
  findResearch(centerChannelId: string, conceptId: number): ResearchView;
  researchConcept(
    centerChannelId: string,
    conceptId: number,
    only: EngineId | undefined,
    onProgress: Report,
  ): Promise<ResearchOutcome>;
  checkClaims(
    centerChannelId: string,
    conceptId: number,
    /** The text the owner is looking at: the draft or the tightened draft. */
    which: ScriptText,
    only: EngineId | undefined,
    onProgress: Report,
  ): Promise<ClaimsOutcome>;
}

export interface ResearchDeps {
  readonly now: () => Date;
  readonly repos: {
    readonly concepts: Pick<ConceptRepo, 'find' | 'findBatch'>;
    readonly scripts: Pick<ScriptRepo, 'find'>;
    readonly research: ResearchRepo;
  };
  /** Runs Claude Code once with the web and nothing else, in a fresh private folder. */
  readonly runWeb: (request: WebRunRequest) => Promise<EngineRunResult>;
}

const sheetView = (sheet: StoredFactSheet): FactSheetView => ({
  ...sheet,
  writtenAt: sheet.writtenAt.toISOString(),
});
const claimView = (claim: StoredClaim): ClaimView => ({
  ...claim,
  checkedAt: claim.checkedAt.toISOString(),
});
const keyOf = (claim: Claim): string => `${claim.what}\n${claim.sentence}`;

function onlyClaude(only: EngineId | undefined): void {
  if (only !== undefined && only !== 'claude') throw new Error(ONLY_CLAUDE);
}

export type ScriptText = 'draft' | 'tightened';

export function researchEngine(deps: ResearchDeps): ResearchEngine {
  const { repos } = deps;
  const findResearch = (center: string, conceptId: number): ResearchView => {
    const sheet = repos.research.findSheet(center, conceptId);
    return {
      sheet: sheet ? sheetView(sheet) : null,
      claims: repos.research.listClaims(center, conceptId).map(claimView),
    };
  };
  const ask = (prompt: string, maxTurns: number, timeoutMs: number) =>
    deps.runWeb({ prompt, systemPrompt: RESEARCH_SYSTEM_PROMPT, maxTurns, timeoutMs, cwd: '' });

  return {
    findResearch,

    async researchConcept(center, conceptId, only, onProgress) {
      onlyClaude(only);
      const concept = repos.concepts.find(center, conceptId);
      if (!concept) throw new Error(NO_SUCH_CONCEPT);
      const batch = repos.concepts.findBatch(center, concept.batchId);
      onProgress({ step: 'asking', text: 'Researching the subject on the web' });
      const needs = concept.needs.trim();
      const script = repos.scripts.find(center, conceptId);
      const typed = repos.research.findLength(center, conceptId);
      // What the hooks and the beat sheet still mark: the sheet is asked to answer them.
      const planned = [script?.chosenHook ?? '', script?.beats ?? ''].join('\n');
      const toCheck = [...new Set(checkMarkers(planned).map((marker) => marker.what))].filter(
        (what) => what.trim() !== '' && !NOT_ONE_LINE.test(what),
      );
      const answer = await ask(
        researchQuestion({
          title: concept.title,
          needs: needs === '' || /^nothing\.?$/i.test(needs) ? null : needs,
          angle: batch?.angle ?? null,
          targetWords: targetWordsOf(script, typed),
          toCheck,
        }),
        RESEARCH_MAX_TURNS,
        RESEARCH_TIMEOUT_MS,
      );
      onProgress({ step: 'reading', text: 'Reading the fact sheet' });
      const sheet = parseFactSheet(answer.text);
      if (sheet.facts.length === 0 && sheet.notFound.length === 0) {
        throw new Error(
          'The research run answered, but with no fact sheet in it. Nothing was changed. Try again.',
        );
      }
      repos.research.saveSheet(conceptId, sheet, 'claude', deps.now());
      const stored = repos.research.findSheet(center, conceptId);
      if (!stored) throw new Error('The fact sheet could not be stored');
      return { kind: 'research', conceptId, sheet: sheetView(stored), engine: 'claude' };
    },

    async checkClaims(center, conceptId, which, only, onProgress) {
      onlyClaude(only);
      const script = repos.scripts.find(center, conceptId);
      if (!script) throw new Error(NO_SUCH_CONCEPT);
      const checked = new Set(repos.research.listClaims(center, conceptId).map(keyOf));
      const open = claimsToCheck(script[which]).filter((claim) => !checked.has(keyOf(claim)));
      const unique = [...new Map(open.map((claim) => [keyOf(claim), claim])).values()];
      if (unique.length === 0) throw new Error('No claim is left marked to check in this script.');
      const batch = unique.slice(0, MAX_CLAIMS_PER_RUN);
      onProgress({ step: 'asking', text: `Checking ${batch.length} claims on the web` });
      const answer = await ask(claimsQuestion(batch), CLAIMS_MAX_TURNS, CLAIMS_TIMEOUT_MS);
      const verdicts = parseClaimVerdicts(answer.text, batch.length);
      repos.research.saveClaims(
        conceptId,
        // parseClaimVerdicts gives one verdict for each claim asked, in order.
        verdicts.map((verdict, at) => ({
          what: batch[at]?.what ?? '',
          sentence: batch[at]?.sentence ?? '',
          verdict: verdict.verdict,
          why: verdict.why,
          correction: verdict.correction,
          sources: verdict.sources,
        })),
        'claude',
        deps.now(),
      );
      return {
        kind: 'claims',
        conceptId,
        checked: batch.length,
        remaining: unique.length - batch.length,
        claims: findResearch(center, conceptId).claims,
        engine: 'claude',
      };
    },
  };
}
