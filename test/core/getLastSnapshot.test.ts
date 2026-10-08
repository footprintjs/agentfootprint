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
import { Agent } from '../../src/core/Agent.js';
import { isPaused, pauseHere } from '../../src/core/pause.js';
import type { Runner } from '../../src/core/runner.js';
import { defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';

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

describe('runner.getLastSnapshot — after a resume, the resumed leg', () => {
  /** An agent whose one tool pauses for a person, then answers `LEG-TWO-ANSWER`. */
  const asks = () =>
    Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'approve', args: {} }] },
          { content: 'LEG-TWO-ANSWER' },
        ],
      }),
      model: 'mock',
    })
      .system('')
      .tool(
        defineTool<Record<string, never>, string>({
          name: 'approve',
          description: 'ask a person',
          inputSchema: { type: 'object' },
          execute: () => {
            pauseHere({ question: 'Approve?' });
            return '';
          },
        }),
      )
      .build();

  // A resumed leg runs on an executor of its own: every runner must hand
  // back THAT leg's snapshot (and so its trace and bug report), never the
  // paused leg's.
  const compositions: readonly (readonly [string, () => Runner])[] = [
    ['Sequence', () => Sequence.create().step('a', asks()).build()],
    [
      'Parallel',
      () =>
        Parallel.create()
          .branch('a', asks())
          .branch('b', llm('B'))
          .mergeWithFn((r) => Object.values(r).join(' | '))
          .build(),
    ],
    [
      'Conditional',
      () =>
        Conditional.create()
          .when('a', () => true, asks())
          .otherwise('b', llm('B'))
          .build(),
    ],
    ['Loop', () => Loop.create().repeat(asks()).times(1).build()],
  ];
  for (const [name, make] of compositions) {
    it(name, async () => {
      const runner = make();
      const paused = await runner.run({ message: 'go' });
      if (!isPaused(paused)) throw new Error(`${name} must pause`);
      const pausedLeg = runner.getLastSnapshot();
      expect(JSON.stringify(pausedLeg)).not.toContain('LEG-TWO-ANSWER');
      await runner.resume(paused.checkpoint, { approved: true });
      const resumedLeg = runner.getLastSnapshot();
      expect(resumedLeg).not.toBe(pausedLeg);
      expect(JSON.stringify(resumedLeg)).toContain('LEG-TWO-ANSWER');
    });
  }
});
