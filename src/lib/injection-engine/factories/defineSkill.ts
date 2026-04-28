/**
 * defineSkill — sugar for LLM-activated Injections that target both
 * system-prompt + tools.
 *
 * A Skill is a bundle of (1) a body of guidance and (2) optionally
 * unlocked tools. The LLM decides when a Skill is needed by calling
 * a designated activation tool — by default `read_skill(<id>)`.
 *
 * Produces an `Injection` with:
 *   - flavor: `'skill'`
 *   - trigger: `{ kind: 'llm-activated', viaToolName: 'read_skill' }`
 *   - inject: `{ systemPrompt: body, tools }`
 *
 * The Agent integration auto-attaches the `read_skill` tool when one
 * or more Skills are present. When the LLM calls
 * `read_skill('billing')`, the engine adds `'billing'` to
 * `ctx.activatedInjectionIds`; the next iteration's evaluator
 * matches this Skill's `id`, activates it, and the body + tools land
 * in the slot subflows.
 *
 * @example
 *   const billingSkill = defineSkill({
 *     id: 'billing',
 *     description: 'Use for refunds, charges, billing questions.',
 *     body: 'When handling billing: confirm identity first, then…',
 *     tools: [refundTool, chargeHistoryTool],
 *   });
 */

import type { Injection } from '../types.js';
import type { Tool } from '../../../core/tools.js';

export interface DefineSkillOptions {
  readonly id: string;
  /** Visible to the LLM via the activation tool's description. */
  readonly description: string;
  /** Body appended to the system-prompt slot once activated. */
  readonly body: string;
  /** Optional unlocked tools, added to the tools slot once activated. */
  readonly tools?: readonly Tool[];
  /**
   * Override the activation tool name. Defaults to `'read_skill'`.
   * Multiple Skills sharing one activation tool is the common pattern;
   * the LLM picks WHICH skill via the tool's argument.
   */
  readonly viaToolName?: string;
}

export function defineSkill(opts: DefineSkillOptions): Injection {
  if (!opts.id || opts.id.trim().length === 0) {
    throw new Error('defineSkill: `id` is required and must be non-empty.');
  }
  if (!opts.description || opts.description.length === 0) {
    throw new Error(`defineSkill(${opts.id}): \`description\` is required (LLM uses it to decide when to activate).`);
  }
  if (!opts.body || opts.body.length === 0) {
    throw new Error(`defineSkill(${opts.id}): \`body\` is required.`);
  }
  return Object.freeze({
    id: opts.id,
    description: opts.description,
    flavor: 'skill' as const,
    trigger: {
      kind: 'llm-activated' as const,
      viaToolName: opts.viaToolName ?? 'read_skill',
    },
    inject: {
      systemPrompt: opts.body,
      ...(opts.tools && opts.tools.length > 0 && { tools: opts.tools }),
    },
  }) as unknown as Injection;
}
