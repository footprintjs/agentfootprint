/**
 * previewInstructions — 5-pattern tests.
 *
 * Tests the dry-run preview that shows what the LLM would receive
 * for a given mock tool result, without running the agent.
 */
import { describe, it, expect } from 'vitest';
import { previewInstructions, quickBind } from '../../../src/test-barrel';
import type { LLMInstruction, PreviewContext } from '../../../src/test-barrel';

// ── Helpers ─────────────────────────────────────────────────

const instructions: LLMInstruction[] = [
  {
    id: 'empathy',
    when: (ctx) => (ctx.content as any)?.status === 'denied',
    text: 'Be empathetic.',
  },
  {
    id: 'trace',
    when: (ctx) => !!(ctx.content as any)?.traceId,
    followUp: quickBind('get_trace', 'traceId'),
  },
  { id: 'pii', when: (ctx) => !!(ctx.content as any)?.ssn, text: 'No PII.', safety: true },
  { id: 'low-stock', when: (ctx) => (ctx.content as any)?.stock < 5, text: 'Low stock warning.' },
];

const deniedCtx: PreviewContext = {
  content: { status: 'denied', traceId: 'tr_1', ssn: '123' },
  toolId: 'evaluate_loan',
};

const approvedCtx: PreviewContext = {
  content: { status: 'approved' },
  toolId: 'evaluate_loan',
};

// ── Unit ────────────────────────────────────────────────────

describe('previewInstructions — unit', () => {
  it('shows which instructions fire for a denied loan', () => {
    const preview = previewInstructions(instructions, deniedCtx);
    expect(preview.firedIds).toEqual(['empathy', 'trace', 'pii']);
    expect(preview.skippedIds).toEqual(['low-stock']);
  });

  it('shows injected text with [INSTRUCTION] and [AVAILABLE ACTION]', () => {
    const preview = previewInstructions(instructions, deniedCtx);
    expect(preview.injectedText).toContain('[INSTRUCTION] Be empathetic.');
    expect(preview.injectedText).toContain('[AVAILABLE ACTION]');
    expect(preview.injectedText).toContain('get_trace');
    expect(preview.injectedText).toContain('[INSTRUCTION] No PII.');
  });

  it('shows follow-ups with resolved params', () => {
    const preview = previewInstructions(instructions, deniedCtx);
    expect(preview.followUps).toHaveLength(1);
    expect(preview.followUps[0].toolId).toBe('get_trace');
    expect(preview.followUps[0].params).toEqual({ traceId: 'tr_1' });
  });

  it('estimates tokens', () => {
    const preview = previewInstructions(instructions, deniedCtx);
    expect(preview.estimatedTokens).toBeGreaterThan(0);
  });

  it('returns empty for approved loan (no instructions match)', () => {
    const preview = previewInstructions(instructions, approvedCtx);
    expect(preview.firedIds).toEqual([]);
    expect(preview.skippedIds).toEqual(['empathy', 'trace', 'pii', 'low-stock']);
    expect(preview.injectedText).toBeUndefined();
    expect(preview.estimatedTokens).toBe(0);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('previewInstructions — boundary', () => {
  it('handles undefined instructions', () => {
    const preview = previewInstructions(undefined, deniedCtx);
    expect(preview.firedIds).toEqual([]);
    expect(preview.injectedText).toBeUndefined();
  });

  it('handles empty instructions array', () => {
    const preview = previewInstructions([], deniedCtx);
    expect(preview.firedIds).toEqual([]);
  });

  it('handles error context', () => {
    const errCtx: PreviewContext = {
      content: {},
      toolId: 'broken_tool',
      error: { code: 'TIMEOUT', message: 'timed out' },
    };
    const errInstr: LLMInstruction[] = [
      { id: 'timeout', when: (ctx) => ctx.error?.code === 'TIMEOUT', text: 'Service timed out.' },
    ];
    const preview = previewInstructions(errInstr, errCtx);
    expect(preview.firedIds).toEqual(['timeout']);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('previewInstructions — scenario', () => {
  it('preview with overrides applied', () => {
    const preview = previewInstructions(instructions, deniedCtx, {
      overrides: {
        suppress: ['empathy'],
        replace: { pii: { text: 'REDACTED — do not repeat any values.' } },
      },
    });

    // empathy suppressed
    expect(preview.firedIds).not.toContain('empathy');
    // pii replaced
    expect(preview.injectedText).toContain('REDACTED');
    expect(preview.injectedText).not.toContain('No PII.');
    // trace still fires
    expect(preview.firedIds).toContain('trace');
  });
});

// ── Property ────────────────────────────────────────────────

describe('previewInstructions — property', () => {
  it('firedIds + skippedIds = all instruction IDs', () => {
    const preview = previewInstructions(instructions, deniedCtx);
    const allIds = instructions.map((i) => i.id);
    const combined = [...preview.firedIds, ...preview.skippedIds].sort();
    expect(combined).toEqual(allIds.sort());
  });

  it('estimatedTokens is roughly injectedText.length / 4', () => {
    const preview = previewInstructions(instructions, deniedCtx);
    if (preview.injectedText) {
      const expected = Math.ceil(preview.injectedText.length / 4);
      expect(preview.estimatedTokens).toBe(expected);
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('previewInstructions — security', () => {
  it('safety instructions appear last in fired list', () => {
    const preview = previewInstructions(instructions, deniedCtx);
    const safetyIndex = preview.fired.findIndex((f) => f.safety);
    // Safety should be the last entry
    expect(safetyIndex).toBe(preview.fired.length - 1);
  });

  it('follow-up params contain only specified fields', () => {
    const preview = previewInstructions(instructions, deniedCtx);
    const fuParams = preview.followUps[0]?.params;
    expect(fuParams).toEqual({ traceId: 'tr_1' });
    // No ssn leaked
    expect(fuParams).not.toHaveProperty('ssn');
  });
});
