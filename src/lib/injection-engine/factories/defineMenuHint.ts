/**
 * defineMenuHint — the tier-3 envelope's system-prompt half (SG-C):
 * an advisory note that fires exactly when the turn-start cascade left a MENU
 * outstanding, telling the model where the menu is and that STAY is a
 * first-class answer. `defineRelevanceHint`'s sibling, same anti-anchoring
 * framing: the offline router is a hint, never an order.
 *
 * The menu's DATA — candidate ids, descriptions, advisory relevance — rides
 * the `read_skill` tool description (rebuilt per iteration from the same
 * turn verdict; see `ReadSkillOffer.menu`), so the ids on the wire have ONE
 * source of truth and this injection's body can stay a static instruction.
 * Auto-registered by `AgentBuilder.build()` whenever the mounted graph can
 * produce a menu (classify or conversation continuity) and the posture is not
 * `'rails'` — a menu verdict with no envelope would be a decision the model
 * was never told about, the accepted-and-silently-wrong kind. Zero cost when
 * the trigger is false (the common iteration): reads `ctx.turnRoute`, which
 * only cascade graphs ever write.
 *
 * Add your own (custom id or body) with
 * `.injection(defineMenuHint({ ... }))` — the auto-registration then stands
 * down (it detects the marker, not the id).
 */

import type { Injection } from '../types.js';

export interface MenuHintOptions {
  /** Injection id (default `'skill-menu-hint'`). */
  readonly id?: string;
  /** Override the advisory body. The default names the mechanism (the
   *  read_skill description leads with the menu) and frames it as advisory. */
  readonly body?: string;
}

/**
 * The metadata marker that says "this injection is the turn-start menu
 * envelope" (the `READS_ENTRY_SCORES_METADATA_KEY` pattern). AgentBuilder
 * auto-registers a default hint only when NO registered injection carries the
 * marker — matching on the id would miss every renamed one and would
 * false-positive on somebody else's injection of that name.
 */
export const MENU_HINT_METADATA_KEY = 'skillMenuHint' as const;

const DEFAULT_BODY =
  'Note: no declared start rule or intent decisively matched this message — the routing ' +
  "scorer left a menu open. The `read_skill` tool's description begins with the closest " +
  'candidate skills (with advisory relevance where a scorer ran). Read it and activate the ' +
  'one that actually fits, or answer directly WITHOUT calling read_skill to stay where you ' +
  'are. The scorer only matches declared intents offline and cannot see the conversation — ' +
  'your judgment wins.';

export function defineMenuHint(options: MenuHintOptions = {}): Injection {
  return {
    id: options.id ?? 'skill-menu-hint',
    flavor: 'instructions',
    description: 'Advisory note while the turn-start routing menu is outstanding',
    trigger: {
      kind: 'rule',
      // Iteration 1 only: the menu is offered at turn start; once an iteration
      // has passed, either a pick resolved it (the cursor moved) or the model
      // chose to stay — re-prompting would nag a decision already made.
      activeWhen: (ctx) => ctx.iteration === 1 && ctx.turnRoute?.offered !== undefined,
    },
    metadata: { [MENU_HINT_METADATA_KEY]: true },
    inject: { systemPrompt: options.body ?? DEFAULT_BODY },
  };
}
