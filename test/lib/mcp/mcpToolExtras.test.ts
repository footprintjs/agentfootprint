/**
 * MCP tool DECLARATIONS, both directions (9.71.0) — `_meta.agentfootprint`.
 *
 * The defect this closes: a tool that arrived over MCP was a second-class
 * citizen of every consumer-side rail. `mcpServe` sent a name, a description
 * and an input schema; everything a check READS — `argumentsFrom`,
 * `resultKind`, `owner`, `resultClass`, `resultCeiling` — stayed on the server.
 * So the dangling-reference and unsupported-argument checks never armed for a
 * remote tool, placement minted a kind no `wants` could spend, and the identity
 * joins had no subject. The fix carries the DECLARATION half of a `Tool` in
 * MCP's own `_meta` bag, under one namespaced key, and leaves the EXECUTION
 * half (`needs`, `checkIn`, session hooks) behind — it governs how a tool runs,
 * and the tool runs on the server.
 *
 * The asymmetry is the interesting part and most of this file is about it:
 * serving validates nothing new (`defineTool` already did), while INGEST
 * validates every field by the SAME rule and THROWS NOTHING — a malformed
 * declaration from a foreign server is warned about once and dropped, and the
 * tool still registers. One server's typo must never kill a bulk register.
 *
 * Test types (Convention 3): unit (the bag composer, the reader, the inclusion
 * bar) · functional (the round trip: five fields out, five fields back) ·
 * integration (the POINT — an MCP-only catalogue arms `unsupported-argument`,
 * and a remote `resultKind` drives placement's mint through the real loop) ·
 * contract (the disposition row shows the check armed) · edge (each field's
 * malformed shape: warn-once, dropped, tool survives) · security (a hostile
 * bag cannot throw, cannot smuggle execution fields, cannot kill the register)
 * · regression (no bag → byte-identical registration, pinned field by field).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Agent, defineTool, inMemoryArtifacts } from '../../../src/index.js';
import { mcpClient, mcpServe, mockMcpClient } from '../../../src/tool-providers/index.js';
import { mock } from '../../../src/llm-providers.js';
import {
  MCP_TOOL_EXTRAS_KEY,
  readToolExtras,
  toolExtrasOf,
  _resetToolExtrasWarnings,
} from '../../../src/lib/mcp/toolExtras.js';
import type {
  McpCallToolRequest,
  McpListedTool,
  McpSdkServer,
} from '../../../src/lib/mcp/types.js';
import type { Tool } from '../../../src/core/tools.js';
import type { CheckReport } from '../../../src/integrity/disposition/types.js';

// ─── Harness ──────────────────────────────────────────────────────

type Handler = (req: McpCallToolRequest, extra: { signal?: AbortSignal }) => unknown;

/** The `_server` double, narrowed to the one thing this file reads: the listing. */
function listingServer(): McpSdkServer & { list(): Promise<{ tools: McpListedTool[] }> } {
  const handlers = new Map<string, Handler>();
  return {
    setRequestHandler(schema: unknown, handler: Handler) {
      handlers.set((schema as { method: string }).method, handler);
    },
    connect: async () => {},
    close: async () => {},
    async list() {
      return (await handlers.get('tools/list')?.({}, {})) as never;
    },
  };
}

/** An `_client` double that serves exactly the listing it was handed. */
const listingClient = (tools: readonly McpListedTool[]) => ({
  connect: async () => {},
  listTools: async () => ({ tools }),
  callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  close: async () => {},
});

/** Register the given listing through the REAL `mcpClient` ingest path. */
async function ingest(tools: readonly McpListedTool[], server = 'fleet-mcp'): Promise<Tool[]> {
  const client = await mcpClient({
    name: server,
    transport: { transport: 'stdio', command: 'echo' },
    _client: listingClient(tools),
  });
  return [...(await client.tools())];
}

/** One tool declaring ALL FIVE — the round trip's subject. */
const declaresEverything = () =>
  defineTool({
    name: 'backup_status',
    description: 'Reads the backup record for one machine.',
    inputSchema: {
      type: 'object',
      properties: { machine: { type: 'string' } },
      required: ['machine'],
    },
    argumentsFrom: ['fleet_report'],
    resultKind: 'dataset/backups',
    owner: { kind: 'registry', id: 'fleet-desk' },
    resultClass: 'triage',
    resultCeiling: { maxChars: 4_000, narrowBy: ['machine'] },
    execute: () => 'no backup record found',
  });

