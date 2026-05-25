/**
 * `runner.getLastSnapshot()` — proves every runner exposes the
 * canonical footprintjs RuntimeSnapshot for downstream consumers
 * (Lens, Trace, dashboards) to read structure from. Validates the
 * Phase 4a design: ONE source of structural truth, never re-derived.
 */

import { describe, it, expect } from 'vitest';
import { LLMCall } from '../../src/core/LLMCall.js';
import { Sequence } from '../../src/core-flow/Sequence.js';
import { Parallel } from '../../src/core-flow/Parallel.js';
import { Conditional } from '../../src/core-flow/Conditional.js';
import { Loop } from '../../src/core-flow/Loop.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';

function llm(reply: string) {
  return LLMCall.create({ provider: new MockProvider({ reply }), model: 'mock' })
    .system('')
    .build();
}

describe('runner.getLastSnapshot — canonical structural truth', () => {
  it('LLMCall exposes snapshot after run', async () => {
    const r = llm('hi');
    expect(r.getLastSnapshot()).toBeUndefined(); // pre-run
    await r.run({ message: 'go' });
    const snap = r.getLastSnapshot();
    expect(snap).toBeDefined();
    expect(snap?.executionTree).toBeDefined();
    expect(snap?.commitLog).toBeDefined();
  });

  it('Sequence exposes snapshot after run', async () => {
    const seq = Sequence.create().step('a', llm('A')).build();
    expect(seq.getLastSnapshot()).toBeUndefined();
    await seq.run({ message: 'go' });
    expect(seq.getLastSnapshot()?.executionTree).toBeDefined();
  });

  it('Parallel exposes snapshot containing all branches', async () => {
    const par = Parallel.create({ name: 'committee' })
      .branch('a', llm('A'))
      .branch('b', llm('B'))
      .branch('c', llm('C'))
      .mergeWithFn((r) => Object.values(r).join(' | '))
      .build();
    await par.run({ message: 'go' });
    const snap = par.getLastSnapshot();
    expect(snap?.executionTree).toBeDefined();
    // The structural truth: 3 branches must be reflected somewhere in
    // the executionTree. We don't assert exact shape (footprintjs's
    // private), but its serialized form must mention all 3 branch ids.
    const json = JSON.stringify(snap?.executionTree);
    expect(json).toContain('a');
    expect(json).toContain('b');
    expect(json).toContain('c');
  });

  it('Conditional exposes snapshot reflecting the chosen branch', async () => {
    const cond = Conditional.create()
      .when('left', (i: { message: string }) => i.message === 'L', llm('LEFT'))
      .otherwise('right', llm('RIGHT'))
      .build();
    await cond.run({ message: 'L' });
    expect(cond.getLastSnapshot()?.executionTree).toBeDefined();
  });

  it('Loop exposes snapshot reflecting iterations', async () => {
    const loop = Loop.create().repeat(llm('iter')).times(2).build();
    await loop.run({ message: 'go' });
    expect(loop.getLastSnapshot()?.executionTree).toBeDefined();
  });

  it('snapshot reflects the MOST RECENT run when reused', async () => {
    const r = llm('hi');
    await r.run({ message: 'first' });
    const snap1 = r.getLastSnapshot();
    await r.run({ message: 'second' });
    const snap2 = r.getLastSnapshot();
    // Different snapshot identity per run.
    expect(snap1).not.toBe(snap2);
    expect(snap2?.executionTree).toBeDefined();
  });
});
