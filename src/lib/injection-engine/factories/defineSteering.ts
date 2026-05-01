/**
 * defineSteering — sugar for always-on system-prompt Injections.
 *
 * Steering docs are the simplest form of context engineering: a fixed
 * piece of guidance the LLM should follow on every iteration. Style
 * guides, output format rules, persona statements, safety policies.
 *
 * Produces an `Injection` with:
 *   - flavor: `'steering'`
 *   - trigger: `{ kind: 'always' }`
 *   - inject: `{ systemPrompt: prompt }`
 *
 * @example
 *   const jsonOnly = defineSteering({
 *     id: 'json-only',
 *     description: 'Always respond with valid JSON.',
 *     prompt: 'Respond with JSON only. No prose. No markdown.',
 *   });
 */

import type { Injection } from '../types.js';
import { resolveCachePolicy } from '../../../cache/applyCachePolicy.js';
import type { CachePolicy } from '../../../cache/types.js';

export interface DefineSteeringOptions {
  readonly id: string;
  readonly description?: string;
  /** Always-on text appended to the system-prompt slot. */
  readonly prompt: string;
  /**
   * Cache policy for this steering injection. Defaults to `'always'`
   * — steering is by definition always-on stable content, ideal for
   * provider-side caching. Override with `'never'` if the prompt
   * contains volatile content (timestamps, per-request IDs).
   *
   * See `CachePolicy` in `agentfootprint/src/cache/types.ts` for all
   * variants. The CacheDecision subflow reads this from
   * `injection.metadata.cache` each iteration.
   */
  readonly cache?: CachePolicy;
}

export function defineSteering(opts: DefineSteeringOptions): Injection {
  if (!opts.id || opts.id.trim().length === 0) {
    throw new Error('defineSteering: `id` is required and must be non-empty.');
  }
  if (!opts.prompt || opts.prompt.length === 0) {
    throw new Error(`defineSteering(${opts.id}): \`prompt\` is required.`);
  }
  const cache = resolveCachePolicy('steering', opts.cache);
  return Object.freeze({
    id: opts.id,
    ...(opts.description && { description: opts.description }),
    flavor: 'steering' as const,
    trigger: { kind: 'always' as const },
    inject: { systemPrompt: opts.prompt },
    metadata: Object.freeze({ cache }),
  }) as unknown as Injection;
}
