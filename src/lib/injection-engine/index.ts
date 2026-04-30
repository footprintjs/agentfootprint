/**
 * agentfootprint Injection Engine — public barrel.
 *
 * The unifying primitive of agentfootprint context engineering.
 * One `Injection` type. One `InjectionEngine` subflow. N typed sugar
 * factories. See `README.md` in this folder for the full concept.
 */

// Primitive types
export type {
  Injection,
  InjectionTrigger,
  InjectionContent,
  InjectionContext,
  InjectionEvaluation,
  ActiveInjection,
} from './types.js';

// POJO projection — used by slot subflows + advanced consumers
export { projectActiveInjection } from './types.js';

// Engine
export { evaluateInjections } from './evaluator.js';
export {
  buildInjectionEngineSubflow,
  type InjectionEngineConfig,
} from './buildInjectionEngineSubflow.js';

// Sugar factories — Ships four; more flavors planned (RAG / Memory / Guardrail)
export { defineInstruction, type DefineInstructionOptions } from './factories/defineInstruction.js';

export {
  defineSkill,
  resolveSurfaceMode,
  type DefineSkillOptions,
  type SurfaceMode,
  type RefreshPolicy,
  type AutoActivateMode,
} from './factories/defineSkill.js';

export { SkillRegistry, type SkillRegistryOptions } from './SkillRegistry.js';

// Skill-tool builders — used by SkillRegistry.toTools() and the Agent's
// auto-attach path. Exported so consumers building custom tool wiring
// (e.g., gatedTools chains) can compose the same `list_skills` /
// `read_skill` tools directly.
export {
  buildListSkillsTool,
  buildReadSkillTool,
  type SkillToolPair,
} from './skillTools.js';

export { defineSteering, type DefineSteeringOptions } from './factories/defineSteering.js';

export { defineFact, type DefineFactOptions } from './factories/defineFact.js';
