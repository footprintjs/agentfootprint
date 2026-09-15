/**
 * Dataset publications through the real Agent dispatcher, checkpoint and wants
 * boundary. Providers and HTTP/MCP connections below are synthetic fixtures;
 * this is not a live-model or network-transport acceptance test.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  Agent, defineTool, inMemoryArtifacts, withDatasetArtifacts,
  type ArtifactMeta, type DatasetResultAdapter, type LLMRequest, type Tool,
  type ToolExecutionContext,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { mcpClient } from '../../src/lib/mcp/index.js';

const scope = { tenant: 'synthetic-org', principal: 'alice', conversationId: 'dataset-adapter' };
const secret = 'COMPLETE_ROW_NOT_FOR_MODEL';
const raw = {
  rows: [
    { id: 'a', amount: 0, optional: null, active: false, detail: secret },
    { id: 'b', amount: 10, optional: 'known', active: true, detail: secret },
    { id: 'c', amount: 20, optional: null, active: true, detail: secret },
  ],
  source: { name: 'synthetic ledger', version: 1 },
  coverage: { checked: ['three retained rows'], not_checked: ['live balances'] },
};
type Args = { account: string };
type Ticket = {
  dataset: { ref: string; kind: string; rows: number; sourceField: string };
  sourceEvidence: { status: string; ref?: string };
  coverage: typeof raw.coverage;
};
const inputSchema = { type: 'object', properties: { account: { type: 'string' } }, required: ['account'] };
const adapter: DatasetResultAdapter<Args, typeof raw, Ticket> = {
  describe(result) {
    return {
      datasets: [{ key: 'rows',
        artifact: { kind: 'dataset/rows', mediaType: 'application/json', data: result.rows },
        source: { kind: 'evidence/source', mediaType: 'application/json', data: result.source, digest: 'sha-256' },
      }],
      project(publications) {
        const publication = publications[0]!;
        if (publication.artifact.status !== 'stored') throw new Error('Dataset unavailable');
        return {
          dataset: { ref: publication.artifact.meta.ref, kind: publication.artifact.meta.kind,
            rows: result.rows.length, sourceField: publication.key },
          sourceEvidence: publication.source?.status === 'stored'
            ? { status: 'available', ref: publication.source.meta.ref } : { status: 'unavailable' },
          coverage: result.coverage,
        };
      },
    };
  },
};
const call = (name: string, args: Record<string, unknown>, id = 'lookup-call') => ({
  content: '', toolCalls: [{ name, args, id }], stopReason: 'tool_use' as const,
});
function lastTool(request: LLMRequest): string {
  const message = [...request.messages].reverse().find(item => item.role === 'tool');
  return String(message?.content ?? '');
}
function consumer(seen: { rows?: unknown; meta?: ArtifactMeta; calls: number }) {
  return defineTool<{ dataset: string }, string>({
    name: 'sum_rows', description: 'Sum the complete stored dataset; pass its reference.',
    inputSchema: { type: 'object', properties: { dataset: { type: 'string' } }, required: ['dataset'] },
    wants: { dataset: 'dataset/rows' },
    execute(args, ctx) {
      seen.calls++;
      seen.rows = args.dataset;
      seen.meta = ctx.wanted?.dataset;
      const rows = args.dataset as unknown as typeof raw.rows;
      return `Total ${rows.reduce((sum, row) => sum + row.amount, 0)} over ${rows.length} rows.`;
    },
  });
}

async function source(mode: 'local' | 'http-backed' | 'mcp') {
  const collected = vi.fn(async () => structuredClone(raw));
  let context: ToolExecutionContext | undefined;
  if (mode === 'mcp') {
    const connection = {
      listTools: async () => ({ tools: [{ name: 'lookup_rows', description: 'Synthetic ledger lookup', inputSchema }] }),
      callTool: vi.fn(async (request: { name: string; arguments?: Record<string, unknown> }) => {
        expect(request).toEqual({ name: 'lookup_rows', arguments: { account: 'demo' } });
        return { content: [{ type: 'text', text: 'PROSE_MIRROR_NOT_THE_DATASET' }], structuredContent: await collected() };
      }),
      close: async () => {},
    };
    const client = await mcpClient({ name: 'synthetic-ledger', connection, resultMode: 'structured' });
    const imported = (await client.tools())[0]! as Tool<Args, typeof raw>;
    return { tool: imported, collected, close: () => client.close() };
  }
  // A producer-owned HTTP fetch seam, with no real server or external data.
  const fetchRows = vi.fn(async (url: string, options: { signal?: AbortSignal }) => {
    expect(url).toBe('https://synthetic.invalid/accounts/demo');
    expect(options.signal).toBe(context?.signal);
    return new Response(JSON.stringify(await collected()), { headers: { 'content-type': 'application/json' } });
  });
  const tool: Tool<Args, typeof raw> = {
    schema: { name: 'lookup_rows', description: 'Synthetic ledger lookup', inputSchema },
    source: 'synthetic-ledger',
    async execute(args, ctx) {
      expect(this).toBe(tool);
      expect(ctx.hasArtifacts).toBe(true);
      context = ctx;
      return mode === 'http-backed'
        ? await (await fetchRows(`https://synthetic.invalid/accounts/${args.account}`, { signal: ctx.signal })).json()
        : await collected();
    },
  };
  return { tool, collected, close: async () => {} };
}

describe('dataset adapter at native Agent boundaries', () => {
  it.each(['local', 'http-backed', 'mcp'] as const)(
    '%s lookup publishes scoped references and a follow-up consumes complete rows without collecting again', async mode => {
      const store = inMemoryArtifacts();
      const fixture = await source(mode);
      const wrapped = withDatasetArtifacts(fixture.tool, adapter);
      expect(wrapped.schema).toBe(fixture.tool.schema);
      expect(wrapped.source).toBe(fixture.tool.source);
      const requests: string[] = [];
      const artifacts: unknown[] = [];
      const seen = { calls: 0 } as { rows?: unknown; meta?: ArtifactMeta; calls: number };
      let ticket: Ticket | undefined;
      const agent = Agent.create({ artifacts: store, model: 'mock', maxIterations: 4,
        provider: mock({ respond(request) {
          requests.push(JSON.stringify(request));
          if (requests.length === 1) return call('lookup_rows', { account: 'demo' });
          if (requests.length === 2) { ticket = JSON.parse(lastTool(request)) as Ticket; return 'Dataset ready.'; }
          if (requests.length === 3) return call('sum_rows', { dataset: ticket!.dataset.ref }, 'sum-call');
          return lastTool(request);
        } }),
      }).tool(wrapped).tool(consumer(seen)).build();
      agent.on('agentfootprint.artifacts.*', event => artifacts.push(event.payload));
      try {
        expect(await agent.run({ message: 'Load demo rows.', identity: scope })).toBe('Dataset ready.');
        expect(ticket?.dataset).toMatchObject({ kind: 'dataset/rows', rows: 3, sourceField: 'rows' });
        expect(ticket?.coverage).toEqual(raw.coverage);
        expect(ticket?.sourceEvidence.status).toBe('available');
        expect(await agent.followUp('Total those rows.')).toBe('Total 30 over 3 rows.');
        expect(fixture.collected).toHaveBeenCalledTimes(1);
        expect(seen.calls).toBe(1);
        expect(seen.rows).toEqual(raw.rows); // Includes zero, false, null and the unprojected fields.
        expect(seen.meta?.ref).toBe(ticket?.dataset.ref);
        const saved = await store.get(scope, ticket!.dataset.ref);
        expect(saved?.data).toEqual(raw.rows);
        expect(saved?.meta.parentRefs).toEqual([ticket!.sourceEvidence.ref]);
        expect(saved?.meta.origin).toMatchObject({ toolCallId: 'lookup-call', runId: expect.any(String) });
        const provenance = await store.get(scope, ticket!.sourceEvidence.ref!);
        expect(provenance?.data).toEqual(raw.source);
        expect(provenance?.meta.digest).toMatch(/^sha-256:/);
        expect(provenance?.meta.origin).toEqual(saved?.meta.origin);
        expect(requests).toHaveLength(4);
        expect(requests.join('')).not.toContain(secret);
        expect(requests.join('')).not.toContain('PROSE_MIRROR_NOT_THE_DATASET');
        expect(JSON.stringify(agent.checkpoint()?.history)).not.toContain(secret);
        expect(JSON.stringify(artifacts)).not.toContain(secret);
      } finally { await fixture.close(); }
    },
  );

  it.each(['tenant', 'principal', 'conversationId', 'deleted', 'expired', 'source-kind'] as const)(
    '%s boundary refuses a published ticket before consumer execution', async boundary => {
      let now = 1_000;
      const store = inMemoryArtifacts({ retention: { ttlMs: 1_000 }, _now: () => now });
      const fixture = await source('local');
      let ticket: Ticket | undefined;
      let calls = 0;
      const producer = Agent.create({ artifacts: store, model: 'mock', provider: mock({ respond(request) {
        if (++calls === 1) return call('lookup_rows', { account: 'demo' });
        ticket = JSON.parse(lastTool(request)) as Ticket;
        return 'Dataset ready.';
      } }) }).tool(withDatasetArtifacts(fixture.tool, adapter)).build();
      await producer.run({ message: 'Load demo rows.', identity: scope });
      expect(ticket?.dataset).toEqual(expect.objectContaining({ ref: expect.stringMatching(/^art_/) }));
      const ref = boundary === 'source-kind' ? ticket!.sourceEvidence.ref! : ticket!.dataset.ref;
      if (boundary === 'deleted') await store.delete(scope, ref);
      if (boundary === 'expired') now = 2_000;
      const otherScope = ['tenant', 'principal', 'conversationId'].includes(boundary)
        ? { ...scope, [boundary]: 'other' } : scope;
      const seen = { calls: 0 };
      const requests: string[] = [];
      const refused: unknown[] = [];
      const reader = Agent.create({ artifacts: store, model: 'mock', provider: mock({ respond(request) {
        requests.push(JSON.stringify(request));
        return requests.length === 1 ? call('sum_rows', { dataset: ref }, 'refused-call') : 'Dataset unavailable.';
      } }) }).tool(consumer(seen)).build();
      reader.on('agentfootprint.artifacts.refused', event => refused.push(event.payload));
      expect(await reader.run({ message: 'Total the earlier dataset.', identity: otherScope })).toBe('Dataset unavailable.');
      expect(seen.calls).toBe(0);
      expect(fixture.collected).toHaveBeenCalledTimes(1);
      expect(refused).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'dispatch', ref })]));
      expect(requests[1]).toContain('was not executed');
      expect(requests.join('')).not.toContain(secret);
      expect(JSON.stringify(reader.checkpoint()?.history)).not.toContain(secret);
    },
  );

  it('keeps a storeless native tool result and never invokes the projection', async () => {
    const describe = vi.fn(adapter.describe);
    const tool = defineTool<Args, typeof raw>({ name: 'lookup_rows', description: 'Synthetic data', inputSchema,
      execute: (_args, ctx) => { expect(ctx.hasArtifacts).toBe(false); return raw; },
    });
    let received: unknown;
    let calls = 0;
    const agent = Agent.create({ model: 'mock', provider: mock({ respond(request) {
      if (++calls === 1) return call('lookup_rows', { account: 'demo' });
      received = JSON.parse(lastTool(request)); return 'Legacy result.';
    } }) }).tool(withDatasetArtifacts(tool, { describe })).build();
    expect(await agent.run({ message: 'Load demo rows.' })).toBe('Legacy result.');
    expect(received).toEqual(raw);
    expect(describe).not.toHaveBeenCalled();
  });
});
