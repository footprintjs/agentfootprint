/**
 * recordRun — the producer for `{ snapshot, events, structure }`, and the
 * commit axis that every blessed observability entry point used to lose.
 *
 * Two things are under test here, and they are the same thing seen from
 * two sides:
 *
 *   1. A recording is THREE fields. `recordRun()` produces all three; a
 *      snapshot alone cannot draw a chart, and a finished run cannot
 *      produce one afterwards.
 *   2. The boundary recorder needs three connections — attach, subscribe,
 *      and a live commit count. The third failed SILENTLY: `enable.flowchart()`
 *      and `enable.localObservability()` built their recorder with no
 *      options, so every boundary in every run recorded through them was
 *      stamped `commitIdxBefore: 0` and the step strip could not be rebuilt.
 *
 * FAILS ON THE OLD BEHAVIOR:
 *   - "distinct non-zero commit indices" — every index was 0.
 *   - "boundaryIndex is populated" — the index was deliberately left empty
 *     in the no-commit-tracking mode the runner was silently in.
 *   - every `recordRun` case — the function did not exist.
 *   - "runner.getCommitCount()" — the accessor was prose in two JSDoc
 *     blocks and implemented nowhere.
 *
 * Sections:
 *   1. unit         — the accessor, the three fields, the wiring
 *   2. functional   — a recording survives JSON and still names its parts
 *   3. integration  — a two-subflow run through enable.flowchart()
 *   4. security     — a lean recording is detectable, and carries no content
 *   5. load         — the event cap bounds a long-running recorder
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../../src/core/Agent.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import { recordRun } from '../../../src/recorders/observability/recordRun.js';
import type { DomainEvent } from '../../../src/recorders/observability/BoundaryRecorder.js';

function llm(reply: string) {
  return LLMCall.create({ provider: new MockProvider({ reply }), model: 'mock' })
    .system('be brief')
    .build();
}

function agent(reply: string) {
  return Agent.create({ provider: new MockProvider({ reply }), model: 'mock' })
    .system('be brief')
    .build();
}

/** A two-subflow run: one Sequence mounting two LLMCall charts. */
function twoSubflowPipeline() {
  return Sequence.create({ name: 'intake' })
    .step('classify', llm('billing'))
    .pipeVia((label) => ({ message: `Intent: ${label.trim()}` }))
    .step('respond', llm('on it'))
    .build();
}

// ─── 1. UNIT ────────────────────────────────────────────────────────

describe('recordRun — unit', () => {
  it('runner.getCommitCount() reports the run’s commit total', async () => {
    const runner = agent('done');
    expect(runner.getCommitCount()).toBe(0); // nothing has run

    await runner.run({ message: 'hi' });

    const commits = runner.getLastSnapshot()?.commitLog.length ?? 0;
    expect(commits).toBeGreaterThan(0);
    expect(runner.getCommitCount()).toBe(commits);
  });

  it('a recording carries all three fields', async () => {
    const runner = agent('done');
    const rec = recordRun(runner);
    await runner.run({ message: 'hi' });
    const recording = rec.toRecording();
    rec.stop();

    expect(recording.snapshot).toBeDefined();
    expect(recording.events.length).toBeGreaterThan(0);
    // The chart. No snapshot carries it, so this is the field that used to
    // go missing from every hand-assembled bundle.
    expect(recording.structure).toBeDefined();
    expect(recording.structure).toBe(
      (runner.getSpec() as { buildTimeStructure?: unknown }).buildTimeStructure,
    );
  });

  it('wires the boundary recorder’s typed half — llm events reach it', async () => {
    const runner = agent('done');
    const rec = recordRun(runner);
    await runner.run({ message: 'hi' });

    const types = new Set(rec.boundary.getEvents().map((e) => e.type));
    rec.stop();

    // attach → boundaries; subscribe → what happened inside them.
    expect(types.has('run.entry')).toBe(true);
    expect(types.has('llm.start')).toBe(true);
    expect(types.has('llm.end')).toBe(true);
  });

  it('stop() is idempotent and leaves the captured events readable', async () => {
    const runner = agent('done');
    const rec = recordRun(runner);
    await runner.run({ message: 'hi' });

    const before = rec.eventCount;
    rec.stop();
    rec.stop();

    expect(rec.eventCount).toBe(before);
    expect(rec.toRecording().events).toHaveLength(before);
  });

  it('stop() detaches — a later run is not recorded', async () => {
    const runner = agent('done');
    const rec = recordRun(runner);
    await runner.run({ message: 'first' });
    const afterFirst = rec.eventCount;
    rec.stop();

    await runner.run({ message: 'second' });
    expect(rec.eventCount).toBe(afterFirst);
  });

  it('toRecording() hands back a detached copy of the timeline', async () => {
    const runner = agent('done');
    const rec = recordRun(runner);
    await runner.run({ message: 'one' });
    const first = rec.toRecording();
    const frozenLength = first.events.length;

    await runner.run({ message: 'two' });
    rec.stop();

    expect(first.events).toHaveLength(frozenLength); // did not grow behind us
    expect(rec.eventCount).toBeGreaterThan(frozenLength);
  });
});

