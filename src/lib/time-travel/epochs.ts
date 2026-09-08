/**
 * epochs — where one epoch's committed pieces live, in either chart shape.
 *
 * Role:  Fold. It reads a finished run's recording and answers one question:
 *        "for iteration k, which commit log holds the call, at which index,
 *        and against which fold base?" It executes nothing, records nothing
 *        and stores nothing beside the log.
 * Reads: a recording (`commitLog`, `initialState`, `subflowResults`), through
 *        footprintjs's own id parsers and this folder's `keyedFold.ts`.
 * Emits: N/A.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * An agent's iteration — an EPOCH — commits to a different place depending on
 * how the chart was built. Under `reactMode: 'dynamic'` the `call-llm` stage is
 * a parent-level stage and its bundle is in the run's own log. Under
 * `'dynamic-grouped'` each turn runs inside an `sf-llm-call` subflow, which has
 * its own isolated runtime and its own log, retained per iteration under
 * `subflowResults['sf-llm-call#k'].treeContext.history`.
 *
 * That fork was written out THREE times — `contextLedger.ts` had a private
 * `llmCallMountKeys`, `trajectory.ts` had a byte-twin of it, and a rebuild of
 * what the model was served would have been the third. Three copies of "which
 * log is this key in?" is three chances to disagree about which iteration a
 * value belonged to, on the one question the whole family exists to answer.
 * So the fork lives here once, and every reader asks it.
 *
 * ── WHAT AN EPOCH NUMBER IS ────────────────────────────────────────────────
 * The committed `iteration` value in effect at the call — the same number
 * `callLLM` put on the receipt's `basis.epoch` and on every `iteration_start`
 * event. It starts at 1. It is READ, not counted: a run that pauses and
 * resumes, or one whose first turn is not its first stage, still names its
 * epochs the way the run itself named them.
 *
 * ── EVERY READ FOLDS FROM THE BASE ─────────────────────────────────────────
 * A location carries the FOLD SOURCE its log was recorded against, not just
 * the log, and every read below goes through `keyedFold.ts`. A resumed run is
 * a fresh executor seeded from `checkpoint.sharedState`, so most of what the
 * call read is base rather than log; a fold that could not see the base
 * answered "absent" for the whole pre-pause world and said nothing about it.
 * `EpochLocation.basis` is that fold's own verdict, carried out to the reader
 * so a recording that travelled without its base declares a gap instead of a
 * confident empty view.
 */

import type { CommitBundle } from 'footprintjs/advanced';
import { parseRuntimeStageId, splitStageId } from 'footprintjs/trace';
import { STAGE_IDS, SUBFLOW_IDS } from '../../conventions.js';
import { keyedFold, type FoldBasis, type FoldSourceLike } from './keyedFold.js';

/** The shape a recording has to have for any of this to work — a snapshot, or
 *  anything that hands one over. */
export interface RecordingLike {
  readonly commitLog?: readonly CommitBundle[];
  /** The log's fold base (`RuntimeSnapshot.initialState`, footprintjs 9.17+).
   *  Absent on a recording that travelled without it — see
   *  {@link EpochLocation.basis}. */
  readonly initialState?: Record<string, unknown>;
  readonly executionTree?: unknown;
  readonly subflowResults?: Record<string, unknown>;
}

/** One epoch, located: which log holds its call, where in that log, and what
 *  that log folds against. */