const bagOf = (tool: McpListedTool): Record<string, unknown> =>
  (tool._meta as Record<string, Record<string, unknown>>)[MCP_TOOL_EXTRAS_KEY]!;

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  _resetToolExtrasWarnings();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

// ─── 1. Unit — the composer, the reader, and the bar ──────────────

describe('unit — toolExtrasOf composes the bag, absent means absent', () => {
  it('carries all five declarations verbatim', () => {
    expect(toolExtrasOf(declaresEverything())).toEqual({
      argumentsFrom: ['fleet_report'],
      resultKind: 'dataset/backups',
      owner: { kind: 'registry', id: 'fleet-desk' },
      resultClass: 'triage',
      resultCeiling: { maxChars: 4_000, narrowBy: ['machine'] },
    });
  });

  it('a tool that declares NOTHING gets no bag at all — not an empty one', () => {
    const plain = defineTool({ name: 'echo', description: 'echo', execute: () => 'ok' });
    expect(toolExtrasOf(plain)).toBeUndefined();
  });

  it('a tool that declares TWO sends two keys, never five with three blanks', () => {
    const partial = defineTool({
      name: 'get_rows',
      description: 'rows',
      resultKind: 'dataset/rows',
      resultClass: 'inventory',
      execute: () => 'rows',
    });
    expect(Object.keys(toolExtrasOf(partial)!).sort()).toEqual(['resultClass', 'resultKind']);
  });

  it('THE BAR: execution-side fields never travel — `needs` and `checkIn` stay home', () => {
    // They govern how a tool RUNS, and the tool runs on the server. A client
    // holding a consent gate the executor already held (or nobody held) is
    // worse than a client that was told nothing.
    const governed = defineTool({
      name: 'wire_money',
      description: 'moves money',
      needs: { credential: 'bank' },
      resultClass: 'triage',
      execute: () => 'sent',
    });
    const bag = toolExtrasOf(governed)!;
    expect(bag).toEqual({ resultClass: 'triage' });
    expect('needs' in bag).toBe(false);
    expect('checkIn' in bag).toBe(false);
  });
});

