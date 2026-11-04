import { afterEach, describe, expect, it, vi } from 'vitest';
import { causalEvidenceRecorder } from '../../../src/memory/causal/evidenceRecorder.js';

const coverage = {
  scope: 'component-execution-leg',
  runId: 'native-leg-A',
  entry: { kind: 'run' },
  priorLegs: 'not-carried',
} as const;
const make = () =>
  causalEvidenceRecorder({ coverage } as Parameters<typeof causalEvidenceRecorder>[0]);
const emit = (rec: ReturnType<typeof make>, suffix: string, payload: unknown) =>
  rec.onEmit({ name: 'agentfootprint.' + suffix, payload });
const pair = (rec: ReturnType<typeof make>, id: string) => {
  emit(rec, 'stream.tool_start', { toolCallId: id, toolName: 'read', args: { id } });
  emit(rec, 'stream.tool_end', { toolCallId: id, result: 'result-' + id });
};
const collect = (rec: ReturnType<typeof make>) =>
  rec.collect() as unknown as Record<string, unknown>;

afterEach(() => vi.restoreAllMocks());

describe('causal component-leg accounting', () => {
  it('does not fabricate a tool pair from whole-field masked events', () => {
    const rec = make();
    emit(rec, 'stream.tool_start', '[masked]');
    emit(rec, 'stream.tool_end', '[masked]');
    expect(collect(rec).toolCalls).toEqual([]);
    expect(collect(rec).availability).toBe('partial');
    expect(collect(rec).causes).toEqual(['observer-failed']);
  });

  it('refuses a malformed tool ID without coercing host code', () => {
    const rec = make();
    const coerce = vi.fn(() => 'invented');
    emit(rec, 'stream.tool_start', { toolCallId: { toString: coerce }, toolName: 'read' });
    expect(coerce).not.toHaveBeenCalled();
    expect(collect(rec).causes).toEqual(['observer-failed']);
  });

  it('counts observed iteration starts, never an iteration ordinal or restored turn total', () => {
    const rec = make();
    emit(rec, 'agent.iteration_start', { turnIndex: 1, iterIndex: 40 });
    emit(rec, 'agent.iteration_start', { turnIndex: 1, iterIndex: 41 });
    emit(rec, 'stream.llm_end', { iteration: 41, usage: { input: 3, output: 2 } });
    emit(rec, 'agent.turn_end', {
      iterationCount: 42,
      totalInputTokens: 900,
      totalOutputTokens: 800,
      durationMs: 700,
    });
    const evidence = collect(rec);
    expect(evidence.observedIterationStarts).toBe(2);
    expect(evidence.lastObservedIteration).toBe(41);
    expect(evidence.tokenUsage).toEqual({ input: 3, output: 2 });
    expect(evidence.coverage).toEqual(coverage);
  });

  it('does not clear earlier observations when a later turn_start is served', () => {
    const rec = make();
    pair(rec, 'first');
    emit(rec, 'agent.turn_start', {});
    expect(collect(rec).toolCalls).toEqual([
      { name: 'read', args: { id: 'first' }, resultPreview: 'result-first', errored: false },
    ]);
  });

  it('never fabricates a dispatched tool from an unmatched end', () => {
    const rec = make();
    emit(rec, 'stream.tool_end', { toolCallId: 'orphan', result: 'unknown' });
    const evidence = collect(rec);
    expect(evidence.toolCalls).toEqual([]);
    expect(evidence.toolAccounting).toEqual({
      unmatchedStarts: 0,
      unmatchedEnds: 1,
      duplicateStarts: 0,
    });
    expect(evidence.causes).toEqual(['incomplete-tool-pairs']);
    expect(evidence.availability).toBe('partial');
  });

  it('keeps the first pending start when an active call ID repeats', () => {
    const rec = make();
    emit(rec, 'stream.tool_start', { toolCallId: 'same', toolName: 'first', args: { owner: 'A' } });
    emit(rec, 'stream.tool_start', {
      toolCallId: 'same',
      toolName: 'second',
      args: { owner: 'B' },
    });
    emit(rec, 'stream.tool_end', { toolCallId: 'same', result: 'A' });
    const evidence = collect(rec);
    expect(evidence.toolCalls).toEqual([
      { name: 'first', args: { owner: 'A' }, resultPreview: 'A', errored: false },
    ]);
    expect(evidence.toolAccounting).toEqual({
      unmatchedStarts: 0,
      unmatchedEnds: 0,
      duplicateStarts: 1,
    });
    expect(evidence.causes).toEqual(['duplicate-tool-start']);
  });

  it('counts missing or invalid usage instead of asserting measured zero', () => {
    const rec = make();
    emit(rec, 'stream.llm_end', {});
    emit(rec, 'stream.llm_end', { usage: { input: -1, output: 3 } });
    emit(rec, 'stream.llm_end', { usage: { input: 2, output: Number.POSITIVE_INFINITY } });
    emit(rec, 'stream.llm_end', { usage: { input: 0, output: 0 } });
    const evidence = collect(rec);
    expect(evidence.usageAccounting).toEqual({ observedCalls: 1, missingUsage: 3 });
    expect(evidence.tokenUsage).toEqual({ input: 0, output: 0 });
    expect(evidence.availability).toBe('partial');
    expect(evidence.causes).toEqual(['missing-usage']);
  });

  it('folds simultaneous gaps in a stable, deduplicated order', () => {
    const rec = make();
    emit(rec, 'stream.tool_start', { toolCallId: 'open', toolName: 'read' });
    emit(rec, 'stream.tool_start', { toolCallId: 'open', toolName: 'read' });
    emit(rec, 'stream.llm_end', {});
    expect(collect(rec).causes).toEqual([
      'incomplete-tool-pairs',
      'duplicate-tool-start',
      'missing-usage',
    ]);
    expect(collect(rec).causes).toEqual([
      'incomplete-tool-pairs',
      'duplicate-tool-start',
      'missing-usage',
    ]);
  });

  it('bounds completed pairs and decisions, declaring omitted evidence', () => {
    const rec = make();
    for (let i = 0; i < 257; i += 1) {
      pair(rec, String(i));
      rec.onEmit({
        name: 'agentfootprint.context.evaluated',
        payload: { routing: [{ id: 'skill-' + i }] },
      });
    }
    const evidence = collect(rec);
    expect(evidence.toolCalls).toHaveLength(256);
    expect(evidence.decisions).toHaveLength(256);
    expect(evidence.availability).toBe('partial');
    expect(evidence.causes).toEqual(['bounded-observation']);
  });

  it('bounds pending starts without replacing an admitted pending owner', () => {
    const rec = make();
    for (let i = 0; i < 257; i += 1) {
      emit(rec, 'stream.tool_start', { toolCallId: String(i), toolName: 'read' });
    }
    emit(rec, 'stream.tool_end', { toolCallId: '256', result: 'not-admitted' });
    const evidence = collect(rec);
    expect(evidence.toolCalls).toEqual([]);
    expect(evidence.toolAccounting).toEqual({
      unmatchedStarts: 256,
      unmatchedEnds: 1,
      duplicateStarts: 0,
    });
    expect(evidence.causes).toEqual(['bounded-observation', 'incomplete-tool-pairs']);
  });

  it('retains a normal matched dispatched pair and excludes a notDispatched bracket', () => {
    const rec = make();
    pair(rec, 'normal');
    emit(rec, 'stream.tool_start', {
      toolCallId: 'settled',
      toolName: 'never-called',
      notDispatched: 'cancelled',
    });
    emit(rec, 'stream.tool_end', {
      toolCallId: 'settled',
      result: 'not a result',
      notDispatched: 'cancelled',
    });
    expect(collect(rec).toolCalls).toEqual([
      { name: 'read', args: { id: 'normal' }, resultPreview: 'result-normal', errored: false },
    ]);
  });
});
