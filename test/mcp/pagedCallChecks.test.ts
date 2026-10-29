/**
 * A paged catalogue's tools fail exactly as the same tools would in a one-page
 * catalogue (Codex review of #248, P2).
 *
 * The MCP SDK's `Client` keeps three per-tool checks for the tools of its most
 * recent `tools/list` answer only, replacing them on every page:
 *
 *   1. `structuredContent` is validated against the tool's `outputSchema`;
 *   2. a tool with an `outputSchema` must return `structuredContent`, unless the
 *      result is an error;
 *   3. a tool with `execution.taskSupport: 'required'` is refused before a
 *      plain `tools/call` is sent.
 *
 * Reading every page therefore dropped all three for every tool outside the
 * last page. Every tool now carries its own (`callChecks.ts`), and a paged
 * list's tools — the last page's too — always run them: no one answer holds
 * them all. These tests pin that, arm by arm, through the REAL SDK client
 * against an MCP endpoint in this process (the transport's `fetch`):
 *
 *   - the SAME error, at the same moment, whatever page the tool was on: the
 *     SDK's own class where the arm can reach it, otherwise the same name, code
 *     and message;
 *   - with no validator on an arm that cannot load the SDK's own, a call to a
 *     paged list's tool with an `outputSchema` is refused before sending
 *     (`McpOutputUncheckedError`), never answered unchecked;
 *   - a one-page catalogue needs nothing new on any arm.
 *
 * What a later listing does to tools already handed out is pinned in
 * `listingKeepsChecks.test.ts`.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { describe, expect, it } from 'vitest';

import type { ToolExecutionContext } from '../../src/index.js';
import {
  McpOutputUncheckedError,
  mcpClient,
  type McpJsonSchemaValidator,
} from '../../src/tool-providers/index.js';
import type { McpClient } from '../../src/mcp/types.js';

const URL_ = 'http://mcp.example.test/mcp';

// ─── The catalogue, paged and not ────────────────────────────────

const COUNT_SCHEMA = {
  type: 'object',
  properties: { count: { type: 'integer' } },
  required: ['count'],
};

const OBJECT = { type: 'object' } as const;
const first = { name: 'first', inputSchema: OBJECT, outputSchema: COUNT_SCHEMA };
const plain = { name: 'plain', inputSchema: OBJECT };
const needsTask = {
  name: 'needsTask',
  inputSchema: OBJECT,
  execution: { taskSupport: 'required' },
};
const taskAndSchema = {
  name: 'taskAndSchema',
  inputSchema: OBJECT,
  outputSchema: COUNT_SCHEMA,
  execution: { taskSupport: 'required' },
};
const last = { name: 'last', inputSchema: OBJECT, outputSchema: { ...COUNT_SCHEMA } };

/** The same five tools: on two pages, and on one. */
const PAGED = [[first, plain, needsTask, taskAndSchema], [last]] as const;
const ONE_PAGE = [[first, plain, needsTask, taskAndSchema, last]] as const;

const ANSWERS = {
  malformed: { content: [{ type: 'text', text: 'x' }], structuredContent: { count: 'wrong' } },
  missing: { content: [{ type: 'text', text: 'no structure' }] },
  valid: { content: [{ type: 'text', text: 'counted' }], structuredContent: { count: 3 } },
  toolError: { content: [{ type: 'text', text: 'the tool failed' }], isError: true },
} as const;
type Answer = keyof typeof ANSWERS;

/** An MCP endpoint in this process: the handshake, a paged list, one scripted answer. */
function endpoint(pages: readonly (readonly object[])[], answer: Answer) {
  const calls: string[] = [];
  const fetch = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? 'GET').toUpperCase() !== 'POST')
      return new Response(null, { status: 405 });
    const message = JSON.parse(String(init?.body)) as {
      method?: string;
      id?: unknown;
      params?: { cursor?: string; name?: string };
    };
    const reply = (result: unknown): Response =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    switch (message.method) {
      case 'initialize':
        return reply({
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'paged', version: '1.0.0' },
        });
      case 'tools/list': {
        const index = message.params?.cursor === undefined ? 0 : Number(message.params.cursor);
        const more = index + 1 < pages.length;
        return reply({ tools: pages[index], ...(more && { nextCursor: String(index + 1) }) });
      }
      case 'tools/call':
        calls.push(String(message.params?.name));
        return reply(ANSWERS[answer]);
      default:
        return new Response(null, { status: 202 });
    }
  };
  return { fetch, calls };
}

