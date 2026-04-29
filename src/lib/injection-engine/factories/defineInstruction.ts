/**
 * defineInstruction — sugar for rule-based system-prompt Injections.
 *
 * The most flexible Instruction-style flavor: a predicate decides
 * activation each iteration. Use for "if condition X is true, give
 * the LLM this guidance". Compared to:
 *   - Steering (always-on, no predicate)
 *   - Skill (LLM-activated via `read_skill`)
 *   - on-tool-return (specific tool just ran — Dynamic ReAct)
 *
 * Produces an `Injection` with:
 *   - flavor: `'instructions'`
 *   - trigger: `{ kind: 'rule', activeWhen }` (or `'always'` if omitted)
 *   - inject: `{ systemPrompt: prompt }`
 *
 * @example
 *   const calmTone = defineInstruction({
 *     id: 'calm-tone',
 *     description: 'Use a calm, empathetic tone with frustrated users.',
 *     activeWhen: (ctx) => /upset|angry|frustrated/.test(ctx.userMessage),
 *     prompt: 'Acknowledge feelings before facts. Avoid corporate jargon.',
 *   });
 *
 *   const piiAfterRedact = defineInstruction({
 *     id: 'pii-after-redact',
 *     activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'redact_pii',
 *     prompt: 'PII has been redacted. Do not include emails or phone numbers.',
 *   });
 */

import type { ContextRole } from '../../../events/types.js';
import type { Injection, InjectionContext, InjectionContent } from '../types.js';

export interface DefineInstructionOptions {
  readonly id: string;
  readonly description?: string;
  /**
   * Predicate to decide activation. Synchronous; side-effect free.
   * If omitted, the instruction is always active (effectively a
   * Steering doc, but tagged with `'instructions'` flavor for
   * narrative semantics — use `defineSteering` for clearer intent).
   * Predicates that throw are skipped (fail-open) and reported via
   * `agentfootprint.context.evaluated`.
   */
  readonly activeWhen?: (ctx: InjectionContext) => boolean;
  /** Instruction text. Lands in the slot specified by `slot` (default system-prompt). */
  readonly prompt: string;
  /**
   * Where the instruction lands.
   *
   * - `'system-prompt'` (default) — appended to the system prompt.
   *   Lower attention than recent messages but always available.
   * - `'messages'` — appended as a recent message. **Higher attention
   *   weight** — the LLM reads recent messages more carefully than
   *   system-prompt text. Use this for guidance that MUST be salient
   *   on this turn (post-tool-result reminders, urgent corrections).
   *
   * Same instruction object can target both slots in different agents
   * — the trigger semantics don't change.
   */
  readonly slot?: 'system-prompt' | 'messages';
  /**
   * When `slot: 'messages'`, the role to use. Default `'system'`.
   * `'user'` is also valid; `'assistant'` and `'tool'` work in
   * principle but rarely make pedagogical sense.
   */
  readonly role?: ContextRole;
}

export function defineInstruction(opts: DefineInstructionOptions): Injection {
  if (!opts.id || opts.id.trim().length === 0) {
    throw new Error('defineInstruction: `id` is required and must be non-empty.');
  }
  if (!opts.prompt || opts.prompt.length === 0) {
    throw new Error(`defineInstruction(${opts.id}): \`prompt\` is required.`);
  }
  const trigger = opts.activeWhen
    ? { kind: 'rule' as const, activeWhen: opts.activeWhen }
    : { kind: 'always' as const };
  const slot = opts.slot ?? 'system-prompt';
  const inject: InjectionContent =
    slot === 'messages'
      ? { messages: [{ role: opts.role ?? 'system', content: opts.prompt }] }
      : { systemPrompt: opts.prompt };
  return Object.freeze({
    id: opts.id,
    ...(opts.description && { description: opts.description }),
    flavor: 'instructions' as const,
    trigger,
    inject,
  }) as unknown as Injection;
}
