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
} from './types.js';

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
} from './factories/defineSkill.js';

export { SkillRegistry } from './SkillRegistry.js';

export { defineSteering, type DefineSteeringOptions } from './factories/defineSteering.js';

export { defineFact, type DefineFactOptions } from './factories/defineFact.js';