// ─── The three arms ───────────────────────────────────────────────

type Arm = 'default' | 'sdk' | 'connection';

/** A client on `arm`, over `pages`, every call answered with `answer`. */
async function clientOn(
  arm: Arm,
  pages: readonly (readonly object[])[],
  answer: Answer,
  validator?: McpJsonSchemaValidator,
  resultMode: 'text' | 'structured' = 'text',
): Promise<{ client: McpClient; calls: string[] }> {
  const server = endpoint(pages, answer);
  const transport = { transport: 'http' as const, url: URL_, fetch: server.fetch };
  const given = validator === undefined ? {} : { jsonSchemaValidator: validator };
  if (arm === 'default') {
    return {
      client: await mcpClient({ name: 'paged', resultMode, transport, ...given }),
      calls: server.calls,
    };
  }
  if (arm === 'sdk') {
    const sdk = { Client, StreamableHTTPClientTransport };
    return {
      client: await mcpClient({ name: 'paged', resultMode, transport, sdk, ...given }),
      calls: server.calls,
    };
  }
  // The caller's own client, given the same validator they hand mcpClient.
  const connection = new Client({ name: 'own', version: '1.0.0' }, { capabilities: {}, ...given });
  await connection.connect(
    new StreamableHTTPClientTransport(new URL(URL_), { fetch: server.fetch }),
  );
  return {
    client: await mcpClient({ name: 'paged', resultMode, connection, ...given }),
    calls: server.calls,
  };
}

const CTX = { toolCallId: 'tc-paged', iteration: 1 } as unknown as ToolExecutionContext;

/** Call `name` on a fresh client; what it returned or threw, and what reached the endpoint. */
async function callOn(
  arm: Arm,
  pages: readonly (readonly object[])[],
  name: string,
  answer: Answer,
  validator?: McpJsonSchemaValidator,
  resultMode: 'text' | 'structured' = 'text',
): Promise<{ value?: unknown; error?: unknown; calls: readonly string[] }> {
  const { client, calls } = await clientOn(arm, pages, answer, validator, resultMode);
  try {
    const tool = (await client.tools()).find((t) => t.schema.name === name)!;
    return await tool.execute({}, CTX).then(
      (value) => ({ value, calls }),
      (error: unknown) => ({ error, calls }),
    );
  } finally {
    await client.close();
  }
}

/** What a caller can branch on: the class's name, the code, the message. */
function handled(error: unknown): { name: string; code: unknown; message: string } {
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  return { name: String(e.name), code: e.code, message: String(e.message) };
}

// ─── One page: the SDK checks every tool, as it always did ────────

describe('one page — the SDK checks every tool, on every arm, with nothing new', () => {
  it.each(['default', 'sdk', 'connection'] as const)('%s arm', async (arm) => {
    const malformed = await callOn(arm, ONE_PAGE, 'first', 'malformed');
    expect(handled(malformed.error)).toMatchObject({ name: 'McpError', code: -32602 });
    const missing = await callOn(arm, ONE_PAGE, 'first', 'missing');
    expect(handled(missing.error)).toMatchObject({ name: 'McpError', code: -32600 });
    const task = await callOn(arm, ONE_PAGE, 'needsTask', 'valid');
    expect(handled(task.error)).toMatchObject({ name: 'McpError', code: -32600 });
    expect(task.calls).toEqual([]);
    expect((await callOn(arm, ONE_PAGE, 'first', 'valid')).value).toBe('counted');
  });

  it('the caller-supplied arms need no validator for one page: nothing is refused', async () => {
    for (const arm of ['sdk', 'connection'] as const) {
      expect((await callOn(arm, ONE_PAGE, 'first', 'valid')).value).toBe('counted');
      expect((await callOn(arm, ONE_PAGE, 'taskAndSchema', 'valid')).calls).toEqual([]);
    }
  });
});