describe('unit — readToolExtras reads defensively and never throws', () => {
  const origin = { server: 'fleet-mcp', tool: 'backup_status' };

  it('no _meta, a foreign _meta, or a non-object bag all read as nothing', () => {
    expect(readToolExtras(undefined, origin)).toEqual({});
    expect(readToolExtras({ someoneElse: { x: 1 } }, origin)).toEqual({});
    expect(readToolExtras({ [MCP_TOOL_EXTRAS_KEY]: 'not an object' }, origin)).toEqual({});
    expect(readToolExtras({ [MCP_TOOL_EXTRAS_KEY]: [1, 2] }, origin)).toEqual({});
    expect(readToolExtras(null, origin)).toEqual({});
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('a field this library does not know is ignored IN SILENCE — a newer server is not an error', () => {
    expect(
      readToolExtras({ [MCP_TOOL_EXTRAS_KEY]: { resultKind: 'k', somethingNewer: 42 } }, origin),
    ).toEqual({ resultKind: 'k' });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── 2. Functional — the round trip ───────────────────────────────

describe('functional — five declarations out, five declarations back', () => {
  it('mcpServe writes the bag, mcpClient reads it, every field byte-equal', async () => {
    const server = listingServer();
    await mcpServe([declaresEverything()], { name: 'fleet-desk', _server: server });
    const listed = await server.list();

    // The carrier: ONE namespaced key inside MCP's own `_meta`.
    expect(Object.keys(listed.tools[0]!._meta!)).toEqual([MCP_TOOL_EXTRAS_KEY]);

    const [registered] = await ingest(listed.tools);
    const source = declaresEverything();
    expect(registered!.argumentsFrom).toEqual(source.argumentsFrom);
    expect(registered!.resultKind).toBe(source.resultKind);
    expect(registered!.owner).toEqual(source.owner);
    expect(registered!.resultClass).toBe(source.resultClass);
    expect(registered!.resultCeiling).toEqual(source.resultCeiling);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('the served bag holds the declarations and nothing else', async () => {
    const server = listingServer();
    await mcpServe([declaresEverything()], { name: 'fleet-desk', _server: server });
    const listed = await server.list();
    expect(bagOf(listed.tools[0]!)).toEqual(toolExtrasOf(declaresEverything()));
  });

  it('a served tool that declares nothing carries no _meta key on the wire', async () => {
    const server = listingServer();
    await mcpServe([defineTool({ name: 'echo', description: 'echo', execute: () => 'ok' })], {
      _server: server,
    });
    const listed = await server.list();
    expect('_meta' in listed.tools[0]!).toBe(false);
  });

  it('mockMcpClient reads the same bag — the mock is a stand-in, not a different door', async () => {
    const client = mockMcpClient({
      name: 'fleet-mcp',
      tools: [
        {
          name: 'backup_status',
          inputSchema: { type: 'object', properties: {} },
          _meta: { [MCP_TOOL_EXTRAS_KEY]: { argumentsFrom: ['fleet_report'] } },
        },
      ],
    });
    const [tool] = await client.tools();
    expect(tool!.argumentsFrom).toEqual(['fleet_report']);
    expect(tool!.source).toBe('fleet-mcp');
  });
});

// ─── 3. Integration — the point, through the real loop ────────────

/**
 * The anonymised triage turn from `test/integrity/unsupportedArgument.test.ts`,
 * with the WHOLE catalogue arriving over MCP. `backup_status` is the agent's
 * only grounded tool and its `argumentsFrom` was declared by a remote server —
 * so if the check fires here, a remotely-declared tool armed it.
 */
const RENDERED_ANSWER = 'The nightly job bkp-4417-ganymede-tier2 finished at 02:14.';
const TASK = 'What is the backup status for that machine?';

async function mcpTriageAgent(opts: { armed: boolean; machine: string }): Promise<{
  agent: Agent;
  findings: Record<string, unknown>[];
  dispositions: Record<string, unknown>[];
}> {
  const fleet = mockMcpClient({
    name: 'fleet-mcp',
    tools: [
      {
        name: 'fleet_report',
        description: 'Lists the machines in the fleet by their real names.',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => 'FLEET: callisto-02 (online), europa-03 (online)',
      },
      {
        name: 'backup_status',
        description: 'Reads the backup record for one machine.',
        inputSchema: {
          type: 'object',
          properties: { machine: { type: 'string' } },
          required: ['machine'],
        },
        handler: async () => 'no backup record found',
        ...(opts.armed && {
          _meta: { [MCP_TOOL_EXTRAS_KEY]: { argumentsFrom: ['fleet_report'] } },
        }),
      },
    ],
  });
  const bad = {
    content: '',
    toolCalls: [{ id: 'c2', name: 'backup_status', args: { machine: opts.machine } }],
    stopReason: 'tool_use' as const,
  };
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          content: RENDERED_ANSWER,
          toolCalls: [{ id: 'c1', name: 'fleet_report', args: {} }],
          stopReason: 'tool_use' as const,
        },
        bad,
        { content: 'done', toolCalls: [], stopReason: 'stop' as const },
      ],
    }),
    model: 'mock',
    maxIterations: 8,
  })
    .system('You are a fleet triage assistant.')
    .tools(await fleet.tools())
    .build();
  const findings: Record<string, unknown>[] = [];
  const dispositions: Record<string, unknown>[] = [];
  agent.on('agentfootprint.integrity.context_error', (e) =>
    findings.push(e.payload as unknown as Record<string, unknown>),
  );
  agent.on('agentfootprint.integrity.disposition', (e) =>
    dispositions.push(e.payload as unknown as Record<string, unknown>),
  );
  return { agent, findings, dispositions };
}

describe('integration — an MCP-declared argumentsFrom arms the choice-seam check', () => {
  it('an id mined from the model’s own prose files unsupported-argument for a REMOTE tool', async () => {
    const { agent, findings } = await mcpTriageAgent({ armed: true, machine: '4417-ganymede' });
    await agent.run({ message: TASK });
    const found = findings.filter((f) => f.kind === 'unsupported-argument');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ seam: 'choice', predicate: 'machine' });
    expect(String(found[0]!.message)).toContain('backup_status');
    expect(String(found[0]!.message)).toContain('fleet_report');
  });

  it('the same catalogue WITHOUT the bag files nothing — the declaration is what armed it', async () => {
    const { agent, findings } = await mcpTriageAgent({ armed: false, machine: '4417-ganymede' });
    await agent.run({ message: TASK });
    expect(findings.filter((f) => f.kind === 'unsupported-argument')).toEqual([]);
  });
});

