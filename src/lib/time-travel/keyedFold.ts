/**
 * keyedFold — the value of ONE state key at one commit, folded from the run's
 * own fold base.
 *
 * Role:  Fold. It reads a finished run's commit log plus the base that log
 *        was recorded against, and answers "what was `key` at commit `idx`?"
 *        It executes nothing, records nothing and stores nothing beside the
 *        log. Its answers are DETACHED — deep-frozen before they are cached,
 *        because a memo that hands out live references is a fold that lets a
 *        reader rewrite the run (`keyedFold.ts` · `freezeDeep`).
 * Reads: a `FoldSource` — a snapshot (`commitLog` + `initialState`) or a
 *        subflow subtree (`history` + `initialState`), through footprintjs's
 *        own `stateAt` (for the base) and `applySmartMerge` (for the replay).
 * Emits: N/A.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * A commit log stores DIFFS. `commitValueAt` folds them for one key and says
 * so in its own docstring: a value that came from the run's INITIAL state and
 * was never `set` again folds to ABSENT, because the log alone cannot see the
 * pre-run base.
 *
 * That is not an edge case here. A RESUMED agent run is a fresh executor
 * seeded from `checkpoint.sharedState`, so the entire pre-pause world —
 * `systemPromptInjections`, `history`, `dynamicToolSchemas`, every build-time
 * constant `seed` wrote before the pause — is base, not log. Folding the
 * resumed run with `commitValueAt` returns an empty system prompt and a
 * truncated conversation and declares no gap: a confident falsehood about the
 * one question this family exists to answer. footprintjs 9.17 shipped
 * `RuntimeSnapshot.initialState` and `stateAt` for exactly this, and every
 * read in `epochs.ts` goes through here so it lands on that base.
 *
 * ── WHY NOT JUST CALL `stateAt` PER READ ───────────────────────────────────
 * `stateAt` folds the WHOLE state, and it clones that state once per bundle
 * (`applySmartMerge` opens with a `structuredClone` of its base). One fold is
 * therefore O(commits × state size) — measured on a real 100-turn agent
 * (1,719 commits, 101 epochs): 323 ms for a single fold, and 11.7 s to fold
 * once per epoch, against 78 ms for the whole per-epoch scrub before this
 * release. A per-epoch reader cannot pay that.
 *
 * So `stateAt` is used for the ONE thing only it can give — the fold base and
 * the honest `basis` verdict, at `commitIdx: -1`, where it folds nothing and
 * clones the base once — and the forward replay is done per key, through
 * footprintjs's own `applySmartMerge`. There is deliberately no second
 * implementation of the trace verbs here: every `set` / `append` / `merge` /
 * `delete` is applied by the same function the live commit uses.
 * `keyed-fold-equivalence.test.ts` pins the result against `stateAt` itself on
 * real runs, including a resumed one and a merge with no `set` anchor — the
 * one shape that cannot be folded at all without the base.
 */

import { applySmartMerge } from 'footprintjs/advanced';
import { stateAt } from 'footprintjs/trace';
import type { CommitBundle } from 'footprintjs/advanced';

/**
 * How a fold was derived — footprintjs's own two answers, restated here so a
 * caller of this module does not have to import the engine's trace barrel to
 * name them.
 *
 * - `'initial+log'` — the recording carried its fold base, so a value seeded
 *   before the run (or before a resume) folds correctly.
 * - `'log-only'` — it did not. Anything the log never `set` reads as absent,
 *   and a reader must say so rather than present the hole as a proof.
 */
export type FoldBasis = 'initial+log' | 'log-only';

/**
 * Anything that carries a commit log and, ideally, the base it was recorded
 * against — the two field spellings footprintjs already has: `commitLog` on a
 * run snapshot, `history` on a subflow subtree.
 */
export interface FoldSourceLike {
  readonly commitLog?: readonly CommitBundle[];
  readonly history?: readonly unknown[];
  readonly initialState?: Record<string, unknown>;
}

/**
 * The delimiter footprintjs joins nested trace paths with — the engine's own
 * `DELIM`. Mirrored rather than imported because it is not on any public
 * barrel.
 *
 * Today's scope facade records a nested write (`scope.profile.city = …`) as a
 * MERGE on the top-level key rather than as a delimited path, so this is
 * DEFENCE and not a hot path. It is still load-bearing: a delimited path must
 * be attributed to its ROOT key, or a write to `history<DELIM>0<DELIM>content`
 * would be filed under a key nobody asks for and dropped from every fold.
 */
const PATH_DELIM = '\u001F';

/** The top-level state key a trace path belongs to. */
function rootKeyOf(path: string): string {
  const cut = path.indexOf(PATH_DELIM);
  return cut < 0 ? path : path.slice(0, cut);
}