// ─── Paged, with a validator: the same error as on one page ───────

/** Each arm with a validator: the default arm's is the SDK's own; the others are given one. */
const WITH_VALIDATOR = [
  ['default (the SDK default validator)', 'default', undefined],
  ['default (a given validator)', 'default', new AjvJsonSchemaValidator()],
  ['sdk (a given validator)', 'sdk', new AjvJsonSchemaValidator()],
  ['connection (a given validator)', 'connection', new AjvJsonSchemaValidator()],
] as const;

describe('paged — an earlier-page tool fails exactly as it would on one page', () => {
  it.each(WITH_VALIDATOR)('malformed structuredContent — %s', async (_, arm, validator) => {
    const paged = await callOn(arm, PAGED, 'first', 'malformed', validator);
    const flat = await callOn(arm, ONE_PAGE, 'first', 'malformed', validator);
    expect(paged.error).toBeDefined();
    expect(handled(paged.error)).toEqual(handled(flat.error));
    expect(handled(paged.error).message).toContain('data/count must be integer');
  });

  it.each(WITH_VALIDATOR)('missing structuredContent — %s', async (_, arm, validator) => {
    const paged = await callOn(arm, PAGED, 'first', 'missing', validator);
    const flat = await callOn(arm, ONE_PAGE, 'first', 'missing', validator);
    expect(paged.error).toBeDefined();
    expect(handled(paged.error)).toEqual(handled(flat.error));
  });

  it.each(WITH_VALIDATOR)(
    'a tool error needs no structuredContent, as on one page — %s',
    async (_, arm, validator) => {
      const paged = await callOn(arm, PAGED, 'first', 'toolError', validator);
      const flat = await callOn(arm, ONE_PAGE, 'first', 'toolError', validator);
      expect(handled(paged.error)).toEqual(handled(flat.error));
      expect(handled(paged.error).message).toContain('the tool failed');
    },
  );

  it.each(WITH_VALIDATOR)(
    'valid output, first page and last page — %s',
    async (_, arm, validator) => {
      expect((await callOn(arm, PAGED, 'first', 'valid', validator)).value).toBe('counted');
      expect((await callOn(arm, PAGED, 'last', 'valid', validator)).value).toBe('counted');
      expect((await callOn(arm, PAGED, 'plain', 'missing', validator)).value).toBe('no structure');
    },
  );

  it.each(WITH_VALIDATOR)('the last page fails as every page does — %s', async (_, arm, v) => {
    const paged = await callOn(arm, PAGED, 'last', 'malformed', v);
    const flat = await callOn(arm, ONE_PAGE, 'last', 'malformed', v);
    expect(handled(paged.error)).toMatchObject({ name: 'McpError', code: -32602 });
    expect(handled(paged.error)).toEqual(handled(flat.error));
  });

  it.each(WITH_VALIDATOR)('a required task is refused before sending — %s', async (_, arm, v) => {
    for (const name of ['needsTask', 'taskAndSchema']) {
      const paged = await callOn(arm, PAGED, name, 'valid', v);
      const flat = await callOn(arm, ONE_PAGE, name, 'valid', v);
      expect(paged.calls).toEqual([]);
      expect(handled(paged.error)).toEqual(handled(flat.error));
      expect(handled(paged.error).message).toContain('requires task-based execution');
    }
  });

  it('structured mode (the reported case): a malformed first-page result is never returned', async () => {
    for (const arm of ['default', 'connection'] as const) {
      const v = arm === 'default' ? undefined : new AjvJsonSchemaValidator();
      const paged = await callOn(arm, PAGED, 'first', 'malformed', v, 'structured');
      expect(paged.value).toBeUndefined();
      expect(handled(paged.error)).toMatchObject({ name: 'McpError', code: -32602 });
    }
  });

  it("on the default arm the error is the SDK's own class, as on one page", async () => {
    for (const [name, answer] of [
      ['first', 'malformed'],
      ['first', 'missing'],
      ['needsTask', 'valid'],
    ] as const) {
      const paged = await callOn('default', PAGED, name, answer);
      const flat = await callOn('default', ONE_PAGE, name, answer);
      expect((paged.error as object).constructor).toBe((flat.error as object).constructor);
      expect((paged.error as object).constructor.name).toBe('McpError');
    }
  });
});

