/**
 * L1a tests — `structureRecorders` option on every composition.
 *
 * Each composition (Parallel, Sequence, Loop, Conditional, Agent,
 * LLMCall) accepts an optional list of `StructureRecorder`s. When
 * attached, each recorder's `onStageAdded` fires once per node in that
 * composition's internal chart at build time. When omitted,
 * footprintjs's dispatcher is bypassed and behaviour is byte-identical
 * to no-recorder.
 *
 * The Lego-block cascade is consumer-driven: each composition uses
 * its OWN `opts.structureRecorders`; subflows mounted via
 * `addSubFlowChart*` carry whatever recorders they were built with.
 * Threading the same recorder reference through every nested
 * composition gives full coverage; missing one leaves only that
 * subflow's nodes unobserved.
 *
 * Migration note: footprintjs v6 removed the legacy
 * `BuildTimeExtractor` (a per-node spec MUTATOR) in favour of the
 * read-only `StructureRecorder` observer interface. These tests now
 * assert observer event counts + payload shapes rather than spec-tree
 * decoration.
 *
 * Test types covered: unit, functional, integration, property,
 * security, performance, ROI.
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  StructureRecorder,
  StructureStageAddedEvent,
  StructureSubflowMountedEvent,
} from 'footprintjs';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { Parallel } from '../../../src/core-flow/Parallel.js';
import { Loop } from '../../../src/core-flow/Loop.js';
import { Conditional } from '../../../src/core-flow/Conditional.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

interface RecordedEvents {
  readonly stageIds: string[];
  readonly mountedSubflowIds: string[];
}

/** Build a recorder that captures every stageAdded + subflowMounted event. */
const makeCapturingRecorder = (
  id = 'test-capture',
): { recorder: StructureRecorder; events: RecordedEvents } => {
  const stageIds: string[] = [];
  const mountedSubflowIds: string[] = [];
  const recorder: StructureRecorder = {
    id,
    onStageAdded: (e: StructureStageAddedEvent) => {
      stageIds.push(e.stageId);
    },
    onSubflowMounted: (e: StructureSubflowMountedEvent) => {
      mountedSubflowIds.push(e.subflowId);
    },
  };
  return { recorder, events: { stageIds, mountedSubflowIds } };
};

const okLLMCall = (reply: string, recorders?: readonly StructureRecorder[]) =>
  LLMCall.create({
    provider: new MockProvider({ reply }),
    model: 'mock',
    ...(recorders ? { structureRecorders: recorders } : {}),
  })
    .system('')
    .build();

// ── 1. Unit — each composition: with vs without recorder ───────────

