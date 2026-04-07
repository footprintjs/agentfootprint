/**
 * AgentInstruction evaluator — 5-pattern tests.
 *
 * Tests agent-level instruction evaluation against Decision Scope:
 * predicate matching, 3-position output classification, priority ordering,
 * error handling (fail-open/fail-closed), and tool deduplication.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  evaluateAgentInstructions,
  type AgentInstruction,
} from '../../../src/lib/instructions/agentInstruction';
import type { ToolDefinition } from '../../../src/types/tools';

// ── Helpers ────────────────────────────────────────────────────

function tool(id: string): ToolDefinition {
  return {
    id,
    description: `Tool ${id}`,
    inputSchema: { type: 'object' },
    handler: async () => ({ content: 'ok' }),
  };
}

interface TestDecision {
  orderStatus: 'pending' | 'denied' | null;
  riskLevel: 'low' | 'high' | 'unknown';
  userVerified: boolean;
}

const defaultDecision: TestDecision = {
  orderStatus: null,
  riskLevel: 'unknown',
  userVerified: false,
};

// ── Unit ───────────────────────────────────────────────────────

describe('evaluateAgentInstructions — unit', () => {
  it('returns empty for no instructions', () => {
    const result = evaluateAgentInstructions(undefined, defaultDecision);
    expect(result.promptInjections).toEqual([]);
    expect(result.toolInjections).toEqual([]);
    expect(result.responseRules).toEqual([]);
    expect(result.matchedIds).toEqual([]);
  });

  it('returns empty for empty array', () => {
    const result = evaluateAgentInstructions([], defaultDecision);
    expect(result.matchedIds).toEqual([]);
  });

  it('fires unconditional instruction (no activeWhen)', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      { id: 'always', prompt: 'Always active.' },
    ];
    const result = evaluateAgentInstructions(instructions, defaultDecision);
    expect(result.matchedIds).toEqual(['always']);
    expect(result.promptInjections).toEqual(['Always active.']);
  });

  it('fires instruction when activeWhen matches', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      {
        id: 'refund',
        activeWhen: (d) => d.orderStatus === 'denied',
        prompt: 'Handle refund.',
        tools: [tool('process_refund')],
        onToolResult: [{ id: 'empathy', text: 'Be empathetic.' }],
      },
    ];
    const decision = { ...defaultDecision, orderStatus: 'denied' as const };
    const result = evaluateAgentInstructions(instructions, decision);

    expect(result.matchedIds).toEqual(['refund']);
    expect(result.promptInjections).toEqual(['Handle refund.']);
    expect(result.toolInjections).toHaveLength(1);
    expect(result.toolInjections[0].id).toBe('process_refund');
    expect(result.responseRules).toHaveLength(1);
    expect(result.responseRules[0].id).toBe('empathy');
  });

  it('skips instruction when activeWhen returns false', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      {
        id: 'refund',
        activeWhen: (d) => d.orderStatus === 'denied',
        prompt: 'Handle refund.',
      },
    ];
    const result = evaluateAgentInstructions(instructions, defaultDecision);
    expect(result.matchedIds).toEqual([]);
    expect(result.promptInjections).toEqual([]);
  });

  it('classifies outputs into all 3 positions', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      {
        id: 'full',
        prompt: 'System text.',
        tools: [tool('admin_tool')],
        onToolResult: [
          { id: 'rule-a', text: 'Rule A.' },
          { id: 'rule-b', text: 'Rule B.' },
        ],
      },
    ];
    const result = evaluateAgentInstructions(instructions, defaultDecision);

    expect(result.promptInjections).toEqual(['System text.']);
    expect(result.toolInjections).toHaveLength(1);
    expect(result.responseRules).toHaveLength(2);
    expect(result.responseRules.map((r) => r.id)).toEqual(['rule-a', 'rule-b']);
  });

  it('instruction with only prompt — no tools or rules', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      { id: 'prompt-only', prompt: 'Extra guidance.' },
    ];
    const result = evaluateAgentInstructions(instructions, defaultDecision);
    expect(result.promptInjections).toEqual(['Extra guidance.']);
    expect(result.toolInjections).toEqual([]);
    expect(result.responseRules).toEqual([]);
  });

  it('instruction with only tools — no prompt or rules', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      { id: 'tools-only', tools: [tool('t1'), tool('t2')] },
    ];
    const result = evaluateAgentInstructions(instructions, defaultDecision);
    expect(result.promptInjections).toEqual([]);
    expect(result.toolInjections).toHaveLength(2);
    expect(result.responseRules).toEqual([]);
  });
});

// ── Priority & Ordering ───────────────────────────────────────

describe('evaluateAgentInstructions — priority ordering', () => {
  it('sorts by priority (lower = first)', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      { id: 'low', priority: 10, prompt: 'Low priority.' },
      { id: 'high', priority: 1, prompt: 'High priority.' },
      { id: 'mid', priority: 5, prompt: 'Mid priority.' },
    ];
    const result = evaluateAgentInstructions(instructions, defaultDecision);
    expect(result.matchedIds).toEqual(['high', 'mid', 'low']);
    expect(result.promptInjections).toEqual(['High priority.', 'Mid priority.', 'Low priority.']);
  });

  it('preserves registration order for same priority', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      { id: 'first', prompt: 'First.' },
      { id: 'second', prompt: 'Second.' },
      { id: 'third', prompt: 'Third.' },
    ];
    const result = evaluateAgentInstructions(instructions, defaultDecision);
    expect(result.matchedIds).toEqual(['first', 'second', 'third']);
  });
});

// ── Tool Deduplication ────────────────────────────────────────

describe('evaluateAgentInstructions — tool deduplication', () => {
  it('deduplicates tools by ID (first registration wins)', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      { id: 'a', tools: [tool('shared'), tool('unique-a')] },
      { id: 'b', tools: [tool('shared'), tool('unique-b')] },
    ];
    const result = evaluateAgentInstructions(instructions, defaultDecision);
    const ids = result.toolInjections.map((t) => t.id);
    expect(ids).toEqual(['shared', 'unique-a', 'unique-b']);
  });
});

// ── Error Handling ────────────────────────────────────────────

describe('evaluateAgentInstructions — error handling', () => {
  it('behavioral: predicate throws → skip (fail-open)', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      {
        id: 'broken',
        activeWhen: () => {
          throw new Error('bug');
        },
        prompt: 'Should not fire.',
      },
      { id: 'ok', prompt: 'This fires.' },
    ];
    const result = evaluateAgentInstructions(instructions, defaultDecision);
    expect(result.matchedIds).toEqual(['ok']);
  });

  it('safety: predicate throws → fire (fail-closed)', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      {
        id: 'safety-broken',
        safety: true,
        activeWhen: () => {
          throw new Error('bug');
        },
        prompt: 'Must fire for safety.',
      },
    ];
    const result = evaluateAgentInstructions(instructions, defaultDecision);
    expect(result.matchedIds).toEqual(['safety-broken']);
    expect(result.promptInjections).toEqual(['Must fire for safety.']);
  });

  it('safety: predicate returns false → does NOT fire', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      {
        id: 'safety-no',
        safety: true,
        activeWhen: () => false,
        prompt: 'Should not fire.',
      },
    ];
    const result = evaluateAgentInstructions(instructions, defaultDecision);
    expect(result.matchedIds).toEqual([]);
  });
});

// ── Safety Ordering ───────────────────────────────────────────

describe('evaluateAgentInstructions — safety ordering', () => {
  it('safety instructions sorted LAST regardless of priority', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      { id: 'safety-first', safety: true, priority: 0, prompt: 'Safety.' },
      { id: 'normal-last', priority: 10, prompt: 'Normal.' },
    ];
    const result = evaluateAgentInstructions(instructions, defaultDecision);
    // Normal (priority 10) comes before safety (priority 0) because safety = last
    expect(result.matchedIds).toEqual(['normal-last', 'safety-first']);
    expect(result.promptInjections).toEqual(['Normal.', 'Safety.']);
  });

  it('multiple safety instructions sorted by priority among themselves', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      { id: 's2', safety: true, priority: 5, prompt: 'S2.' },
      { id: 's1', safety: true, priority: 1, prompt: 'S1.' },
      { id: 'n1', priority: 0, prompt: 'N1.' },
    ];
    const result = evaluateAgentInstructions(instructions, defaultDecision);
    expect(result.matchedIds).toEqual(['n1', 's1', 's2']);
  });
});

// ── Response Rules (no dedup) ─────────────────────────────────

describe('evaluateAgentInstructions — responseRules accumulation', () => {
  it('same-ID rules from different instructions both appear (no dedup)', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      { id: 'a', onToolResult: [{ id: 'pii', text: 'Text from A.' }] },
      { id: 'b', onToolResult: [{ id: 'pii', text: 'Text from B.' }] },
    ];
    const result = evaluateAgentInstructions(instructions, defaultDecision);
    expect(result.responseRules).toHaveLength(2);
    expect(result.responseRules[0].text).toBe('Text from A.');
    expect(result.responseRules[1].text).toBe('Text from B.');
  });
});

// ── Dev-mode warning ──────────────────────────────────────────

describe('evaluateAgentInstructions — dev-mode warnings', () => {
  it('safety instruction with no outputs warns in dev mode', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prevEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';

    try {
      const instructions: AgentInstruction<TestDecision>[] = [{ id: 'empty-safety', safety: true }];
      const result = evaluateAgentInstructions(instructions, defaultDecision);
      expect(result.matchedIds).toEqual(['empty-safety']);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Safety instruction 'empty-safety' matched but has no outputs"),
      );
    } finally {
      process.env['NODE_ENV'] = prevEnv;
      warnSpy.mockRestore();
    }
  });

  it('safety instruction with no outputs does NOT warn in production', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prevEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';

    try {
      const instructions: AgentInstruction<TestDecision>[] = [{ id: 'empty-safety', safety: true }];
      evaluateAgentInstructions(instructions, defaultDecision);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      process.env['NODE_ENV'] = prevEnv;
      warnSpy.mockRestore();
    }
  });
});

// ── Multi-instruction Composition ─────────────────────────────

describe('evaluateAgentInstructions — composition', () => {
  it('multiple instructions match — outputs accumulate', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      {
        id: 'refund',
        activeWhen: (d) => d.orderStatus === 'denied',
        prompt: 'Handle refund.',
        tools: [tool('process_refund')],
      },
      {
        id: 'high-risk',
        activeWhen: (d) => d.riskLevel === 'high',
        prompt: 'Require approval.',
        tools: [tool('ask_manager')],
        onToolResult: [{ id: 'escalate', text: 'Escalate if needed.' }],
      },
    ];
    const decision: TestDecision = {
      orderStatus: 'denied',
      riskLevel: 'high',
      userVerified: false,
    };
    const result = evaluateAgentInstructions(instructions, decision);

    expect(result.matchedIds).toEqual(['refund', 'high-risk']);
    expect(result.promptInjections).toEqual(['Handle refund.', 'Require approval.']);
    expect(result.toolInjections).toHaveLength(2);
    expect(result.responseRules).toHaveLength(1);
  });

  it('partial match — only matching instruction fires', () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      {
        id: 'refund',
        activeWhen: (d) => d.orderStatus === 'denied',
        prompt: 'Handle refund.',
      },
      {
        id: 'admin',
        activeWhen: (d) => d.userVerified,
        prompt: 'Admin access.',
      },
    ];
    const decision: TestDecision = {
      orderStatus: 'denied',
      riskLevel: 'unknown',
      userVerified: false,
    };
    const result = evaluateAgentInstructions(instructions, decision);

    expect(result.matchedIds).toEqual(['refund']);
    expect(result.promptInjections).toEqual(['Handle refund.']);
  });
});