// ─── 2. FUNCTIONAL ──────────────────────────────────────────────────

describe('recordRun — functional', () => {
  it('a recording survives JSON with all three fields intact', async () => {
    const runner = agent('done');
    const rec = recordRun(runner);
    await runner.run({ message: 'hi' });
    const json = JSON.stringify(rec.toRecording());
    rec.stop();

    const reloaded = JSON.parse(json) as {
      snapshot?: { commitLog?: unknown[]; recorders?: { name?: string }[] };
      events?: unknown[];
      structure?: unknown;
    };
    expect(reloaded.structure).toBeDefined();
    expect(reloaded.events!.length).toBeGreaterThan(0);
    expect(reloaded.snapshot!.commitLog!.length).toBeGreaterThan(0);
    // The boundary log rides the snapshot — it is what the step strip is
    // rebuilt from, and it has to survive the trip to disk.
    expect(reloaded.snapshot!.recorders!.some((r) => r.name === 'BoundaryEvents')).toBe(true);
  });

  it('records nothing extra: no narrative / metrics unless the consumer attached them', async () => {
    const runner = agent('done');
    const rec = recordRun(runner);
    await runner.run({ message: 'hi' });
    const names = (
      rec.toRecording().snapshot as { recorders?: { name?: string }[] }
    ).recorders!.map((r) => r.name);
    rec.stop();

    expect(names).toContain('BoundaryEvents');
    expect(names).not.toContain('Metrics');
  });
});

// ─── 3. INTEGRATION ─────────────────────────────────────────────────

