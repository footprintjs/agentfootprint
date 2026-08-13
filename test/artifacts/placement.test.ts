/**
 * The placement threshold (9.22.0, Leg 3): `artifacts: { store, placement:
 * { maxInlineChars } }` — a tool result over the threshold is checked into
 * the store (kind `tool-result/<toolName>`) and the model reads the claim
 * ticket. Precedence, stated and TESTED here as the truth table: per-tool
 * `resultCeiling` (author's refusal) FIRST · placement (operator's ref-ing)
 * second · agent-level `maxToolResultChars` truncation net LAST.
 *
 * Sections: Functional (trip → ticket + minted-with-origin; ride-through of
 * effects/steps semantics via error-free flags) · Precedence truth table ·
 * Integration (placed ref consumed by a wants-tool — the full circle) ·
 * Config refusals · Regression (zero-delta pins: under threshold, and no
 * placement configured).
 */

import { describe, it, expect } from 'vitest';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  isPlacedToolResult,
  placedResultKind,
  type AgentfootprintEvent,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

type Caught = { name: string; payload: Record<string, unknown> };
const artifactCapture = (agent: Agent) => {
  const events: Caught[] = [];
  agent.on('agentfootprint.artifacts.*', (e: AgentfootprintEvent) => {
    events.push({ name: e.type, payload: e.payload as Record<string, unknown> });
  });
  return events;
};
const toolEndCapture = (agent: Agent) => {
  const ends: Record<string, unknown>[] = [];
  agent.on('agentfootprint.stream.tool_end', (e) =>
    ends.push(e.payload as Record<string, unknown>),
  );
  return ends;
};

const BIG = 'r'.repeat(5_000);

const bigTool = defineTool({
  name: 'get_report',
  description: 'returns a big report',
  execute: () => BIG,
});

describe('functional — over the threshold, the ticket travels instead of the freight', () => {
  it('mints tool-result/<toolName> with origin, and BOTH channels carry the one-shape ticket', async () => {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({ replies: [call('get_report', 't1'), final('done')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: { store, placement: { maxInlineChars: 2_000 } },
    })
      .system('s')
      .tool(bigTool)
      .build();
    const events = artifactCapture(agent);
    const ends = toolEndCapture(agent);
    const history: { role: string; content: string }[] = [];
    agent.on('agentfootprint.agent.iteration_end', (e) => {
      // The final iteration_end carries no history (nothing was dispatched).
      const h = (e.payload as { history?: readonly { role: string; content: string }[] }).history;
      if (h) history.push(...h);
    });
    await agent.run({ message: 'go' }, { sessionId: 'place' });

    // The record: minted, with the honest vocabulary and the run's origin.
    const minted = events.filter((e) => e.name === 'agentfootprint.artifacts.minted');
    expect(minted).toHaveLength(1);
    expect(minted[0].payload).toMatchObject({
      kind: placedResultKind('get_report'),
      mediaType: 'text/plain',
      bytes: 5_000,
      label: 'get_report result',
      tool: 'get_report',
    });
    expect(minted[0].payload.origin).toMatchObject({ toolCallId: 't1' });

    // tool_end carries the ticket — the payload the window was spared never
    // ships to an event sink either.
    const endResult = ends[0].result;
    expect(isPlacedToolResult(endResult)).toBe(true);
    expect((endResult as { bytes: number }).bytes).toBe(5_000);
    expect(JSON.stringify(endResult)).not.toContain('rrrrrrrrrr');
    expect(ends[0].error).toBeUndefined();

    // What the model read (history) is the same ticket, stated.
    const toolMsg = history.find((m) => m.role === 'tool');
    const parsed = JSON.parse(String(toolMsg?.content)) as Record<string, unknown>;
    expect(parsed.placed).toBe(true);
    expect(parsed.kind).toBe('tool-result/get_report');
    expect(String(parsed.reason)).toContain('placement');
    expect(String(parsed.reason)).toContain('present');
  });
});

describe('the precedence truth table — ceiling × placement × truncation', () => {
  const run = async (opts: {
    ceiling?: number;
    placement?: number;
    cap?: number;
  }): Promise<{
    endResult: unknown;
    error: unknown;
    minted: Caught[];
    refusedEvents: Record<string, unknown>[];
  }> => {
    const tool = defineTool({
      name: 'sized',
      description: 'returns 5000 chars',
      ...(opts.ceiling !== undefined && { resultCeiling: { maxChars: opts.ceiling } }),
      execute: () => BIG,
    });
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({ replies: [call('sized', 't1'), final('done')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts:
        opts.placement !== undefined
          ? { store, placement: { maxInlineChars: opts.placement } }
          : store,
      ...(opts.cap !== undefined && { maxToolResultChars: opts.cap }),
    })
      .system('s')
      .tool(tool)
      .build();
    const events = artifactCapture(agent);
    const refusedEvents: Record<string, unknown>[] = [];
    agent.on('agentfootprint.tools.result_refused', (e) =>
      refusedEvents.push(e.payload as Record<string, unknown>),
    );
    const ends = toolEndCapture(agent);
    await agent.run({ message: 'go' });
    return {
      endResult: ends[0].result,
      error: ends[0].error,
      minted: events.filter((e) => e.name === 'agentfootprint.artifacts.minted'),
      refusedEvents,
    };
  };

  it('row 1 — ceiling trips: the AUTHOR refuses first; nothing is minted, nothing truncated', async () => {
    const row = await run({ ceiling: 1_000, placement: 2_000, cap: 3_000 });
    expect(String(row.endResult)).toContain('Result too large');
    expect(row.refusedEvents).toHaveLength(1);
    expect(row.minted).toHaveLength(0);
  });

  it('row 2 — under the ceiling, over placement: the ticket, never the truncation marker', async () => {
    const row = await run({ ceiling: 10_000, placement: 2_000, cap: 3_000 });
    expect(isPlacedToolResult(row.endResult)).toBe(true);
    expect(row.minted).toHaveLength(1);
    expect(row.refusedEvents).toHaveLength(0);
  });

  it('row 3 — placement on but threshold above the size, over the cap: the net still catches it', async () => {
    const row = await run({ placement: 9_000, cap: 3_000 });
    expect(row.minted).toHaveLength(0);
    expect((row.endResult as { truncated?: boolean }).truncated).toBe(true);
  });

  it('row 4 — no placement: the cap truncates exactly as every release since 9.11.0', async () => {
    const row = await run({ cap: 3_000 });
    expect(row.minted).toHaveLength(0);
    expect((row.endResult as { truncated?: boolean }).truncated).toBe(true);
  });

  it('row 5 — placement alone: the ticket, and no net needed', async () => {
    const row = await run({ placement: 2_000 });
    expect(isPlacedToolResult(row.endResult)).toBe(true);
    expect(row.minted).toHaveLength(1);
  });
});

describe('integration — the placed ref is a first-class ticket: a wants-tool redeems it', () => {
  it('big result placed → the model routes the ref → the consumer reads the exact displaced text', async () => {
    const store = inMemoryArtifacts();
    let placedRef = '';
    const seen: { data?: unknown } = {};
    const consume = defineTool<{ report: string }, string>({
      name: 'consume_report',
      description: 'consumes a placed tool result',
      inputSchema: {
        type: 'object',
        properties: { report: { type: 'string' } },
        required: ['report'],
      },
      wants: { report: placedResultKind('get_report') },
      execute: (args) => {
        seen.data = args.report;
        return `got ${(args.report as unknown as string).length} chars`;
      },
    });
    const build = (replies: unknown[]) =>
      Agent.create({
        provider: mock({ replies: replies as never }),
        model: 'mock',
        maxIterations: 4,
        artifacts: { store, placement: { maxInlineChars: 2_000 } },
      })
        .system('s')
        .tool(bigTool)
        .tool(consume)
        .build();

    const first = build([call('get_report', 't1'), final('placed')]);
    first.on('agentfootprint.artifacts.minted', (e) => {
      placedRef = (e.payload as { ref: string }).ref;
    });
    await first.run({ message: 'fetch' }, { sessionId: 'circle' });
    expect(placedRef).toMatch(/^art_/);

    const second = build([call('consume_report', 't2', { report: placedRef }), final('done')]);
    const ends = toolEndCapture(second);
    await second.run({ message: 'consume' }, { sessionId: 'circle' });
    // The consumer read the EXACT text the model was spared.
    expect(seen.data).toBe(BIG);
    expect(String(ends[0].result)).toBe('got 5000 chars');
  });
});

describe('config refusals — a dial that cannot dial is refused where it is set', () => {
  it('non-positive / non-integer maxInlineChars', () => {
    for (const bad of [0, -5, 2.5, Number.NaN]) {
      expect(() =>
        Agent.create({
          provider: mock({ replies: [final('x')] as never }),
          model: 'mock',
          artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: bad } },
        })
          .system('s')
          .build(),
      ).toThrowError(/maxInlineChars/);
    }
  });

  it('object form without a store (plain-JS caller) is configuration that lies — refused by name', () => {
    expect(() =>
      Agent.create({
        provider: mock({ replies: [final('x')] as never }),
        model: 'mock',
        artifacts: { store: undefined, placement: { maxInlineChars: 100 } } as never,
      })
        .system('s')
        .build(),
    ).toThrowError(/without a `store`/);
  });
});

