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

import type { Injection, InjectionContext } from '../types.js';

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
  /** Text appended to the system-prompt slot when active. */
  readonly prompt: string;
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
  return Object.freeze({
    id: opts.id,
    ...(opts.description && { description: opts.description }),
    flavor: 'instructions' as const,
    trigger,
    inject: { systemPrompt: opts.prompt },
  }) as unknown as Injection;
}
