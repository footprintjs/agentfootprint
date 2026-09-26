/**
 * callerIdentity — WHO a resumed run is for, read back from the run it resumes.
 *
 * Seed (`stages/seed.ts · seedFrom`) writes the run's memory namespace on one of
 * three rungs: the caller's EXPLICIT identity; `{ conversationId: sessionId }`
 * for a session-bound run that named none (recorded as
 * `runIdentitySource: 'session'`); or the per-run default
 * `{ conversationId: '<runId>' }`. Only the first rung is a caller's identity —
 * the other two are derivations this library made, and `Agent.lastRunIdentity`
 * (what `checkpoint()`, `EventMeta.principal` and a tool's `ctx.identity` read)
 * must stay absent for them, so "absent" keeps meaning "nobody named one".
 *
 * `Agent.resume` does not re-seed: the resumed run keeps the paused run's
 * `runIdentity`, restored from the flowchart checkpoint. So the checkpoint is
 * the one carrier of "who the paused run was for" that survives a shared
 * instance (another person ran in between), a pooled instance rebuilt after
 * eviction, and a restart. This module is the inverse of seed's rungs over that
 * carrier.
 *
 * One stated edge: a flowchart checkpoint does not carry the paused run's id,
 * so the per-run default is recognised by SHAPE — an identity that is exactly
 * `{ conversationId }` holding an id `makeRunId` minted (`isMintedRunId`). A
 * caller who deliberately names `{ conversationId: 'run-<digits>-<digits>' }`
 * and then resumes without naming an identity is read as having named none —
 * the fail-closed direction: a derived namespace is never published as a
 * person.
 */

import type { MemoryIdentity } from '../../memory/identity/types.js';
import { isMintedRunId } from '../RunnerBase.js';

/** The two state keys seed writes the rungs into — read, never written, here. */
interface SeededIdentity {
  readonly runIdentity?: unknown;
  readonly runIdentitySource?: unknown;
}

/**
 * The identity the CALLER of the run whose state this is named, or undefined
 * when that run's identity was derived (session rung, per-run default) or the
 * state carries none.
 *
 * @example
 * ```ts
 * // Agent.resume — the resuming call's identity wins, as it does on run():
 * this.lastRunIdentity = options?.identity ?? callerIdentityOf(checkpoint.sharedState);
 * ```
 */
export function callerIdentityOf(state: unknown): MemoryIdentity | undefined {
  if (state === null || typeof state !== 'object') return undefined;
  const { runIdentity, runIdentitySource } = state as SeededIdentity;
  if (runIdentitySource !== undefined) return undefined;
  if (runIdentity === null || typeof runIdentity !== 'object') return undefined;
  if (isPerRunDefault(runIdentity as MemoryIdentity)) return undefined;
  return runIdentity as MemoryIdentity;
}

/** Seed's third rung: exactly `{ conversationId: <a minted run id | 'default'> }`. */
function isPerRunDefault(identity: MemoryIdentity): boolean {
  const keys = Object.keys(identity);
  if (keys.length !== 1 || keys[0] !== 'conversationId') return false;
  return identity.conversationId === 'default' || isMintedRunId(identity.conversationId);
}
