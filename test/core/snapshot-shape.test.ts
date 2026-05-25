/**
 * Inspects the snapshot shape Lens / Trace will consume. Asserts the
 * structural truth a single LLMCall produces — proves we have all the
 * info needed to drive the UI without re-derivation.
 */

import { describe, it, expect } from 'vitest';
import { LLMCall } from '../../src/core/LLMCall.js';
import { Parallel } from '../../src/core-flow/Parallel.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';

function llm(reply: string) {
  return LLMCall.create({ provider: new MockProvider({ reply }), model: 'mock' })
    .system('hi')
    .build();
}

/** Recursively collect every stage id in an executionTree-like value.
 *  In footprintjs's StageSnapshot the stage id is the `id` field. */
function collectStageIds(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  const n = node as Record<string, unknown>;
  if (typeof n.id === 'string') out.push(n.id);
  for (const [key, value] of Object.entries(n)) {
    if (key === 'id') continue;
    if (Array.isArray(value)) value.forEach((v) => collectStageIds(v, out));
    else if (value && typeof value === 'object') collectStageIds(value, out);
  }
  return out;
}

/** Walk flowMessages recursively to find Parallel children's targetStage names. */
function collectFlowTargets(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  const n = node as Record<string, unknown>;
  const flowMessages = n.flowMessages;
  if (Array.isArray(flowMessages)) {
    for (const msg of flowMessages) {
      if (msg && typeof msg === 'object') {
        const target = (msg as { targetStage?: unknown }).targetStage;
        if (Array.isArray(target)) target.forEach((t) => out.push(String(t)));
        else if (typeof target === 'string') out.push(target);
      }
    }
  }
  for (const [key, value] of Object.entries(n)) {
    if (key === 'flowMessages') continue;
    if (Array.isArray(value)) value.forEach((v) => collectFlowTargets(v, out));
    else if (value && typeof value === 'object') collectFlowTargets(value, out);
  }
  return out;
}

describe('snapshot shape — single LLMCall', () => {
  it('snapshot.executionTree contains the expected internal subflows', async () => {
    const r = llm('hello');
    await r.run({ message: 'go' });
    const snap = r.getLastSnapshot();
    expect(snap).toBeDefined();
    const stageIds = collectStageIds(snap?.executionTree);
    // The LLMCall builds: a seed stage + 3 slot subflows + the call-llm
    // stage. All MUST appear in the executionTree for Lens to render
    // the internal structure on drill-in.
    expect(stageIds.length).toBeGreaterThan(0);
    // Look for any stage id mentioning the slots / call-llm.
    const allIds = stageIds.join(' ');
    expect(allIds).toMatch(/system-prompt|messages|tools|call-llm|seed/);
  });

  it('snapshot.commitLog records per-stage writes', async () => {
    const r = llm('hello');
    await r.run({ message: 'go' });
    const snap = r.getLastSnapshot();
    expect(snap?.commitLog).toBeDefined();
    expect(Array.isArray(snap?.commitLog)).toBe(true);
    expect((snap?.commitLog ?? []).length).toBeGreaterThan(0);
    // commitLog entries must have runtimeStageId — the JOIN KEY.
    const first = snap?.commitLog?.[0];
    expect(first).toHaveProperty('runtimeStageId');
  });
});

describe('snapshot shape — Parallel (multi-branch)', () => {
  it('snapshot reflects ALL parallel branches via flowMessages.targetStage', async () => {
    const par = Parallel.create({ name: 'committee' })
      .branch('legal', llm('legal-says'))
      .branch('ethics', llm('ethics-says'))
      .branch('cost', llm('cost-says'))
      .mergeWithFn((r) => Object.values(r).join(' | '))
      .build();
    await par.run({ message: 'go' });
    const snap = par.getLastSnapshot();
    expect(snap?.executionTree).toBeDefined();

    // Branch names live in the seed stage's `flowMessages` —
    // `{type: 'children', targetStage: ['legal','ethics','cost'], count: 3}`.
    // This is the structural truth Lens reads to render Parallel-as-parallel
    // WITHOUT re-deriving from typed events.
    const flowTargets = collectFlowTargets(snap?.executionTree).join(' ');
    expect(flowTargets).toContain('legal');
    expect(flowTargets).toContain('ethics');
    expect(flowTargets).toContain('cost');

    // The "Parallel: 3-way fanout" description is also in the snapshot,
    // proving Lens can identify the composition kind directly.
    const json = JSON.stringify(snap?.executionTree);
    expect(json).toContain('Parallel: 3-way fanout');
  });

  it('back-to-back Parallel runs produce DIFFERENT snapshot identity', async () => {
    const par = Parallel.create({ name: 'committee' })
      .branch('a', llm('A'))
      .branch('b', llm('B'))
      .mergeWithFn((r) => Object.values(r).join(' | '))
      .build();

    await par.run({ message: 'first' });
    const snap1 = par.getLastSnapshot();

    await par.run({ message: 'second' });
    const snap2 = par.getLastSnapshot();

    expect(snap1).not.toBe(snap2);
    const flowTargets2 = collectFlowTargets(snap2?.executionTree).join(' ');
    expect(flowTargets2).toContain('a');
    expect(flowTargets2).toContain('b');
  });
});
