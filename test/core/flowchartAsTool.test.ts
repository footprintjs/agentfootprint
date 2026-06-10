/**
 * flowchartAsTool — 7-pattern test matrix
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Pins:
 *   - Wraps a footprintjs FlowChart as a Tool with stable schema
 *   - LLM args flow into scope.$getArgs(); flowchart writes flow back
 *   - Default resultMapper = JSON.stringify(values)
 *   - Custom resultMapper invoked with FlowchartToolSnapshot
 *   - Mapper errors envelope as [mapper-error: ...]
 *   - Pause inside flowchart → throw with checkpoint attached
 *   - Errors thrown from flowchart propagate (Agent layer envelopes)
 *   - Composes with the Agent's tool-dispatch path (smoke integration)
 *   - `recorders` option: attached CombinedRecorders observe the INTERNAL
 *     executor — decide() evidence fires onDecision; one array routes all
 *     three channels; shared instances accumulate across invocations with
 *     a fresh runId per invocation (Convention 4)
 */

import { describe, expect, it } from 'vitest';
import { decide, flowChart } from 'footprintjs';
import type { CombinedRecorder, FlowDecisionEvent, PausableHandler } from 'footprintjs';
import { Agent, flowchartAsTool, mock, type FlowchartToolSnapshot } from '../../src/index.js';
import { unconfiguredCredentialProvider } from '../../src/identity.js';
import { causalEvidenceRecorder } from '../../src/memory/causal/evidenceRecorder.js';

// ─── Fixtures ─────────────────────────────────────────────────────

interface RefundState {
  refundId: string;
  status: 'ok' | 'failed';
}

function buildRefundChart() {
  return flowChart<RefundState>(
    'RefundFlow',
    async (scope) => {
      const args = scope.$getArgs<{ orderId: string }>();
      scope.refundId = `rf-${args.orderId}`;
      scope.status = 'ok';
    },
    'refund-flow',
  ).build();
}

const refundInputSchema = {
  type: 'object',
  properties: {
    orderId: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['orderId', 'reason'],
} as const;

const baseToolCtx = {
  toolCallId: 't-1',
  iteration: 1,
  credentials: unconfiguredCredentialProvider(),
  hasCredentials: false,
};

// ─── 1. UNIT — schema construction + defaults ─────────────────────

describe('flowchartAsTool — unit', () => {
  it('produces a Tool with the supplied schema', () => {
    const tool = flowchartAsTool({
      name: 'process_refund',
      description: 'Process a refund',
      inputSchema: refundInputSchema,
      flowchart: buildRefundChart(),
    });
    expect(tool.schema.name).toBe('process_refund');
    expect(tool.schema.description).toBe('Process a refund');
    expect(tool.schema.inputSchema).toEqual(refundInputSchema);
  });

  it('defaults inputSchema to empty object when omitted', () => {
    const tool = flowchartAsTool({
      name: 'noop',
      description: 'noop tool',
      flowchart: flowChart<{ done: boolean }>(
        'Noop',
        (scope) => {
          scope.done = true;
        },
        'noop',
      ).build(),
    });
    expect(tool.schema.inputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('throws on empty/whitespace name', () => {
    const chart = buildRefundChart();
    expect(() => flowchartAsTool({ name: '', description: 'd', flowchart: chart })).toThrow(
      /`name` is required/,
    );
    expect(() => flowchartAsTool({ name: '  ', description: 'd', flowchart: chart })).toThrow(
      /`name` is required/,
    );
  });

  it('throws on missing description', () => {
    const chart = buildRefundChart();
    expect(() => flowchartAsTool({ name: 'ok', description: '', flowchart: chart })).toThrow(
      /`description` is required/,
    );
  });

  it('throws on missing flowchart', () => {
    expect(() =>
      flowchartAsTool({
        name: 'ok',
        description: 'ok',
        flowchart: undefined as unknown as ReturnType<typeof buildRefundChart>,
      }),
    ).toThrow(/`flowchart` is required/);
  });
});

// ─── 2. SCENARIO — args flow through, default mapper returns JSON ──

describe('flowchartAsTool — scenario: end-to-end execute', () => {
  it('args reach scope.$getArgs(); default mapper returns JSON of values', async () => {
    const tool = flowchartAsTool({
      name: 'process_refund',
      description: 'Process refund',
      inputSchema: refundInputSchema,
      flowchart: buildRefundChart(),
    });
    const out = await tool.execute({ orderId: 'O-100', reason: 'duplicate' }, baseToolCtx);
    const parsed = JSON.parse(out as string);
    expect(parsed.refundId).toBe('rf-O-100');
    expect(parsed.status).toBe('ok');
  });

  it('custom resultMapper receives the FlowchartToolSnapshot', async () => {
    let captured: FlowchartToolSnapshot | undefined;
    const tool = flowchartAsTool({
      name: 'process_refund',
      description: 'Process refund',
      inputSchema: refundInputSchema,
      flowchart: buildRefundChart(),
      resultMapper: (snapshot) => {
        captured = snapshot;
        const v = snapshot.values as { refundId?: string };
        return JSON.stringify({ refundId: v.refundId });
      },
    });
    const out = await tool.execute({ orderId: 'O-200', reason: 'r' }, baseToolCtx);
    expect(JSON.parse(out as string)).toEqual({ refundId: 'rf-O-200' });
    expect(captured).toBeDefined();
    expect(captured!.values).toBeDefined();
    expect(Array.isArray(captured!.narrative)).toBe(true);
  });

  it('mapper errors envelope as [mapper-error: ...]', async () => {
    const tool = flowchartAsTool({
      name: 'process_refund',
      description: 'Process refund',
      inputSchema: refundInputSchema,
      flowchart: buildRefundChart(),
      resultMapper: () => {
        throw new Error('boom');
      },
    });
    const out = await tool.execute({ orderId: 'X', reason: 'y' }, baseToolCtx);
    expect(out).toContain('[mapper-error: boom]');
  });
});

// ─── 3. INTEGRATION — composes with Agent's tool-dispatch path ────

describe('flowchartAsTool — integration: Agent tool dispatch', () => {
  it('LLM tool call → flowchart runs → result is what the LLM sees', async () => {
    const tool = flowchartAsTool({
      name: 'process_refund',
      description: 'Process refund',
      inputSchema: refundInputSchema,
      flowchart: buildRefundChart(),
    });

    let calls = 0;
    const provider = mock({
      respond: () => {
        calls++;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'tc-1',
                name: 'process_refund',
                args: { orderId: 'O-1', reason: 'duplicate' },
              },
            ],
          };
        }
        return { content: 'Refund completed.', toolCalls: [] };
      },
    });

    const agent = Agent.create({ provider, model: 'mock', maxIterations: 5 })
      .system('You answer support tickets.')
      .tool(tool)
      .build();

    const result = await agent.run({ message: 'refund order O-1' });
    expect(result).toBe('Refund completed.');
    expect(calls).toBe(2); // tool-call iter + final iter
  });
});

