/**
 * defineStepsHint — the static advisory half of steps-as-data (9.18.0):
 * one system-prompt note that fires exactly while a declared procedure is
 * in progress, telling the model HOW the mechanism works — the current
 * step leads the matching tool's description, `skip_step` records a
 * decline, and the rest of the toolbox stays available.
 *
 * `defineMenuHint`'s sibling, same division of labor (SG-C): the BODY is
 * static instruction; the DATA — which step, which tool, what note — rides
 * the tools slot (the step banner + the `skip_step` description), rebuilt
 * per iteration from the one source of truth (`scope.stepPointer` + the
 * frozen plan). Auto-registered by `AgentBuilder.build()` whenever any
 * registered skill declares steps — a narrowed offer with no explanation
 * would be sequence enforcement the model was never told about, the
 * accepted-and-silently-wrong kind. Zero cost when the trigger is false:
 * it reads `ctx.stepPointer`, which only stepped tenures ever populate.
 *
 * Add your own (custom id or body) with
 * `.injection(defineStepsHint({ ... }))` — the auto-registration then
 * stands down (it detects the marker, not the id).
 */

import type { Injection } from '../types.js';

export interface StepsHintOptions {
  /** Injection id (default `'skill-steps-hint'`). */
  readonly id?: string;
  /** Override the advisory body. The default names the mechanism (banner in
   *  the tool description, `skip_step` for declines) and frames the order
   *  as declared, not caged. */
  readonly body?: string;
}

/**
 * The metadata marker that says "this injection is the steps advisory"
 * (the `MENU_HINT_METADATA_KEY` pattern). AgentBuilder auto-registers a
 * default hint only when NO registered injection carries the marker —
 * matching on the id would miss every renamed one and would false-positive
 * on somebody else's injection of that name.
 */
export const STEPS_HINT_METADATA_KEY = 'skillStepsHint' as const;

const DEFAULT_BODY =
  'This skill declares a step-by-step procedure. The current step leads the matching ' +
  "tool's description (“[Step k of n — …]”). Steps are a declared order, not a cage: " +
  'skip one with `skip_step(reason)` if it cannot or should not run — the reason goes on ' +
  'the record — and your other tools remain available throughout.';

export function defineStepsHint(options: StepsHintOptions = {}): Injection {
  return {
    id: options.id ?? 'skill-steps-hint',
    flavor: 'instructions',
    description: 'Advisory note while a declared skill procedure is in progress',
    trigger: {
      kind: 'rule',
      // In progress only: the pointer exists while a stepped skill holds the
      // tenure, and `step <= total` while steps remain. A completed pointer
      // stays on scope as the record, but the banner is gone by then and a
      // hint describing an absent banner would be the config that lies.
      activeWhen: (ctx) =>
        ctx.stepPointer !== undefined && ctx.stepPointer.step <= ctx.stepPointer.total,
    },
    metadata: { [STEPS_HINT_METADATA_KEY]: true },
    inject: { systemPrompt: options.body ?? DEFAULT_BODY },
  };
}
