import { formulaEngine } from './formulaEngine';
import { hookEngine } from './hookEngine';
import { ideaEngine } from './ideaEngine';
import type { LabDeps } from './labDeps';
import type { LabEngine } from './labTypes';
import { scriptEngine } from './scriptEngine';
import type { ScriptEngine } from './scriptTypes';

/**
 * The idea lab and the script writer: concepts, title formulas, the hook
 * library and scripts, on this engine's store and engines.
 */
export function lab(deps: LabDeps): LabEngine & ScriptEngine {
  return {
    ...ideaEngine(deps),
    ...formulaEngine(deps),
    ...hookEngine(deps),
    ...scriptEngine(deps),
  };
}
