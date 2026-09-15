import { describe, expect, it, vi } from 'vitest';
import { mcpClient } from '../../../src/lib/mcp/mcpClient.js';
import { mockMcpClient } from '../../../src/lib/mcp/mockMcpClient.js';
import { Agent, inMemoryArtifacts } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { McpCallToolResult, McpConnection, McpSdkClient } from '../../../src/lib/mcp/types.js';

type Mode = 'text' | 'structured' | 'structured-or-json';
const declaration = { name: 'inventory', description: 'Declared inventory',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
  _meta: { agentfootprint: { resultKind: 'dataset/rows', resultColumns: { latency: 'number' } } } };
function connection(result: unknown): McpConnection {
  return { listTools: async () => ({ tools: [declaration] }),
    callTool: vi.fn(async () => result as McpCallToolResult), close: async () => {} };
}
async function tool(result: unknown, resultMode?: Mode) {
  const client = await mcpClient({ name: 'synthetic-source', connection: connection(result), resultMode });
  return (await client.tools())[0]!;
}
const text = (value: string) => ({ content: [{ type: 'text', text: value }] });

describe('MCP declared structured results', () => {
  it('retains the structured object instead of its prose mirror, with declaration and source unchanged', async () => {
    const data = JSON.parse('{"rows":[{"latency":0,"missing":null,"ok":false}],"__proto__":{"own":true}}');
    const t = await tool({ ...text('A prose mirror, not the dataset.'), structuredContent: data }, 'structured');
    expect(await t.execute({ id: 'one' })).toEqual(data);
    expect(t.source).toBe('synthetic-source');
    expect(t.schema).toEqual({ name: declaration.name, description: declaration.description, inputSchema: declaration.inputSchema });
    expect(t.resultKind).toBe('dataset/rows');
    expect(t.resultColumns).toEqual({ latency: 'number' });
    expect(Object.hasOwn(await t.execute({}) as object, '__proto__')).toBe(true);
  });

  it('uses the same mode through the library-built connection and after refresh', async () => {
    const sdk: McpSdkClient = { ...connection({ ...text('mirror'), structuredContent: { rows: [] } }), connect: vi.fn(async () => {}) };
    const client = await mcpClient({ transport: { transport: 'stdio', command: 'unused' }, _client: sdk, resultMode: 'structured' });
    expect(await (await client.tools())[0]!.execute({})).toEqual({ rows: [] });
    expect(await (await client.refresh())[0]!.execute({})).toEqual({ rows: [] });
  });

  it('lets an ordinary execution wrapper store exact structured rows under the real invocation scope', async () => {
    const data = { rows: [{ id: 'SYNTHETIC_PRIVATE_ROW', latency: 0, missing: null }] };
    const imported = await tool({ ...text('unused mirror'), structuredContent: data }, 'structured');
    const store = inMemoryArtifacts();
    const scope = { tenant: 't', principal: 'alice', conversationId: 'structured-demo' };
    const requests: string[] = [];
    let ref = '';
    const agent = Agent.create({ artifacts: store, model: 'mock', provider: mock({ respond: request => {
      requests.push(JSON.stringify(request));
      return requests.length === 1 ? { toolCalls: [{ id: 'structured-call', name: 'inventory', args: {} }] } : 'Stored result ready.';
    } }) }).tool({ ...imported, execute: async (args, ctx) => {
      const received = await imported.execute(args, ctx) as typeof data;
      const meta = await ctx.artifacts.put({ kind: 'dataset/rows', mediaType: 'application/json', data: received.rows });
      ref = meta.ref;
      return { ref, rows: received.rows.length };
    } }).build();
    await agent.run({ message: 'Load the synthetic inventory', identity: scope });
    const record = await store.get(scope, ref);
    expect(record?.data).toEqual(data.rows);
    expect(record?.meta.origin).toMatchObject({ toolCallId: 'structured-call', runId: expect.any(String) });
    expect(await store.get({ ...scope, principal: 'bob' }, ref)).toBeNull();
    expect(requests.join('')).not.toContain('SYNTHETIC_PRIVATE_ROW');
  });

  it.each([undefined, 'text'] as const)('keeps default/explicit text and legacy behavior (%s)', async mode => {
    expect(await (await tool({ ...text('mirror'), structuredContent: { rows: [1] } }, mode)).execute({})).toBe('mirror');
    expect(await (await tool({ toolResult: { rows: [] }, content: [] }, mode)).execute({})).toBe('{"rows":[]}');
    expect(await (await tool({ content: [{ type: 'text', text: 'one' }, { type: 'image' }, { type: 'text', text: 'two' }] }, mode)).execute({})).toBe('one\n[image]\ntwo');
  });

  it('parses one JSON object text block only when fallback was explicitly enabled', async () => {
    const result = text(' \n {"rows":[],"unknown":null,"zero":0,"enabled":false} \n');
    expect(await (await tool(result, 'structured-or-json')).execute({})).toEqual({ rows: [], unknown: null, zero: 0, enabled: false });
    await expect((await tool(result, 'structured')).execute({})).rejects.toThrow(/structuredContent/);
    expect(await (await tool(result)).execute({})).toBe(result.content[0]!.text);
  });

  it('prefers present structured content over the explicit JSON fallback', async () => {
    expect(await (await tool({ ...text('{"rows":[1]}'), structuredContent: { rows: [] } }, 'structured-or-json')).execute({})).toEqual({ rows: [] });
  });

  it.each([null, [], 0, 'secret-payload', { invalid: undefined }, { invalid: Number.NaN }])('refuses malformed structured content without leaking or falling back (%j)', async structuredContent => {
    const t = await tool({ ...text('{"fallback":"secret-payload"}'), structuredContent }, 'structured-or-json');
    const error = await t.execute({}).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/structuredContent/);
    expect((error as Error).message).not.toContain('secret-payload');
  });

  it('refuses missing structured data and cyclic/non-JSON values', async () => {
    await expect((await tool(text('No structured content'), 'structured')).execute({})).rejects.toThrow(/structuredContent/);
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const data of [cyclic, { value: 1n }, { value: new Date() }, { value: () => 1 }]) {
      await expect((await tool({ content: [], structuredContent: data }, 'structured')).execute({})).rejects.toThrow(/structuredContent/);
    }
  });

  it('does not execute accessor fields at the structured-result boundary', async () => {
    for (const key of ['structuredContent', 'content', 'isError']) {
      const get = vi.fn(() => { throw new Error('SENSITIVE_GETTER'); });
      const result = Object.defineProperty({}, key, { enumerable: true, get });
      await expect((await tool(result, 'structured-or-json')).execute({})).rejects.toThrow(/structuredContent/);
      expect(get).not.toHaveBeenCalled();
    }
  });

  it('enforces documented decoding bounds without truncating a accepted object', async () => {
    let data: Record<string, unknown> = { value: 0 };
    for (let index = 0; index < 63; index++) data = { next: data };
    expect(await (await tool({ content: [], structuredContent: data }, 'structured')).execute({})).toEqual(data);
    await expect((await tool({ content: [], structuredContent: { next: data } }, 'structured')).execute({})).rejects.toThrow(/over-limit/);
    await expect((await tool({ content: [], structuredContent: { values: new Array(1_000_000).fill(null) } }, 'structured')).execute({})).rejects.toThrow(/over-limit/);
    await expect((await tool(text(' '.repeat(16_000_000) + '{}'), 'structured-or-json')).execute({})).rejects.toThrow(/over-limit/);
  });

  it('allows repeated JSON subobjects but refuses sparse arrays and extra non-JSON properties', async () => {
    const child = { value: 0 }, record = { first: child, second: child };
    expect(await (await tool({ content: [], structuredContent: record }, 'structured')).execute({})).toEqual(record);
    const sparse = new Array(2); sparse[1] = 0;
    const extra = Object.assign([0], { note: 'not a JSON array element' });
    for (const data of [{ values: sparse }, { values: extra }, { [Symbol('unsupported')]: 0 }]) {
      await expect((await tool({ content: [], structuredContent: data }, 'structured')).execute({})).rejects.toThrow(/structuredContent/);
    }
  });

  it.each([
    text('The answer is {"rows":[]}'), text('```json\n{"rows":[]}\n```'), text('[1,2]'), text('null'), text('1e999'),
    { content: [{ type: 'text', text: '{"rows":' }, { type: 'text', text: '[]}' }] },
    { content: [{ type: 'text', text: '{"rows":[]}' }, { type: 'image' }] },
    { toolResult: { rows: [] } }, { content: [] },
  ])('never treats prose, scalar/array, mixed blocks or legacy output as declared structured data (%j)', async result => {
    await expect((await tool(result, 'structured-or-json')).execute({})).rejects.toThrow(/structured|JSON/);
  });

  it.each(['structured', 'structured-or-json'] as const)('honors isError before any structured decoding (%s)', async mode => {
    for (const result of [{ ...text('backend unavailable'), structuredContent: { rows: [] }, isError: true },
      { toolResult: { rows: [] }, structuredContent: { rows: [] }, isError: true }]) {
      await expect((await tool(result, mode)).execute({})).rejects.toThrow(/returned an error/);
    }
  });

  it.each(['structured', 'structured-or-json'] as const)('preserves tool-authored correction text without reading structured error data (%s)', async mode => {
    const readStructured = vi.fn(() => { throw new Error('PRIVATE_STRUCTURED_ERROR_ROWS'); });
    const result = { isError: true, content: [
      { type: 'text', text: 'HTTP 422: node must be complete' },
      { type: 'text', text: 'Use the full node identifier.' },
    ] };
    Object.defineProperty(result, 'structuredContent', { enumerable: true, get: readStructured });
    const error = await (await tool(result, mode)).execute({}).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('HTTP 422: node must be complete\nUse the full node identifier.');
    expect((error as Error).message).not.toContain('PRIVATE_STRUCTURED_ERROR_ROWS');
    expect(readStructured).not.toHaveBeenCalled();
  });

  it.each(['structured', 'structured-or-json'] as const)('bounds complete error diagnostics without truncating them into advice (%s)', async mode => {
    const atLimit = 'x'.repeat(8_192);
    await expect((await tool({ ...text(atLimit), isError: true }, mode)).execute({})).rejects.toThrow(atLimit);
    for (const content of [text(atLimit + 'x').content,
      [{ type: 'text', text: atLimit }, { type: 'text', text: 'extra' }],
      Array.from({ length: 33 }, () => ({ type: 'text', text: 'tool advice' })),
      [], [{ type: 'text', text: '' }], [{ type: 'image', text: 'not declared text' }],
      [{ type: 'text', text: { toJSON: () => 'PRIVATE_DIAGNOSTIC' } }]]) {
      const error = await (await tool({ content, isError: true, structuredContent: { secret: 'PRIVATE_STRUCTURED_ERROR_ROWS' } }, mode))
        .execute({}).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('returned an error; its structured result was not read.');
      expect((error as Error).message).not.toContain('PRIVATE_');
      expect((error as Error).message.length).toBeLessThan(200);
    }
  });

  it.each(['structured', 'structured-or-json'] as const)('reads only own data properties for error diagnostics (%s)', async mode => {
    const unsafe = vi.fn(() => { throw new Error('PRIVATE_DIAGNOSTIC'); });
    const contentAccessor = { isError: true };
    Object.defineProperty(contentAccessor, 'content', { get: unsafe });
    const indexAccessor = [{ type: 'text', text: 'unused' }];
    Object.defineProperty(indexAccessor, '0', { get: unsafe });
    const typeAccessor = { text: 'unused' };
    Object.defineProperty(typeAccessor, 'type', { get: unsafe });
    const textAccessor = { type: 'text' };
    Object.defineProperty(textAccessor, 'text', { get: unsafe });
    const textObject = { type: 'text', text: { toJSON: unsafe, toString: unsafe } };
    const inherited = Object.create({ type: 'text', text: 'PRIVATE_DIAGNOSTIC' });
    for (const result of [contentAccessor, ...[indexAccessor, [typeAccessor], [textAccessor], [textObject], [inherited], new Array(1)]
      .map(content => ({ isError: true, content }))]) {
      const error = await (await tool(result, mode)).execute({}).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('returned an error; its structured result was not read.');
      expect((error as Error).message).not.toContain('PRIVATE_DIAGNOSTIC');
    }
    expect(unsafe).not.toHaveBeenCalled();
  });

  it('refuses an unknown mode before calling a connection', async () => {
    const c = connection(text('unused'));
    await expect(mcpClient({ connection: c, resultMode: 'guess' as Mode })).rejects.toThrow(/resultMode/);
    expect(c.callTool).not.toHaveBeenCalled();
  });

  it('keeps the curated mock usable for structured and explicitly JSON-text producers', async () => {
    const structured = mockMcpClient({ resultMode: 'structured', tools: [{ ...declaration,
      handler: async () => ({ content: [], structuredContent: { rows: [] } }) }] });
    expect(await (await structured.tools())[0]!.execute({})).toEqual({ rows: [] });
    const json = mockMcpClient({ resultMode: 'structured-or-json', tools: [{ ...declaration, handler: async () => '{"rows":[]}' }] });
    expect(await (await json.tools())[0]!.execute({})).toEqual({ rows: [] });
  });
});
