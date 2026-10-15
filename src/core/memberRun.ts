/**
 * memberRun — WHO a composition member runs for: the run that mounted it.
 *
 * ── The defect this closes ───────────────────────────────────────────────────
 * A composition (`Sequence`, `Parallel`, `Conditional`, `Loop`, `Workflow`,
 * `Graph`) mounts each member's chart in ITS OWN executor; the member's
 * `run()` never runs. So a member agent's per-run facts — the memory
 * namespace, a tool's `ctx.identity`, `ctx.runId` — were read off the member
 * INSTANCE, which every run of the composition shares: `'pending'` for an
 * instance never run on its own (one memory for every user of the
 * composition), or the last direct run's caller (another person's identity).
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 * The run decides, and it travels with the run. The OUTERMOST runner's
 * `run()` builds one `ParentRun` — the identity its caller named, or none, and
 * that run's own id — and every composition hands it to each member through
 * the member's input (`withParentRun`), nesting included. A member agent reads
 * it there (`stages/seed.ts`): the caller's identity when one was named, else
 * the run's own per-run conversation `{ conversationId: runId }` — never a
 * value its instance holds. A member mounted where no run reaches it is
 * refused by name.
 *
 * Per-run args are the carrier because they are the one thing two overlapping
 * runs of one composition cannot share.
 *
 * Pattern: value object + pure helpers. Role: core, run identity.
 */

import type { MemoryIdentity } from '../memory/identity/types.js';
import { assertIdentityShape } from './agent/callerIdentity.js';

/** The state key a runner keeps the run it serves under. */
export const MEMBER_RUN_KEY = 'memberRun';

/** The run a member is mounted in, as its composition hands it down. */
export interface ParentRun {
  /** The outermost run's id — the member's `ctx.runId`, and its conversation when no identity was named. */
  readonly runId: string;
  /** The identity the outermost run's caller named, if any. */
  readonly identity?: MemoryIdentity;
}

/**
 * The `ParentRun` a top-level composition run hands its members.
 *
 * @throws TypeError (from `assertIdentityShape`) when `identity` is not one.
 */
export function topLevelParentRun(
  runId: string,
  identity: MemoryIdentity | undefined,
  door: string,
): ParentRun {
  assertIdentityShape(identity, door);
  return { runId, ...(identity !== undefined && { identity: copyIdentity(identity) }) };
}

/**
 * The `ParentRun` a runner was handed in its input, as a validated copy;
 * `undefined` when the input carries none.
 *
 * @throws TypeError when a `parentRun` is present but malformed — a member
 *   must never run under a half-named run.
 */
export function parentRunOf(args: unknown, door: string): ParentRun | undefined {
  if (args === null || typeof args !== 'object') return undefined;
  const raw = (args as { readonly parentRun?: unknown }).parentRun;
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`${door}: \`parentRun\` must be an object like { runId, identity? }.`);
  }
  const { runId, identity } = raw as { readonly runId?: unknown; readonly identity?: unknown };
  if (typeof runId !== 'string' || runId === '') {
    throw new TypeError(`${door}: \`parentRun.runId\` must be a non-empty string.`);
  }
  assertIdentityShape(identity, door);
  return {
    runId,
    ...(identity !== undefined && { identity: copyIdentity(identity as MemoryIdentity) }),
  };
}

/** The runners that read `parentRun` — an Agent, and every composition (which hands it on). */
const readers = new WeakSet<object>();

/**
 * Register a runner that reads `parentRun` from its input — `Agent` and the
 * compositions call this in their constructors. Every other runner is handed
 * the input it always was, byte for byte.
 */
export function readsParentRun(runner: object): void {
  readers.add(runner);
}

/**
 * A member's input with the run it is mounted in — what every composition's
 * input mapper returns — for a runner that reads it; the input unchanged for
 * any other runner, or when there is no run to hand down.
 */
export function withParentRun<I extends object>(
  input: I,
  parentRun: ParentRun | undefined,
  runner: object,
): I | (I & { readonly parentRun: ParentRun }) {
  return parentRun === undefined || !readers.has(runner) ? input : { ...input, parentRun };
}

/**
 * A composition's seed: keep the run it was handed — its own `run()` builds
 * one; a parent composition's mapper hands one down — in its state, under
 * {@link MEMBER_RUN_KEY}, for its input mappers to hand on. (A run's input is
 * not part of the state an input mapper reads, and the input key itself is
 * read-only, so it is kept under a key of its own.) Written only when there is
 * one.
 */
export function adoptParentRun(scope: object, args: unknown, door: string): void {
  const parentRun = parentRunOf(args, door);
  if (parentRun !== undefined) (scope as Record<string, unknown>)[MEMBER_RUN_KEY] = parentRun;
}

/** The run a runner's state carries (`adoptParentRun`, or an agent's seed), for its input mappers. */
export function parentRunIn(state: unknown): ParentRun | undefined {
  if (state === null || typeof state !== 'object') return undefined;
  return (state as Record<string, ParentRun | undefined>)[MEMBER_RUN_KEY];
}

/** The memory namespace a member runs under: the named identity, else the run's own conversation. */
export function memberIdentityOf(parentRun: ParentRun): MemoryIdentity {
  return parentRun.identity ?? { conversationId: parentRun.runId };
}

function copyIdentity(identity: MemoryIdentity): MemoryIdentity {
  return {
    ...(identity.conversationId !== undefined && { conversationId: identity.conversationId }),
    ...(identity.tenant !== undefined && { tenant: identity.tenant }),
    ...(identity.principal !== undefined && { principal: identity.principal }),
  } as MemoryIdentity;
}

/**
 * A member mounted where no run reaches it — another runner's executor is
 * running this agent's chart, and neither a `parentRun` nor an `identity`
 * arrived in its input. Refused rather than run under its instance's last run.
 */
export class MemberIdentityError extends Error {
  readonly code = 'ERR_MEMBER_NO_IDENTITY' as const;

  constructor() {
    super(
      'Agent: this agent is running inside another runner’s chart and no identity reached it ' +
        '— no `parentRun` from a composition and no `identity` in its input. It is refused ' +
        'rather than run under its instance’s last run, which may be another user’s, or under ' +
        'a placeholder every run would share. Mount it through a composition (Sequence, ' +
        'Parallel, Conditional, Loop, Workflow, Graph), which hands it the run it serves, or ' +
        'return `identity` from your inputMapper.',
    );
    this.name = 'MemberIdentityError';
  }
}
