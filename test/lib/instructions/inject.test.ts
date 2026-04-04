/**
 * Instruction injection + template — 5-pattern tests.
 *
 * Tests the full pipeline: evaluate → render → append to tool result content.
 * Covers default template, custom templates, and processInstructions().
 */
import { describe, it, expect } from 'vitest';
import { renderInstructions } from '../../../src/lib/instructions/template';
import { processInstructions } from '../../../src/lib/instructions/inject';
import { evaluateInstructions } from '../../../src/lib/instructions/evaluator';
import { quickBind, type LLMInstruction, type InstructionContext, type InstructionTemplate } from '../../../src/lib/instructions';

// ── Helper ──────────────────────────────────────────────────────

function ctx(content: Record<string, unknown>, overrides?: Partial<InstructionContext>): InstructionContext {
  return { content, latencyMs: 10, input: {}, toolId: 'test', ...overrides };
}

// ── Unit: renderInstructions ────────────────────────────────────

describe('renderInstructions — unit', () => {
  it('returns undefined for empty instructions', () => {
    expect(renderInstructions([])).toBeUndefined();
  });

  it('renders behavioral inject with [INSTRUCTION] prefix', () => {
    const fired = evaluateInstructions(
      [{ id: 'a', text: 'Be empathetic.' }],
      ctx({}),
    );
    const text = renderInstructions(fired)!;
    expect(text).toContain('[INSTRUCTION] Be empathetic.');
  });

  it('renders follow-up with structured block', () => {
    const fired = evaluateInstructions(
      [{ id: 'a', followUp: quickBind('get_trace', 'traceId') }],
      ctx({ traceId: 'tr_1' }),
    );
    const text = renderInstructions(fired)!;
    expect(text).toContain('[AVAILABLE ACTION]');
    expect(text).toContain('Tool: get_trace');
    expect(text).toContain('"traceId":"tr_1"');
    expect(text).toContain('Use when:');
  });

  it('renders composite (inject + followUp) in one block', () => {
    const fired = evaluateInstructions(
      [{
        id: 'a',
        text: 'Order flagged.',
        followUp: quickBind('get_fraud', 'orderId'),
      }],
      ctx({ orderId: 'ord_1' }),
    );
    const text = renderInstructions(fired)!;
    expect(text).toContain('[INSTRUCTION] Order flagged.');
    expect(text).toContain('[AVAILABLE ACTION]');
    expect(text).toContain('Tool: get_fraud');
  });

  it('uses custom template when provided', () => {
    const custom: InstructionTemplate = {
      formatText: (text) => `<guidance>${text}</guidance>`,
      formatFollowUp: (fu) => `<action tool="${fu.toolId}" />`,
      formatBlock: (parts) => parts.join('\n'),
    };
    const fired = evaluateInstructions(
      [{
        id: 'a',
        text: 'Be kind.',
        followUp: quickBind('get_trace', 'traceId'),
      }],
      ctx({ traceId: 'tr_1' }),
    );
    const text = renderInstructions(fired, custom)!;
    expect(text).toContain('<guidance>Be kind.</guidance>');
    expect(text).toContain('<action tool="get_trace" />');
    expect(text).not.toContain('[INSTRUCTION]');
  });
});

// ── Unit: processInstructions ───────────────────────────────────

describe('processInstructions — unit', () => {
  it('returns original content when no instructions match', () => {
    const result = processInstructions(
      'tool output here',
      [{ id: 'a', when: () => false, text: 'never' }],
      ctx({}),
    );
    expect(result.content).toBe('tool output here');
    expect(result.fired).toEqual([]);
    expect(result.injected).toBe(false);
  });

  it('appends instruction text to original content', () => {
    const result = processInstructions(
      '{"status":"denied"}',
      [{ id: 'a', text: 'Be empathetic.' }],
      ctx({}),
    );
    expect(result.content).toContain('{"status":"denied"}');
    expect(result.content).toContain('[INSTRUCTION] Be empathetic.');
    expect(result.injected).toBe(true);
    expect(result.fired).toHaveLength(1);
  });

  it('includes runtime instructions in output', () => {
    const result = processInstructions(
      'result',
      undefined, // no build-time instructions
      ctx({}),
      { instructions: ['Service degraded.'] },
    );
    expect(result.content).toContain('[INSTRUCTION] Service degraded.');
    expect(result.injected).toBe(true);
  });
});

// ── Boundary ────────────────────────────────────────────────────