export interface EpochLocation {
  /**
   * The committed `iteration` at the call. 1-based, and READ rather than
   * counted — a run that pauses and resumes still names its epochs the way the
   * run itself named them.
   *
   * ONE fallback, and it is a count: when the fold cannot read `iteration` at
   * all (a recording whose base did not travel, on a run that never re-`set`
   * it), this is the location's position in run order instead. The tell is
   * {@link EpochLocation.basis} / {@link EpochLocation.runBasis} reading
   * `'log-only'`, which is also what makes `servedView.ts` raise
   * `no-fold-base`. A view must have some number to be addressed by; this one
   * is the honest second choice, not a claim about the record.
   */
  readonly epoch: number;
  /** The `call-llm` stage's `runtimeStageId` — the llm-turn stop's own id. */
  readonly callRuntimeStageId: string;
  /** The log the call committed to: the run's own under `'dynamic'`, the
   *  turn's inner history under `'dynamic-grouped'`. */
  readonly log: readonly CommitBundle[];
  /** The call's ARRAY index in {@link EpochLocation.log}. */
  readonly callIdx: number;
  /** The RUN's log, always. Run constants (a build-time fact seeded once) are
   *  read here, because a grouped turn's inner log never sees them unless the
   *  boundary happens to carry them. */
  readonly runLog: readonly CommitBundle[];
  /** The `sf-llm-call` mount this epoch was projected from — set under
   *  `'dynamic-grouped'` only, and the tell that `callIdx` is inner-relative. */
  readonly subflowScope?: string;
  /**
   * The fold source {@link EpochLocation.log} belongs to — the log PLUS the
   * base it was recorded against. Reads go through it, never through the bare
   * array, so a value seeded before the run (every key of a resumed run) folds
   * from where it actually came from.
   */
  readonly source: FoldSourceLike;
  /** The same, for {@link EpochLocation.runLog}. */
  readonly runSource: FoldSourceLike;
  /**
   * How {@link EpochLocation.source} folds. `'log-only'` means the recording
   * travelled without its fold base, so anything the log never `set` reads as
   * absent — `servedView.ts` turns that into a declared gap rather than an
   * empty view.
   */
  readonly basis: FoldBasis;
  /** The same, for {@link EpochLocation.runSource}. */
  readonly runBasis: FoldBasis;
  /** `false` when this recording carries no RUN log at all — a subtree handed
   *  in on its own. Every run constant is then unreadable, which
   *  `servedView.ts` declares rather than reads as absent. */
  readonly hasRunLog: boolean;
}

/**
 * A snapshot from whatever the caller had: a runner (`Agent`, `LLMCall`), or
 * the snapshot itself. Duck-typed on purpose — a recording read back from JSON
 * is a plain object and must work exactly like a live one.
 */
export function recordingOf(source: unknown): RecordingLike | undefined {
  const runner = source as { getLastSnapshot?: unknown; getSnapshot?: unknown };
  const accessor = runner?.getLastSnapshot ?? runner?.getSnapshot;
  if (typeof accessor === 'function') {
    return (accessor as () => unknown).call(source) as RecordingLike | undefined;
  }
  return source as RecordingLike | undefined;
}

/**
 * The `sf-llm-call` mount keys in `subflowResults`, in loop order.
 *
 * Non-empty ⇒ the run is GROUPED and every turn's pieces are in its own inner
 * log. Empty ⇒ flat, and the run's own log holds everything.
 *
 * @example
 * ```ts
 * llmCallMountKeys(snapshot.subflowResults); // ['sf-llm-call#4', 'sf-llm-call#9']
 * ```
 */
export function llmCallMountKeys(subflowResults: Record<string, unknown> | undefined): string[] {
  if (!subflowResults) return [];
  return Object.keys(subflowResults)
    .filter(
      (k) => k.includes('#') && splitStageId(k.split('#')[0]).localStageId === SUBFLOW_IDS.LLM_CALL,
    )
    .sort((a, b) => parseRuntimeStageId(a).executionIndex - parseRuntimeStageId(b).executionIndex);
}

/**
 * One `sf-llm-call` mount's own subtree — its log AND the base that log folds
 * against. The subtree, not the array, because the whole point of a location
 * is that a read lands on the base as well as the diffs.
 */
function innerSubtreeOf(
  subflowResults: Record<string, unknown>,
  key: string,
): FoldSourceLike | undefined {
  const entry = subflowResults[key] as { treeContext?: unknown } | undefined;
  const tree = entry?.treeContext as FoldSourceLike | undefined;
  return tree !== null && typeof tree === 'object' && Array.isArray(tree.history)
    ? tree
    : undefined;
}

