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
 * instance, a pooled instance rebuilt after eviction, and a restart. This
 * module is the inverse of seed's rungs over that carrier.
 *
 * THE LAW: never drop an identity the caller named, never promote a derived
 * one. The session rung is recorded, so it is certain. The per-run default is
 * NOT recorded (writing a marker would change the committed keys of every
 * run that names nobody), and a flowchart checkpoint does not carry the paused
 * run's id — so it is recognised by the strongest evidence available, in order:
 *
 *  1. **The caller named exactly this identity on this instance** (`named`, the
 *     instance's last caller identity) → it is the caller's. This is what keeps
 *     a single-user app's `{ conversationId: 'run-1-1' }` across a bare resume.
 *  2. **This instance minted that conversation id as a run id** (`minted`) →
 *     derived, for certain.
 *  3. **The checkpoint's own receipt names that id as its run** (the paused run's
 *     `receipt.basis.runId`, present once it called a model) → derived, for
 *     certain.
 *  4. **LAST RESORT — the SHAPE `makeRunId` mints** (`isMintedRunId`), for a
 *     checkpoint from another instance with no receipt to match → read as
 *     derived. The one stated edge: a caller who names
 *     `{ conversationId: 'run-<digits>-<digits>' }` on one instance and resumes
 *     it bare on ANOTHER, after a pause-resume-pause chain, loses it — the
 *     fail-closed direction, because a derived namespace is never published as
 *     a person. Pass `identity` on `resume` to keep it.
 *
 * A checkpoint names who it is for; it is not proof. A host that lets
 * checkpoints leave its trust boundary signs them or keeps them server-side —
 * see `Agent.resume`.
 */

import type { MemoryIdentity } from '../../memory/identity/types.js';
import { isMintedRunId } from '../RunnerBase.js';

/** The keys of the paused run's state this module reads — never writes. */
interface SeededState {
  readonly runIdentity?: unknown;
  readonly runIdentitySource?: unknown;
  readonly receipt?: { readonly basis?: { readonly runId?: unknown } };
}

/** What the resuming instance knows about identities and run ids. */
export interface CallerIdentityEvidence {
  /** The identity a caller last NAMED on this instance, if any. */
  readonly named?: MemoryIdentity;
  /** Run ids this instance minted (bounded). */
  readonly minted?: ReadonlySet<string>;
}

/**
 * The identity the CALLER of the run whose state this is named, as a COPY, or
 * undefined when that run's identity was derived (session rung, per-run
 * default), is malformed, or the state carries none.
 *
 * @example
 * ```ts
 * // Agent.resume — a resuming call that names a DIFFERENT identity is refused:
 * const named = callerIdentityOf(checkpoint.sharedState, { named: last, minted });
 * ```
 */
export function callerIdentityOf(
  state: unknown,
  evidence: CallerIdentityEvidence = {},
): MemoryIdentity | undefined {
  if (state === null || typeof state !== 'object') return undefined;
  const seeded = state as SeededState;
  if (seeded.runIdentitySource !== undefined) return undefined;
  const identity = wellFormed(seeded.runIdentity);
  if (identity === undefined) return undefined;
  if (evidence.named !== undefined && sameIdentity(evidence.named, identity)) return identity;
  if (conversationOnly(identity)) {
    const id = identity.conversationId;
    if (evidence.minted?.has(id) === true) return undefined;
    if (readReceiptRunId(seeded) === id) return undefined;
    if (isMintedRunId(id)) return undefined;
  }
  return identity;
}

/** Do two identities name the same tenant, principal and conversation? */
export function sameIdentity(a: MemoryIdentity, b: MemoryIdentity): boolean {
  return (
    a.conversationId === b.conversationId && a.principal === b.principal && a.tenant === b.tenant
  );
}

/** A fresh `MemoryIdentity` from an untrusted value — strings only, or nothing. */
function wellFormed(value: unknown): MemoryIdentity | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  // Every field a string or absent (a JS caller can omit `conversationId`;
  // what they named is still theirs), and at least one present.
  for (const key of ['conversationId', 'tenant', 'principal'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') return undefined;
  }
  if (raw.conversationId === undefined && raw.tenant === undefined && raw.principal === undefined) {
    return undefined;
  }
  return {
    ...(typeof raw.conversationId === 'string' && { conversationId: raw.conversationId }),
    ...(typeof raw.tenant === 'string' && { tenant: raw.tenant }),
    ...(typeof raw.principal === 'string' && { principal: raw.principal }),
  } as MemoryIdentity;
}

/** Seed's third rung has exactly one field, a string conversation id. */
function conversationOnly(identity: MemoryIdentity): boolean {
  return (
    typeof identity.conversationId === 'string' &&
    identity.tenant === undefined &&
    identity.principal === undefined
  );
}

function readReceiptRunId(state: SeededState): unknown {
  try {
    return state.receipt?.basis?.runId;
  } catch {
    return undefined;
  }
}
