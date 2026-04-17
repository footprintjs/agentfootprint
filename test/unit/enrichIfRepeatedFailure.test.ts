/**
 * Unit tests for the repeated-failure escalation helper and its supports.
 *
 * Covers:
 *   - stableStringify canonicalization (JSON key-order fragility fix)
 *   - strict JSON error detection (no substring false positives)
 *   - threshold respected + configurable + disabled at 0
 *   - escalation emitted exactly once per (name, args)
 *   - different args / successful calls do not trigger
 */

import { describe, it, expect } from 'vitest';
import {
  enrichIfRepeatedFailure,
  stableStringify,
  REPEATED_FAILURE_ESCALATION_THRESHOLD,
} from '../../src/lib/call/helpers';
import { assistantMessage, toolResultMessage, userMessage } from '../../src/types/messages';
import type { Message, ToolCall } from '../../src/types';

function errorMsg(payload: Record<string, unknown>): string {
  return JSON.stringify({ error: true, ...payload });
}

function history(calls: Array<{ args: Record<string, unknown>; result: string; id: string }>): Message[] {
  const msgs: Message[] = [userMessage('go')];
  for (const c of calls) {
    const tc: ToolCall = { id: c.id, name: 'broken', arguments: c.args };
    msgs.push(assistantMessage('calling', [tc]));
    msgs.push(toolResultMessage(c.result, c.id));
  }
  return msgs;
}

describe('stableStringify', () => {
  it('produces identical output regardless of key order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('handles nested objects', () => {
    expect(stableStringify({ outer: { b: 2, a: 1 } })).toBe(
      stableStringify({ outer: { a: 1, b: 2 } }),
    );
  });

  it('arrays preserve order', () => {
    expect(stableStringify([3, 1, 2])).not.toBe(stableStringify([1, 2, 3]));
  });

  it('handles primitives', () => {
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(null)).toBe('null');
  });
});

describe('enrichIfRepeatedFailure — core behavior', () => {
  const tc: ToolCall = { id: 'c', name: 'broken', arguments: { wrong: true } };
  const errorContent = errorMsg({ message: 'bad' });

  it('below threshold: no enrichment', () => {
    const prior = history([
      { args: { wrong: true }, result: errorMsg({ message: 'bad' }), id: 'p1' },
    ]);
    const out = enrichIfRepeatedFailure(errorContent, tc, prior, { didError: true, threshold: 3 });
    // 2 total failures (1 prior + 1 current) < threshold 3
    expect(out).toBe(errorContent);
  });

  it('at threshold: enrichment fires', () => {
    const prior = history([
      { args: { wrong: true }, result: errorMsg({ message: 'bad' }), id: 'p1' },
      { args: { wrong: true }, result: errorMsg({ message: 'bad' }), id: 'p2' },
    ]);
    const out = enrichIfRepeatedFailure(errorContent, tc, prior, { didError: true, threshold: 3 });
    expect(out).toContain('escalation');
    expect(out).toContain('repeatedFailures');
    expect(out).toContain('3');
  });

  it('4th failure (above threshold, not a multiple): bare — escalation silent between fires', () => {
    const prior = history([
      { args: { wrong: true }, result: errorMsg({ message: 'bad' }), id: 'p1' },
      { args: { wrong: true }, result: errorMsg({ message: 'bad' }), id: 'p2' },
      { args: { wrong: true }, result: errorMsg({ message: 'bad' }), id: 'p3' },
    ]);
    // Current = 4th identical failure. threshold=3 already fired at 3.
    // total=4 is not a multiple of 3 → no escalation. 4, 5 are bare;
    // 6 re-fires (covered in the next test).
    const out = enrichIfRepeatedFailure(errorContent, tc, prior, { didError: true, threshold: 3 });
    expect(out).toBe(errorContent);
  });

  it('periodic re-emit: escalation fires again at 6, 9, 12 ...', () => {
    // Prior = 5 identical failures (so current is the 6th). Threshold=3.
    // 6 % 3 === 0 → escalation re-fires with repeatedFailures=6.
    const prior = history(
      Array.from({ length: 5 }, (_, i) => ({
        args: { wrong: true },
        result: errorMsg({ message: 'bad' }),
        id: `p${i + 1}`,
      })),
    );
    const out = enrichIfRepeatedFailure(errorContent, tc, prior, { didError: true, threshold: 3 });
    expect(out).toContain('escalation');
    expect(out).toContain('"repeatedFailures":6');
  });

  it('different args do not count as prior failures', () => {
    const prior = history([
      { args: { a: 1 }, result: errorMsg({ message: 'bad' }), id: 'p1' },
      { args: { b: 2 }, result: errorMsg({ message: 'bad' }), id: 'p2' },
    ]);
    const out = enrichIfRepeatedFailure(errorContent, tc, prior, { didError: true, threshold: 3 });
    expect(out).toBe(errorContent);
  });

  it('key-order differences are treated as identical (stableStringify)', () => {
    // Prior call used {a:1, b:2}; current uses {b:2, a:1} — same logically.
    const priorCall = { a: 1, b: 2 };
    const currentCall = { b: 2, a: 1 };
    const prior = history([
      { args: priorCall, result: errorMsg({ message: 'bad' }), id: 'p1' },
      { args: priorCall, result: errorMsg({ message: 'bad' }), id: 'p2' },
    ]);
    const currentTC: ToolCall = { id: 'c', name: 'broken', arguments: currentCall };
    const out = enrichIfRepeatedFailure(errorContent, currentTC, prior, {
      didError: true,
      threshold: 3,
    });
    expect(out).toContain('escalation');
  });

  it('successful calls do not count', () => {
    // Prior tool results contain no "error":true — they are successes.
    const prior = history([
      { args: { wrong: true }, result: '{"status":"ok"}', id: 'p1' },
      { args: { wrong: true }, result: '{"status":"ok"}', id: 'p2' },
    ]);
    const out = enrichIfRepeatedFailure(errorContent, tc, prior, { didError: true, threshold: 3 });
    expect(out).toBe(errorContent);
  });
});