describe('contract — the disposition row shows the check armed', () => {
  it('an MCP-armed run records the encounter and the finding', async () => {
    const { agent, dispositions } = await mcpTriageAgent({
      armed: true,
      machine: '4417-ganymede',
    });
    await agent.run({ message: TASK });
    const rows = dispositions[0]!.rows as CheckReport[];
    const row = rows.find((r) => r.check === 'unsupported-argument')!;
    expect(row.seam).toBe('choice');
    expect(row.checked).toBeGreaterThanOrEqual(1);
    expect(row.findings).toBe(1);
    expect(row.lastFiredAt).toBeDefined();
  });

  it('and WITHOUT the bag the same row is honest about having no subject', async () => {
    const { agent, dispositions } = await mcpTriageAgent({
      armed: false,
      machine: '4417-ganymede',
    });
    await agent.run({ message: TASK });
    const rows = dispositions[0]!.rows as CheckReport[];
    expect(rows.find((r) => r.check === 'unsupported-argument')).toMatchObject({
      checked: 0,
      findings: 0,
    });
  });
});

describe('integration — a remote resultKind drives placement’s mint', () => {
  const ROWS = 'x'.repeat(5_000);

  const placementAgent = async (declare: boolean) => {
    const remote = mockMcpClient({
      name: 'rows-mcp',
      tools: [
        {
          name: 'get_rows',
          description: 'returns a big dataset',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ROWS,
          ...(declare && { _meta: { [MCP_TOOL_EXTRAS_KEY]: { resultKind: 'dataset/rows' } } }),
        },
      ],
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          {
            content: '',
            toolCalls: [{ id: 't1', name: 'get_rows', args: {} }],
            stopReason: 'tool_use' as const,
          },
          { content: 'done', toolCalls: [], stopReason: 'stop' as const },
        ],
      }),
      model: 'mock',
      maxIterations: 3,
      artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: 2_000 } },
    })
      .system('s')
      .tools(await remote.tools())
      .build();
    const minted: Record<string, unknown>[] = [];
    agent.on('agentfootprint.artifacts.minted', (e) =>
      minted.push(e.payload as Record<string, unknown>),
    );
    await agent.run({ message: 'go' }, { sessionId: declare ? 'mcp-kind' : 'mcp-nokind' });
    return minted;
  };

  it('the placed result is minted under the kind the SERVER declared', async () => {
    const minted = await placementAgent(true);
    expect(minted).toHaveLength(1);
    expect(minted[0]!.kind).toBe('dataset/rows');
  });

  it('without the declaration it mints the framework default, exactly as before', async () => {
    const minted = await placementAgent(false);
    expect(minted[0]!.kind).toBe('tool-result/get_rows');
  });
});

// ─── 4. Edge — a malformed bag, field by field ────────────────────

/** Each row: the field, a shape its own rule refuses, and a phrase OF that rule. */
const MALFORMED: ReadonlyArray<{ field: string; value: unknown; rule: RegExp }> = [
  { field: 'argumentsFrom', value: ['fleet_report', ''], rule: /non-empty tool/ },
  { field: 'argumentsFrom', value: [], rule: /at least one tool/ },
  { field: 'argumentsFrom', value: 'fleet_report', rule: /at least one tool/ },
  { field: 'resultKind', value: '   ', rule: /not a kind anything could want/ },
  { field: 'owner', value: { kind: 'registry', id: '' }, rule: /non-empty kind and id/ },
  { field: 'owner', value: null, rule: /non-empty kind and id/ },
  { field: 'resultClass', value: 'nonsense', rule: /not a class this library has/ },
  { field: 'resultCeiling', value: { maxChars: -5 }, rule: /positive whole number/ },
  { field: 'resultCeiling', value: { maxChars: 10, narrowBy: [] }, rule: /suggest/ },
];