/** One recorded write, as the replay needs it. */
interface Touch {
  /** Array index of the bundle that carried it. */
  readonly at: number;
  readonly bundle: CommitBundle;
  /** The engine's own trace entry — handed straight back to
   *  `applySmartMerge`, never rebuilt from parts. */
  readonly entry: CommitBundle['trace'][number];
  /** `true` when this write fully determines the key on its own — a `set` or
   *  a `delete` of the WHOLE key, which makes everything before it (the base
   *  included) irrelevant. A nested `set` does not qualify. */
  readonly anchors: boolean;
}

/**
 * One key's value at one commit — the question, and the answers already
 * computed for it.
 */
export interface KeyedFold {
  /** How this fold was derived — see {@link FoldBasis}. */
  readonly basis: FoldBasis;
  /** How many bundles the log holds. */
  readonly length: number;
  /**
   * The value of `key` folded through commit ARRAY INDEX `idx`, inclusive.
   * `-1` (or lower) folds nothing and returns the base's value — the state
   * before the log's first commit.
   *
   * DEEP-FROZEN, and the same object on every call for the same question. It
   * is detached from the engine's own bundles AND unmutable, so a caller
   * cannot rewrite what a later index folds to — `keyedFold.ts` · `freezeDeep`
   * says why that is a law here rather than a courtesy. Copy it
   * (`structuredClone`, a spread) if you need something to edit.
   */
  valueAt(key: string, idx: number): unknown;
}

/**
 * Deep-freeze in place, skipping subtrees that are frozen already.
 *
 * ── A FOLD RESULT IS DETACHED, OR IT IS NOT A FOLD ─────────────────────────
 * This module memoizes: `valueAt` hands the SAME object back on every call for
 * the same question, and the forward cursor seeds the replay of every LATER
 * index from that very object. Handing out a live reference therefore does not
 * merely risk a surprise — a consumer that edits what it was handed silently
 * rewrites what every later epoch reports was served, which is the one thing
 * this family exists to be trusted about.
 *
 * It was not a hazard in the reader this module replaced. footprintjs's
 * `commitValueAt` clones per call, so the same edit was harmless there; the
 * memo is what introduced it, so the memo is where it is closed.
 *
 * FREEZING RATHER THAN CLONING PER READ, for two reasons. Cloning per read is
 * exactly the cost the forward cursor exists to avoid — it puts an O(value)
 * copy back on every question, on the hot path of a scrub. And freezing is the
 * answer footprintjs itself already gives: `stateAt` returns
 * `freezeDeep(structuredClone(out))`, so a caller that moves between the two
 * folds meets one contract instead of two.
 *
 * The forward replay is unaffected: `applySmartMerge` opens with a
 * `structuredClone` of its base, and a clone of a frozen value is not frozen.
 *
 * MEASURED, so the choice is not a guess, and reported because it is not free.
 * On a 601-epoch run (10,219 commits) the whole per-epoch scrub — every
 * epoch's system pieces, conversation and tool list, folded and rebuilt —
 * costs 1,141 ms with the freeze and 930 ms without it: +211 ms, +23%, on a
 * scrub that cost 20.8 s two fixes ago. The batch form moves 919 ms to
 * 1,116 ms. The alternative is DEARER, not cheaper: on the same structure
 * (1,200 messages) `structuredClone` costs 3.6x what this walk does — 0.94 ms
 * against 0.26 ms — and a copy would have to run once per READ where the
 * freeze runs once per memoized answer. A mutable answer is not worth 23%, and
 * buying safety by copying would cost more than 23%.
 */
function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    const inner = (value as Record<string, unknown>)[key];
    if (inner !== null && typeof inner === 'object' && !Object.isFrozen(inner)) freezeDeep(inner);
  }
  return value;
}

/** The bundles, from whichever field this source spells them in. */
function commitsOf(source: FoldSourceLike | undefined): readonly CommitBundle[] {
  if (!source) return [];
  if (Array.isArray(source.commitLog)) return source.commitLog;
  if (Array.isArray(source.history)) return source.history as readonly CommitBundle[];
  return [];
}

/** Build the per-key touch index in ONE pass over the log. */
function indexTouches(log: readonly CommitBundle[]): Map<string, Touch[]> {
  const index = new Map<string, Touch[]>();
  for (let at = 0; at < log.length; at++) {
    const bundle = log[at];
    if (!bundle) continue;
    for (const entry of bundle.trace ?? []) {
      const path = entry.path;
      if (typeof path !== 'string') continue;
      const key = rootKeyOf(path);
      const verb = entry.verb;
      const touch: Touch = {
        at,
        bundle,
        entry,
        anchors: path === key && (verb === 'set' || verb === 'delete'),
      };
      const list = index.get(key);
      if (list === undefined) index.set(key, [touch]);
      else list.push(touch);
    }
  }
  return index;
}

