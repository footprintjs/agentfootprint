import { describe, expect, it } from 'vitest';
import { evidenceRecoveryOf, findingsLedgerOf, foldedSpansOf } from './checkpointParts.js';

describe('conversation checkpoint parts', () => {
  it('keeps an unspent repair absent even when pending text exists', () => {
    expect(evidenceRecoveryOf()).toBeUndefined();
    expect(
      evidenceRecoveryOf({
        evidenceRevisionSpent: false,
        evidenceRecovery: { instruction: 'review the measured result' },
      }),
    ).toBeUndefined();
  });

  it('keeps a spent budget without inventing pending feedback', () => {
    expect(evidenceRecoveryOf({ evidenceRevisionSpent: true })).toEqual({ revisionSpent: true });
    expect(
      evidenceRecoveryOf({
        evidenceRevisionSpent: true,
        evidenceRecoveryUsed: true,
        evidenceRecovery: { instruction: 'already used' },
      }),
    ).toEqual({ revisionSpent: true });
  });

  it('carries unused feedback byte for byte, including an optional conclusion', () => {
    const pending = { instruction: '  measured result\n', conclusion: 'kept conclusion' };
    expect(evidenceRecoveryOf({ evidenceRevisionSpent: true, evidenceRecovery: pending })).toEqual({
      revisionSpent: true,
      pending,
    });
    expect(
      evidenceRecoveryOf({
        evidenceRevisionSpent: true,
        evidenceRecovery: { instruction: 'without a conclusion' },
      }),
    ).toEqual({ revisionSpent: true, pending: { instruction: 'without a conclusion' } });
  });

  it('does not lend the pending feedback object to its checkpoint caller', () => {
    const pending = { instruction: 'original', conclusion: 'original conclusion' };
    const copy = evidenceRecoveryOf({
      evidenceRevisionSpent: true,
      evidenceRecovery: pending,
    });
    if (copy?.pending === undefined) throw new Error('expected pending recovery');
    Object.assign(copy.pending, { instruction: 'stored edit' });
    expect(pending.instruction).toBe('original');
  });

  it('does not manufacture empty spans or ledger arrays', () => {
    expect(foldedSpansOf()).toBeUndefined();
    expect(foldedSpansOf({ foldedSpans: [] })).toBeUndefined();
    expect(findingsLedgerOf()).toBeUndefined();
    expect(findingsLedgerOf({ findingsLedger: [] })).toBeUndefined();
  });

  it('detaches nested retained messages and stage ids from the live fold', () => {
    const spans = [
      {
        summaryFingerprint: 'summary-fingerprint',
        runId: 'recorded-run',
        iteration: 2,
        foldedAtMs: 123,
        model: 'mock',
        messageCount: 1,
        removedStageIds: ['call-llm#1'],
        retained: 'conversation' as const,
        messages: [{ role: 'user' as const, content: 'original question' }],
      },
    ];
    const copy = foldedSpansOf({ foldedSpans: spans });
    expect(copy).toEqual(spans);
    if (copy?.[0]?.messages?.[0] === undefined) throw new Error('expected retained message');
    Object.assign(copy[0].messages[0], { content: 'stored edit' });
    spans[0].removedStageIds.push('later-stage');
    expect(spans[0].messages[0].content).toBe('original question');
    expect(copy[0].removedStageIds).toEqual(['call-llm#1']);
  });

  it('detaches ledger rows in both directions', () => {
    const ledger = [
      {
        kind: 'basis' as const,
        toolCallId: 'call-1',
        toolName: 'lookup',
        iteration: 1,
        basis: 'direct' as const,
      },
    ];
    const copy = findingsLedgerOf({ findingsLedger: ledger });
    expect(copy).toEqual(ledger);
    if (copy?.[0] === undefined) throw new Error('expected ledger row');
    Object.assign(copy[0], { toolCallId: 'stored edit' });
    ledger[0].toolName = 'later live edit';
    expect(ledger[0].toolCallId).toBe('call-1');
    expect(copy[0]).toMatchObject({ toolName: 'lookup' });
  });
});
