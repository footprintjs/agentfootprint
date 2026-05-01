/**
 * applyCachePolicy — internal helper for injection factories.
 *
 * Each factory (`defineSkill`, `defineSteering`, `defineFact`,
 * `defineInstruction`, `defineMemory`) calls this to merge the
 * consumer-supplied `cache` option with the flavor-specific default.
 * The merged policy lands in `Injection.metadata.cache` for the
 * CacheDecision subflow (Phase 4) to read back.
 *
 * Why it lives in src/cache/ (not co-located with each factory):
 *   - Single source of truth for per-flavor defaults
 *   - Tests for the defaults live in one place (test/cache/)
 *   - Adding a new factory means adding one entry to the map below;
 *     not duplicating the default-resolution logic five times
 */

import type { CachePolicy } from './types.js';

/**
 * Per-flavor default `cache` values when consumer doesn't specify.
 * These match the documentation in `CachePolicy`'s JSDoc — keep
 * synchronized.
 */
const FLAVOR_DEFAULTS: Readonly<Record<string, CachePolicy>> = Object.freeze({
  steering: 'always',
  fact: 'always',
  skill: 'while-active',
  instruction: 'never',
  memory: 'while-active',
});

/**
 * Resolve the effective `cache` policy for an injection.
 *
 * @param flavor - The injection flavor (drives the default if `consumerValue` undefined)
 * @param consumerValue - What the consumer wrote in `cache:` (or undefined)
 * @returns The effective CachePolicy. Always defined.
 */
export function resolveCachePolicy(
  flavor: keyof typeof FLAVOR_DEFAULTS | string,
  consumerValue: CachePolicy | undefined,
): CachePolicy {
  if (consumerValue !== undefined) return consumerValue;
  // Fall back to per-flavor default; if flavor unknown, default is 'never'
  // (conservative — unfamiliar injections shouldn't accidentally cache).
  return FLAVOR_DEFAULTS[flavor] ?? 'never';
}

/**
 * Read-only access to the per-flavor default table. Exported for
 * tests asserting the documented defaults are wired correctly. Not
 * intended for runtime use — callers should use `resolveCachePolicy`.
 */
export function getFlavorDefault(flavor: string): CachePolicy {
  return FLAVOR_DEFAULTS[flavor] ?? 'never';
}
