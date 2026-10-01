/**
 * The per-epoch scrub does the batch form's work, once — COUNTED, at two sizes.
 *
 * A reader's UI does not call `servedViews(snapshot)` once. It holds the
 * snapshot and asks for ONE epoch at a time as a person drags a scrubber —
 * `servedAt(snapshot, k)`, over and over. Before 9.88.0 that shape relocated
 * every epoch on every call and re-scanned the log for the iteration number
 * once per bundle: the scrub cost E times the batch form, and that factor grew
 * with E. Measured on a 600-turn run it took 20.8 s, about 35x the batch form
 * at half the length — the difference between a scrubber and a spinner.
 *
 * ── A COMPLEXITY CLAIM IS COUNTED, NEVER TIMED ─────────────────────────────
 * The defect was a COUNT before it was a cost: work was redone for every
 * question. A scrub's work has two halves. The RECORDING's preparation —
 * locate the epochs, build the fold base — is owed once per recording. Each
 * EPOCH's view — its pieces, read at the call — is owed once per epoch. This
 * file counts the operations each half is made of, at the module boundaries
 * the code reaches them through, and requires the scrub to perform as many of
 * each as the batch does: the same number, at 13 epochs and at 49.
 *
 * It used to time them instead: best-of-5 milliseconds per form, the median of
 * three rounds, the ratio required to stay flat as the run grew. That failed on
 * CI with `src` unchanged (the drift it guarded read 2.25 once, where the
 * code's is 1.0), because the clock was measuring the test. Every timed pass
 * began right after the test's own JSON copy of the recording — 22 MB at 48
 * turns — and the garbage collection that copy owed landed inside one form's
 * timed window or the other's: on Node 22, a young-generation collection fell
 * inside 90-96% of the large passes against 3-7% of the small ones, and which
 * form's best pass escaped it followed the collector's schedule. That error is
 * correlated within a run, heavy-tailed, and can favour either form; more
 * rounds, a median, a `gc()` first or a wider bound only move where it lands.
 * The copies (70 of them) were also most of the test's run time, enough to
 * cross the 5 s default once. A count has no such floor: it reads the same on
 * a quiet laptop and on a loaded runner under coverage. And it needs no copy:
 * each form gets a SPREAD of the recording, a new object for both memos to key
 * on (see the calibration).
 *
 * ── WHAT IS COUNTED ────────────────────────────────────────────────────────
 * The recording's preparation, wrapped at `footprintjs/trace`, the barrel
 * `src` imports them from (footprintjs's calls to its own functions do not
 * pass through it and are not counted):
 * - `stateAt` — a FOLD BASE BUILT. `keyedFold.ts` · `keyedFold` calls it once
 *   per fold source and memoizes the fold on that object; a question that
 *   rebuilt the fold would clone the run's initial state again.
 * - `splitStageId` — a LOG POSITION WALKED. `epochs.ts` · `locate` parses one
 *   stage id per bundle (and one per `subflowResults` mount key) to find the
 *   calls; a question that relocated the epochs would walk the whole log again.
 * Each epoch's view, wrapped at `epochs.ts`, the module `servedView.ts`
 * imports them from:
 * - `readAtCall`, `readAfterCall`, `readRunConstant` — a PIECE READ.
 *   `servedView.ts` · `viewOf` reads every piece it rebuilds through these
 *   three, so a question that built views it was not asked for reads more
 *   pieces than the batch does.
 * Either way `src` runs untouched.
 *
 * NEITHER HALF GUARDS THE OTHER. With only the preparation counted, a
 * `servedAt` that answered one epoch by building every view
 * (`servedViews(source).find(...)`) passed: both memos still hit, so the
 * preparation counts stayed equal, while the scrub read E times the batch's
 * pieces — 1,859 `readAtCall`s against 143 at 13 epochs, a factor that grows
 * with the run. The timed test this file replaced caught that one; the count
 * has to as well.
 *
 * ── WHAT IS NOT COUNTED, AND WHY THAT IS HONEST ────────────────────────────
 * `epochs.ts` · `epochAt` finds the asked epoch among the LOCATED ones with a
 * linear `.find`: one number comparison per located epoch, E(E+1)/2 across a
 * whole scrub. It is the only work the scrub does that the batch does not. It
 * walks no log position, builds no fold and reads no piece, and the batch's
 * own answer is already quadratic in the run (E conversations averaging E/2
 * turns each), so it is a constant fraction of the batch rather than a factor
 * that grows.
 *
 * The counters see work only through the operations it calls. A question that
 * walked the whole log calling none of them — parsing each id with
 * `parseRuntimeStageId` instead of `splitStageId`, say — would pass this file.
 * Seeing every walk, whatever it calls, would take a count of log entries
 * READ rather than of named operations.
 *
 * ── THE CALIBRATION ────────────────────────────────────────────────────────
 * A counter that cannot see the defect proves nothing by staying equal. So the
 * same test asks two shapes that each redo ONE half per question, and requires
 * each to count exactly that:
 * - A fresh recording OBJECT per question — the shape 9.88.0 replaced. A
 *   spread, not a copy, defeats both memos, which key on that object, so every
 *   question prepares the recording again: the scrub plus one whole
 *   preparation for each of the other E - 1 questions. Today that is E times
 *   the batch on the preparation counters, and the batch's own reads.
 * - Every view built per question, on ONE recording: the preparation once, and
 *   the batch's view work (the batch minus the preparation) E times. Today
 *   that is the batch's preparation, and E times its reads.
 * Each factor grows with the run, and each is seen by its own half of the
 * instrument and by nothing else. The runs use `reactMode: 'dynamic'`, where
 * the fold source IS the recording, which is what makes a spread cold for
 * both memos. Under `'dynamic-grouped'` each turn folds its own subtree, which
 * a spread shares, so none of this would hold as written.
 *
 * The structural half needs no counter at all: `epochLocations` returns the
 * very same array for the same recording, checked by identity.
 *
 * Test types (Convention 3): performance/regression.
 */

