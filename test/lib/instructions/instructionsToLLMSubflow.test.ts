/**
 * InstructionsToLLM subflow — 5-pattern tests.
 *
 * Tests the full subflow as a footprintjs flowchart: mounting, execution,
 * narrative visibility, decision-driven activation, and empty-registry passthrough.
 *
 * Uses a wrapper chart with a Seed stage (same pattern as slot tests) because
 * the subflow reads scope.decision which must be initialized via a stage.
 */
import { describe, it, expect } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { buildInstructionsToLLMSubflow } from '../../../src/lib/instructions/buildInstructionsToLLMSubflow';
import type { AgentInstruction } from '../../../src/lib/instructions/agentInstruction';
import type { InstructionsToLLMState } from '../../../src/scope/types';
import type { ToolDefinition } from '../../../src/types/tools';
import type { LLMToolDescription } from '../../../src/types/llm';

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
}

/**
 * Run the InstructionsToLLM subflow inside a wrapper chart.
 * Seed stage sets up scope.decision (what the parent inputMapper would do).
 * Returns the final shared state.
 */
async function runSubflow(
  instructions: AgentInstruction[],
  decision: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const subflow = buildInstructionsToLLMSubflow(instructions);

  const wrapper = flowChart<InstructionsToLLMState>(
    'Seed',
    (scope) => {
      scope.decision = decision;
    },
    'test-seed',
  )
    .addSubFlowChartNext('sf-instructions-to-llm', subflow, 'InstructionsToLLM', {
      inputMapper: (parent: Record<string, unknown>) => ({
        decision: parent.decision,
      }),
      outputMapper: (sf: Record<string, unknown>) => ({
        promptInjections: sf.promptInjections,
        toolInjections: sf.toolInjections,
        responseRules: sf.responseRules,
        matchedInstructions: sf.matchedInstructions,
      }),
    })
    .build();

  const executor = new FlowChartExecutor(wrapper);
  await executor.run();
  return executor.getSnapshot()?.sharedState ?? {};
}

// ── Unit ───────────────────────────────────────────────────────

describe('buildInstructionsToLLMSubflow — unit', () => {
  it('returns a valid flowchart', () => {
    const subflow = buildInstructionsToLLMSubflow([]);
    expect(subflow).toBeDefined();
  });

  it('empty instructions — passthrough with no injections', async () => {
    const state = await runSubflow([], { orderStatus: null });
    expect(state.promptInjections).toEqual([]);
    expect(state.toolInjections).toEqual([]);
    expect(state.responseRules).toEqual([]);
    expect(state.matchedInstructions).toBe('none matched');
  });

  it('matching instruction produces all 3 outputs', async () => {
    const instructions: AgentInstruction<TestDecision>[] = [
      {
        id: 'refund',
        activeWhen: (d) => d.orderStatus === 'denied',
        prompt: 'Be empathetic.',
        tools: [tool('process_refund')],
        onToolResult: [{ id: 'empathy', text: 'Do NOT promise reversal.' }],
      },
    ];
    const state = await runSubflow(instructions as AgentInstruction[], {
      orderStatus: 'denied',
      riskLevel: 'unknown',
    });

    expect(state.promptInjections).toEqual(['Be empathetic.']);
    // ToolDefinition converted to LLMToolDescription (id → name)
    expect((state.toolInjections as LLMToolDescription[]).map((t) => t.name)).toEqual([
      'process_refund',
    ]);
    expect((state.responseRules as any[]).map((r) => r.id)).toEqual(['empathy']);
    expect(state.matchedInstructions).toBe('1 matched: refund');
  });

  it('non-matching instruction produces empty outputs', async () => {
    const state = await runSubflow(
      [{ id: 'refund', activeWhen: (d: any) => d.orderStatus === 'denied', prompt: 'Nope.' }],
      { orderStatus: 'pending', riskLevel: 'unknown' },
    );
    expect(state.promptInjections).toEqual([]);
    expect(state.matchedInstructions).toBe('none matched');
  });
});

// ── Narrative Visibility ──────────────────────────────────────

describe('buildInstructionsToLLMSubflow — narrative', () => {
  it('subflow appears in narrative with stage name', async () => {
    const subflow = buildInstructionsToLLMSubflow([{ id: 'a', prompt: 'P' }]);
    const wrapper = flowChart<InstructionsToLLMState>(
      'Seed',
      (scope) => {
        scope.decision = {};
      },
      'test-seed',
    )
      .addSubFlowChartNext('sf-instructions-to-llm', subflow, 'InstructionsToLLM', {
        inputMapper: (p: Record<string, unknown>) => ({ decision: p.decision }),
        outputMapper: (sf: Record<string, unknown>) => ({
          promptInjections: sf.promptInjections,
          toolInjections: sf.toolInjections,
          responseRules: sf.responseRules,
          matchedInstructions: sf.matchedInstructions,
        }),
      })
      .build();

    const executor = new FlowChartExecutor(wrapper);
    executor.enableNarrative();
    await executor.run();
    const narrative = executor.getNarrative();
    // Subflow shows in narrative — either as entry or as a stage path
    expect(
      narrative.some(
        (s: string) => s.includes('InstructionsToLLM') || s.includes('EvaluateInstructions'),
      ),
    ).toBe(true);
  });
});