/** The last position in `touches` whose bundle index is `<= idx`, or `-1`. */
function lastTouchAt(touches: readonly Touch[], idx: number): number {
  let lo = 0;
  let hi = touches.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (touches[mid]!.at <= idx) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Memoized folds, one per source object. */
const FOLDS = new WeakMap<object, KeyedFold>();

/**
 * The keyed fold for one source, memoized on the source object.
 *
 * Memoized because a per-epoch reader asks the same source for the same keys
 * at many different commits, and the index is the expensive half: building it
 * is one pass over the log, and answering a read afterwards is a binary search
 * plus a replay from the nearest full-value write (normally exactly one).
 *
 * @example
 * ```ts
 * import { keyedFold } from 'agentfootprint';
 *
 * const fold = keyedFold(agent.getSnapshot());
 * fold.basis;                      // 'initial+log' — the base travelled
 * fold.valueAt('history', 12);     // the conversation after the 13th commit
 * fold.valueAt('history', -1);     // …and what the run STARTED from
 * ```
 */
export function keyedFold(source: FoldSourceLike | undefined): KeyedFold {
  if (source !== null && typeof source === 'object') {
    const memo = FOLDS.get(source);
    if (memo !== undefined) return memo;
  }

  const log = commitsOf(source);
  // `stateAt` at -1 folds NOTHING: it clones the base once and reports whether
  // there was one. That is the whole reason to call the engine's own fold here
  // rather than read `initialState` directly — the `basis` verdict is its
  // answer to give, and a recording that travelled without its base must be
  // able to say so.
  const seed = stateAt(source as never, -1);
  const index = indexTouches(log);
  const answers = new Map<string, Map<number, unknown>>();
  /** Per key, the furthest replay position reached and the value there — see
   *  the forward-cursor note in `compute`. */
  const cursor = new Map<string, { position: number; value: unknown }>();

  /** One touch applied, through the ENGINE's verb switch, over a state
   *  projected to this key alone. `applySmartMerge` navigates from the root,
   *  so a delimited path lands exactly where it did in the real fold. */
  const step = (key: string, value: unknown, touch: Touch): unknown =>
    (
      applySmartMerge({ [key]: value }, touch.bundle.updates, touch.bundle.overwrite, [
        touch.entry,
      ]) as Record<string, unknown>
    )[key];

  const compute = (key: string, idx: number): unknown => {
    const touches = index.get(key);
    const last = touches === undefined ? -1 : lastTouchAt(touches, idx);
    // The base's own value. `stateAt` already deep-freezes what it returns, so
    // this is a no-op today — asserted rather than assumed, because the law
    // this module states about its answers must not rest on another module
    // continuing to keep it.
    if (touches === undefined || last < 0) return freezeDeep(seed.state[key]);

    // Anchor at the latest write that fully determines the key on its own;
    // everything before it — the base included — cannot be read back through
    // it. With no anchor the base IS the starting value, which is the whole
    // fix: `commitValueAt` starts from `undefined` here and folds a fiction.
    let start = 0;
    let anchored = false;
    for (let i = last; i >= 0; i--) {
      if (touches[i]!.anchors) {
        start = i;
        anchored = true;
        break;
      }
    }
    let from = start;
    let value: unknown = anchored ? undefined : seed.state[key];

    // THE FORWARD CURSOR, and why this module would be slower than the reader
    // it replaces without it. An agent's `history` is `set` ONCE and appended
    // to every turn, so a query at turn k has to replay k appends from the
    // anchor — and a per-epoch scrub asks E times, which is O(E²) replays of a
    // growing array. Resuming from the furthest position already reached makes
    // the whole scrub O(E) replays instead, because a scrub walks forward.
    // (Measured on a 96-turn run: 201 ms per scrub without this, 40 ms with.)
    // A backward or out-of-order query simply falls back to the anchor, which
    // is correct and no worse than never having cached anything.
    const held = cursor.get(key);
    if (held !== undefined && held.position >= start && held.position <= last) {
      from = held.position + 1;
      value = held.value;
    }
    for (let i = from; i <= last; i++) value = step(key, value, touches[i]!);
    // Frozen HERE, before anything else can hold it: the cursor keeps this very
    // object as the seed for every later index, and `valueAt` memoizes it. One
    // freeze covers both — `keyedFold.ts` · `freezeDeep`.
    freezeDeep(value);
    cursor.set(key, { position: last, value });
    return value;
  };

  const fold: KeyedFold = {
    basis: seed.basis as FoldBasis,
    length: log.length,
    valueAt(key: string, idx: number): unknown {
      const at = Math.min(Math.floor(idx), log.length - 1);
      let perKey = answers.get(key);
      if (perKey === undefined) {
        perKey = new Map<number, unknown>();
        answers.set(key, perKey);
      }
      if (perKey.has(at)) return perKey.get(at);
      const value = compute(key, at);
      perKey.set(at, value);
      return value;
    },
  };

  // The fold OBJECT is memoized too — the same one every caller of `keyedFold`
  // gets for this source — so it is frozen for the same reason its answers are.
  Object.freeze(fold);
  if (source !== null && typeof source === 'object') FOLDS.set(source, fold);
  return fold;
}
