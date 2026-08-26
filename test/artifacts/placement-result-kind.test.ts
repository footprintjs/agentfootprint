/**
 * `Tool.resultKind` (9.70.0) — a placed result the `wants` rail can spend.
 *
 * The property under test is that ONE decision moved and nothing else did.
 * `wants` matches artifact kinds by exact string equality BY LAW — no
 * wildcards, no hierarchy — and placement minted `tool-result/<toolName>`, so
 * the framework handed out a ticket its own rail refused as a kind mismatch
 * and consumers re-minted by hand at the seam. The fix is on the PRODUCING
 * end: the mint speaks the author's vocabulary. So every assertion here is
 * one-sided — the declared kind must reach the store, the event, the ticket
 * and the consuming tool's resolution, while a tool that declares nothing
 * must produce the same bytes it produced before this field existed.
 *
 * Sections follow Convention 3: Unit (the kind decision + the definition-time
 * refusal) · Functional (the declared kind on every channel) · Integration
 * (the full circle through the REAL loop — a `wants` consumer redeeming a
 * ticket it could not have redeemed before) · Edge (whitespace, the
 * matcher-is-untouched pin) · Regression (the zero-delta pin: absent
 * `resultKind` is byte-identical to the old mint).
 */

import { describe, it, expect } from 'vitest';
import {
  Agent,
  assertResultKind,
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
const artifactCapture = (agent: Agent): Caught[] => {
  const events: Caught[] = [];
  agent.on('agentfootprint.artifacts.*', (e: AgentfootprintEvent) => {
    events.push({ name: e.type, payload: e.payload as Record<string, unknown> });
  });
  return events;
};
const toolEndCapture = (agent: Agent): Record<string, unknown>[] => {
  const ends: Record<string, unknown>[] = [];
  agent.on('agentfootprint.stream.tool_end', (e) =>
    ends.push(e.payload as Record<string, unknown>),
  );
  return ends;
};

const ROWS = 'x'.repeat(5_000);

// ─── 1. Unit — the kind decision, and the refusal that guards it ──────

describe('unit — placedResultKind is the one place the kind is decided', () => {
  it('composes the framework default when the tool declared nothing', () => {
    expect(placedResultKind('get_rows')).toBe('tool-result/get_rows');
    expect(placedResultKind('get_rows', undefined)).toBe('tool-result/get_rows');
  });

  it('a declared kind WINS — that is the whole feature', () => {
    expect(placedResultKind('get_rows', 'dataset/rows')).toBe('dataset/rows');
  });

  it('copies a declared kind onto the Tool, and leaves it off when absent', () => {
    const declared = defineTool({
      name: 'get_rows',
      description: 'rows',
      resultKind: 'dataset/rows',
      execute: () => ROWS,
    });
    expect(declared.resultKind).toBe('dataset/rows');
    const plain = defineTool({ name: 'get_rows', description: 'rows', execute: () => ROWS });
    // Absent, not empty — the `capabilities` law: saying nothing is a
    // different statement from declaring a blank.
    expect('resultKind' in plain).toBe(false);
  });

  it('refuses a kind nothing could ever want, at DEFINITION time, naming the tool', () => {
    expect(() =>
      defineTool({ name: 'get_rows', description: 'rows', resultKind: '', execute: () => ROWS }),
    ).toThrow(/get_rows/);
    expect(() =>
      defineTool({ name: 'get_rows', description: 'rows', resultKind: '', execute: () => ROWS }),
    ).toThrow(/resultKind/);
    // The refusal teaches the way out, and names what omitting it does.
    expect(() =>
      defineTool({ name: 'get_rows', description: 'rows', resultKind: '', execute: () => ROWS }),
    ).toThrow(/tool-result\/get_rows/);
  });

  it('assertResultKind is that same check, exported for hand-built Tools', () => {
    expect(() => assertResultKind('t', undefined)).not.toThrow();
    expect(() => assertResultKind('t', 'dataset/rows')).not.toThrow();
    expect(() => assertResultKind('t', '')).toThrow(/resultKind/);
  });
});

// ─── 2. Functional — the declared kind reaches every channel ──────────

describe('functional — a placed result is minted under the DECLARED kind', () => {
  it('the store, the artifacts.minted event, and the ticket all say dataset/rows', async () => {
    const store = inMemoryArtifacts();
    const getRows = defineTool({
      name: 'get_rows',
      description: 'returns a big dataset',
      resultKind: 'dataset/rows',
      execute: () => ROWS,
    });
    const agent = Agent.create({
      provider: mock({ replies: [call('get_rows', 't1'), final('done')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: { store, placement: { maxInlineChars: 2_000 } },
    })
      .system('s')
      .tool(getRows)
      .build();
    const events = artifactCapture(agent);
    const ends = toolEndCapture(agent);
    const history: { role: string; content: string }[] = [];
    agent.on('agentfootprint.agent.iteration_end', (e) => {
      const h = (e.payload as { history?: readonly { role: string; content: string }[] }).history;
      if (h) history.push(...h);
    });
    await agent.run({ message: 'go' }, { sessionId: 'declared' });

    const minted = events.filter((e) => e.name === 'agentfootprint.artifacts.minted');
    expect(minted).toHaveLength(1);
    expect(minted[0].payload).toMatchObject({
      kind: 'dataset/rows',
      label: 'get_rows result',
      tool: 'get_rows',
      bytes: 5_000,
    });
    // The framework's own vocabulary is nowhere on the record — a mint that
    // said both would leave a consumer guessing which one to want.
    expect(JSON.stringify(minted[0].payload)).not.toContain('tool-result/');

    const endResult = ends[0].result;
    expect(isPlacedToolResult(endResult)).toBe(true);
    expect((endResult as { kind: string }).kind).toBe('dataset/rows');

    // And what the MODEL read names the kind it must route to — twice, in
    // the reason sentence, because the ticket teaches the redemption.
    const toolMsg = history.find((m) => m.role === 'tool');
    const parsed = JSON.parse(String(toolMsg?.content)) as Record<string, unknown>;
    expect(parsed.kind).toBe('dataset/rows');
    expect(String(parsed.reason)).toContain("wants 'dataset/rows'");
  });
});

// ─── 3. Integration — the full circle through the real loop ───────────

describe('integration — a wants consumer redeems a ticket it could not have redeemed before', () => {
  it('get_rows declares dataset/rows → placement mints it → chart_rows resolves the DATA', async () => {
    const store = inMemoryArtifacts();
    const getRows = defineTool({
      name: 'get_rows',
      description: 'returns a big dataset',
      resultKind: 'dataset/rows',
      execute: () => ROWS,
    });
    const seen: { data?: unknown } = {};
    const chartRows = defineTool<{ dataset: string }, string>({
      name: 'chart_rows',
      description: 'charts a stored dataset',
      inputSchema: {
        type: 'object',
        properties: { dataset: { type: 'string' } },
        required: ['dataset'],
      },
      // The consumer's OWN vocabulary — it names no tool and knows no prefix.
      wants: { dataset: 'dataset/rows' },
      execute: (args) => {
        seen.data = args.dataset;
        return `charted ${(args.dataset as unknown as string).length} chars`;
      },
    });
    const build = (replies: unknown[]): Agent =>
      Agent.create({
        provider: mock({ replies: replies as never }),
        model: 'mock',
        maxIterations: 4,
        artifacts: { store, placement: { maxInlineChars: 2_000 } },
      })
        .system('s')
        .tool(getRows)
        .tool(chartRows)
        .build();

    let placedRef = '';
    const first = build([call('get_rows', 't1'), final('placed')]);
    first.on('agentfootprint.artifacts.minted', (e) => {
      placedRef = (e.payload as { ref: string }).ref;
    });
    await first.run({ message: 'fetch' }, { sessionId: 'circle-kind' });
    expect(placedRef).toMatch(/^art_/);

    const second = build([call('chart_rows', 't2', { dataset: placedRef }), final('done')]);
    const ends = toolEndCapture(second);
    const refused: Record<string, unknown>[] = [];
    second.on('agentfootprint.artifacts.refused', (e) =>
      refused.push(e.payload as Record<string, unknown>),
    );
    await second.run({ message: 'chart' }, { sessionId: 'circle-kind' });

    // Nothing was refused, and the handler read the EXACT displaced text.
    expect(refused).toHaveLength(0);
    expect(seen.data).toBe(ROWS);
    expect(String(ends[0].result)).toBe('charted 5000 chars');
  });

  it('WITHOUT the declaration the same consumer is refused — the friction this closes, pinned', async () => {
    const store = inMemoryArtifacts();
    // Byte-for-byte the tool above, minus `resultKind`.
    const getRows = defineTool({
      name: 'get_rows',
      description: 'returns a big dataset',
      execute: () => ROWS,
    });
    const chartRows = defineTool<{ dataset: string }, string>({
      name: 'chart_rows',
      description: 'charts a stored dataset',
      inputSchema: {
        type: 'object',
        properties: { dataset: { type: 'string' } },
        required: ['dataset'],
      },
      wants: { dataset: 'dataset/rows' },
      execute: (args) => `charted ${(args.dataset as unknown as string).length} chars`,
    });
    const build = (replies: unknown[]): Agent =>
      Agent.create({
        provider: mock({ replies: replies as never }),
        model: 'mock',
        maxIterations: 4,
        artifacts: { store, placement: { maxInlineChars: 2_000 } },
      })
        .system('s')
        .tool(getRows)
        .tool(chartRows)
        .build();

    let placedRef = '';
    const first = build([call('get_rows', 't1'), final('placed')]);
    first.on('agentfootprint.artifacts.minted', (e) => {
      placedRef = (e.payload as { ref: string }).ref;
    });
    await first.run({ message: 'fetch' }, { sessionId: 'circle-nokind' });

    const second = build([call('chart_rows', 't2', { dataset: placedRef }), final('done')]);
    const refused: Record<string, unknown>[] = [];
    second.on('agentfootprint.artifacts.refused', (e) =>
      refused.push(e.payload as Record<string, unknown>),
    );
    await second.run({ message: 'chart' }, { sessionId: 'circle-nokind' });

    // The kind mismatch, exactly as the field reported it. `wants` is right
    // to refuse — the mint was speaking a vocabulary the consumer never named.
    expect(refused.map((r) => r.reason)).toContain('kind-mismatch');
  });
});

// ─── 4. Edge ──────────────────────────────────────────────────────────

describe('edge — the boundaries of the declaration', () => {
  it('a whitespace-only kind is refused too: it would match nothing on the wants rail', () => {
    expect(() =>
      defineTool({ name: 'get_rows', description: 'rows', resultKind: '   ', execute: () => ROWS }),
    ).toThrow(/resultKind/);
  });

  it('the library owns no charset — a kind with any shape the consumer uses is accepted', () => {
    // Deliberate: the kind is the CONSUMER's vocabulary. A shape rule here
    // would be the library legislating a namespace it does not own.
    for (const kind of ['dataset/rows', 'rows', 'acme:dataset.rows.v2', 'tool-result/other']) {
      expect(() =>
        defineTool({
          name: 'get_rows',
          description: 'rows',
          resultKind: kind,
          execute: () => ROWS,
        }),
      ).not.toThrow();
    }
  });

  it('declaring resultKind does NOT loosen the matcher — a near-miss still refuses', async () => {
    const store = inMemoryArtifacts();
    const getRows = defineTool({
      name: 'get_rows',
      description: 'rows',
      resultKind: 'dataset/rows',
      execute: () => ROWS,
    });
    const chartRows = defineTool<{ dataset: string }, string>({
      name: 'chart_rows',
      description: 'charts a stored dataset',
      inputSchema: {
        type: 'object',
        properties: { dataset: { type: 'string' } },
        required: ['dataset'],
      },
      // One segment off. Exact match is the law, and it stays the law.
      wants: { dataset: 'dataset/rows/v2' },
      execute: () => 'charted',
    });
    const build = (replies: unknown[]): Agent =>
      Agent.create({
        provider: mock({ replies: replies as never }),
        model: 'mock',
        maxIterations: 4,
        artifacts: { store, placement: { maxInlineChars: 2_000 } },
      })
        .system('s')
        .tool(getRows)
        .tool(chartRows)
        .build();

    let placedRef = '';
    const first = build([call('get_rows', 't1'), final('placed')]);
    first.on('agentfootprint.artifacts.minted', (e) => {
      placedRef = (e.payload as { ref: string }).ref;
    });
    await first.run({ message: 'fetch' }, { sessionId: 'near-miss' });

    const second = build([call('chart_rows', 't2', { dataset: placedRef }), final('done')]);
    const refused: Record<string, unknown>[] = [];
    second.on('agentfootprint.artifacts.refused', (e) =>
      refused.push(e.payload as Record<string, unknown>),
    );
    await second.run({ message: 'chart' }, { sessionId: 'near-miss' });
    expect(refused.map((r) => r.reason)).toContain('kind-mismatch');
  });
});

// ─── 5. Regression — the zero-delta pin ───────────────────────────────

describe('regression — a tool that declares nothing mints exactly what it always did', () => {
  const runPlacement = async (
    tool: ReturnType<typeof defineTool>,
  ): Promise<{ minted: Record<string, unknown>; ticket: Record<string, unknown> }> => {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({ replies: [call('get_rows', 't1'), final('done')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: { store, placement: { maxInlineChars: 2_000 } },
    })
      .system('s')
      .tool(tool)
      .build();
    const events = artifactCapture(agent);
    const ends = toolEndCapture(agent);
    await agent.run({ message: 'go' }, { sessionId: 'zero-delta' });
    const minted = events.find((e) => e.name === 'agentfootprint.artifacts.minted');
    return {
      minted: minted?.payload ?? {},
      ticket: ends[0].result as Record<string, unknown>,
    };
  };

  it('the mint is tool-result/<toolName>, and the ticket is the same object modulo the ref', async () => {
    const plain = defineTool({
      name: 'get_rows',
      description: 'returns a big dataset',
      execute: () => ROWS,
    });
    const row = await runPlacement(plain);
    expect(row.minted.kind).toBe('tool-result/get_rows');
    expect(row.ticket.kind).toBe('tool-result/get_rows');

    // The whole ticket, field by field — the ref is the only value that
    // cannot be pinned (it is minted fresh), and the reason quotes it.
    const ref = String(row.ticket.ref);
    expect(row.ticket).toEqual({
      placed: true,
      ref,
      kind: 'tool-result/get_rows',
      mediaType: 'text/plain',
      bytes: 5_000,
      reason:
        `get_rows returned 5000 chars, over the 2000-char placement threshold, so the full ` +
        `result was stored as artifact '${ref}' (tool-result/get_rows) instead of entering ` +
        `this conversation. Route the ref: pass the string '${ref}' to a tool whose argument ` +
        `wants 'tool-result/get_rows', or call present({ ref: '${ref}', as: … }) to hand it ` +
        `to the screen. Do not retype or summarize content you have not read.`,
    });
  });

  it('the declared kind changes ONLY the kind — every other field of the ticket is untouched', async () => {
    const declared = defineTool({
      name: 'get_rows',
      description: 'returns a big dataset',
      resultKind: 'dataset/rows',
      execute: () => ROWS,
    });
    const plain = defineTool({
      name: 'get_rows',
      description: 'returns a big dataset',
      execute: () => ROWS,
    });
    const a = await runPlacement(declared);
    const b = await runPlacement(plain);

    const shapeOf = (t: Record<string, unknown>): Record<string, unknown> => {
      const { ref: _ref, reason: _reason, kind: _kind, ...rest } = t;
      return rest;
    };
    expect(shapeOf(a.ticket)).toEqual(shapeOf(b.ticket));
    expect(a.minted.mediaType).toBe(b.minted.mediaType);
    expect(a.minted.bytes).toBe(b.minted.bytes);
    expect(a.minted.label).toBe(b.minted.label);
  });
});