// ── Decision-Driven Multi-Turn ────────────────────────────────

describe('buildInstructionsToLLMSubflow — decision-driven', () => {
  it('different decision values activate different instructions', async () => {
    const instructions: AgentInstruction[] = [
      { id: 'refund', activeWhen: (d: any) => d.orderStatus === 'denied', prompt: 'Refund flow.' },
      {
        id: 'high-risk',
        activeWhen: (d: any) => d.riskLevel === 'high',
        prompt: 'High risk alert.',
      },
    ];

    // Only refund matches
    const s1 = await runSubflow(instructions, { orderStatus: 'denied', riskLevel: 'low' });
    expect(s1.promptInjections).toEqual(['Refund flow.']);
    expect(s1.matchedInstructions).toBe('1 matched: refund');

    // Only high-risk matches
    const s2 = await runSubflow(instructions, { orderStatus: 'pending', riskLevel: 'high' });
    expect(s2.promptInjections).toEqual(['High risk alert.']);
    expect(s2.matchedInstructions).toBe('1 matched: high-risk');

    // Both match
    const s3 = await runSubflow(instructions, { orderStatus: 'denied', riskLevel: 'high' });
    expect(s3.promptInjections).toEqual(['Refund flow.', 'High risk alert.']);
    expect(s3.matchedInstructions).toBe('2 matched: refund, high-risk');

    // None match
    const s4 = await runSubflow(instructions, { orderStatus: 'pending', riskLevel: 'low' });
    expect(s4.promptInjections).toEqual([]);
    expect(s4.matchedInstructions).toBe('none matched');
  });
});

// ── Safety ────────────────────────────────────────────────────

describe('buildInstructionsToLLMSubflow — safety', () => {
  it('safety instruction fires even when predicate throws', async () => {
    const state = await runSubflow(
      [
        {
          id: 'compliance',
          safety: true,
          activeWhen: () => {
            throw new Error('bug');
          },
          prompt: 'GDPR required.',
        },
      ],
      {},
    );
    expect(state.promptInjections).toEqual(['GDPR required.']);
    expect(state.matchedInstructions).toBe('1 matched: compliance');
  });
});

// ── Missing decision field ────────────────────────────────────

describe('buildInstructionsToLLMSubflow — missing decision', () => {
  it('undefined decision — behavioral predicates skip, unconditional fires', async () => {
    const instructions: AgentInstruction[] = [
      { id: 'conditional', activeWhen: (d: any) => d?.orderStatus === 'denied', prompt: 'Nope.' },
      { id: 'unconditional', prompt: 'Always.' },
    ];
    // Don't set decision in seed — scope.decision will be undefined
    const subflow = buildInstructionsToLLMSubflow(instructions);
    const wrapper = flowChart<InstructionsToLLMState>(
      'Seed',
      () => {
        /* no decision set */
      },
      'test-seed',
    )
      .addSubFlowChartNext('sf-instructions-to-llm', subflow, 'InstructionsToLLM', {
        inputMapper: (p: Record<string, unknown>) => ({ decision: p.decision }),
        outputMapper: (sf: Record<string, unknown>) => ({
          promptInjections: sf.promptInjections,
          matchedInstructions: sf.matchedInstructions,
        }),
      })
      .build();

    const executor = new FlowChartExecutor(wrapper);
    await executor.run();
    const state = executor.getSnapshot()?.sharedState as any;
    // Unconditional fires, conditional skips (fail-open)
    expect(state.promptInjections).toEqual(['Always.']);
    expect(state.matchedInstructions).toBe('1 matched: unconditional');
  });
});

// ── Immutability ──────────────────────────────────────────────

describe('buildInstructionsToLLMSubflow — immutability', () => {
  it('instruction registry is frozen at build time', async () => {
    const instructions: AgentInstruction[] = [{ id: 'a', prompt: 'Prompt A.' }];
    const subflow = buildInstructionsToLLMSubflow(instructions);

    // Mutate the original array AFTER build
    instructions.push({ id: 'b', prompt: 'Prompt B.' });

    // Subflow should only see the original instruction
    const wrapper = flowChart<InstructionsToLLMState>(
      'Seed',
      (scope) => {
        scope.decision = {};
      },
      'test-seed',
    )
      .addSubFlowChartNext('sf-instructions-to-llm', subflow, 'InstructionsToLLM', {
        inputMapper: (p: Record<string, unknown>) => ({ decision: p.decision }),
        outputMapper: (sf: Record<string, unknown>) => ({
          promptInjections: sf.promptInjections,
          matchedInstructions: sf.matchedInstructions,
        }),
      })
      .build();

    const executor = new FlowChartExecutor(wrapper);
    await executor.run();
    const state = executor.getSnapshot()?.sharedState as any;
    expect(state.promptInjections).toEqual(['Prompt A.']);
    expect(state.matchedInstructions).toBe('1 matched: a');
  });
});