describe('injection — boundary', () => {
  it('no build-time instructions + no runtime = no injection', () => {
    const result = processInstructions('result', undefined, ctx({}));
    expect(result.content).toBe('result');
    expect(result.injected).toBe(false);
  });

  it('instruction with only follow-up (no inject text) still produces output', () => {
    const result = processInstructions(
      'result',
      [{ id: 'a', followUp: quickBind('get_trace', 'id') }],
      ctx({ id: '123' }),
    );
    expect(result.content).toContain('[AVAILABLE ACTION]');
    expect(result.injected).toBe(true);
  });

  it('empty inject string is not rendered', () => {
    const fired = evaluateInstructions([{ id: 'a', text: '' }], ctx({}));
    // Empty string is falsy — renderInstructions skips it
    const text = renderInstructions(fired);
    expect(text).toBeUndefined();
  });

  it('custom template with partial overrides falls back to default', () => {
    const partial: InstructionTemplate = {
      formatText: (text) => `CUSTOM: ${text}`,
      // no formatFollowUp — falls back to default
    };
    const fired = evaluateInstructions(
      [{ id: 'a', text: 'Hello', followUp: quickBind('tool', 'id') }],
      ctx({ id: '1' }),
    );
    const text = renderInstructions(fired, partial)!;
    expect(text).toContain('CUSTOM: Hello');
    expect(text).toContain('[AVAILABLE ACTION]'); // default follow-up format
  });
});

// ── Scenario ────────────────────────────────────────────────────

describe('injection — scenario', () => {
  it('loan denial: full pipeline with behavioral + follow-up + safety', () => {
    const instructions: LLMInstruction[] = [
      {
        id: 'empathy',
        when: (c) => (c.content as any).status === 'denied',
        text: 'Loan denied. Be empathetic. Do NOT promise reversal.',
        followUp: quickBind('get_trace', 'traceId', {
          description: 'Retrieve denial reasoning',
          condition: 'User asks why',
        }),
        priority: 1,
      },
      {
        id: 'pii',
        when: (c) => !!(c.content as any).ssn,
        text: 'Contains PII. Do NOT repeat SSN to user.',
        safety: true,
      },
    ];

    const result = processInstructions(
      '{"status":"denied","traceId":"tr_8f3a","ssn":"123-45-6789"}',
      instructions,
      ctx({ status: 'denied', traceId: 'tr_8f3a', ssn: '123-45-6789' }),
    );

    // Original content preserved
    expect(result.content).toContain('"status":"denied"');

    // Follow-up injected
    expect(result.content).toContain('Tool: get_trace');
    expect(result.content).toContain('"traceId":"tr_8f3a"');
    expect(result.content).toContain('Retrieve denial reasoning');

    // Behavioral injected
    expect(result.content).toContain('Be empathetic');

    // Safety injected LAST (highest attention)
    const empathyPos = result.content.indexOf('Be empathetic');
    const safetyPos = result.content.indexOf('Do NOT repeat SSN');
    expect(safetyPos).toBeGreaterThan(empathyPos);

    // Both fired
    expect(result.fired).toHaveLength(2);
    expect(result.injected).toBe(true);
  });

  it('build-time + runtime combined', () => {
    const result = processInstructions(
      '{"delayed": true}',
      [{ id: 'empathy', text: 'Apologize for the delay.' }],
      ctx({ delayed: true }),
      {
        instructions: ['ETA is approximately 2 hours.'],
        followUps: [{
          toolId: 'track_package',
          params: { trackingId: 'PKG_1' },
          description: 'Track package',
          condition: 'User asks where it is',
        }],
      },
    );

    expect(result.content).toContain('Apologize for the delay');
    expect(result.content).toContain('ETA is approximately 2 hours');
    expect(result.content).toContain('Tool: track_package');
    expect(result.fired).toHaveLength(3); // build-time + runtime followUp + runtime inject
  });
});

// ── Property ────────────────────────────────────────────────────

describe('injection — property', () => {
  it('processInstructions is pure — does not modify original content string', () => {
    const original = 'original content';
    const result = processInstructions(
      original,
      [{ id: 'a', text: 'Appended.' }],
      ctx({}),
    );
    // Original string is unchanged (strings are immutable in JS, but verify intent)
    expect(original).toBe('original content');
    // Result has new content
    expect(result.content).not.toBe(original);
    expect(result.content.startsWith(original)).toBe(true);
  });

  it('injection text is separated from content by double newline', () => {
    const result = processInstructions(
      'content',
      [{ id: 'a', text: 'Guidance.' }],
      ctx({}),
    );
    expect(result.content).toBe('content\n\n[INSTRUCTION] Guidance.');
  });
});

// ── Security ────────────────────────────────────────────────────

describe('injection — security', () => {
  it('safety instruction is always last in injected text', () => {
    const instructions: LLMInstruction[] = [
      { id: 'safety', text: 'SAFETY: Do NOT leak PII.', safety: true, priority: -1 },
      { id: 'normal1', text: 'Normal instruction 1.', priority: 0 },
      { id: 'normal2', text: 'Normal instruction 2.', priority: 0 },
    ];
    const result = processInstructions('result', instructions, ctx({}));

    const lines = result.content.split('\n\n');
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toContain('SAFETY: Do NOT leak PII.');
  });

  it('follow-up params do not include fields not specified', () => {
    const result = processInstructions(
      'result',
      [{
        id: 'a',
        followUp: quickBind('get_trace', 'traceId'),
      }],
      ctx({ traceId: 'tr_1', secretKey: 'sk_secret', ssn: '123' }),
    );
    // Only traceId in the injected text — no secretKey or ssn
    expect(result.content).toContain('"traceId":"tr_1"');
    expect(result.content).not.toContain('sk_secret');
    expect(result.content).not.toContain('123');
  });
});
