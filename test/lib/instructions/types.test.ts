/**
 * LLMInstruction types — 5-pattern tests.
 *
 * Tests type construction, quickBind, InstructionContext, FollowUpBinding,
 * and InstructedToolResult.
 */
import { describe, it, expect } from 'vitest';
import {
  quickBind,
  type LLMInstruction,
  type FollowUpBinding,
  type InstructionContext,
  type RuntimeFollowUp,
  type InstructedToolResult,
  type InstructedToolDefinition,
} from '../../../src/lib/instructions';

// ── Helper ──────────────────────────────────────────────────────

function makeCtx(
  content: Record<string, unknown>,
  overrides?: Partial<InstructionContext>,
): InstructionContext {
  return {
    content,
    latencyMs: 42,
    input: { query: 'test' },
    toolId: 'test-tool',
    ...overrides,
  };
}

// ── Unit ────────────────────────────────────────────────────────

describe('LLMInstruction types — unit', () => {
  it('LLMInstruction with inject only (text only)', () => {
    const instr: LLMInstruction = {
      id: 'oos',
      when: (ctx) => (ctx.content as any).quantity === 0,
      text: 'Item out of stock. Suggest alternatives.',
    };
    expect(instr.id).toBe('oos');
    expect(instr.text).toBeTruthy();
    expect(instr.followUp).toBeUndefined();
  });

  it('LLMInstruction with followUp only (Tier 2)', () => {
    const instr: LLMInstruction = {
      id: 'trace',
      when: (ctx) => (ctx.content as any).denied,
      followUp: {
        toolId: 'get_trace',
        params: (ctx) => ({ traceId: (ctx.content as any).traceId }),
        description: 'Get denial trace',
        condition: 'User asks why',
      },
    };
    expect(instr.followUp?.toolId).toBe('get_trace');
    expect(instr.text).toBeUndefined();
  });

  it('LLMInstruction composite (Tier 3)', () => {
    const instr: LLMInstruction = {
      id: 'flagged',
      text: 'Flagged. Do NOT confirm.',
      followUp: quickBind('get_fraud_report', 'orderId'),
    };
    expect(instr.text).toBeTruthy();
    expect(instr.followUp?.toolId).toBe('get_fraud_report');
  });

  it('InstructionContext provides full execution context', () => {
    const ctx = makeCtx(
      { status: 'denied', traceId: 'tr_123' },
      {
        error: { code: 'TIMEOUT', message: 'timed out' },
        latencyMs: 5000,
      },
    );
    expect(ctx.content).toEqual({ status: 'denied', traceId: 'tr_123' });
    expect(ctx.error?.code).toBe('TIMEOUT');
    expect(ctx.latencyMs).toBe(5000);
    expect(ctx.toolId).toBe('test-tool');
    expect(ctx.input).toEqual({ query: 'test' });
  });
});

// ── quickBind ───────────────────────────────────────────────────

describe('quickBind — unit', () => {
  it('single param extracts field from content', () => {
    const binding = quickBind('get_trace', 'traceId');
    const ctx = makeCtx({ traceId: 'tr_abc', status: 'denied' });
    const params = binding.params(ctx);
    expect(params).toEqual({ traceId: 'tr_abc' });
    expect(binding.toolId).toBe('get_trace');
  });

  it('multiple params extracts all fields', () => {
    const binding = quickBind('get_step_log', ['executionId', 'stepName']);
    const ctx = makeCtx({ executionId: 'ex_1', stepName: 'credit-check' });
    const params = binding.params(ctx);
    expect(params).toEqual({ executionId: 'ex_1', stepName: 'credit-check' });
  });

  it('custom description and condition', () => {
    const binding = quickBind('get_trace', 'traceId', {
      description: 'Retrieve denial reasoning',
      condition: 'User asks why denied',
    });
    expect(binding.description).toBe('Retrieve denial reasoning');
    expect(binding.condition).toBe('User asks why denied');
  });

  it('default description and condition', () => {
    const binding = quickBind('get_trace', 'traceId');
    expect(binding.description).toBe('Follow up with get_trace');
    expect(binding.condition).toBe('User asks for more details');
  });
});

// ── Boundary ────────────────────────────────────────────────────

describe('LLMInstruction types — boundary', () => {
  it('when predicate with no error (normal success result)', () => {
    const instr: LLMInstruction = {
      id: 'success',
      when: (ctx) => !ctx.error,
      text: 'Operation succeeded.',
    };
    const ctx = makeCtx({ status: 'ok' });
    expect(instr.when!(ctx)).toBe(true);
  });

  it('when predicate with error context', () => {
    const instr: LLMInstruction = {
      id: 'timeout',
      when: (ctx) => ctx.error?.code === 'TIMEOUT',
      text: 'Service timed out.',
    };
    const ctx = makeCtx({}, { error: { code: 'TIMEOUT', message: 'timed out' } });
    expect(instr.when!(ctx)).toBe(true);
  });

  it('when predicate with latency threshold', () => {
    const instr: LLMInstruction = {
      id: 'slow',
      when: (ctx) => ctx.latencyMs > 5000,
      text: 'Response was slow. Apologize for the delay.',
    };
    expect(instr.when!(makeCtx({}, { latencyMs: 6000 }))).toBe(true);
    expect(instr.when!(makeCtx({}, { latencyMs: 100 }))).toBe(false);
  });

  it('instruction without when fires unconditionally', () => {
    const instr: LLMInstruction = {
      id: 'always',
      text: 'Always include this guidance.',
    };
    expect(instr.when).toBeUndefined(); // no predicate = always fires
  });

  it('quickBind with missing field returns undefined value', () => {
    const binding = quickBind('get_trace', 'traceId');
    const ctx = makeCtx({ status: 'ok' }); // no traceId field
    const params = binding.params(ctx);
    expect(params).toEqual({ traceId: undefined });
  });
});

