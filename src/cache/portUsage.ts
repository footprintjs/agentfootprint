/**
 * The one reader of PORT-shaped usage for the cache meter.
 *
 * Pattern: pure function, one job. Given the `usage` the framework put on
 *          `agentfootprint.stream.llm_end`, answer what is actually known
 *          about cache traffic on that call.
 * Role:    the honest half of the 9.59.0 meter fix. Before it, three
 *          strategies each parsed RAW WIRE field names (`cache_read_input_tokens`,
 *          `prompt_tokens_details.cached_tokens`) off a value that has never
 *          carried them — the framework normalises the wire at the ADAPTER
 *          ring (`readCacheUsage`) and only ever hands a strategy the port
 *          shape. Every field read `undefined`, `?? 0` turned that into a
 *          zero, the guard tripped, and a 20-call turn that hit cache on
 *          every call reported hitRate 0.
 *
 * The distinction this function exists to preserve: an adapter sets
 * `cacheRead` / `cacheWrite` ONLY when the provider reported a number, so
 *   • both absent      → nobody measured  → `unknown`
 *   • either present   → measured         → `known` (a present 0 is a real 0)
 * That is exactly the line `Claim<T>` was written to hold.
 */

import { known, unknown, type Claim } from '../lib/claim/claim.js';
import type { CacheMetrics, CacheUsage } from './types.js';

/**
 * Read cache metrics off port usage.
 *
 * @param usage  the `usage` field of `agentfootprint.stream.llm_end`
 * @param who    the adapter named in the evidence sentence, e.g. `'the Anthropic adapter'`
 */
export function readPortCacheUsage(
  usage: CacheUsage | undefined,
  who: string,
): Claim<CacheMetrics> {
  if (usage === undefined || usage === null || typeof usage !== 'object') {
    return unknown(
      'the llm_end event carried no usage payload, so nothing about cache traffic was measured',
      'agentfootprint.stream.llm_end',
    );
  }
  const { cacheRead, cacheWrite, input } = usage;
  if (cacheRead === undefined && cacheWrite === undefined) {
    return unknown(
      `${who} reported no cache fields on this call — that is "nobody measured", not "no cache traffic"`,
      'agentfootprint.stream.llm_end usage (port shape)',
    );
  }
  return known(
    {
      cacheReadTokens: cacheRead ?? 0,
      cacheWriteTokens: cacheWrite ?? 0,
      freshInputTokens: typeof input === 'number' ? input : 0,
    },
    `${who} reported cache token counts on the port usage`,
  );
}