// ─── Paged, no validator reachable: refused before sending ────────

describe('paged — no validator on an arm that cannot load one', () => {
  it.each(['sdk', 'connection'] as const)(
    '%s arm: a tool with an outputSchema is refused before sending, on every page',
    async (arm) => {
      for (const name of ['first', 'last']) {
        const refused = await callOn(arm, PAGED, name, 'valid');
        expect(refused.error).toBeInstanceOf(McpOutputUncheckedError);
        expect(refused.error).toMatchObject({
          name: 'McpOutputUncheckedError',
          code: 'ERR_MCP_OUTPUT_UNCHECKED',
          reason: 'output-unchecked',
          sent: false,
          server: 'paged',
          tool: name,
        });
        expect((refused.error as Error).message).toContain('was not sent');
        expect((refused.error as Error).message).toContain('jsonSchemaValidator');
        expect(refused.calls).toEqual([]);
      }
    },
  );

  it.each(['sdk', 'connection'] as const)(
    '%s arm: a tool that needs no check works as on one page',
    async (arm) => {
      expect((await callOn(arm, PAGED, 'plain', 'missing')).value).toBe('no structure');
      expect((await callOn(arm, PAGED, 'plain', 'valid')).value).toBe('counted');
    },
  );

  it.each(['sdk', 'connection'] as const)(
    '%s arm: a required task is the task refusal, never "output unchecked"',
    async (arm) => {
      for (const name of ['needsTask', 'taskAndSchema']) {
        const paged = await callOn(arm, PAGED, name, 'valid');
        const flat = await callOn(arm, ONE_PAGE, name, 'valid');
        expect(paged.calls).toEqual([]);
        expect(paged.error).not.toBeInstanceOf(McpOutputUncheckedError);
        expect(handled(paged.error)).toEqual(handled(flat.error));
      }
    },
  );
});

// ─── One validator for the whole client ───────────────────────────

/** An SDK validator that records every schema it is asked to compile. */
function recordingValidator(): McpJsonSchemaValidator & { readonly compiled: string[] } {
  const inner = new AjvJsonSchemaValidator();
  const compiled: string[] = [];
  return {
    compiled,
    getValidator(schema: object) {
      compiled.push(JSON.stringify(schema));
      return inner.getValidator(schema as never);
    },
  };
}

describe('jsonSchemaValidator — one validator serves every page', () => {
  it.each(['default', 'sdk'] as const)(
    '%s arm: the client the library builds is handed it too',
    async (arm) => {
      const validator = recordingValidator();
      const { client } = await clientOn(arm, PAGED, 'valid', validator);
      const count = (): number =>
        validator.compiled.filter((s) => s === JSON.stringify(COUNT_SCHEMA)).length;
      try {
        const tools = await client.tools();
        // The SDK client compiled all three output schemas with it as it listed
        // both pages; the library compiles nothing until a tool's own checks run.
        expect(count()).toBe(3);
        const first = tools.find((t) => t.schema.name === 'first')!;
        await first.execute({}, CTX);
        // `first`'s own checks compiled its schema with the same validator, once.
        expect(count()).toBe(4);
        await first.execute({}, CTX);
        expect(count()).toBe(4);
      } finally {
        await client.close();
      }
    },
  );

  it('a malformed validator is refused when the client is built, by name', async () => {
    for (const bad of [{}, { getValidator: 'no' }, null]) {
      await expect(
        mcpClient({
          name: 'paged',
          connection: {
            listTools: async () => ({ tools: [] }),
            callTool: async () => ({ content: [] }),
            close: async () => {},
          },
          jsonSchemaValidator: bad as unknown as McpJsonSchemaValidator,
        }),
      ).rejects.toThrow(/`jsonSchemaValidator`/);
    }
  });
});
