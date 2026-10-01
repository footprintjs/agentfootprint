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
 * The defect was a COUNT before it was a cost: work that belongs to the
 * recording — locating the epochs, preparing the fold — was redone for every
 * question. So this file counts the two operations that work is made of, at
 * the module boundary the code reaches them through, and requires the scrub to
 * perform as many of each as the batch does — the same number, at 13 epochs
 * and at 49.
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
 * a quiet laptop and on a loaded runner under coverage.
 *
 * ── WHAT IS COUNTED ────────────────────────────────────────────────────────
 * - `stateAt` — a FOLD BASE BUILT. `keyedFold.ts` · `keyedFold` calls it once
 *   per fold source and memoizes the fold on that object; a question that
 *   rebuilt the fold would clone the run's initial state again.
 * - `splitStageId` — a LOG POSITION WALKED. `epochs.ts` · `locate` parses one
 *   stage id per bundle (and one per `subflowResults` mount key) to find the
 *   calls; a question that relocated the epochs would walk the whole log again.
 * Both are wrapped at `footprintjs/trace`, the barrel `src` imports them from,
 * so `src` is measured untouched. footprintjs's calls to its own functions do
 * not pass through that barrel and are not counted.
 *
 * ── WHAT IS NOT COUNTED, AND WHY THAT IS HONEST ────────────────────────────
 * `epochs.ts` · `epochAt` finds the asked epoch among the LOCATED ones with a
 * linear `.find`: one number comparison per located epoch, E(E+1)/2 across a
 * whole scrub. It is the only work the scrub does that the batch does not. It
 * walks no log position and builds no fold, and the batch's own answer is
 * already quadratic in the run (E conversations averaging E/2 turns each), so
 * it is a constant fraction of the batch rather than a factor that grows.
 *
 * ── THE CALIBRATION ────────────────────────────────────────────────────────
 * A counter that cannot see the defect proves nothing by staying equal. So the
 * same test asks the shape this release replaced: a fresh recording OBJECT per
 * question (a spread, not a copy) defeats both memos, which key on that object,
 * so every question relocates every epoch and builds its own fold base. It must
 * read the scrub's count plus one whole preparation (locate the epochs, build
 * the fold base) for each of the other E - 1 questions — today exactly E times
 * the batch on both counters: the factor that grows with the run, seen by the
 * instrument that guards against it. (The runs below use the default
 * `reactMode: 'dynamic'`, where the fold source IS the recording. Under
 * `'dynamic-grouped'` each turn folds its own subtree, which a spread shares,
 * so this calibration would not hold there as written.)
 *
 * The structural half needs no counter at all: `epochLocations` returns the
 * very same array for the same recording, checked by identity.
 *
 * Test types (Convention 3): performance/regression.
 */

import { describe, expect, it, vi } from 'vitest';
import { Agent, defineTool, epochLocations, servedAt, servedViews } from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

/** The two operations the defect multiplied — see the header. Held in a
 *  hoisted cell so the (hoisted) mock factory below can reach it. */
const counted = vi.hoisted(() => ({ stateAt: 0, splitStageId: 0 }));

vi.mock('footprintjs/trace', async (importOriginal) => {
  const real = await importOriginal<typeof import('footprintjs/trace')>();
  return {
    ...real,
    stateAt: ((...args: Parameters<typeof real.stateAt>) => {
      counted.stateAt += 1;
      return real.stateAt(...args);
    }) as typeof real.stateAt,
    splitStageId: ((...args: Parameters<typeof real.splitStageId>) => {
      counted.splitStageId += 1;
      return real.splitStageId(...args);
    }) as typeof real.splitStageId,
  };
});

type Snapshot = NonNullable<ReturnType<Agent['getSnapshot']>>;
type Counts = { readonly stateAt: number; readonly splitStageId: number };

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
  })
    .system('you are a bot')
    .tool(ping)
    .build();
  await agent.run({ message: 'go' });
  return agent.getSnapshot()!;
}

/** How many of each counted operation `work` performed. */
function countOf(work: () => void): Counts {
  counted.stateAt = 0;
  counted.splitStageId = 0;
  work();
  return { stateAt: counted.stateAt, splitStageId: counted.splitStageId };
}

/**
 * A detached copy, because the epoch memo and the fold memo both key on the
 * recording OBJECT: each form gets its own, or the second form counted would
 * be reading the first one's memo and prove nothing. One per form — the
 * replaced shape below needs none.
 */
function coldCopyOf(snapshot: Snapshot): Snapshot {
  return JSON.parse(JSON.stringify(snapshot)) as Snapshot;
}

/**
 * The batch form, the scrub and the replaced shape, counted on one run — and
 * the recording's PREPARATION on its own, which is what the replaced shape
 * repeats.
 */
function countTheForms(snapshot: Snapshot) {
  // Asked of the live snapshot, so it warms that object's memos and nobody
  // else's.
  const epochs = epochLocations(snapshot).map((e) => e.epoch);
  const forBatch = coldCopyOf(snapshot);
  const forScrub = coldCopyOf(snapshot);
  return {
    epochs: epochs.length,
    // Locating the epochs of a NEW recording object, which builds its fold
    // base on the way: the work that belongs to a recording, not to a question.
    prepare: countOf(() => void epochLocations({ ...snapshot })),
    batch: countOf(() => void servedViews(forBatch)),
    scrub: countOf(() => {
      for (const epoch of epochs) servedAt(forScrub, epoch);
    }),
    // A NEW recording object per question: nothing is copied, and neither memo
    // ever hits — every question prepares the recording from scratch.
    rebuilt: countOf(() => {
      for (const epoch of epochs) servedAt({ ...snapshot }, epoch);
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

    for (const { epochs, prepare, batch, scrub, rebuilt } of forms) {
      const at = `at ${epochs} epochs`;

      // The counters are wired, and preparing a recording moves both. A mock
      // that never fired would make every comparison below an equality of
      // zeros.
      expect(prepare.stateAt, `fold bases built preparing a recording ${at}`).toBeGreaterThan(0);
      expect(
        prepare.splitStageId,
        `log positions walked preparing a recording ${at}`,
      ).toBeGreaterThan(0);

      // THE LAW. Not "within 2x" — the same. The epoch index is located once
      // per recording and each log's fold base is built once, after which both
      // forms ask the same questions of the same folds in the same order, so a
      // scrub that counts more than the batch is rebuilding something per
      // question: exactly the defect, at its smallest.
      expect(scrub, `the scrub against the batch ${at}`).toEqual(batch);

      // THE CALIBRATION. The replaced shape prepares the recording again for
      // every question, where the scrub prepares it once: E - 1 preparations
      // more, a count that grows with the run, and the instrument reads
      // exactly that. (Today a view itself counts nothing, so this is also E
      // times the batch: 49 fold bases where the scrub builds 1.)
      expect(rebuilt, `a rebuild per question ${at}`).toEqual({
        stateAt: scrub.stateAt + (epochs - 1) * prepare.stateAt,
        splitStageId: scrub.splitStageId + (epochs - 1) * prepare.splitStageId,
      });
    }
  });
});