describe('the commit axis through the blessed entry points — integration', () => {
  it('enable.flowchart(): a two-subflow run stamps DISTINCT non-zero commit indices', async () => {
    const pipeline = twoSubflowPipeline();
    const handle = pipeline.enable.flowchart();

    await pipeline.run({ message: 'my invoice has an error' });

    const entries = handle.boundary
      .getEvents()
      .filter((e): e is DomainEvent & { type: 'subflow.entry' } => e.type === 'subflow.entry');
    handle.unsubscribe();

    expect(entries.length).toBeGreaterThanOrEqual(2); // two mounted charts

    const indices = entries.map((e) => e.commitIdxBefore);
    // OLD BEHAVIOR: every one of these was 0 — attachFlowchart built its
    // BoundaryRecorder with no options, so getCommitCount was undefined.
    expect(indices.some((i) => i > 0)).toBe(true);
    expect(new Set(indices).size).toBeGreaterThan(1); // an axis, not a point
    // Monotonic: a later boundary never opens before an earlier one.
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
  });

  it('enable.flowchart(): the boundary index is populated, so the strip has ranges', async () => {
    const pipeline = twoSubflowPipeline();
    const handle = pipeline.enable.flowchart();
    await pipeline.run({ message: 'hi' });

    // OLD BEHAVIOR: with no commit tracking the index is deliberately left
    // EMPTY (zero-width [0,0] ranges would read as real), so this was 0.
    expect(handle.boundary.boundaryIndex.size).toBeGreaterThan(0);
    handle.unsubscribe();
  });

  it('enable.localObservability({ includeSnapshot }): the Trace carries the run’s snapshot', async () => {
    const runner = agent('done');
    const dev = runner.enable.localObservability({ includeSnapshot: true });
    await runner.run({ message: 'hi' });

    const trace = dev.getTrace();
    dev.unsubscribe();

    expect(trace.structure).toBeDefined();
    // OLD BEHAVIOR: a Trace had events + structure and no footprintjs
    // snapshot, so it could never drive the commit axis or the memory panel.
    const snapshot = trace.snapshot as { commitLog?: unknown[] } | undefined;
    expect(snapshot?.commitLog?.length).toBeGreaterThan(0);
  });

  it('the snapshot stays OUT unless asked for — `redact` cannot reach inside one', async () => {
    const runner = agent('done');
    const dev = runner.enable.localObservability();
    await runner.run({ message: 'hi' });
    const trace = dev.getTrace();
    dev.unsubscribe();

    expect(trace.snapshot).toBeUndefined();
    expect(trace.structure).toBeDefined(); // the chart still rides along
  });

  it('enable.localObservability(): its boundaries carry the axis too', async () => {
    const pipeline = twoSubflowPipeline();
    const dev = pipeline.enable.localObservability();
    await pipeline.run({ message: 'hi' });

    const stamped = dev.boundary.getEvents().filter((e) => e.commitIdxBefore > 0);
    dev.unsubscribe();

    expect(stamped.length).toBeGreaterThan(0);
  });

  it('recordRun(): a two-subflow run records an axis a viewer can rebuild', async () => {
    const pipeline = twoSubflowPipeline();
    const rec = recordRun(pipeline);
    await pipeline.run({ message: 'hi' });
    const recording = rec.toRecording();
    rec.stop();

    const bundle = (
      recording.snapshot as { recorders?: { name?: string; data?: DomainEvent[] }[] }
    ).recorders!.find((r) => r.name === 'BoundaryEvents')!;

    const opens = bundle.data!.filter((e) => e.type === 'subflow.entry');
    expect(opens.length).toBeGreaterThanOrEqual(2);
    expect(new Set(opens.map((e) => e.commitIdxBefore)).size).toBeGreaterThan(1);
  });
});

// ─── 4. SECURITY ────────────────────────────────────────────────────

describe('recordRun — security', () => {
  it('a lean recording says it is lean, and carries no captured content', async () => {
    const runner = agent('the secret is hunter2');
    const rec = recordRun(runner, { boundaryDetail: 'lean' });
    await runner.run({ message: 'hi' });

    // Read the bundle from the recorder itself: `meta` reaches
    // getSnapshot().recorders only on footprintjs 9.12+, and this suite
    // runs against whichever engine is installed.
    const bundle = rec.boundary.toSnapshot();
    rec.stop();

    expect(bundle.meta.mode).toBe('lean');
    expect(JSON.stringify(bundle.data)).not.toContain('hunter2');
  });

  it('the default recording is full, and says THAT', async () => {
    const runner = agent('done');
    const rec = recordRun(runner);
    await runner.run({ message: 'hi' });
    const bundle = rec.boundary.toSnapshot();
    rec.stop();

    expect(bundle.meta.mode).toBe('full');
  });
});

// ─── 5. LOAD ────────────────────────────────────────────────────────

describe('recordRun — load', () => {
  it('the event cap bounds retention and reports what it dropped', async () => {
    const runner = agent('done');
    const rec = recordRun(runner, { maxEvents: 3 });
    await runner.run({ message: 'hi' });
    rec.stop();

    expect(rec.eventCount).toBe(3);
    expect(rec.droppedEvents).toBeGreaterThan(0);
    expect(rec.toRecording().events).toHaveLength(3);
  });
});
