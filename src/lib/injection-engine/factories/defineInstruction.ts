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
import { assertKnownFacts, isTemplate, TEMPLATE_FACTS } from '../promptTemplate.js';
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
/**
 * The instruction's words — a fixed string, or a template that names run-time
 * facts. Exactly one, because they are the same decision spelled two ways and
 * a definition carrying both would leave the library picking one.
 */
export type DefineInstructionWords =
  | {
      /** Instruction text, exactly as the model will read it. */
      readonly prompt: string;
      readonly promptTemplate?: never;
    }
  | {
      readonly prompt?: never;
      /**
       * Instruction text with named run-time facts in it (9.57.0), rendered
       * fresh on every action:
       *
       * ```ts
       * promptTemplate:
       *   'You are on action {{action}} of {{actionBudget}}; ' +
       *   '{{actionsRemaining}} remain. Finish what you have rather than start something new.',
       * ```
       *
       * The vocabulary is CLOSED and has three words — `{{action}}`,
       * `{{actionBudget}}`, `{{actionsRemaining}}` — and a name outside it is
       * refused here, at define time, rather than rendering as a literal in
       * front of the model. It is closed rather than a `(ctx) => string`
       * because a function makes ABSENCE the author's problem: given one, an
       * author writes `${ctx.maxIterations}` and ships "23 of undefined", or
       * writes `?? 0` and ships a fabricated denominator nothing can tell
       * from a real zero. With named slots the library owns absence and
       * applies one rule — if any named fact is unavailable the whole
       * instruction is skipped, by name, on the record.
       *
       * Two things a template may not be, both refused at define time:
       * `slot: 'messages'` (the delivery ledger keys by content, so a
       * re-render would deliver a NEW message on every action), and any
       * `cache` other than `'never'` (a marker asserting a stable prefix
       * through bytes that change every call is a guaranteed miss plus the
       * cache-write premium, with the trace claiming a stable prefix).
       *
       * Declare templated instructions LAST: a never-cacheable injection
       * truncates the cached prefix at its declaration position.
       */
      readonly promptTemplate: string;
    };

export type DefineInstructionOptions = DefineInstructionBase &
  DefineInstructionWords &
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
  const words = opts as { prompt?: string; promptTemplate?: string };
  if (words.prompt !== undefined && words.promptTemplate !== undefined) {
    throw new Error(
      `defineInstruction('${opts.id}'): pass \`prompt\` OR \`promptTemplate\`, not both. ` +
        `They are the same decision spelled two ways, and the library will not pick one for you.`,
    );
  }
  const template = words.promptTemplate;
  const text = template ?? words.prompt;
  if (!text || text.length === 0) {
    throw new Error(
      `defineInstruction(${opts.id}): \`prompt\` is required — or \`promptTemplate\`, when ` +
        `the words name a run-time fact (${TEMPLATE_FACTS.map((f) => `{{${f}}}`).join(', ')}).`,
    );
  }
  // A template is refused HERE for everything it can be refused for, because
  // everything below this line happens on somebody's paid run.
  const templated = template !== undefined && isTemplate(template);
  if (template !== undefined) assertKnownFacts(template, `defineInstruction('${opts.id}')`);
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
  if (templated && toMessages) {
    throw new Error(
      `defineInstruction('${opts.id}'): \`promptTemplate\` cannot target ` +
        `\`slot: 'messages'\`. The messages slot delivers each piece ONCE per run, and its ` +
        `ledger keys by the content itself — so a template that renders differently every ` +
        `action would deliver a new message every action, for the whole run. Use the ` +
        `system-prompt slot (the default), which is re-composed per action by design.`,
    );
  }
  if (templated && opts.cache !== undefined && opts.cache !== 'never') {
    throw new Error(
      `defineInstruction('${opts.id}'): \`promptTemplate\` cannot be cached ` +
        `(\`cache: '${String(opts.cache)}'\`). A cache marker asserts a STABLE PREFIX, and ` +
        `these bytes change on every action — you would pay the cache-write premium for a ` +
        `guaranteed miss, and the trace would claim a stable prefix that never existed. ` +
        `Leave \`cache\` unset, or say \`cache: 'never'\` out loud.`,
    );
  }
  const trigger = opts.activeWhen
    ? { kind: 'rule' as const, activeWhen: opts.activeWhen }
    : { kind: 'always' as const };
  const inject: InjectionContent = toMessages
    ? { messages: [{ role: raw.role as WireRole, content: text }] }
    : { systemPrompt: text };
  const cache = resolveCachePolicy('instruction', opts.cache);
  return Object.freeze({
    id: opts.id,
    ...(opts.description && { description: opts.description }),
    flavor: 'instructions' as const,
    trigger,
    inject,
    // TOP-LEVEL, not `metadata` (9.57.0): at least one live path rebuilds
    // `metadata` wholesale, and a lost marker means the literal
    // `{{actionsRemaining}}` reaches the model — the exact class of failure
    // this feature exists to prevent. Top-level fields survive every
    // `{...injection}` spread in the repo.
    ...(templated && { templated: true as const }),
    metadata: Object.freeze({ cache }),
  }) as unknown as Injection;
}
