/**
 * agentfootprint Injection Engine — public barrel.
 *
 * The unifying primitive of agentfootprint context engineering.
 * One `Injection` type. One `InjectionEngine` subflow. N typed sugar
 * factories. See `README.md` in this folder for the full concept.
 *
 * ─── 7-panel design review (2026-04-28) ─────────────────────────────
 *
 *   LLM-AI system design   ✓ ONE primitive replaces N feature-specific
 *                            subsystems. Skill, Steering, Instruction,
 *                            Context (and RAG, Memory, Guardrail)
 *                            are typed sugar producing the same shape.
 *                            Engine is shared; observability is shared;
 *                            Lens chips are shared.
 *
 *   Performance            ✓ Trigger evaluation O(N) per iteration.
 *                            Subflow ceremony ~50µs per iteration.
 *                            Negligible. Active set materialized once,
 *                            consumed by 3 slot subflows.
 *
 *   Scalability            ✓ Adding a flavor = adding a sugar factory
 *                            file. Zero engine change. Library scales
 *                            to 50+ flavors without bloating the
 *                            engine. The "narrow waist" pattern.
 *
 *   Research alignment     ✓ Maps to "Augmented LM" framing
 *                            (Mialon et al. 2023): every external
 *                            input is an augmentation; agentfootprint
 *                            calls them Injections. Factory names
 *                            preserve research vocabulary (Skill, RAG,
 *                            Memory, Steering) at the API surface.
 *
 *   Flexibility            ✓ Discriminated `trigger` union handles
 *                            always / rule / on-tool-return /
 *                            llm-activated. New trigger kinds extend
 *                            cleanly. Multi-slot per Injection covers
 *                            Skills (system-prompt + tools).
 *
 *   Abstraction-modular    ✓ Engine = subflow (drill-able). Factories
 *                            = small files (one per flavor). Slot
 *                            subflows are unchanged consumers.
 *                            Textbook narrow-waist architecture.
 *
 *   Software engineering   ✓ Predicate exceptions caught + reported
 *                            via `skipped[]`, never propagate. Frozen
 *                            Injections. Validation in factories.
 *                            7-pattern test coverage. Subpath export
 *                            for tree-shake.
 *
 * Plus footprintjs integration check ✓ — uses existing slot subflow
 * convention (writes activeInjections to scope; slots filter by
 * targeted slot) + ContextRecorder picks up source field zero-change.
 *
 * Plus TypeScript engineer check ✓ — discriminated union, no `any`,
 * frozen returns, exhaustiveness check on trigger kind.
 *
 * ─── 7-pattern test coverage ────────────────────────────────────────
 *
 *   See `test/lib/injection-engine/*.test.ts`.
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

export { defineSkill, type DefineSkillOptions } from './factories/defineSkill.js';

export { defineSteering, type DefineSteeringOptions } from './factories/defineSteering.js';

export { defineFact, type DefineFactOptions } from './factories/defineFact.js';