import { describe, expect, it, vi } from 'vitest';
import { Agent, defineTool, epochLocations, servedAt, servedViews } from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

/** The operations a scrub's work is made of — see the header — and the
 *  wrapper that counts one. Hoisted, so the (hoisted) mock factories below can
 *  reach both. */
const { counted, counting } = vi.hoisted(() => {
  const counted = {
    // The recording's preparation.
    stateAt: 0,
    splitStageId: 0,
    // Each epoch's view.
    readAtCall: 0,
    readAfterCall: 0,
    readRunConstant: 0,
  };
  /** `fn` itself, plus one on `counted[name]` per call. */
  const counting = <F extends (...args: any[]) => any>(name: keyof typeof counted, fn: F): F =>
    ((...args: Parameters<F>): ReturnType<F> => {
      counted[name] += 1;
      return fn(...args);
    }) as F;
  return { counted, counting };
});

vi.mock('footprintjs/trace', async (importOriginal) => {
  const real = await importOriginal<typeof import('footprintjs/trace')>();
  return {
    ...real,
    stateAt: counting('stateAt', real.stateAt),
    splitStageId: counting('splitStageId', real.splitStageId),
  };
});

vi.mock('../../../src/lib/time-travel/epochs.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/lib/time-travel/epochs.js')>();
  return {
    ...real,
    readAtCall: counting('readAtCall', real.readAtCall),
    readAfterCall: counting('readAfterCall', real.readAfterCall),
    readRunConstant: counting('readRunConstant', real.readRunConstant),
  };
});

type Snapshot = NonNullable<ReturnType<Agent['getSnapshot']>>;
type Counter = keyof typeof counted;
type Counts = Readonly<Record<Counter, number>>;
const COUNTERS = Object.keys(counted) as Counter[];

/** A provider that calls one tool `turns` times and then answers. */
function looping(turns: number) {
  let i = 0;
  return {
    name: 'complexity-mock',
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
      i += 1;
      return i <= turns
        ? {
            content: '',
            toolCalls: [{ id: `c${i}`, name: 'ping', args: {} }],
            usage: { input: 0, output: 0 },
          }
        : { content: 'done', toolCalls: [], usage: { input: 0, output: 0 } };
    },
  };
}

const ping = defineTool({ name: 'ping', description: 'ping', execute: () => 'pong' });

async function runOf(turns: number): Promise<Snapshot> {
  const agent = Agent.create({
    provider: looping(turns) as never,
    model: 'mock',
    maxIterations: turns + 4,
    // The fold source IS the recording here, so a spread is cold — see the
    // header's last note.
    reactMode: 'dynamic',
  })
    .system('you are a bot')
    .tool(ping)
    .build();
  await agent.run({ message: 'go' });
  return agent.getSnapshot()!;
}

/** How many of each counted operation `work` performed. */
function countOf(work: () => void): Counts {
  for (const name of COUNTERS) counted[name] = 0;
  work();
  return { ...counted };
}

/** `base + times × each`, counter by counter. */
function plusTimes(base: Counts, times: number, each: Counts): Counts {
  return Object.fromEntries(COUNTERS.map((n) => [n, base[n] + times * each[n]])) as Counts;
}

/** `from - less`, counter by counter. */
function minus(from: Counts, less: Counts): Counts {
  return Object.fromEntries(COUNTERS.map((n) => [n, from[n] - less[n]])) as Counts;
}