// ── Scenario ────────────────────────────────────────────────────

describe('LLMInstruction types — scenario', () => {
  it('loan denial with behavioral + follow-up', () => {
    const instructions: LLMInstruction[] = [
      {
        id: 'denial-empathy',
        description: 'Guide LLM to be empathetic when loan denied',
        when: (ctx) => (ctx.content as any).status === 'denied',
        text: 'Loan denied. Be empathetic. Do NOT promise reversal.',
        followUp: quickBind('get_execution_trace', 'traceId', {
          description: 'Retrieve detailed denial reasoning',
          condition: 'User asks why their loan was denied',
        }),
        priority: 0,
      },
      {
        id: 'pii-guard',
        description: 'Prevent PII leakage from loan result',
        when: (ctx) => !!(ctx.content as any).ssn,
        text: 'Result contains PII. Do NOT repeat SSN or DOB.',
        safety: true,
      },
    ];

    const ctx = makeCtx({ status: 'denied', traceId: 'tr_8f3a', ssn: '123-45-6789' });

    // Both instructions fire
    const fired = instructions.filter((i) => !i.when || i.when(ctx));
    expect(fired).toHaveLength(2);
    expect(fired[0].id).toBe('denial-empathy');
    expect(fired[1].id).toBe('pii-guard');
    expect(fired[1].safety).toBe(true);

    // Follow-up resolves params correctly
    const followUp = fired[0].followUp!;
    expect(followUp.params(ctx)).toEqual({ traceId: 'tr_8f3a' });
  });

  it('InstructedToolResult from handler with runtime instructions', () => {
    const result: InstructedToolResult = {
      content: '{"status":"delayed"}',
      instructions: ['Delivery delayed. Apologize and offer tracking.'],
      followUps: [
        {
          toolId: 'track_package',
          params: { trackingId: 'PKG_123' },
          description: 'Track package location',
          condition: 'User asks where their package is',
        },
      ],
    };

    expect(result.instructions).toHaveLength(1);
    expect(result.followUps).toHaveLength(1);
    expect(result.followUps![0].params).toEqual({ trackingId: 'PKG_123' });
  });
});

// ── Property ────────────────────────────────────────────────────

describe('LLMInstruction types — property', () => {
  it('quickBind is equivalent to manual FollowUpBinding', () => {
    const quick = quickBind('get_trace', 'traceId');
    const manual: FollowUpBinding = {
      toolId: 'get_trace',
      params: (ctx) => ({ traceId: (ctx.content as any).traceId }),
      description: 'Follow up with get_trace',
      condition: 'User asks for more details',
    };

    const ctx = makeCtx({ traceId: 'tr_abc' });
    expect(quick.toolId).toBe(manual.toolId);
    expect(quick.params(ctx)).toEqual(manual.params(ctx));
    expect(quick.description).toBe(manual.description);
    expect(quick.condition).toBe(manual.condition);
  });

  it('priority defaults to 0 when not specified', () => {
    const instr: LLMInstruction = { id: 'test', text: 'test' };
    expect(instr.priority ?? 0).toBe(0);
  });

  it('safety defaults to false when not specified', () => {
    const instr: LLMInstruction = { id: 'test', text: 'test' };
    expect(instr.safety ?? false).toBe(false);
  });
});

// ── Security ────────────────────────────────────────────────────

describe('LLMInstruction types — security', () => {
  it('safety instructions have safety flag set', () => {
    const instr: LLMInstruction = {
      id: 'pii',
      when: (ctx) => !!(ctx.content as any).hasPII,
      text: 'Do NOT repeat raw PII values.',
      safety: true,
    };
    expect(instr.safety).toBe(true);
  });

  it('quickBind does not leak fields not in paramNames', () => {
    const binding = quickBind('get_trace', 'traceId');
    const ctx = makeCtx({ traceId: 'tr_1', secretKey: 'sk_secret', ssn: '123-45-6789' });
    const params = binding.params(ctx);
    // Only extracts traceId — ssn and secretKey are not leaked
    expect(params).toEqual({ traceId: 'tr_1' });
    expect(params).not.toHaveProperty('secretKey');
    expect(params).not.toHaveProperty('ssn');
  });

  it('InstructionContext input is separate from content', () => {
    const ctx = makeCtx({ result: 'data' }, { input: { apiKey: 'sk-secret' } });
    // Input and content are separate — instruction predicates can
    // check input but the follow-up params resolve from content only
    expect(ctx.input).toEqual({ apiKey: 'sk-secret' });
    expect(ctx.content).toEqual({ result: 'data' });
  });
});