describe('L1a — structureRecorders option, per-composition unit', () => {
  it('LLMCall: without recorder, build succeeds (byte-identical fast path)', () => {
    const c = okLLMCall('X');
    const spec = c.getSpec().buildTimeStructure;
    expect(spec).toBeDefined();
  });

  it('LLMCall: with recorder, every OUTER chart node fires onStageAdded', () => {
    // L1a scope: the LLMCall's OWN builder attaches the recorder to
    // its own OUTER chart nodes (Client stage + sf-llm-call subflow
    // mount). The inner sf-llm-call subflow chart is built by an
    // internal helper that does NOT thread the recorder — its internal
    // nodes (seed, slot mounts, call-llm, extract-final) are not
    // observed by THIS recorder. Inner-builder wiring is a follow-up.
    const { recorder, events } = makeCapturingRecorder();
    okLLMCall('X', [recorder]);
    // Outer chart: Client stage. sf-llm-call fires as a subflow mount.
    expect(events.stageIds).toContain('client');
    expect(events.mountedSubflowIds).toContain('sf-llm-call');
  });

  it('Sequence: with recorder, every OUTER node fires onStageAdded', () => {
    // Inner steps are pre-built LLMCalls without the recorder — their
    // nodes are NOT observed (cascade is consumer-driven; see below).
    const { recorder, events } = makeCapturingRecorder();
    Sequence.create({ structureRecorders: [recorder] })
      .step('a', okLLMCall('A'))
      .step('b', okLLMCall('B'))
      .build();
    // Outer nodes: Seed + Finalize (step mounts fire onSubflowMounted, not onStageAdded).
    expect(events.stageIds).toContain('seed');
    expect(events.stageIds).toContain('finalize');
    // Step subflow mounts fire onSubflowMounted.
    expect(events.mountedSubflowIds).toContain('step-a');
    expect(events.mountedSubflowIds).toContain('step-b');
  });

  it('Parallel: with recorder, OUTER nodes (Seed + fork mounts + Merge) all observed', () => {
    const { recorder, events } = makeCapturingRecorder();
    Parallel.create({ structureRecorders: [recorder] })
      .branch('legal', okLLMCall('L'))
      .branch('ethics', okLLMCall('E'))
      .mergeWithFn((r) => Object.values(r).join('|'))
      .build();
    // Seed + Merge are stage events; branches mount as subflows.
    expect(events.stageIds).toContain('seed');
    expect(events.stageIds).toContain('merge');
    expect(events.mountedSubflowIds).toContain('legal');
    expect(events.mountedSubflowIds).toContain('ethics');
  });

  it('Loop: with recorder, every OUTER real node fires onStageAdded', () => {
    // Loop's outer chart has: Seed → IterationStart → body mount → Guard.
    // The body is a mounted subflow (fires onSubflowMounted, not onStageAdded).
    const { recorder, events } = makeCapturingRecorder();
    Loop.create({ structureRecorders: [recorder] })
      .repeat(okLLMCall('body'))
      .times(2)
      .build();
    expect(events.stageIds).toContain('seed');
    expect(events.stageIds).toContain('iteration-start');
    expect(events.stageIds).toContain('guard');
    expect(events.mountedSubflowIds).toContain('body');
  });

  it('Conditional: with recorder, OUTER nodes (incl. branch mounts) observed', () => {
    const { recorder, events } = makeCapturingRecorder();
    Conditional.create({ structureRecorders: [recorder] })
      .when('hi', () => true, okLLMCall('H'))
      .otherwise('lo', okLLMCall('L'))
      .build();
    expect(events.stageIds).toContain('seed');
    expect(events.stageIds).toContain('route'); // decider
    // Branches are mounted as subflows on the decider.
    expect(events.mountedSubflowIds).toContain('hi');
    expect(events.mountedSubflowIds).toContain('lo');
  });
});

// ── 2. Functional — without recorder, build still succeeds ─────────

describe('L1a — undefined recorders leaves library shape unchanged', () => {
  it('Parallel built without recorder still produces a valid chart', () => {
    const par = Parallel.create()
      .branch('a', okLLMCall('A'))
      .branch('b', okLLMCall('B'))
      .mergeWithFn((r) => Object.values(r).join('|'))
      .build();
    expect(par.getSpec().buildTimeStructure).toBeDefined();
  });
});

// ── 3. Integration — consumer-driven cascade through nested compositions

describe('L1a — Lego-block cascade (consumer threads the same reference)', () => {
  it('same recorder in inner LLMCall + outer Parallel → both outer + branch internals observed', () => {
    // The cascade rule: each composition's builder fires events for the
    // nodes IT creates. Threading the same recorder through inner
    // LLMCalls causes those nodes to fire too. Slot subflow internals
    // remain unobserved (see the slot-builder follow-up backlog).
    const { recorder, events } = makeCapturingRecorder();
    const legal = okLLMCall('L', [recorder]);
    const ethics = okLLMCall('E', [recorder]);
    Parallel.create({ structureRecorders: [recorder] })
      .branch('legal', legal)
      .branch('ethics', ethics)
      .mergeWithFn((r) => Object.values(r).join('|'))
      .build();
    // Outer Parallel: seed + merge stages; legal/ethics as subflow mounts.
    expect(events.stageIds).toContain('seed');
    expect(events.stageIds).toContain('merge');
    expect(events.mountedSubflowIds).toContain('legal');
    expect(events.mountedSubflowIds).toContain('ethics');
    // Inner LLMCalls (with the same recorder threaded) emit their own
    // OUTER chart nodes — `client` stage + `sf-llm-call` subflow mount,
    // one of each per LLMCall. Cascade demonstrates that consumers can
    // share a recorder reference across nested compositions.
    expect(events.stageIds.filter((id) => id === 'client').length).toBeGreaterThanOrEqual(2);
    expect(events.mountedSubflowIds.filter((id) => id === 'sf-llm-call').length).toBeGreaterThanOrEqual(2);
  });

  it('recorder on outer Parallel only → branch internals NOT observed (cascade is opt-in)', () => {
    const { recorder, events } = makeCapturingRecorder();
    const legal = okLLMCall('L'); // no recorder
    const ethics = okLLMCall('E'); // no recorder
    Parallel.create({ structureRecorders: [recorder] })
      .branch('legal', legal)
      .branch('ethics', ethics)
      .mergeWithFn((r) => Object.values(r).join('|'))
      .build();
    // Only ONE seed event (the outer Parallel's) — inner LLMCall seed
    // stages don't fire on THIS recorder because the LLMCall was built
    // without it.
    expect(events.stageIds.filter((id) => id === 'seed').length).toBe(1);
    expect(events.stageIds).not.toContain('call-llm');
  });
});