describe('enrichIfRepeatedFailure — strict JSON detection', () => {
  const tc: ToolCall = { id: 'c', name: 'broken', arguments: {} };

  it('tool content with "error":true in prose (not top-level field) is NOT a false positive', () => {
    // A legitimate successful tool result that happens to contain the phrase
    // `"error":true` inside a string field — strict JSON parse ignores this.
    const falseSignal = JSON.stringify({
      success: true,
      log: 'the API docs say: {"error":true,"reason":"..."} is an error response shape',
    });
    const prior = history([
      { args: {}, result: falseSignal, id: 'p1' },
      { args: {}, result: falseSignal, id: 'p2' },
    ]);
    const currentError = errorMsg({ message: 'bad' });
    const out = enrichIfRepeatedFailure(currentError, tc, prior, {
      didError: true,
      threshold: 3,
    });
    expect(out).toBe(currentError); // 1 real failure (current) — below threshold
  });

  it('no-op when didError=false', () => {
    const prior = history([
      { args: {}, result: errorMsg({ message: 'bad' }), id: 'p1' },
      { args: {}, result: errorMsg({ message: 'bad' }), id: 'p2' },
    ]);
    const successContent = '{"result":"ok"}';
    const out = enrichIfRepeatedFailure(successContent, tc, prior, {
      didError: false,
      threshold: 3,
    });
    expect(out).toBe(successContent);
  });

  it('no-op when content is not JSON', () => {
    const prior = history([
      { args: {}, result: errorMsg({ message: 'bad' }), id: 'p1' },
      { args: {}, result: errorMsg({ message: 'bad' }), id: 'p2' },
    ]);
    const plain = 'plain text error';
    const out = enrichIfRepeatedFailure(plain, tc, prior, { didError: true, threshold: 3 });
    expect(out).toBe(plain);
  });
});

describe('enrichIfRepeatedFailure — threshold config', () => {
  const tc: ToolCall = { id: 'c', name: 'broken', arguments: { x: 1 } };
  const errorContent = errorMsg({ message: 'bad' });

  it('threshold 0 disables escalation entirely', () => {
    const prior = history(
      Array(10)
        .fill(null)
        .map((_, i) => ({ args: { x: 1 }, result: errorMsg({ message: 'bad' }), id: `p${i}` })),
    );
    const out = enrichIfRepeatedFailure(errorContent, tc, prior, { didError: true, threshold: 0 });
    expect(out).toBe(errorContent);
  });

  it('threshold 2 fires on 2nd failure', () => {
    const prior = history([{ args: { x: 1 }, result: errorMsg({ message: 'bad' }), id: 'p1' }]);
    const out = enrichIfRepeatedFailure(errorContent, tc, prior, { didError: true, threshold: 2 });
    expect(out).toContain('escalation');
    expect(out).toContain('2');
  });

  it('module-level default constant is 3', () => {
    expect(REPEATED_FAILURE_ESCALATION_THRESHOLD).toBe(3);
  });
});
