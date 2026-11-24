import type { TypedScope } from 'footprintjs';
import { describe, expect, it } from 'vitest';
import { memoryRecallInjections } from '../../../src/core/agent/memoryRecallInjections.js';
import { memoryInjectionKey, retrievalEvidenceKey } from '../../../src/memory/define.types.js';
import type { RetrievalEvidence } from '../../../src/memory/retrieval/types.js';
import { formatDefault } from '../../../src/memory/stages/formatDefault.js';
import type { MemoryState } from '../../../src/memory/stages/types.js';

function entry(id: string, label: string) {
  return {
    id,
    value: { role: 'system' as const, content: `body-${label}`, docUri: `doc-${label}` },
  };
}

const admitted = { id: 'same', score: 0.8, rank: 1, admitted: true, docUri: 'doc-keep' };
const rejected = {
  id: 'same',
  score: 0.2,
  rank: 2,
  admitted: false,
  reason: 'over-budget' as const,
  docUri: 'doc-drop',
};

function evidence(candidates: NonNullable<RetrievalEvidence['candidates']>): RetrievalEvidence {
  return {
    strategy: 'top-k',
    queryHash: 'test',
    k: 2,
    selectionOrder: 'recency',
    consideredCount: candidates.length,
    admittedCount: candidates.filter((candidate) => candidate.admitted).length,
    rejectedCount: candidates.filter((candidate) => !candidate.admitted).length,
    candidates,
    candidatesComplete: true,
    corpusEmpty: false,
  };
}

function recall(record: RetrievalEvidence, content: string) {
  return memoryRecallInjections(
    {
      [memoryInjectionKey('docs')]: [{ role: 'system', content }],
      [retrievalEvidenceKey('docs')]: record,
    },
    [{ id: 'docs', flavor: 'rag' }],
  );
}

describe.each(['full', 'ids-only'] as const)('%s ambiguous recall formatting', (recording) => {
  it('uses the selected entry’s own coordinates and omits colliding evidence', async () => {
    const scope = {
      selected: [entry('same', 'keep')],
      retrieved: evidence([admitted, rejected]),
    } as unknown as TypedScope<MemoryState>;
    await formatDefault({ flavor: 'rag', recording })(scope);
    const content = scope.formatted[0].content;
    expect(content).toContain('doc="doc-keep"');
    expect(content).toContain('body-keep');
    expect(content).not.toContain('doc-drop');
    expect(content).not.toContain('score=');
    expect(scope.retrieved).toMatchObject({
      candidateIdsAmbiguous: true,
      candidatesComplete: false,
    });
    expect(scope.retrieved).not.toHaveProperty('candidates');
    expect(scope.retrieved).not.toHaveProperty('promptRanges');
    expect(recall(scope.retrieved!, content)).toEqual([
      expect.objectContaining({ id: 'memory:docs', inject: { systemPrompt: content } }),
    ]);
  });

  it('does not attribute a custom picker’s colliding selections to one candidate', async () => {
    const scope = {
      selected: [entry('same', 'first'), entry('same', 'second')],
      retrieved: evidence([admitted]),
    } as unknown as TypedScope<MemoryState>;
    await formatDefault({ flavor: 'rag', recording })(scope);
    const content = scope.formatted[0].content;
    expect(content).toContain('doc="doc-first"');
    expect(content).toContain('doc="doc-second"');
    expect(content).not.toContain('score=');
    expect(scope.retrieved).toMatchObject({ candidateIdsAmbiguous: true });
    expect(scope.retrieved).not.toHaveProperty('promptRanges');
  });

  it('leaves a rejected row unplaced even when a custom picker formats its ID', async () => {
    const scope = {
      selected: [entry('same', 'keep'), entry('other', 'override')],
      retrieved: evidence([admitted, { ...rejected, id: 'other' }]),
    } as unknown as TypedScope<MemoryState>;
    await formatDefault({ flavor: 'rag', recording })(scope);
    expect(scope.retrieved?.candidates?.[0]).toHaveProperty('promptPosition', 0);
    expect(scope.retrieved?.candidates?.[1]).not.toHaveProperty('promptPosition');
    expect(scope.retrieved?.candidates?.[1]).not.toHaveProperty('promptFragment');
    expect(scope.formatted[0].content).not.toContain('doc-drop');
  });
});

it('does not split legacy duplicate IDs even when the only admitted fragment rejoins exactly', () => {
  const record = evidence([{ ...admitted, promptFragment: 'keep', promptPosition: 0 }, rejected]);
  expect(recall(record, 'keep')).toEqual([
    expect.objectContaining({ id: 'memory:docs', inject: { systemPrompt: 'keep' } }),
  ]);
});

it('does not split legacy duplicate ranges that rejoin the prompt exactly', () => {
  const record: RetrievalEvidence = {
    ...evidence([admitted]),
    recording: 'ids-only',
    promptRanges: [
      { id: 'same', start: 0, end: 3, score: 0.8, rank: 1 },
      { id: 'same', start: 5, end: 8, score: 0.2, rank: 2 },
    ],
  };
  expect(recall(record, 'one\n\ntwo')).toEqual([
    expect.objectContaining({ id: 'memory:docs', inject: { systemPrompt: 'one\n\ntwo' } }),
  ]);
});