describe('edge — one malformed field is warned about once and DROPPED', () => {
  for (const { field, value, rule } of MALFORMED) {
    it(`${field} = ${JSON.stringify(value)} — dropped, warned, tool still registered`, async () => {
      // A well-formed neighbour rides along, chosen so it is never the field
      // under test: the drop must be surgical, not a bag-wide bail-out.
      const sibling =
        field === 'resultClass' ? { resultKind: 'dataset/backups' } : { resultClass: 'triage' };
      const [tool] = await ingest([
        {
          name: 'backup_status',
          description: 'reads a backup record',
          inputSchema: { type: 'object', properties: {} },
          _meta: { [MCP_TOOL_EXTRAS_KEY]: { ...sibling, [field]: value } },
        },
      ]);

      // The tool arrived, the bad field did not, and the good one beside it did.
      expect(tool!.schema.name).toBe('backup_status');
      expect(field in tool!).toBe(false);
      expect(field === 'resultClass' ? tool!.resultKind : tool!.resultClass).toBe(
        field === 'resultClass' ? 'dataset/backups' : 'triage',
      );

      // ONE warning, naming server, tool, field — and the rule it broke.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const said = String(warnSpy.mock.calls[0]![0]);
      expect(said).toContain('fleet-mcp');
      expect(said).toContain('backup_status');
      expect(said).toContain(field);
      expect(said).toMatch(rule);
    });
  }

  it('the warning is ONCE per server+tool+field, however often the catalogue is re-listed', async () => {
    const listing: McpListedTool[] = [
      {
        name: 'backup_status',
        inputSchema: { type: 'object', properties: {} },
        _meta: { [MCP_TOOL_EXTRAS_KEY]: { resultKind: '' } },
      },
    ];
    const client = await mcpClient({
      name: 'fleet-mcp',
      transport: { transport: 'stdio', command: 'echo' },
      _client: listingClient(listing),
    });
    await client.tools();
    await client.refresh();
    await client.refresh();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── 5. Security — a hostile bag is data, never a weapon ──────────

describe('security — one bad tool cannot kill a bulk register', () => {
  it('a malformed neighbour does not stop the other tools from arriving intact', async () => {
    const tools = await ingest([
      {
        name: 'fleet_report',
        inputSchema: { type: 'object', properties: {} },
        _meta: { [MCP_TOOL_EXTRAS_KEY]: { resultClass: 'inventory' } },
      },
      {
        name: 'poisoned',
        inputSchema: { type: 'object', properties: {} },
        _meta: { [MCP_TOOL_EXTRAS_KEY]: { owner: { kind: '', id: '' } } },
      },
      {
        name: 'backup_status',
        inputSchema: { type: 'object', properties: {} },
        _meta: { [MCP_TOOL_EXTRAS_KEY]: { argumentsFrom: ['fleet_report'] } },
      },
    ]);
    expect(tools.map((t) => t.schema.name)).toEqual(['fleet_report', 'poisoned', 'backup_status']);
    expect(tools[0]!.resultClass).toBe('inventory');
    expect('owner' in tools[1]!).toBe(false);
    expect(tools[2]!.argumentsFrom).toEqual(['fleet_report']);
  });

  it('no shape a server can send makes the ingest throw', async () => {
    const hostile: unknown[] = [
      { argumentsFrom: [null] },
      { argumentsFrom: { 0: 'x', length: 1 } },
      { owner: 'registry' },
      { owner: { kind: 1, id: 2 } },
      { resultKind: 0 },
      { resultCeiling: null },
      { resultCeiling: 5 },
      { resultCeiling: { maxChars: Number.NaN } },
      { resultClass: { evil: true } },
      { argumentsFrom: ['backup_status'] }, // a tool grounded by itself
    ];
    for (const bag of hostile) {
      await expect(
        ingest([
          {
            name: 'backup_status',
            inputSchema: { type: 'object', properties: {} },
            _meta: { [MCP_TOOL_EXTRAS_KEY]: bag },
          },
        ]),
      ).resolves.toHaveLength(1);
    }
  });

  it('a bag naming an EXECUTION field cannot smuggle one onto the Tool', async () => {
    // `needs` and `checkIn` are outside the list this reader knows, so they
    // are not read at all. A server cannot make a client demand a credential
    // or hold a consent gate for a tool it does not execute.
    const [tool] = await ingest([
      {
        name: 'wire_money',
        inputSchema: { type: 'object', properties: {} },
        _meta: {
          [MCP_TOOL_EXTRAS_KEY]: {
            needs: { credential: 'bank' },
            checkIn: 'always',
            resultClass: 'triage',
          },
        },
      },
    ]);
    expect('needs' in tool!).toBe(false);
    expect('checkIn' in tool!).toBe(false);
    expect(tool!.resultClass).toBe('triage');
  });
});

// ─── 6. Regression — no bag is byte-identical to before ───────────

describe('regression — a server that sends no bag registers exactly what it always did', () => {
  it('the registered Tool has these fields and no others', async () => {
    const [tool] = await ingest([
      {
        name: 'search',
        description: 'Search the web',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      },
    ]);
    // The exact key set, pinned — a new declaration key appearing here for a
    // server that declared nothing would be this feature inventing facts.
    expect(Object.keys(tool!).sort()).toEqual(['execute', 'schema', 'source']);
    expect(tool!.schema).toEqual({
      name: 'search',
      description: 'Search the web',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    });
    expect(tool!.source).toBe('fleet-mcp');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('and so does the mock client', async () => {
    const client = mockMcpClient({
      name: 'mock-mcp',
      tools: [{ name: 'send_message', inputSchema: { type: 'object' } }],
    });
    const [tool] = await client.tools();
    expect(Object.keys(tool!).sort()).toEqual(['execute', 'schema', 'source']);
  });
});
