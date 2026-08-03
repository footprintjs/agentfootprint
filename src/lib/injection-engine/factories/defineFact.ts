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
 *   - inject: `systemPrompt` — the slot that reaches the model
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

import type { Injection, InjectionContext, InjectionTrigger } from '../types.js';
import { messagesSlotRefusal } from '../messagesSlotRefusal.js';
import { resolveCachePolicy } from '../../../cache/applyCachePolicy.js';
import type { CachePolicy } from '../../../cache/types.js';

export interface DefineFactOptions {
  readonly id: string;
  readonly description?: string;
  /** The fact (data string) to inject. */
  readonly data: string;
  /**
   * Which slot to land in. `'system-prompt'` (the default) is the only
   * slot a fact can land in: it is the one every provider delivers.
   *
   * `'messages'` is REFUSED — see {@link messagesSlotRefusal}. It was
   * accepted before 7.19.1, recorded as injected, and never sent.
   */
  readonly slot?: 'system-prompt';
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

export function defineFact(opts: DefineFactOptions): Injection {
  if (!opts.id || opts.id.trim().length === 0) {
    throw new Error('defineFact: `id` is required and must be non-empty.');
  }
  if (!opts.data || opts.data.length === 0) {
    throw new Error(`defineFact(${opts.id}): \`data\` is required.`);
  }
  // The type already rules `'messages'` out for TypeScript callers; this
  // catches the JavaScript ones and the `as never` casts, because a
  // refusal that only exists at compile time is not a refusal.
  if ((opts.slot as string | undefined) === 'messages') {
    throw new Error(messagesSlotRefusal(`defineFact('${opts.id}')`));
  }
  const trigger: InjectionTrigger = opts.activeWhen
    ? { kind: 'rule', activeWhen: opts.activeWhen }
    : { kind: 'always' };
  const inject = { systemPrompt: opts.data };

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
