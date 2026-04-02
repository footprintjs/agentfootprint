/**
 * InstructionRecorder — 5-pattern tests.
 *
 * Tests tracking of instruction firings, follow-up offerings,
 * per-tool breakdown, and summary aggregation.
 */
import { describe, it, expect } from 'vitest';
import { InstructionRecorder } from '../../../src/lib/instructions/InstructionRecorder';
import type { ResolvedInstruction } from '../../../src/lib/instructions/evaluator';

// ── Helpers ─────────────────────────────────────────────────────

function firing(id: string, opts?: { inject?: string; safety?: boolean; followUpToolId?: string }): ResolvedInstruction {
  return {
    id,
    inject: opts?.inject,
    safety: opts?.safety ?? false,
    priority: 0,
    resolvedFollowUp: opts?.followUpToolId ? {
      toolId: opts.followUpToolId,
      params: { id: '123' },
      description: 'test',
      condition: 'user asks',
      strict: false,
    } : undefined,
  };
}

// ── Unit ────────────────────────────────────────────────────────

describe('InstructionRecorder — unit', () => {
  it('records a single instruction firing', () => {
    const rec = new InstructionRecorder();
    rec.recordFirings('check_order', [firing('oos')]);

    expect(rec.getFiringCount('check_order', 'oos')).toBe(1);
    expect(rec.getFiredInstructionIds('check_order')).toEqual(['oos']);
  });

  it('records follow-up offering alongside instruction', () => {
    const rec = new InstructionRecorder();
    rec.recordFirings('eval_loan', [firing('denial', { followUpToolId: 'get_trace' })]);

    const summary = rec.getSummary();
    expect(summary.totalFollowUpsOffered).toBe(1);
    expect(summary.byTool['eval_loan'].followUps['get_trace'].offered).toBe(1);
  });

  it('getSummary returns totals and per-tool breakdown', () => {
    const rec = new InstructionRecorder();
    rec.recordFirings('tool_a', [firing('a1'), firing('a2')]);
    rec.recordFirings('tool_b', [firing('b1')]);

    const summary = rec.getSummary();
    expect(summary.totalFired).toBe(3);
    expect(Object.keys(summary.byTool)).toEqual(['tool_a', 'tool_b']);
  });

  it('clear resets all state', () => {
    const rec = new InstructionRecorder();
    rec.recordFirings('tool', [firing('a')]);
    expect(rec.getSummary().totalFired).toBe(1);

    rec.clear();
    expect(rec.getSummary().totalFired).toBe(0);
    expect(rec.getFiringCount('tool', 'a')).toBe(0);
  });

  it('default id is instruction-recorder', () => {
    expect(new InstructionRecorder().id).toBe('instruction-recorder');
  });

  it('custom id', () => {
    expect(new InstructionRecorder('custom').id).toBe('custom');
  });
});

// ── Boundary ────────────────────────────────────────────────────

describe('InstructionRecorder — boundary', () => {
  it('empty fired array produces no recordings', () => {
    const rec = new InstructionRecorder();
    rec.recordFirings('tool', []);
    expect(rec.getSummary().totalFired).toBe(0);
  });

  it('same instruction fires multiple times — count accumulates', () => {
    const rec = new InstructionRecorder();
    rec.recordFirings('tool', [firing('oos')]);
    rec.recordFirings('tool', [firing('oos')]);
    rec.recordFirings('tool', [firing('oos')]);

    expect(rec.getFiringCount('tool', 'oos')).toBe(3);
    expect(rec.getSummary().totalFired).toBe(3);
  });

  it('getFiringCount for unknown tool returns 0', () => {
    const rec = new InstructionRecorder();
    expect(rec.getFiringCount('unknown', 'unknown')).toBe(0);
  });

  it('getFiredInstructionIds for unknown tool returns empty array', () => {
    const rec = new InstructionRecorder();
    expect(rec.getFiredInstructionIds('unknown')).toEqual([]);
  });
});

// ── Scenario ────────────────────────────────────────────────────

