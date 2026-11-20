import { commitValueAt, type CommitBundle } from 'foottrace';
import { describe, expect, it, vi } from 'vitest';
import type { TraceToolpackArtifacts } from '../types.js';
import { TRACE_WITHHELD } from './marker.js';
import { projectTraceArtifacts } from './project.js';

const question = { role: 'user', content: 'Which day?' };
const answer = { role: 'assistant', content: 'Tuesday.' };
const confirmation = { role: 'user', content: 'Thanks.' };

function commit(
  idx: number,
  history: readonly unknown[],
  verb: 'set' | 'append',
  note: string,
): CommitBundle {
  return {
    idx,
    stage: 'Conversation',
    stageId: 'conversation',
    runtimeStageId: `conversation#${idx}`,
    trace: [
      { path: 'history', verb },
      { path: 'organizerNotes', verb: 'set' },
    ],
    overwrite: { history, organizerNotes: note },
    updates: {},
    redactedPaths: [],
  };
}

function record(note: string, encoding: 'full' | 'delta' = 'full') {
  const history = [question, answer, confirmation];
  return {
    snapshot: {
      runId: 'schedule',
      commitValues: encoding,
      writeProvenance: 'off',
      initialState: { turnNumber: 1, history: [question], organizerNotes: note },
      sharedState: { turnNumber: 2, history, organizerNotes: note },
      executionTree: {
        id: 'conversation',
        runtimeStageId: 'conversation#0',
        name: 'Conversation',
        stageReads: { organizerNotes: note },
        logs: { organizerNotes: note },
        errors: {},
        metrics: {},
        evals: {},
      },
      commitLog: [
        commit(0, [question, answer], 'set', note),
        encoding === 'delta'
          ? commit(1, [confirmation], 'append', note)
          : commit(1, history, 'set', note),
      ],
      recorders: [{ id: 'notes', name: 'Organizer notes', data: [note] }],
      subflowResults: { organizer: { organizerNotes: note } },
    },
    narrative: [note],
    innerRuns: { get: vi.fn(), list: vi.fn(() => []), dropped: 0, limit: 5 },
  } satisfies TraceToolpackArtifacts;
}

describe('the admitted trace projection', () => {
  it.each(['full', 'delta'] as const)('preserves admitted history across %s replay', (encoding) => {
    const source = record('Orchard planning', encoding);
    const projected = projectTraceArtifacts(source).snapshot;
    expect(projected.initialState).toMatchObject({ history: [question], turnNumber: 1 });
    expect(projected.sharedState).toMatchObject({
      history: [question, answer, confirmation],
      turnNumber: 2,
    });
    expect(projected.commitLog.map(({ runtimeStageId }) => runtimeStageId)).toEqual([
      'conversation#0',
      'conversation#1',
    ]);
    expect(commitValueAt(projected.commitLog, 0, 'history')).toEqual([question, answer]);
    expect(commitValueAt(projected.commitLog, 1, 'history')).toEqual([
      question,
      answer,
      confirmation,
    ]);
  });

  it('makes an unlisted payload irrelevant to the admitted view', () => {
    const first = record('Orchard planning');
    const second = record('Boat repair and travel dates');
    const admitted = projectTraceArtifacts(first);

    expect(admitted).toEqual(projectTraceArtifacts(second));
    expect(admitted.narrative).toEqual([TRACE_WITHHELD]);
    expect(admitted.snapshot.recorders).toBeUndefined();
    expect(admitted.snapshot.subflowResults).toBeUndefined();
    expect(admitted.innerRuns).toBeUndefined();
    expect(JSON.stringify(admitted)).not.toContain('Orchard planning');
  });

  it('leaves host evidence untouched without reading unlisted values', () => {
    const source = record('Orchard planning');
    const original = structuredClone(source.snapshot);
    const readUnknown = vi.fn(() => {
      throw Error('Unlisted state was read');
    });
    Object.defineProperty(source.snapshot.sharedState, 'unlistedAccessor', {
      enumerable: true,
      get: readUnknown,
    });
    const projected = projectTraceArtifacts(source);

    expect(readUnknown).not.toHaveBeenCalled();
    expect(source.innerRuns.get).not.toHaveBeenCalled();
    expect(source.innerRuns.list).not.toHaveBeenCalled();
    expect(projected.snapshot).not.toBe(source.snapshot);
    expect(projected.snapshot.sharedState.history).not.toBe(source.snapshot.sharedState.history);
    expect(source.snapshot.commitLog).toEqual(original.commitLog);
    expect(source.snapshot.recorders).toEqual(original.recorders);
    expect(source.snapshot.initialState).toEqual(original.initialState);
    expect(source.snapshot.sharedState.organizerNotes).toBe('Orchard planning');
    expect(source.narrative).toEqual(['Orchard planning']);
  });
});
