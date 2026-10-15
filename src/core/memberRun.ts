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
 * The run decides, and only the engine can name it. The OUTERMOST
 * composition's `run()` OPENS one run — the identity its caller named, or
 * none, and that run's own id — in this module's private registry, and hands
 * its members only an unguessable LINK to it (`withParentRun`), nesting
 * included. A member agent looks the run up by that link (`stages/seed.ts`):
 * the caller's identity when one was named, else the run's own per-run
 * conversation `{ conversationId: runId }` — never a value its instance
 * holds, and never a run-shaped value it was handed: a `parentRun` that is not
 * a live link is refused by name (`ParentRunRefusedError`). A member mounted
 * where no run reaches it is refused too (`MemberIdentityError`).
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

/** The run a member is mounted in. */
export interface ParentRun {
  /** The outermost run's id — the member's `ctx.runId`, and its conversation when no identity was named. */
  readonly runId: string;
  /** The identity the outermost run's caller named, if any. */
  readonly identity?: MemoryIdentity;
}

/**
 * A run as a runner's state records it: the run, and the LINK that names it in
 * this module's registry. Only the link travels to members; what a member runs
 * for is looked up here, never read off what it was handed.
 */
export interface ParentRunRecord extends ParentRun {
  readonly link: string;
}

// ── The brand: a module-private registry of the runs a composition opened ──
//
// A member is handed a LINK, an unguessable token, never a run. The run it
// names lives here, where only `openParentRun` / `reopenParentRun` can put it
// — so nothing outside this module (an option, an input, a mapper, a state
// key, a model's or a tool's output) can make a member run for someone: a
// `parentRun` that is not a live link is refused by name. A token rather than
// an object brand, because a member's input is copied on its way in, and a
// copy keeps a string but not an object's identity.

const live = new Map<string, { readonly run: ParentRun; holders: number }>();

/**
 * A `parentRun` that is not a live link this module issued — forged, copied
 * from another run, or a run already over. Refused, never used.
 */
export class ParentRunRefusedError extends Error {
  readonly code = 'ERR_PARENT_RUN_REFUSED' as const;

  constructor(door: string) {
    super(
      `${door}: \`parentRun\` is not a run this process opened — it is refused. Only a ` +
        'composition’s own run() hands its members their run; one built anywhere else (an ' +
        'option, an input mapper, a model’s or a tool’s output) could name another person.',
    );
    this.name = 'ParentRunRefusedError';
  }
}

/**
 * Open the run a top-level composition run hands its members, and register it.
 * Close it with {@link closeParentRun} when the run returns (finished or paused).
 *
 * @throws TypeError (from `assertIdentityShape`) when `identity` is not one.
 */
export function openParentRun(
  runId: string,
  identity: MemoryIdentity | undefined,
  door: string,
): ParentRunRecord {
  assertIdentityShape(identity, door);
  const run: ParentRun = {
    runId,
    ...(identity !== undefined && { identity: copyIdentity(identity) }),
  };
  const link = globalThis.crypto.randomUUID();
  live.set(link, { run, holders: 1 });
  return { link, ...run };
}

/**
 * Re-open, for a resumed leg, the run a paused composition was running — read
 * off the checkpoint's own state (the checkpoint is the record of that run; a
 * host keeps it server-side or signs it, as for every resume). `undefined`
 * when the paused run recorded none.
 */
export function reopenParentRun(sharedState: unknown, door: string): ParentRunRecord | undefined {
  if (sharedState === null || typeof sharedState !== 'object') return undefined;
  const raw = (sharedState as Record<string, unknown>)[MEMBER_RUN_KEY];
  if (raw === undefined) return undefined;
  const { link, runId, identity } = (raw ?? {}) as {
    readonly link?: unknown;
    readonly runId?: unknown;
    readonly identity?: unknown;
  };
  if (typeof link !== 'string' || link === '' || typeof runId !== 'string' || runId === '') {
    throw new ParentRunRefusedError(door);
  }
  assertIdentityShape(identity, door);
  const run: ParentRun = {
    runId,
    ...(identity !== undefined && { identity: copyIdentity(identity as MemoryIdentity) }),
  };
  const held = live.get(link);
  if (held !== undefined) held.holders++;
  else live.set(link, { run, holders: 1 });
  return { link, ...(held?.run ?? run) };
}

