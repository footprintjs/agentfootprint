/**
 * The per-epoch scrub costs a CONSTANT factor over the batch form, at any
 * recording size.
 *
 * A reader's UI does not call `servedViews(snapshot)` once. It holds the
 * snapshot and asks for ONE epoch at a time as a person drags a scrubber —
 * `servedAt(snapshot, k)`, over and over. Before 9.88.0 that shape relocated
 * every epoch on every call and re-scanned the log for the iteration number
 * once per bundle: the scrub cost E times the batch form, and that factor grew
 * with E. Measured on a 600-turn run it took 20.8 s, about 35x the batch form
 * at half the length — the difference between a scrubber and a spinner.
 *
 * ── WHY THE GUARD IS A RATIO, NOT A GROWTH CURVE ───────────────────────────
 * Both forms are superlinear in the RUN, and honestly so: a scrub of E epochs
 * hands back E conversations whose average length is E/2, so the ANSWER is
 * quadratic in size before anybody writes any code. Timing 4x the commits and
 * demanding under 4x the time would fail a perfect implementation.
 *
 * The defect was never the size of the answer. It was that asking one epoch at
 * a time cost a FACTOR OF E more than asking for all of them, because the epoch
 * index was rebuilt per question. That factor is what this guards, measured the
 * only way it is meaningful: the same work, both ways, at two sizes, requiring
 * the ratio to stay flat as the run grows. A ratio is also immune to the
 * machine, which a millisecond budget is not.
 *
 * The structural half needs no clock at all: `epochLocations` returns the very
 * same array for the same recording, checked by identity.
 *
 * Test types (Convention 3): performance/regression.
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool, epochLocations, servedAt, servedViews } from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

type Snapshot = NonNullable<ReturnType<Agent['getSnapshot']>>;

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

/**
 * Best-of-N milliseconds for one COLD pass of `work` over a fresh copy of the
 * recording.
 *
 * A detached copy per pass, because the epoch memo and the per-key fold cache
 * both key on the recording OBJECT: timing the same object twice would measure
 * the cache and prove nothing. Cloning happens outside the timed region.
 */
function coldMs(snapshot: Snapshot, work: (cold: Snapshot) => void, passes = 5): number {
  let best = Infinity;
  for (let p = 0; p < passes; p++) {
    const cold = JSON.parse(JSON.stringify(snapshot)) as Snapshot;
    const started = performance.now();
    work(cold);
    best = Math.min(best, performance.now() - started);
  }
  return Math.max(best, 0.05);
}

/** How much more one-at-a-time costs than all-at-once, on one recording. */
function scrubOverBatch(snapshot: Snapshot): number {
  const epochs = servedViews(snapshot).map((v) => v.epoch);
  const batch = coldMs(snapshot, (cold) => void servedViews(cold));
  const scrub = coldMs(snapshot, (cold) => {
    for (const epoch of epochs) servedAt(cold, epoch);
  });
  return scrub / batch;
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
  it('stays a constant factor over the batch form as the recording grows 4x', async () => {
    const small = await runOf(12);
    const large = await runOf(48);

    // The runs really are ~4x apart, or the comparison below means nothing.
    const ratioOfSize = large.commitLog.length / small.commitLog.length;
    expect(ratioOfSize).toBeGreaterThan(3);
    expect(ratioOfSize).toBeLessThan(5);
    const smallEpochs = servedViews(small).length;
    const largeEpochs = servedViews(large).length;
    expect(largeEpochs).toBeGreaterThan(smallEpochs * 3);

    // Warm the module before anything is timed.
    scrubOverBatch(small);

    const smallOverhead = scrubOverBatch(small);
    const largeOverhead = scrubOverBatch(large);

    // THE DISCRIMINATING CLAUSE. Measured against the shape this release
    // replaced — the epoch index rebuilt per question, every read a full scan
    // of the log — the overhead was 2.4x at 13 epochs and 3.7x at 49, climbing
    // to 5.0x at 97. With the index built once and the fold resumed forward it
    // is 1.0-1.1x at every size, because the scrub does the same work the batch
    // does, once. The bound sits between the two with room on both sides.
    expect(
      smallOverhead,
      `small: scrub cost ${smallOverhead.toFixed(2)}x the batch form at ${smallEpochs} epochs`,
    ).toBeLessThan(2);
    expect(
      largeOverhead,
      `large: scrub cost ${largeOverhead.toFixed(2)}x the batch form at ${largeEpochs} epochs`,
    ).toBeLessThan(2);

    // …and the overhead must not GROW with the run, which is the superlinearity
    // itself: an index rebuilt per question costs a factor proportional to the
    // epoch count, so a 4x longer run pays a bigger multiple. Built once, the
    // two ratios are the same number.
    const drift = largeOverhead / smallOverhead;
    expect(
      drift,
      `overhead drifted ${drift.toFixed(2)}x from ${smallEpochs} to ${largeEpochs} epochs`,
    ).toBeLessThan(1.6);
  });
});
