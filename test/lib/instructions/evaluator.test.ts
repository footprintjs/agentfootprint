/**
 * Instruction evaluator — 5-pattern tests.
 *
 * Tests predicate matching, priority sorting, injection ordering,
 * error handling, and runtime instruction merging.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateInstructions,
  mergeRuntimeInstructions,
  type ResolvedInstruction,
} from '../../../src/lib/instructions/evaluator';
import { quickBind, type LLMInstruction, type InstructionContext } from '../../../src/lib/instructions';

// ── Helper ──────────────────────────────────────────────────────

function ctx(content: Record<string, unknown>, overrides?: Partial<InstructionContext>): InstructionContext {
  return { content, latencyMs: 10, input: {}, toolId: 'test', ...overrides };
}

// ── Unit ────────────────────────────────────────────────────────

describe('evaluateInstructions — unit', () => {
  it('returns empty for no instructions', () => {
    expect(evaluateInstructions(undefined, ctx({}))).toEqual([]);
    expect(evaluateInstructions([], ctx({}))).toEqual([]);
  });

  it('fires instruction when predicate matches', () => {
    const instructions: LLMInstruction[] = [
      { id: 'oos', when: (c) => (c.content as any).qty === 0, inject: 'Out of stock.' },
    ];
    const result = evaluateInstructions(instructions, ctx({ qty: 0 }));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('oos');
    expect(result[0].inject).toBe('Out of stock.');
  });

  it('skips instruction when predicate returns false', () => {
    const instructions: LLMInstruction[] = [
      { id: 'oos', when: (c) => (c.content as any).qty === 0, inject: 'Out of stock.' },
    ];
    expect(evaluateInstructions(instructions, ctx({ qty: 5 }))).toEqual([]);
  });

  it('fires unconditional instruction (no when)', () => {
    const instructions: LLMInstruction[] = [
      { id: 'always', inject: 'Always include this.' },
    ];
    const result = evaluateInstructions(instructions, ctx({}));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('always');
  });

  it('resolves follow-up params from context', () => {
    const instructions: LLMInstruction[] = [
      {
        id: 'trace',
        when: (c) => (c.content as any).denied,
        followUp: quickBind('get_trace', 'traceId'),
      },
    ];
    const result = evaluateInstructions(instructions, ctx({ denied: true, traceId: 'tr_abc' }));
    expect(result[0].resolvedFollowUp).toBeDefined();
    expect(result[0].resolvedFollowUp!.toolId).toBe('get_trace');
    expect(result[0].resolvedFollowUp!.params).toEqual({ traceId: 'tr_abc' });
  });
});

// ── Boundary ────────────────────────────────────────────────────

describe('evaluateInstructions — boundary', () => {
  it('predicate throws: behavioral instruction skipped (fail-open)', () => {
    const instructions: LLMInstruction[] = [
      { id: 'broken', when: () => { throw new Error('bug'); }, inject: 'Never see this.' },
      { id: 'ok', inject: 'This fires.' },
    ];
    const result = evaluateInstructions(instructions, ctx({}));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ok');
  });

  it('predicate throws: safety instruction fires (fail-closed)', () => {
    const instructions: LLMInstruction[] = [
      { id: 'safety', when: () => { throw new Error('bug'); }, inject: 'PII guard.', safety: true },
    ];
    const result = evaluateInstructions(instructions, ctx({}));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('safety');
    expect(result[0].safety).toBe(true);
  });

  it('follow-up params throws: inject preserved, follow-up dropped', () => {
    const instructions: LLMInstruction[] = [
      {
        id: 'bad-params',
        inject: 'Be empathetic.',
        followUp: {
          toolId: 'get_trace',
          params: () => { throw new Error('no traceId'); },
          description: 'Get trace',
          condition: 'User asks',
        },
      },
    ];
    const result = evaluateInstructions(instructions, ctx({}));
    expect(result).toHaveLength(1);
    expect(result[0].inject).toBe('Be empathetic.');
    expect(result[0].resolvedFollowUp).toBeUndefined();
  });

  it('multiple instructions fire — all returned', () => {
    const instructions: LLMInstruction[] = [
      { id: 'a', inject: 'A' },
      { id: 'b', inject: 'B' },
      { id: 'c', inject: 'C' },
    ];
    expect(evaluateInstructions(instructions, ctx({}))).toHaveLength(3);
  });
});

// ── Scenario ────────────────────────────────────────────────────

describe('evaluateInstructions — scenario', () => {
  it('loan denial: empathy + follow-up + PII safety — correct order', () => {
    const instructions: LLMInstruction[] = [
      {
        id: 'empathy',
        when: (c) => (c.content as any).status === 'denied',
        inject: 'Be empathetic.',
        followUp: quickBind('get_trace', 'traceId'),
        priority: 1,
      },
      {
        id: 'pii',
        when: (c) => !!(c.content as any).ssn,
        inject: 'Do NOT repeat SSN.',
        safety: true,
        priority: 0,
      },
      {
        id: 'vip',
        when: (c) => (c.content as any).tier === 'vip',
        inject: 'VIP customer.',
        priority: 0,
      },
    ];

    const result = evaluateInstructions(
      instructions,
      ctx({ status: 'denied', traceId: 'tr_1', ssn: '123', tier: 'vip' }),
    );

    expect(result).toHaveLength(3);
    // Order: non-safety by priority (vip=0, empathy=1), then safety last
    expect(result[0].id).toBe('vip');       // priority 0, non-safety
    expect(result[1].id).toBe('empathy');   // priority 1, non-safety
    expect(result[2].id).toBe('pii');       // safety — LAST
  });

  it('merge runtime instructions between build-time and safety', () => {
    const buildTime = evaluateInstructions(
      [
        { id: 'empathy', inject: 'Be empathetic.', priority: 0 },
        { id: 'pii', inject: 'No PII.', safety: true },
      ],
      ctx({}),
    );

    const merged = mergeRuntimeInstructions(buildTime, {
      instructions: ['Service degraded. Set expectations.'],
      followUps: [{
        toolId: 'status_page',
        params: { region: 'us' },
        description: 'Check status',
        condition: 'User asks about delays',
      }],
    });

    // Order: build-time non-safety → runtime → build-time safety
    expect(merged[0].id).toBe('empathy');                    // build-time non-safety
    expect(merged[1].id).toBe('runtime-followup-status_page'); // runtime follow-up
    expect(merged[2].id).toBe('runtime-inject-0');           // runtime inject
    expect(merged[3].id).toBe('pii');                        // safety LAST
  });
});

// ── Property ────────────────────────────────────────────────────

describe('evaluateInstructions — property', () => {
  it('safety instructions always come after non-safety regardless of priority', () => {
    const instructions: LLMInstruction[] = [
      { id: 'safety-high', inject: 'S', safety: true, priority: -100 }, // lowest priority number
      { id: 'normal', inject: 'N', priority: 999 },                     // highest priority number
    ];
    const result = evaluateInstructions(instructions, ctx({}));
    expect(result[0].id).toBe('normal');      // non-safety first
    expect(result[1].id).toBe('safety-high'); // safety last, even with lower priority number
  });

  it('stable sort: same priority preserves array order', () => {
    const instructions: LLMInstruction[] = [
      { id: 'first', inject: 'A', priority: 0 },
      { id: 'second', inject: 'B', priority: 0 },
      { id: 'third', inject: 'C', priority: 0 },
    ];
    const result = evaluateInstructions(instructions, ctx({}));
    expect(result.map((r) => r.id)).toEqual(['first', 'second', 'third']);
  });

  it('evaluateInstructions is pure — same input produces same output', () => {
    const instructions: LLMInstruction[] = [
      { id: 'a', when: (c) => (c.content as any).x > 0, inject: 'A' },
      { id: 'b', inject: 'B' },
    ];
    const c = ctx({ x: 1 });
    const r1 = evaluateInstructions(instructions, c);
    const r2 = evaluateInstructions(instructions, c);
    expect(r1.map((r) => r.id)).toEqual(r2.map((r) => r.id));
  });
});

// ── Security ────────────────────────────────────────────────────

describe('evaluateInstructions — security', () => {
  it('safety instructions fire even when all behavioral predicates fail', () => {
    const instructions: LLMInstruction[] = [
      { id: 'behavioral', when: () => false, inject: 'Never fires.' },
      { id: 'safety', inject: 'Always guard PII.', safety: true },
    ];
    const result = evaluateInstructions(instructions, ctx({}));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('safety');
  });

  it('mergeRuntimeInstructions rejects follow-ups without params', () => {
    const merged = mergeRuntimeInstructions([], {
      followUps: [
        { toolId: 'get_trace', params: { id: '1' }, description: 'ok', condition: 'ok' },
        { toolId: '', params: { id: '2' }, description: 'empty id', condition: 'ok' }, // empty toolId
        { toolId: 'get_trace', params: undefined as any, description: 'no params', condition: 'ok' }, // no params
      ],
    });
    // Only the valid follow-up passes
    expect(merged).toHaveLength(1);
    expect(merged[0].resolvedFollowUp!.toolId).toBe('get_trace');
  });

  it('resolved follow-up has strict defaulting to false', () => {
    const instructions: LLMInstruction[] = [
      { id: 'fu', followUp: quickBind('get_trace', 'traceId') },
    ];
    const result = evaluateInstructions(instructions, ctx({ traceId: 'tr_1' }));
    expect(result[0].resolvedFollowUp!.strict).toBe(false);
  });
});