/**
 * The FIRST commit of the `call-llm` stage in a log, or `-1`.
 *
 * First, not last, for the reason `commitStops` anchors there: one stage
 * execution can flush more than one bundle under one `runtimeStageId`, and the
 * call's own reads happened at the first.
 */
function callIndexIn(log: readonly CommitBundle[]): number {
  for (let i = 0; i < log.length; i++) {
    const stageId = log[i]?.stageId;
    if (stageId && splitStageId(stageId).localStageId === STAGE_IDS.CALL_LLM) return i;
  }
  return -1;
}

/** Located epochs, memoized on the recording object. */
const LOCATIONS = new WeakMap<object, readonly EpochLocation[]>();

/**
 * Every epoch in a recording, in run order — the ONE owner of the flat /
 * grouped fork.
 *
 * Returns `[]` for a recording with no LLM call in it at all (an empty log, a
 * chart with no `call-llm` stage). That is a different fact from "the epoch you
 * asked for is not here", which is what {@link epochAt} says with `undefined`.
 *
 * MEMOIZED on the recording object, because the cost of locating epochs is a
 * pass over the log and a per-epoch reader asks for one epoch at a time: before
 * this, scrubbing a 600-turn run epoch by epoch relocated every epoch on every
 * call and took 20.8 s. Holding the snapshot and asking it repeatedly is the
 * shape a reader's UI actually has, so the memo is keyed on exactly that
 * object; a caller that hands in a runner and gets a fresh snapshot each time
 * pays the pass each time, which is the cost of asking a different question.
 *
 * FROZEN, because it is memoized: the array and each location on it are the
 * very objects the next caller gets, so an edit here would be an edit to
 * everybody's answer. The same law `keyedFold.ts` · `freezeDeep` states for a
 * folded value. What is NOT frozen is what a location POINTS AT — `log`,
 * `source`, `runSource` are the caller's own recording, and this file does not
 * get to lock down an object it was merely handed.
 *
 * @example
 * ```ts
 * import { epochLocations } from 'agentfootprint';
 *
 * epochLocations(agent.getSnapshot()!).map((e) => [e.epoch, e.callRuntimeStageId]);
 * // dynamic:         [[1, 'call-llm#12'], [2, 'call-llm#31']]
 * // dynamic-grouped: [[1, 'sf-llm-call/call-llm#9'], [2, 'sf-llm-call/call-llm#28']]
 * ```
 */
export function epochLocations(source: unknown): readonly EpochLocation[] {
  const recording = recordingOf(source);
  if (recording !== null && typeof recording === 'object') {
    const memo = LOCATIONS.get(recording);
    if (memo !== undefined) return memo;
  }
  const located = Object.freeze(locate(recording).map((e) => Object.freeze(e)));
  if (recording !== null && typeof recording === 'object') LOCATIONS.set(recording, located);
  return located;
}

