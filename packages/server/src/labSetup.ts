import { formulaEngine } from './formulaEngine';
import { hookEngine } from './hookEngine';
import { ideaEngine } from './ideaEngine';
import type { LabDeps } from './labDeps';
import type { LabEngine } from './labTypes';

/** The idea lab: concepts, title formulas and the hook library, on this engine's store and engines. */
export function lab(deps: LabDeps): LabEngine {
  return { ...ideaEngine(deps), ...formulaEngine(deps), ...hookEngine(deps) };
}
