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

import type { Injection, InjectionContext, InjectionContent } from '../types.js';
import { messagesSlotRefusal } from '../messagesSlotRefusal.js';
import { resolveCachePolicy } from '../../../cache/applyCachePolicy.js';
import type { CachePolicy } from '../../../cache/types.js';

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
  /** Instruction text. Lands in the system-prompt slot. */
  readonly prompt: string;
  /**
   * Where the instruction lands. `'system-prompt'` (the default) is the
   * only slot an instruction can land in: it is the one every provider
   * delivers.
   *
   * `'messages'` is REFUSED — see {@link messagesSlotRefusal}. It was
   * accepted before 7.19.1 and documented as the recency-first
   * placement; it was recorded as injected and never sent. To make a
   * rule salient at the moment it matters, return it from the tool whose
   * result it is about — a tool result IS a recent message.
   */
  readonly slot?: 'system-prompt';
  /**
   * Cache policy for this instruction. Defaults to `'never'` —
   * instructions are typically rule-based (volatile per-iter
   * `activeWhen` predicates, on-tool-return reminders). Override to
   * `'always'` only for instructions you know are stable per-turn
   * (e.g., a static safety rule wrapped as `defineInstruction` for
   * narrative tagging — though `defineSteering` is the cleaner choice
   * for that case).
   */
  readonly cache?: CachePolicy;
}

export function defineInstruction(opts: DefineInstructionOptions): Injection {
  if (!opts.id || opts.id.trim().length === 0) {
    throw new Error('defineInstruction: `id` is required and must be non-empty.');
  }
  if (!opts.prompt || opts.prompt.length === 0) {
    throw new Error(`defineInstruction(${opts.id}): \`prompt\` is required.`);
  }
  // Refused at run time as well as in the type — see defineFact for why.
  if ((opts.slot as string | undefined) === 'messages') {
    throw new Error(messagesSlotRefusal(`defineInstruction('${opts.id}')`));
  }
  const trigger = opts.activeWhen
    ? { kind: 'rule' as const, activeWhen: opts.activeWhen }
    : { kind: 'always' as const };
  const inject: InjectionContent = { systemPrompt: opts.prompt };
  const cache = resolveCachePolicy('instruction', opts.cache);
  return Object.freeze({
    id: opts.id,
    ...(opts.description && { description: opts.description }),
    flavor: 'instructions' as const,
    trigger,
    inject,
    metadata: Object.freeze({ cache }),
  }) as unknown as Injection;
}