/** Release a run this module opened (`openParentRun` / `reopenParentRun`). */
export function closeParentRun(record: ParentRunRecord | undefined): void {
  if (record === undefined) return;
  const held = live.get(record.link);
  if (held === undefined) return;
  if (--held.holders <= 0) live.delete(record.link);
}

/** The run a live link names, or `undefined`. */
export function runOfLink(link: unknown): ParentRun | undefined {
  return typeof link === 'string' ? live.get(link)?.run : undefined;
}

/**
 * The run a runner was handed in its input, looked up by its link; `undefined`
 * when the input carries none.
 *
 * @throws ParentRunRefusedError when a `parentRun` is present but is not a live
 *   link — a member never runs under a run it cannot prove.
 */
export function resolveParentRun(args: unknown, door: string): ParentRunRecord | undefined {
  if (args === null || typeof args !== 'object') return undefined;
  const link = (args as { readonly parentRun?: unknown }).parentRun;
  if (link === undefined) return undefined;
  const run = runOfLink(link);
  if (run === undefined) throw new ParentRunRefusedError(door);
  return { link: link as string, ...run };
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
 * A member's input with the LINK of the run it is mounted in — what every
 * composition's input mapper returns — for a runner that reads it; the input
 * unchanged for any other runner, or when there is no run to hand down.
 */
export function withParentRun<I extends object>(
  input: I,
  record: ParentRunRecord | undefined,
  runner: object,
): I | (I & { readonly parentRun: string }) {
  return record === undefined || !readers.has(runner)
    ? input
    : { ...input, parentRun: record.link };
}

/**
 * A composition's seed: resolve the link it was handed — its own `run()`
 * opened one; a parent composition's mapper hands one down — and keep the run
 * in its state, under {@link MEMBER_RUN_KEY}, for its input mappers to hand on
 * (a run's input is not part of the state an input mapper reads). Written only
 * when there is one.
 *
 * @throws ParentRunRefusedError for a link that is not live.
 */
export function adoptParentRun(scope: object, args: unknown, door: string): void {
  const record = resolveParentRun(args, door);
  if (record !== undefined) (scope as Record<string, unknown>)[MEMBER_RUN_KEY] = record;
}

/** The run a runner's state carries (`adoptParentRun`, or an agent's seed), for its input mappers. */
export function parentRunIn(state: unknown): ParentRunRecord | undefined {
  if (state === null || typeof state !== 'object') return undefined;
  return (state as Record<string, ParentRunRecord | undefined>)[MEMBER_RUN_KEY];
}

/**
 * What an inner mount of a member agent is handed of its run: the link, or —
 * for a chart a caller built — the identity it was given. Nothing on the
 * agent's own runs.
 */
export function memberRunArg(record: unknown): {
  readonly parentRun?: string;
  readonly memberIdentity?: MemoryIdentity;
} {
  if (record === null || typeof record !== 'object') return {};
  const { link, identity } = record as { readonly link?: unknown; readonly identity?: unknown };
  if (typeof link === 'string' && link !== '') return { parentRun: link };
  return identity !== undefined ? { memberIdentity: identity as MemoryIdentity } : {};
}

/**
 * The identity a member's stage runs for, read from the stage's own input:
 * the run its link names, else the identity a caller-built chart handed it.
 */
export function memberIdentityIn(scope: object): MemoryIdentity | undefined {
  const getArgs = (scope as { readonly $getArgs?: () => unknown }).$getArgs;
  const args = (typeof getArgs === 'function' ? getArgs.call(scope) : undefined) as
    | {
        readonly parentRun?: unknown;
        readonly memberIdentity?: MemoryIdentity;
        readonly identity?: MemoryIdentity;
      }
    | undefined;
  if (args?.parentRun !== undefined) {
    // A link decides alone: a dead one names nobody — never the input's own
    // `identity`, which on a workflow or graph step can be an earlier step's data.
    return runOfLink(args.parentRun)?.identity;
  }
  return args?.memberIdentity ?? args?.identity;
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