describe('regression — zero-delta pins', () => {
  it('under the threshold: the result is byte-identical and nothing is minted', async () => {
    const small = defineTool({
      name: 'small',
      description: 'small result',
      execute: () => 'tiny',
    });
    const agent = Agent.create({
      provider: mock({ replies: [call('small', 't1'), final('done')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: 2_000 } },
    })
      .system('s')
      .tool(small)
      .build();
    const events = artifactCapture(agent);
    const ends = toolEndCapture(agent);
    await agent.run({ message: 'go' });
    expect(ends[0].result).toBe('tiny');
    expect(events).toHaveLength(0);
  });

  it('store WITHOUT placement (the bare form): big results travel exactly as in 9.21.0', async () => {
    const agent = Agent.create({
      provider: mock({ replies: [call('get_report', 't1'), final('done')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: inMemoryArtifacts(),
    })
      .system('s')
      .tool(bigTool)
      .build();
    const events = artifactCapture(agent);
    const ends = toolEndCapture(agent);
    await agent.run({ message: 'go' });
    expect(ends[0].result).toBe(BIG);
    expect(events).toHaveLength(0);
  });

  it('an ERRORED call is never placed — tool-result/<name> must never claim an error is the result', async () => {
    const boom = defineTool({
      name: 'boom',
      description: 'throws big',
      execute: () => {
        throw new Error('x'.repeat(5_000));
      },
    });
    const agent = Agent.create({
      provider: mock({ replies: [call('boom', 't1'), final('done')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: 2_000 } },
    })
      .system('s')
      .tool(boom)
      .build();
    const events = artifactCapture(agent);
    const ends = toolEndCapture(agent);
    await agent.run({ message: 'go' });
    expect(ends[0].error).toBe(true);
    expect(events.filter((e) => e.name === 'agentfootprint.artifacts.minted')).toHaveLength(0);
  });
});
