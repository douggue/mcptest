/**
 * The risk check before publishing for one centre channel. Code works out
 * the overlaps and the unchecked facts at each look; one AI question, read
 * through read-only tools, lists the claims the script does not support,
 * and code keeps only those whose quotes are really there.
 */
import {
  parseRiskAnswer,
  riskFacts,
  scriptedConcepts,
  verifyRiskAnswer,
  type RiskDeps,
  type RiskFacts,
  type RiskRepo,
} from '@jgtube/core';
import type { Engine } from './app';
import type { RiskCheckView, RiskEngine } from './riskTypes';

const NO_SCRIPT =
  'There is no kept concept with that number for this channel, or it has no script yet.';

export interface RiskEngineDeps {
  readonly now: () => Date;
  readonly repos: RiskDeps & { readonly risks: RiskRepo };
  readonly analyse: Engine['analyse'];
}

function checkView(deps: RiskEngineDeps, center: string, facts: RiskFacts): RiskCheckView {
  const stored = deps.repos.risks.find(center, facts.conceptId);
  return {
    conceptId: facts.conceptId,
    title: facts.title,
    stage: facts.stage,
    overlaps: facts.overlaps,
    transcriptsCompared: facts.transcriptsCompared,
    unchecked: facts.unchecked,
    ai: stored && {
      claims: stored.claims,
      notes: stored.notes,
      engine: stored.engine,
      checkedAt: stored.checkedAt.toISOString(),
      scriptChangedSince: facts.scriptUpdatedAt.getTime() > stored.scriptUpdatedAt.getTime(),
    },
  };
}

export function riskEngine(deps: RiskEngineDeps): RiskEngine {
  const { repos, now } = deps;
  const ready = (center: string, conceptId: number): RiskFacts | null => {
    const facts = riskFacts(repos, center, conceptId, now());
    return facts?.status === 'ready' ? facts : null;
  };

  return {
    findRisk(center, conceptId) {
      if (repos.maps.latestForCenter(center) === null) return null;
      const facts = conceptId === null ? null : ready(center, conceptId);
      return {
        centerChannelId: center,
        concepts: scriptedConcepts(repos, center),
        check: facts && checkView(deps, center, facts),
      };
    },

    async askRisk(center, conceptId, only) {
      if (ready(center, conceptId) === null) throw new Error(NO_SCRIPT);
      const answer = await deps.analyse('risk-check', center, only, { kind: 'risk', conceptId });
      // Read again: the script the engine read through its tools is the one stored now.
      const facts = ready(center, conceptId);
      if (facts === null) throw new Error(NO_SCRIPT);
      const checked = verifyRiskAnswer(parseRiskAnswer(answer.text), {
        packaging: facts.packaging,
        script: facts.script,
        overlapIds: new Set(facts.overlaps.map((overlap) => overlap.id)),
      });
      repos.risks.save(center, conceptId, {
        claims: checked.claims,
        notes: checked.notes,
        engine: answer.engine,
        checkedAt: now(),
        scriptUpdatedAt: facts.scriptUpdatedAt,
      });
      return {
        claims: checked.claims.length,
        notes: checked.notes.length,
        dropped: checked.dropped,
        engine: answer.engine,
      };
    },

    riskFindings(center, conceptId) {
      const facts = ready(center, conceptId);
      return (
        facts && {
          stage: facts.stage,
          overlaps: facts.overlaps,
          transcriptsCompared: facts.transcriptsCompared,
          unchecked: facts.unchecked,
        }
      );
    },
  };
}