describe('InstructionRecorder — scenario', () => {
  it('loan agent: denial empathy + PII safety + follow-up across multiple calls', () => {
    const rec = new InstructionRecorder();

    // First loan evaluation — denied
    rec.recordFirings('evaluate_loan', [
      firing('denial-empathy', { inject: 'Be empathetic', followUpToolId: 'get_trace' }),
      firing('pii-guard', { inject: 'No PII', safety: true }),
    ]);

    // Second loan evaluation — also denied
    rec.recordFirings('evaluate_loan', [
      firing('denial-empathy', { inject: 'Be empathetic', followUpToolId: 'get_trace' }),
    ]);

    // Different tool
    rec.recordFirings('check_credit', [
      firing('low-score', { inject: 'Low credit score' }),
    ]);

    const summary = rec.getSummary();
    expect(summary.totalFired).toBe(4);
    expect(summary.totalFollowUpsOffered).toBe(2);

    // Per-tool breakdown
    const loanStats = summary.byTool['evaluate_loan'];
    expect(loanStats.instructions['denial-empathy'].fired).toBe(2);
    expect(loanStats.instructions['denial-empathy'].safety).toBe(false);
    expect(loanStats.instructions['pii-guard'].fired).toBe(1);
    expect(loanStats.instructions['pii-guard'].safety).toBe(true);
    expect(loanStats.followUps['get_trace'].offered).toBe(2);

    const creditStats = summary.byTool['check_credit'];
    expect(creditStats.instructions['low-score'].fired).toBe(1);
    expect(Object.keys(creditStats.followUps)).toEqual([]);
  });
});

// ── Property ────────────────────────────────────────────────────

describe('InstructionRecorder — property', () => {
  it('totalFired equals sum of all per-tool instruction counts', () => {
    const rec = new InstructionRecorder();
    rec.recordFirings('a', [firing('x'), firing('y')]);
    rec.recordFirings('b', [firing('z')]);
    rec.recordFirings('a', [firing('x')]);

    const summary = rec.getSummary();
    let sumFromTools = 0;
    for (const stats of Object.values(summary.byTool)) {
      for (const instr of Object.values(stats.instructions)) {
        sumFromTools += instr.fired;
      }
    }
    expect(summary.totalFired).toBe(sumFromTools);
  });

  it('totalFollowUpsOffered equals sum of all per-tool follow-up counts', () => {
    const rec = new InstructionRecorder();
    rec.recordFirings('a', [firing('x', { followUpToolId: 't1' })]);
    rec.recordFirings('b', [firing('y', { followUpToolId: 't2' })]);
    rec.recordFirings('a', [firing('x', { followUpToolId: 't1' })]);

    const summary = rec.getSummary();
    let sumFromTools = 0;
    for (const stats of Object.values(summary.byTool)) {
      for (const fu of Object.values(stats.followUps)) {
        sumFromTools += fu.offered;
      }
    }
    expect(summary.totalFollowUpsOffered).toBe(sumFromTools);
  });
});

// ── Security ────────────────────────────────────────────────────

describe('InstructionRecorder — security', () => {
  it('safety flag is preserved in summary', () => {
    const rec = new InstructionRecorder();
    rec.recordFirings('tool', [
      firing('normal', { safety: false }),
      firing('safety', { safety: true }),
    ]);

    const summary = rec.getSummary();
    expect(summary.byTool['tool'].instructions['normal'].safety).toBe(false);
    expect(summary.byTool['tool'].instructions['safety'].safety).toBe(true);
  });

  it('recorder does not expose raw instruction content (no inject text stored)', () => {
    const rec = new InstructionRecorder();
    rec.recordFirings('tool', [firing('a', { inject: 'secret instruction text' })]);

    const summary = rec.getSummary();
    // Summary only stores firing counts and safety flags — not the inject text
    const instrData = summary.byTool['tool'].instructions['a'];
    expect(instrData).toEqual({ fired: 1, safety: false });
    expect((instrData as any).inject).toBeUndefined();
  });
});
