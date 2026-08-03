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
 *   - inject: `{ systemPrompt: prompt }`, or `{ messages: [{ role, content }] }`
 *     when `slot: 'messages'` names the role it speaks as
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

import type { WireRole } from '../../../adapters/types.js';
import type { Injection, InjectionContext, InjectionContent } from '../types.js';
import { messagesToolRoleRefusal } from '../messagesSlotRefusal.js';
import { resolveCachePolicy } from '../../../cache/applyCachePolicy.js';
import type { CachePolicy } from '../../../cache/types.js';

interface DefineInstructionBase {
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
  /** Instruction text. */
  readonly prompt: string;
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

/**
 * `slot` and `role` are ONE decision, so the type makes them one choice —
 * see {@link DefineFactOptions} for the full reasoning. In short:
 * `slot: 'messages'` requires a `role` with no default (who appears to speak
 * is the app's meaning to set), and `slot: 'system-prompt'` forbids one.
 */
export type DefineInstructionOptions = DefineInstructionBase &
  (
    | {
        /**
         * The default. Appended to the system prompt — the one placement
         * every provider delivers. An `on-tool-return` instruction already
         * lands on exactly the turn it matters; this is a system prompt that
         * says it on that one turn, rather than on every turn.
         */
        readonly slot?: 'system-prompt';
        readonly role?: never;
      }
    | {
        /**
         * Deliver the instruction into the conversation itself — it enters
         * `scope.history` at the injection-engine boundary, at the END of the
         * window, so the model reads it at the recency this option is
         * reaching for. If its role would collide with the turn already at
         * the end, delivery defers to the next boundary and says so on
         * `messagesDelivery.deferred` rather than reordering anything.
         *
         * In a tool-using loop the window ends on the user's turn or on tool
         * results, so a `'user'` role typically never gets a slot. Use
         * `'assistant'`, use `'system'` on a provider that carries it, or
         * return the words from the tool whose result they are about.
         */
        readonly slot: 'messages';
        /**
         * Who appears to say it. Required — no default. Refused at run start
         * when the attached provider does not carry it inside `messages`.
         */
        readonly role: WireRole;
      }
  );

export function defineInstruction(opts: DefineInstructionOptions): Injection {
  if (!opts.id || opts.id.trim().length === 0) {
    throw new Error('defineInstruction: `id` is required and must be non-empty.');
  }
  if (!opts.prompt || opts.prompt.length === 0) {
    throw new Error(`defineInstruction(${opts.id}): \`prompt\` is required.`);
  }
  // Refused at run time as well as in the type, read through a widened view —
  // see defineFact for why the widening is deliberate.
  const raw = opts as { slot?: string; role?: string };
  const toMessages = raw.slot === 'messages';
  if (toMessages && !raw.role) {
    throw new Error(
      `defineInstruction('${opts.id}'): \`slot: 'messages'\` requires a \`role\` — ` +
        `'user', 'assistant', or 'system' on a provider that carries it. There is no ` +
        `default: who appears to speak is a meaning your app owns, not one the library picks.`,
    );
  }
  if (toMessages && raw.role === 'tool') {
    throw new Error(messagesToolRoleRefusal(`defineInstruction('${opts.id}')`));
  }
  const trigger = opts.activeWhen
    ? { kind: 'rule' as const, activeWhen: opts.activeWhen }
    : { kind: 'always' as const };
  const inject: InjectionContent = toMessages
    ? { messages: [{ role: raw.role as WireRole, content: opts.prompt }] }
    : { systemPrompt: opts.prompt };
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
