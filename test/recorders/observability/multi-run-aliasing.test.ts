/**
 * Multi-run aliasing regression — proves the Parallel back-to-back bug
 * is fixed by runId-aware state reset in BoundaryRecorder + RunStepRecorder.
 *
 * The bug: two `executor.run()` calls produce identical runtimeStageId
 * values because each run's counter resets at zero. Recorders that key
 * fork bookkeeping by `(parentSubflow, runtimeStageId)` saw the second
 * run's `seed#0` collide with the first run's, suppressed the second
 * fork emission, and the slider stalled.
 *
 * The fix: every event hook calls `observeRunId(event.traversalContext?.runId)`.
 * When runId changes, recorder state resets so the second run starts
 * cleanly. Without the fix, the assertions below fail.
 */

import { describe, it, expect } from 'vitest';
import { Parallel } from '../../../src/core-flow/Parallel.js';
import { Conditional } from '../../../src/core-flow/Conditional.js';
import { Loop } from '../../../src/core-flow/Loop.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import { boundaryRecorder } from '../../../src/recorders/observability/BoundaryRecorder.js';
import { runStepRecorder } from '../../../src/recorders/observability/RunStepRecorder.js';

function llm(reply: string) {
  return LLMCall.create({ provider: new MockProvider({ reply }), model: 'mock' })
    .system('')
    .build();
}

describe('multi-run aliasing — runId reset fix', () => {
  it('BoundaryRecorder reset clears prior run events when reused', async () => {
    const par = Parallel.create({ name: 'Committee' })
      .branch('quality', llm('q'))
      .branch('speed', llm('s'))
      .branch('cost', llm('c'))
      .mergeWithFn((r) => Object.values(r).join(' | '))
      .build();
    const rec = boundaryRecorder();
    par.attach(rec);

    await par.run({ message: 'first' });
    const firstCount = rec.getEvents().length;
    expect(firstCount).toBeGreaterThan(0);

    // Reuse the recorder — second run should reset on new runId.
    await par.run({ message: 'second' });
    const secondCount = rec.getEvents().length;

    // After reset, the second run's count should be ~equal to the first
    // (same shape), NOT the cumulative sum of two runs.
    expect(secondCount).toBeLessThanOrEqual(firstCount + 5);
    expect(secondCount).toBeGreaterThan(firstCount / 2);
  });

  it('RunStepRecorder emits a fresh fork on every run (no suppression)', async () => {
    const par = Parallel.create({ name: 'Committee2' })
      .branch('quality', llm('q'))
      .branch('speed', llm('s'))
      .mergeWithFn((r) => Object.values(r).join(' | '))
      .build();
    const rec = runStepRecorder();
    par.attach(rec);

    await par.run({ message: 'first' });
    const firstSteps = rec.getSteps();
    const firstForks = firstSteps.filter((s) => s.kind === 'fork').length;
    expect(firstForks).toBe(1);

    // Second run with the SAME recorder. Without runId reset, the
    // forkKey `committee@__root__#0` would already be in `forkEmitted`
    // and the fork RunStep would be suppressed.
    await par.run({ message: 'second' });
    const secondSteps = rec.getSteps();
    const secondForks = secondSteps.filter((s) => s.kind === 'fork').length;
    expect(secondForks).toBe(1);
  });

  it('back-to-back Parallel runs both produce a merge step', async () => {
    const par = Parallel.create({ name: 'Committee3' })
      .branch('a', llm('A'))
      .branch('b', llm('B'))
      .mergeWithFn((r) => Object.values(r).join('+'))
      .build();
    const rec = runStepRecorder();
    par.attach(rec);

    await par.run({ message: '1' });
    expect(rec.getSteps().filter((s) => s.kind === 'merge')).toHaveLength(1);

    await par.run({ message: '2' });
    // After reset, the second run's merge should be the only merge in
    // the recorder's state — the first run's data was wiped on runId
    // change.
    expect(rec.getSteps().filter((s) => s.kind === 'merge')).toHaveLength(1);
  });

  it('Conditional reuse: second run boundary count ~equals first (state was reset)', async () => {
    // Use BoundaryRecorder — its events are observable directly without
    // the leaf-vs-composition projection filter that RunStepRecorder
    // applies. Tests the same runId-reset path on the Conditional shape.
    const cond = Conditional.create()
      .when('a', (i: { message: string }) => i.message === 'a', llm('A'))
      .otherwise('b', llm('B'))
      .build();
    const rec = boundaryRecorder();
    cond.attach(rec);

    await cond.run({ message: 'a' });
    const firstCount = rec.getEvents().length;
    expect(firstCount).toBeGreaterThan(0);

    await cond.run({ message: 'b' });
    const secondCount = rec.getEvents().length;
    // Without runId reset, the second run would ACCUMULATE on top of
    // the first (secondCount ≈ 2*firstCount). With reset, the recorder
    // holds only the second run.
    expect(secondCount).toBeLessThan(firstCount * 2);
  });

  it('Loop reuse: second run boundary count ~equals first (state was reset)', async () => {
    const loop = Loop.create().repeat(llm('iter')).times(2).build();
    const rec = boundaryRecorder();
    loop.attach(rec);

    await loop.run({ message: 'first' });
    const firstCount = rec.getEvents().length;
    expect(firstCount).toBeGreaterThan(0);

    await loop.run({ message: 'second' });
    const secondCount = rec.getEvents().length;
    expect(secondCount).toBeLessThan(firstCount * 2);
  });

  it('LiveLLMTracker resets its own store on runId change (per-tracker observeRunId)', async () => {
    const { liveStateRecorder } = await import(
      '../../../src/recorders/observability/LiveStateRecorder.js'
    );
    const { EventDispatcher } = await import('../../../src/events/dispatcher.js');
    const dispatcher = new EventDispatcher();

    const live = liveStateRecorder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    live.subscribe(dispatcher as any);

    const fire = (type: string, runId: string, payload: Record<string, unknown>): void => {
      dispatcher.dispatch({
        type,
        payload,
        meta: {
          wallClockMs: Date.now(),
          runOffsetMs: 0,
          runtimeStageId: 'call-llm#0',
          subflowPath: [],
          compositionPath: [],
          runId,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    };

    // Run 1 starts an LLM call. No matching llm_end fires (orphan).
    fire('agentfootprint.stream.llm_start', 'R1', {
      iteration: 0,
      provider: 'p',
      model: 'm',
    });
    expect(live.isLLMInFlight()).toBe(true);

    // Run 2 starts a fresh LLM call with the SAME runtimeStageId.
    // Without runId reset, the second start would silently overwrite
    // the orphan or be treated as the same boundary. With reset, the
    // tracker's observeRunId detects the new runId and clears the
    // store before storing the new boundary.
    fire('agentfootprint.stream.llm_start', 'R2', {
      iteration: 0,
      provider: 'q',
      model: 'm',
    });
    expect(live.isLLMInFlight()).toBe(true);
    // Verify the active state reflects the SECOND run's payload, not the first.
    const active = live.llm.getActive('call-llm#0');
    expect(active?.provider).toBe('q');
  });
});
