import { describe, expect, it, vi } from 'vitest';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import {
  admitCompletedCodeExecution,
  executionClaimContext,
  noteExecutionEntry,
  noteExecutionExit,
  sealExecutionClaimTurn,
  seedExecutionEvidence,
} from './executionEvidence.js';

vi.mock('../../../redaction/runRedaction.js', () => ({
  retainedStateValue: (scope: { keepsOut?: string }, key: string, value: unknown) =>
    scope.keepsOut === key ? undefined : value,
}));

function turn(message = 'Did you run code?') {
  const state = {
    userMessage: message,
    $getArgs: () => ({ message }),
    $getValue(key: string) {
      return Object.getOwnPropertyDescriptor(this, key)?.value;
    },
  };
  return Object.assign(state, { scope: state as unknown as TypedScope<AgentState> });
}

const key = [1, 2, 3, 4, 0] as const;

describe('execution claims use owned terminal receipts', () => {
  it('seals a closed, observed empty dispatch scope', () => {
    const { scope } = turn();
    seedExecutionEvidence(scope, true);
    expect(executionClaimContext(scope).evidence.current).toBe('unknown');
    sealExecutionClaimTurn(scope);
    expect(executionClaimContext(scope).evidence.current).toBe('none');
  });

  it('does not infer absence after an opaque or unsettled entry', () => {
    const { scope } = turn();
    seedExecutionEvidence(scope, true);
    noteExecutionEntry(scope);
    sealExecutionClaimTurn(scope);
    expect(executionClaimContext(scope).evidence.current).toBe('unknown');
  });

  it.each([0, 7])('keeps a settled exit %i with its own occurrence', (exitCode) => {
    const { scope } = turn();
    seedExecutionEvidence(scope, true);
    noteExecutionEntry(scope);
    noteExecutionExit(scope, key, exitCode);
    sealExecutionClaimTurn(scope);
    expect(executionClaimContext(scope)).toMatchObject({
      evidence: { current: 'confirmed' },
      occurrences: { current: key },
    });
  });

  it('requires both a valid exit and the native occurrence', () => {
    const { scope } = turn();
    seedExecutionEvidence(scope, true);
    noteExecutionEntry(scope);
    noteExecutionExit(scope, undefined, 0);
    noteExecutionExit(scope, key, undefined);
    sealExecutionClaimTurn(scope);
    expect(executionClaimContext(scope).evidence.current).toBe('unknown');
  });

  it('sends both a hidden positive receipt and a hidden complete empty scope as unknown', () => {
    const observations = [undefined, key].map((occurrence) => {
      const state = turn();
      seedExecutionEvidence(state.scope, true);
      if (occurrence !== undefined) {
        noteExecutionEntry(state.scope);
        noteExecutionExit(state.scope, occurrence, 0);
      }
      sealExecutionClaimTurn(state.scope);
      Object.assign(state, { keepsOut: 'codeExecutionReceipt' });
      return executionClaimContext(state.scope);
    });
    expect(observations[0]).toEqual(observations[1]);
    expect(observations[1]?.evidence.current).toBe('unknown');
  });

  it('reads only own occurrence words on the admitted checkpoint', () => {
    const address = [...key];
    const iterator = vi.fn(() => {
      throw Error('must not execute');
    });
    Object.defineProperty(address, Symbol.iterator, { get: iterator });
    const carried = {
      originRunId: 'run',
      receipt: { status: 'confirmed', callOccurrenceKey: address },
    };
    expect(admitCompletedCodeExecution(carried, 'run')).toEqual({
      originRunId: 'run',
      receipt: { status: 'confirmed', callOccurrenceKey: key },
    });
    expect(iterator).not.toHaveBeenCalled();
  });

  it('targets the previous completed turn without borrowing the current exit', () => {
    const { scope } = turn('Did you run code or estimate for the previous answer?');
    seedExecutionEvidence(scope, true, { originRunId: 'earlier-run', receipt: { status: 'none' } });
    noteExecutionExit(scope, key, 0);
    sealExecutionClaimTurn(scope);
    expect(executionClaimContext(scope)).toMatchObject({
      defaultTarget: 'previous',
      evidence: { current: 'confirmed', previous: 'none' },
    });
  });
});