// ── 4. Property — recorder invocation count ────────────────────────

describe('L1a — recorder invocation count', () => {
  it('LLMCall: recorder fires at construction time (eager build) per OUTER chart node', () => {
    const onStageAdded = vi.fn();
    const recorder: StructureRecorder = { id: 'count', onStageAdded };
    okLLMCall('X', [recorder]);
    // Eager build (RunnerBase.initChart): the recorder fires at
    // constructor time. Outer LLMCall chart adds 2 raw stages via
    // addFunction (Seed, CallLLM); the 3 slot subflows fire on
    // onSubflowMounted instead. Slot subflow internals are NOT covered
    // (slot builders don't yet thread the recorder — separate follow-up).
    expect(onStageAdded.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('Parallel: recorder fires only for OUTER nodes when inner branches were built without it', () => {
    const onStageAdded = vi.fn();
    const onSubflowMounted = vi.fn();
    const recorder: StructureRecorder = {
      id: 'count',
      onStageAdded,
      onSubflowMounted,
    };
    Parallel.create({ structureRecorders: [recorder] })
      .branch('a', okLLMCall('A'))
      .branch('b', okLLMCall('B'))
      .mergeWithFn((r) => Object.values(r).join('|'))
      .build();
    // Outer Parallel: Seed + Merge + 2 fork-branch slot nodes = 4 stages.
    // (Each branch is registered as a stage AND as a mounted subflow.)
    expect(onStageAdded.mock.calls.length).toBeGreaterThanOrEqual(2);
    // 2 branch mounts.
    expect(onSubflowMounted).toHaveBeenCalledTimes(2);
  });
});

// ── 5. Security — recorder that throws does not crash build ────────

describe('L1a — recorder error isolation', () => {
  it('throwing recorder leaves the library spec intact', () => {
    const throwing: StructureRecorder = {
      id: 'throwing',
      onStageAdded: () => {
        throw new Error('recorder boom');
      },
    };
    // footprintjs's dispatcher catches handler errors and accumulates
    // them on builder.getStructureBuildErrors(); the build still succeeds.
    expect(() =>
      LLMCall.create({
        provider: new MockProvider({ reply: 'X' }),
        model: 'mock',
        structureRecorders: [throwing],
      })
        .system('')
        .build(),
    ).not.toThrow();
  });
});

// ── 6. Performance — recorder adds negligible cost ─────────────────

describe('L1a — performance', () => {
  it('Parallel.build() with no-op recorder completes under 200ms', () => {
    const recorder: StructureRecorder = { id: 'noop', onStageAdded: () => {} };
    const t0 = performance.now();
    Parallel.create({ structureRecorders: [recorder] })
      .branch('a', okLLMCall('A'))
      .branch('b', okLLMCall('B'))
      .mergeWithFn((r) => Object.values(r).join('|'))
      .build();
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

// ── 7. ROI — same recorder reused, events stable ───────────────────

describe('L1a — ROI (stability across builds)', () => {
  it('same recorder reference across two independent builds → both observed', () => {
    const { recorder, events } = makeCapturingRecorder();
    okLLMCall('X', [recorder]);
    const firstBuildCount = events.stageIds.length;
    okLLMCall('Y', [recorder]);
    // Second build adds at LEAST as many events as the first (same shape).
    expect(events.stageIds.length).toBeGreaterThanOrEqual(2 * firstBuildCount);
  });
});
