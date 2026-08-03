/**
 * defineFact — sugar for context-style Injections (data, not behavior).
 *
 * Use for developer-supplied facts the LLM should see in addition to
 * user messages and tool results. Examples: user profile, env info,
 * computed conversation summary, cached config, current time. Distinct
 * from Skills (LLM-activated guidance) and Steering (always-on rules)
 * in INTENT — they share the engine.
 *
 * Produces an `Injection` with:
 *   - flavor: `'fact'`
 *   - trigger: configurable (default `'always'`)
 *   - inject: `systemPrompt` (default), or `messages` with a declared role
 *
 * @example
 *   const userProfile = defineFact({
 *     id: 'user-profile',
 *     data: `Name: ${user.name}, Plan: ${user.plan}, Joined: ${user.joinedAt}`,
 *   });
 *
 *   const turnTime = defineFact({
 *     id: 'turn-time',
 *     data: `Current time: ${new Date().toISOString()}`,
 *   });
 */

import type { WireRole } from '../../../adapters/types.js';
import type { Injection, InjectionContext, InjectionTrigger } from '../types.js';
import { messagesToolRoleRefusal } from '../messagesSlotRefusal.js';
import { resolveCachePolicy } from '../../../cache/applyCachePolicy.js';
import type { CachePolicy } from '../../../cache/types.js';

interface DefineFactBase {
  readonly id: string;
  readonly description?: string;
  /** The fact (data string) to inject. */
  readonly data: string;
  /**
   * Trigger control. Defaults to always-on. For conditional facts
   * (e.g., "only show user profile after iteration 3"), pass a
   * predicate via `activeWhen`.
   */
  readonly activeWhen?: (ctx: InjectionContext) => boolean;
  /**
   * Cache policy for this fact injection. Defaults to `'always'` —
   * facts are typically static data the LLM should always have in mind.
   * Override with `'never'` for facts containing volatile content
   * (e.g., a `Current time:` fact); use `{ until }` for time-bounded
   * facts.
   */
  readonly cache?: CachePolicy;
}

/**
 * `slot` and `role` are ONE decision, so the type makes them one choice.
 *
 * `slot: 'messages'` requires a `role` and there is deliberately no default:
 * who appears to speak is a meaning the app owns. (Before 7.19.1 the option
 * existed with `role` defaulting to `'system'` — a default that reached the
 * model on OpenAI-family providers and vanished on Anthropic-family ones.
 * Now the role is stated, and a provider that cannot carry it refuses at run
 * start by name.) `slot: 'system-prompt'` forbids `role`, because there is no
 * role in a system prompt to choose.
 */
export type DefineFactOptions = DefineFactBase &
  (
    | {
        /** The default. The one placement every provider delivers. */
        readonly slot?: 'system-prompt';
        readonly role?: never;
      }
    | {
        /**
         * Deliver the fact into the conversation itself — it enters
         * `scope.history` at the injection-engine boundary, so the window
         * strategies, the slots and the wire all see the same past.
         * Placed at the END of the window; if its role would collide with
         * the turn already there, delivery defers to the next boundary and
         * says so on `messagesDelivery.deferred`.
         */
        readonly slot: 'messages';
        /**
         * Who appears to say it. Required — no default. Refused at run start
         * when the attached provider does not carry it inside `messages`
         * (the Anthropic family drops `'system'` there; the OpenAI family
         * carries it). `'tool'` is refused outright: a tool message answers a
         * specific call, and an injection has no call to answer.
         */
        readonly role: WireRole;
      }
  );

export function defineFact(opts: DefineFactOptions): Injection {
  if (!opts.id || opts.id.trim().length === 0) {
    throw new Error('defineFact: `id` is required and must be non-empty.');
  }
  if (!opts.data || opts.data.length === 0) {
    throw new Error(`defineFact(${opts.id}): \`data\` is required.`);
  }
  // The runtime guards read a WIDENED view on purpose. The declared type
  // already pairs `slot` with `role` correctly, and TypeScript narrows so well
  // that `opts.role` is provably present inside a `slot === 'messages'` branch
  // — which makes the checks below unreachable *to the compiler* and therefore
  // invisible to the JavaScript callers and `as never` casts they exist for. A
  // refusal that only holds at compile time is not a refusal.
  const raw = opts as { slot?: string; role?: string };
  const toMessages = raw.slot === 'messages';
  if (toMessages && !raw.role) {
    throw new Error(
      `defineFact('${opts.id}'): \`slot: 'messages'\` requires a \`role\` — ` +
        `'user', 'assistant', or 'system' on a provider that carries it. There is no ` +
        `default: who appears to speak is a meaning your app owns, not one the library picks.`,
    );
  }
  if (toMessages && raw.role === 'tool') {
    throw new Error(messagesToolRoleRefusal(`defineFact('${opts.id}')`));
  }
  const trigger: InjectionTrigger = opts.activeWhen
    ? { kind: 'rule', activeWhen: opts.activeWhen }
    : { kind: 'always' };
  const inject = toMessages
    ? { messages: [{ role: raw.role as WireRole, content: opts.data }] }
    : { systemPrompt: opts.data };

  const cache = resolveCachePolicy('fact', opts.cache);
  // Two-stage cast (`as unknown as Injection`) is required because
  // `flavor: 'fact'` narrows tighter than `ContextSource`. Both stages
  // are type-safe at the call site — `flavor` IS a valid `ContextSource`
  // member; TypeScript just can't narrow back through the freeze.
  return Object.freeze({
    id: opts.id,
    ...(opts.description && { description: opts.description }),
    flavor: 'fact' as const,
    trigger,
    inject,
    metadata: Object.freeze({ cache }),
  }) as unknown as Injection;
}
