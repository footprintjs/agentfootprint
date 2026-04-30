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
 */

import { describe, expect, it } from 'vitest';
import { flowChart } from 'footprintjs';
import type { PausableHandler } from 'footprintjs';
import { Agent, flowchartAsTool, mock, type FlowchartToolSnapshot } from '../../src/index.js';

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

const baseToolCtx = { toolCallId: 't-1', iteration: 1 };

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