/** The uncached pass — one walk of the log, one keyed fold per source. */
function locate(recording: RecordingLike | undefined): EpochLocation[] {
  const runLog = (recording?.commitLog ?? []) as readonly CommitBundle[];
  const runSource: FoldSourceLike = recording ?? {};
  const runFold = keyedFold(runSource);
  const hasRunLog = runLog.length > 0;
  const subflowResults = recording?.subflowResults;

  const mounts = llmCallMountKeys(subflowResults);
  if (mounts.length > 0 && subflowResults) {
    const found: EpochLocation[] = [];
    for (const [ordinal, key] of mounts.entries()) {
      const inner = innerSubtreeOf(subflowResults, key);
      const log = (inner?.history ?? []) as readonly CommitBundle[];
      const callIdx = callIndexIn(log);
      if (inner === undefined || callIdx < 0) continue;
      const fold = keyedFold(inner);
      const iteration = fold.valueAt('iteration', callIdx);
      found.push({
        epoch:
          typeof iteration === 'number' && Number.isFinite(iteration) ? iteration : ordinal + 1,
        callRuntimeStageId: log[callIdx]!.runtimeStageId,
        log,
        callIdx,
        runLog,
        subflowScope: key,
        source: inner,
        runSource,
        basis: fold.basis,
        runBasis: runFold.basis,
        hasRunLog,
      });
    }
    return found;
  }

  // FLAT: every `call-llm` bundle in the run's own log, at its first commit.
  const found: EpochLocation[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < runLog.length; i++) {
    const bundle = runLog[i]!;
    if (splitStageId(bundle.stageId).localStageId !== STAGE_IDS.CALL_LLM) continue;
    if (seen.has(bundle.runtimeStageId)) continue;
    seen.add(bundle.runtimeStageId);
    const iteration = runFold.valueAt('iteration', i);
    found.push({
      epoch:
        typeof iteration === 'number' && Number.isFinite(iteration) ? iteration : found.length + 1,
      callRuntimeStageId: bundle.runtimeStageId,
      log: runLog,
      callIdx: i,
      runLog,
      source: runSource,
      runSource,
      basis: runFold.basis,
      runBasis: runFold.basis,
      hasRunLog,
    });
  }
  return found;
}

/**
 * One epoch by number, or `undefined` when the run has no such iteration.
 *
 * @example
 * ```ts
 * epochAt(agent.getSnapshot()!, 2)?.callRuntimeStageId; // 'call-llm#31'
 * ```
 */
export function epochAt(source: unknown, epoch: number): EpochLocation | undefined {
  return epochLocations(source).find((e) => e.epoch === epoch);
}

/**
 * The value of `key` as the epoch's call READ it — folded to just BEFORE the
 * call's own bundle, so a key the call itself writes back (`history` gains the
 * assistant turn; `receipt` is minted) reads as it was on the way in.
 *
 * Folded from the run's base, not from the log alone: on a resumed run the
 * call read values the log never wrote, and reading those as absent is the
 * fiction `keyedFold.ts` exists to end. A call that is its log's FIRST commit
 * (a grouped turn, or the first stage after a resume) therefore folds to the
 * base rather than to nothing.
 *
 * @example
 * ```ts
 * const epoch = epochAt(snapshot, 1)!;
 * (readAtCall(epoch, 'history') as unknown[]).length; // the turns that went out
 * ```
 */
export function readAtCall(location: EpochLocation, key: string): unknown {
  if (location.callIdx < 0) return undefined;
  return keyedFold(location.source).valueAt(key, location.callIdx - 1);
}

/**
 * The value of `key` the epoch's call itself COMMITTED — folded through the
 * call's own bundle. The receipt is read this way, and only the receipt: it is
 * the one value the call writes that describes the call.
 */
export function readAfterCall(location: EpochLocation, key: string): unknown {
  if (location.callIdx < 0) return undefined;
  return keyedFold(location.source).valueAt(key, location.callIdx);
}

/**
 * A RUN CONSTANT: a build-time fact `seed` put on the record once, read from
 * the run's own log.
 *
 * It is read from the run log rather than the epoch's log because that is where
 * `seed` runs in both chart shapes. Under `'dynamic-grouped'` the turn's inner
 * log only ever holds what the boundary's `inputMapper` carried in, and a
 * constant nobody inside the turn reads is not carried — so asking the inner
 * log would answer "absent" for a fact the run plainly recorded.
 *
 * `undefined` has TWO causes and a caller must not blur them: the run never
 * recorded this constant, or this recording carries no run log to read
 * (`EpochLocation.hasRunLog` is `false` — a subtree handed in on its own).
 * `servedView.ts` branches on that flag and declares a gap for the second.
 */
export function readRunConstant(location: EpochLocation, key: string): unknown {
  if (!location.hasRunLog) return undefined;
  return keyedFold(location.runSource).valueAt(key, location.runLog.length - 1);
}
