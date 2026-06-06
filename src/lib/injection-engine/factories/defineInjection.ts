/**
 * defineInjection — the unified injection factory (one factory, a `type`
 * discriminant for the flavor).
 *
 * The named factories (`defineInstruction`, `defineSkill`, `defineSteering`,
 * `defineFact`) are self-documenting sugar — prefer them when you know the
 * flavor at author time. `defineInjection` is for the cases where the flavor is
 * chosen *programmatically* (config-driven pipelines, a UI that lets users add
 * any flavor, table-driven tests) — pass `type` and the same options the named
 * factory takes:
 *
 * @example
 *   // these two are equivalent
 *   defineInstruction({ id: 'calm', prompt: '…', activeWhen });
 *   defineInjection({ type: 'instruction', id: 'calm', prompt: '…', activeWhen });
 *
 * @example  // flavor decided at runtime
 *   const inj = defineInjection({ type: cfg.flavor, id: cfg.id, ...cfg.opts });
 *
 * All four flavors return the same `Injection` primitive — `type` simply routes
 * to the matching named factory. RAG and Memory are NOT covered here: they are
 * separate subsystems (retrieval + stores), not plain Injections.
 */

import type { Injection } from '../types.js';
import { defineFact, type DefineFactOptions } from './defineFact.js';
import { defineInstruction, type DefineInstructionOptions } from './defineInstruction.js';
import { defineSkill, type DefineSkillOptions } from './defineSkill.js';
import { defineSteering, type DefineSteeringOptions } from './defineSteering.js';

/** Discriminated union — `type` picks the flavor; the rest are that flavor's options. */
export type DefineInjectionOptions =
  | ({ type: 'instruction' } & DefineInstructionOptions)
  | ({ type: 'skill' } & DefineSkillOptions)
  | ({ type: 'steering' } & DefineSteeringOptions)
  | ({ type: 'fact' } & DefineFactOptions);

/** The flavor discriminants `defineInjection` accepts. */
export type InjectionFlavor = DefineInjectionOptions['type'];

export function defineInjection(opts: DefineInjectionOptions): Injection {
  // Each named factory reads only the fields it knows and constructs a fresh
  // frozen Injection, so the extra `type` discriminant on `opts` is ignored.
  switch (opts.type) {
    case 'instruction':
      return defineInstruction(opts);
    case 'skill':
      return defineSkill(opts);
    case 'steering':
      return defineSteering(opts);
    case 'fact':
      return defineFact(opts);
    default: {
      const exhaustive: never = opts;
      throw new Error(
        `defineInjection: unknown injection type "${String(
          (exhaustive as { type?: unknown }).type,
        )}".`,
      );
    }
  }
}