/**
 * The batch form, the scrub and the two calibration shapes, counted on one
 * run — and the recording's PREPARATION on its own, which the first
 * calibration repeats.
 *
 * Every form gets its own NEW recording object — a spread — because the epoch
 * memo and the fold memo both key on that object: a form that shared one would
 * be reading another form's memo and prove nothing.
 */
function countTheForms(snapshot: Snapshot) {
  // Asked of the live snapshot, so it warms that object's memos and nobody
  // else's.
  const epochs = epochLocations(snapshot).map((e) => e.epoch);
  return {
    epochs: epochs.length,
    // Locating the epochs of a NEW recording object, which builds its fold
    // base on the way: the work that belongs to a recording, not to a question.
    prepare: countOf(() => void epochLocations({ ...snapshot })),
    batch: countOf(() => void servedViews({ ...snapshot })),
    scrub: countOf(() => {
      const recording = { ...snapshot };
      for (const epoch of epochs) servedAt(recording, epoch);
    }),
    // A NEW recording object per question: neither memo ever hits, so every
    // question prepares the recording from scratch — and builds one view.
    eachPrepared: countOf(() => {
      for (const epoch of epochs) servedAt({ ...snapshot }, epoch);
    }),
    // ONE recording, every view built per question: both memos hit after the
    // first question, and every question builds all E views.
    eachViewed: countOf(() => {
      const recording = { ...snapshot };
      for (const epoch of epochs) servedViews(recording).find((v) => v.epoch === epoch);
    }),
  };
}

describe('locating an epoch', () => {
  it('is done ONCE per recording, not once per servedAt call', async () => {
    const snapshot = await runOf(6);
    // Identity, so this is a fact about the implementation and not about a
    // clock: the second ask returns the very array the first one built.
    expect(epochLocations(snapshot)).toBe(epochLocations(snapshot));
    // A different recording object is a different question, and gets its own
    // pass — the memo is not a global cache keyed on shape.
    const travelled = JSON.parse(JSON.stringify(snapshot)) as Snapshot;
    expect(epochLocations(travelled)).not.toBe(epochLocations(snapshot));
    expect(epochLocations(travelled).map((e) => e.epoch)).toEqual(
      epochLocations(snapshot).map((e) => e.epoch),
    );
  });
});

describe('a per-epoch scrub', () => {
  it('does the same counted work as the batch form, at 13 and at 49 epochs', async () => {
    const small = await runOf(12);
    const large = await runOf(48);

    // The runs really are ~4x apart, or "at both sizes" means nothing.
    const ratioOfSize = large.commitLog.length / small.commitLog.length;
    expect(ratioOfSize).toBeGreaterThan(3);
    expect(ratioOfSize).toBeLessThan(5);
    const forms = [countTheForms(small), countTheForms(large)];
    expect(forms[1]!.epochs).toBeGreaterThan(forms[0]!.epochs * 3);

    for (const { epochs, prepare, batch, scrub, eachPrepared, eachViewed } of forms) {
      const at = `at ${epochs} epochs`;
      // What the batch does beyond preparing the recording: its E views.
      const views = minus(batch, prepare);

      // The counters are wired: preparing a recording moves the preparation
      // counters, and building the views moves every read counter. A mock that
      // never fired would make every comparison below an equality of zeros.
      expect(prepare.stateAt, `fold bases built preparing a recording ${at}`).toBeGreaterThan(0);
      expect(
        prepare.splitStageId,
        `log positions walked preparing a recording ${at}`,
      ).toBeGreaterThan(0);
      for (const read of ['readAtCall', 'readAfterCall', 'readRunConstant'] as const) {
        expect(views[read], `${read} building the views ${at}`).toBeGreaterThan(0);
      }

      // THE LAW. Not "within 2x" — the same. The epoch index is located once
      // per recording, each log's fold base is built once, and each epoch's
      // view is built once, after which both forms ask the same questions of
      // the same folds in the same order. A scrub that counts more than the
      // batch is rebuilding something per question: exactly the defect, at
      // its smallest.
      expect(scrub, `the scrub against the batch ${at}`).toEqual(batch);

      // THE CALIBRATION, one shape per half. A recording prepared again for
      // every question pays E - 1 preparations more than the scrub: E times
      // the batch on the preparation counters, the batch's reads.
      expect(eachPrepared, `a recording prepared per question ${at}`).toEqual(
        plusTimes(scrub, epochs - 1, prepare),
      );
      // Every view built for every question pays one preparation and the
      // batch's view work E times: the batch's preparation, E times its reads.
      expect(eachViewed, `every view built per question ${at}`).toEqual(
        plusTimes(prepare, epochs, views),
      );
    }
  });
});
