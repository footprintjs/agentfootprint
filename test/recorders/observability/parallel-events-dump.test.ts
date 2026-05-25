/**
 * Diagnostic: dump every BoundaryRecorder DomainEvent for a real
 * Parallel run. Lets us confirm what signals exist (fork.branch?
 * subflow.entry with primitiveKind? composition.fork_start typed?)
 * before changing the projection.
 */

import { describe, it, expect } from 'vitest';
import { Parallel } from '../../../src/core-flow/Parallel.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import { boundaryRecorder } from '../../../src/recorders/observability/BoundaryRecorder.js';

function llm(reply: string) {
  return LLMCall.create({ provider: new MockProvider({ reply }), model: 'mock' })
    .system('')
    .build();
}

describe('DIAGNOSTIC — BoundaryRecorder events for Parallel-as-runner', () => {
  it('dumps the full event stream so we can see what signals exist', async () => {
    const par = Parallel.create({ name: 'Committee' })
      .branch('legal', llm('legal-says'))
      .branch('ethics', llm('ethics-says'))
      .branch('cost', llm('cost-says'))
      .mergeWithFn((r) => Object.values(r).join(' | '))
      .build();
    const rec = boundaryRecorder();
    par.attach(rec);
    await par.run({ message: 'hi' });
    const events = rec.getEvents();
    // eslint-disable-next-line no-console
    console.log('\n=== PARALLEL DOMAIN EVENT STREAM ===');
    for (const e of events) {
      const summary: Record<string, unknown> = {
        type: e.type,
        depth: (e as { depth?: number }).depth,
        path: (e as { subflowPath?: readonly string[] }).subflowPath?.join('/'),
      };
      if ((e as { primitiveKind?: string }).primitiveKind) {
        summary.primitiveKind = (e as { primitiveKind?: string }).primitiveKind;
      }
      if ((e as { childName?: string }).childName) {
        summary.childName = (e as { childName?: string }).childName;
      }
      if ((e as { parentSubflowId?: string }).parentSubflowId) {
        summary.parent = (e as { parentSubflowId?: string }).parentSubflowId;
      }
      if ((e as { actorArrow?: string }).actorArrow) {
        summary.arrow = (e as { actorArrow?: string }).actorArrow;
      }
      if ((e as { subflowId?: string }).subflowId) {
        summary.subflowId = (e as { subflowId?: string }).subflowId;
      }
      // eslint-disable-next-line no-console
      console.log('  ', JSON.stringify(summary));
    }
    expect(events.length).toBeGreaterThan(0);
  });
});