// ─── 4. PROPERTY — invariants ────────────────────────────────────

describe('flowchartAsTool — properties', () => {
  it('fresh executor per call: state does not leak between invocations', async () => {
    let writes = 0;
    const chart = flowChart<{ counter: number }>(
      'Counter',
      (scope) => {
        // The fixture writes a fresh counter per run; if state leaks,
        // we'd see writes of 1, 2, 3...
        scope.counter = 1;
        writes++;
      },
      'counter',
    ).build();

    const tool = flowchartAsTool({ name: 'counter', description: 'd', flowchart: chart });
    const a = await tool.execute({}, baseToolCtx);
    const b = await tool.execute({}, baseToolCtx);
    const c = await tool.execute({}, baseToolCtx);
    expect(writes).toBe(3);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});

// ─── 5. SECURITY — pause + error propagation ──────────────────────

describe('flowchartAsTool — security: pause + error propagation', () => {
  it('pause inside flowchart → throws with checkpoint on error', async () => {
    const handler: PausableHandler<{ approved?: boolean }> = {
      execute: () => ({ question: 'approve?' }),
      resume: (scope, input: { approved: boolean }) => {
        scope.approved = input.approved;
      },
    };
    const chart = flowChart<{ approved?: boolean }>('Pausing', handler, 'pausing').build();

    const tool = flowchartAsTool({
      name: 'pausing_op',
      description: 'pauses',
      flowchart: chart,
    });
    try {
      await tool.execute({}, baseToolCtx);
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as Error & { checkpoint?: unknown };
      expect(err.message).toContain('paused');
      expect(err.checkpoint).toBeDefined();
    }
  });

  it('errors thrown from flowchart propagate to caller', async () => {
    const chart = flowChart<{ x: number }>(
      'Throws',
      () => {
        throw new Error('flow-internal failure');
      },
      'throws',
    ).build();
    const tool = flowchartAsTool({
      name: 'throwing_op',
      description: 'throws',
      flowchart: chart,
    });
    await expect(tool.execute({}, baseToolCtx)).rejects.toThrow(/flow-internal failure/);
  });
});

// ─── 6. PERFORMANCE — bounded ────────────────────────────────────

describe('flowchartAsTool — performance', () => {
  it('100 sequential invocations of a trivial flowchart under 500ms', async () => {
    const chart = flowChart<{ value: number }>(
      'Simple',
      (scope) => {
        scope.value = 42;
      },
      'simple',
    ).build();
    const tool = flowchartAsTool({
      name: 'simple_op',
      description: 'simple',
      flowchart: chart,
    });
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) await tool.execute({}, baseToolCtx);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(500);
  });
});

// ─── 7. ROI — what the bridge unlocks ─────────────────────────────

describe('flowchartAsTool — ROI: composition over rewrite', () => {
  it('pre-existing footprintjs flowchart wraps as one tool — no flatten/restructure required', async () => {
    // Imagine an existing intake flowchart with branching + decision evidence;
    // we don't have to rewrite it as N small tools. Wrap, attach, done.
    const chart = flowChart<{ classified: string }>(
      'Triage',
      (scope) => {
        const args = scope.$getArgs<{ priority?: 'high' | 'low' }>();
        scope.classified = args.priority === 'high' ? 'escalated' : 'queued';
      },
      'triage',
    ).build();

    const tool = flowchartAsTool({
      name: 'triage_request',
      description: 'Triage a support request and return the routing decision.',
      inputSchema: {
        type: 'object',
        properties: { priority: { enum: ['high', 'low'] } },
      },
      flowchart: chart,
      resultMapper: (snap) => {
        const c = (snap.values as { classified?: string }).classified;
        return c ?? 'unclassified';
      },
    });

    const a = await tool.execute({ priority: 'high' }, baseToolCtx);
    const b = await tool.execute({ priority: 'low' }, baseToolCtx);
    expect(a).toBe('escalated');
    expect(b).toBe('queued');
  });
});

// ─── 8. RECORDERS OPTION — observe the internal executor ──────────
//
// The #21-lighthouse gap: flowchartAsTool builds its executor internally,
// so decide()/select() evidence inside a tool-mounted chart could not
// reach the agent's evidence recorders (causal #5 bridge, OTel #19
// decisionEvidenceRecorder). The `recorders` option closes it.

interface PolicyState {
  creditScore: number;
  outcome?: 'approve' | 'decline';
  pings?: number;
}

/** Chart with a labeled decide() rule — the evidence-bearing fixture. */
function buildPolicyChart() {
  return flowChart<PolicyState>(
    'Seed',
    async (scope) => {
      const args = scope.$getArgs<{ credit_score: number }>();
      scope.creditScore = args.credit_score;
      scope.$emit('test.policy.seeded', { creditScore: args.credit_score });
    },
    'seed',
  )
    .addDeciderFunction(
      'Adjudicate',
      (scope) =>
        decide(
          scope as unknown as PolicyState,
          [
            {
              when: { creditScore: { lt: 580 } },
              then: 'decline',
              label: 'Credit score below the 580 floor',
            },
          ],
          'approve',
        ),
      'adjudicate',
    )
    .addFunctionBranch('decline', 'Decline', async (scope) => {
      scope.outcome = 'decline';
    })
    .addFunctionBranch('approve', 'Approve', async (scope) => {
      scope.outcome = 'approve';
    })
    .end()
    .build();
}

describe('flowchartAsTool — recorders option (unit: plumbing)', () => {
  it('attached CombinedRecorder.onDecision fires with decide() evidence', async () => {
    const decisions: FlowDecisionEvent[] = [];
    const recorder: CombinedRecorder = {
      id: 'evidence-probe',
      onDecision: (e) => decisions.push(e),
    };
    const tool = flowchartAsTool({
      name: 'adjudicate_loan',
      description: 'Apply the lending policy',
      flowchart: buildPolicyChart(),
      recorders: [recorder],
    });

    const out = await tool.execute({ credit_score: 500 }, baseToolCtx);
    expect(JSON.parse(out as string).outcome).toBe('decline');

    expect(decisions).toHaveLength(1);
    // FlowDecisionEvent.chosen carries the chosen branch's display NAME;
    // the branch ID lives in evidence.chosen.
    expect(decisions[0].chosen).toBe('Decline');
    expect(decisions[0].evidence).toBeDefined();
    expect(decisions[0].evidence!.chosen).toBe('decline');
    const matched = decisions[0].evidence!.rules.find((r) => r.matched);
    expect(matched?.label).toBe('Credit score below the 580 floor');
  });

  it('one array routes one recorder across all three channels (scope/flow/emit)', async () => {
    const writes: string[] = [];
    const decisions: string[] = [];
    const emits: string[] = [];
    const recorder: CombinedRecorder = {
      id: 'tri-channel',
      onWrite: (e) => writes.push(e.key),
      onDecision: (e) => decisions.push(e.chosen),
      onEmit: (e) => emits.push(e.name),
    };
    const tool = flowchartAsTool({
      name: 'adjudicate_loan',
      description: 'Apply the lending policy',
      flowchart: buildPolicyChart(),
      recorders: [recorder],
    });

    await tool.execute({ credit_score: 720 }, baseToolCtx);

    expect(writes).toContain('creditScore'); // ScopeRecorder channel
    expect(decisions).toEqual(['Approve']); // FlowRecorder channel
    expect(emits).toContain('test.policy.seeded'); // EmitRecorder channel
  });

  it('multiple recorders in the array all attach', async () => {
    const seenA: string[] = [];
    const seenB: string[] = [];
    const a: CombinedRecorder = { id: 'rec-a', onDecision: (e) => seenA.push(e.chosen) };
    const b: CombinedRecorder = { id: 'rec-b', onDecision: (e) => seenB.push(e.chosen) };
    const tool = flowchartAsTool({
      name: 'adjudicate_loan',
      description: 'Apply the lending policy',
      flowchart: buildPolicyChart(),
      recorders: [a, b],
    });

    await tool.execute({ credit_score: 500 }, baseToolCtx);

    expect(seenA).toEqual(['Decline']);
    expect(seenB).toEqual(['Decline']);
  });
});

describe('flowchartAsTool — recorders option (multi-invocation)', () => {
  it('a shared stateful recorder sees events from EVERY invocation, each with a fresh runId', async () => {
    const decisions: FlowDecisionEvent[] = [];
    const recorder: CombinedRecorder = {
      id: 'accumulator',
      onDecision: (e) => decisions.push(e),
    };
    const tool = flowchartAsTool({
      name: 'adjudicate_loan',
      description: 'Apply the lending policy',
      flowchart: buildPolicyChart(),
      recorders: [recorder],
    });

    await tool.execute({ credit_score: 500 }, baseToolCtx);
    await tool.execute({ credit_score: 720 }, baseToolCtx);
    await tool.execute({ credit_score: 410 }, baseToolCtx);

    // The instance is the consumer's: it accumulates across invocations.
    expect(decisions.map((d) => d.chosen)).toEqual(['Decline', 'Approve', 'Decline']);

    // Each invocation is a fresh executor → a fresh runId (Convention 4).
    const runIds = decisions.map((d) => d.traversalContext?.runId);
    expect(runIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(runIds).size).toBe(3);
  });
});

describe('flowchartAsTool — recorders option (integration: Agent end-to-end)', () => {
  it('decide() evidence inside a tool-mounted chart reaches the causal-evidence recorder DURING the agent run', async () => {
    const evidence = causalEvidenceRecorder();
    const tool = flowchartAsTool({
      name: 'adjudicate_loan',
      description: 'Apply the lending policy and return the outcome.',
      inputSchema: {
        type: 'object',
        properties: { credit_score: { type: 'number' } },
        required: ['credit_score'],
      },
      flowchart: buildPolicyChart(),
      recorders: [evidence],
    });

    let calls = 0;
    let decisionsSeenMidRun = -1;
    const provider = mock({
      respond: () => {
        calls++;
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'tc-1', name: 'adjudicate_loan', args: { credit_score: 500 } }],
          };
        }
        // Second LLM call happens AFTER the tool ran but BEFORE the run
        // ends — proof the evidence was captured during the agent run.
        decisionsSeenMidRun = evidence.collect().decisions.length;
        return { content: 'Application declined.', toolCalls: [] };
      },
    });

    const agent = Agent.create({ provider, model: 'mock', maxIterations: 5 })
      .system('You adjudicate loan applications.')
      .tool(tool)
      .build();

    const result = await agent.run({ message: 'adjudicate applicant with score 500' });
    expect(result).toBe('Application declined.');
    expect(decisionsSeenMidRun).toBe(1);

    const { decisions } = evidence.collect();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].stageId).toBe('adjudicate');
    expect(decisions[0].chosen).toBe('Decline'); // branch display name (event contract)
    // The full DecisionEvidence (rules + conditions) survived the bridge.
    const captured = decisions[0].evidence as
      | { rules?: ReadonlyArray<{ matched: boolean; label?: string }> }
      | undefined;
    expect(
      captured?.rules?.some((r) => r.matched && r.label === 'Credit score below the 580 floor'),
    ).toBe(true);
  });
});
