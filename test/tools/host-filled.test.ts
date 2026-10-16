/**
 * hostFilled — tool arguments the host fills from the call's credential or
 * the caller's identity.
 *
 * Threat model: the model, tool input and message text are untrusted. The
 * field must be absent from every schema the model sees, a model-sent value
 * must be refused by name before the tool runs, and the filled credential must
 * not come back through the tool's result or a thrown error.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  defineTool,
  fromCredential,
  fromIdentity,
  hostFilled,
  HostFilledArgumentError,
  HOST_FILLED_PLACEHOLDER,
  type Tool,
} from '../../src/index.js';
import { mock, mockMcpClient } from '../../src/doors/providers.js';
import { requestContext, requestCredentials, staticTokens } from '../../src/doors/security.js';
import type { LLMRequest } from '../../src/provider-contract/types.js';

const TOKEN = 'mcp-tok-91d2e7c4a0f8';

/** An MCP server whose tools take a `token` argument the model must never see. */
function crmServer(calls: Record<string, unknown>[], echo = false) {
  return mockMcpClient({
    name: 'crm-mcp',
    tools: [
      {
        name: 'find_account',
        description: 'Find an account',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' }, token: { type: 'string' } },
          required: ['name', 'token'],
        },
        handler: async (args: Record<string, unknown>) => {
          calls.push(args);
          return echo ? `found ${String(args.name)} with ${String(args.token)}` : 'found';
        },
      },
      {
        name: 'list_regions',
        description: 'List regions',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => 'eu, us',
      },
    ],
  });
}

interface Outcome {
  readonly answer: string;
  readonly requests: LLMRequest[];
  readonly toolResults: string[];
}

/** Run an agent whose model makes ONE call with `args`, then answers. */
async function runOnce(
  tools: readonly Tool[],
  args: Record<string, unknown>,
  options: {
    credentials?: Parameters<typeof Agent.create>[0]['credentials'];
    request?: unknown;
    identity?: unknown;
  } = {},
): Promise<Outcome> {
  const requests: LLMRequest[] = [];
  const agent = Agent.create({
    provider: mock({
      respond: (req) => {
        requests.push(req);
        const done = req.messages.some((m) => m.role === 'tool');
        return done
          ? { content: 'done' }
          : { toolCalls: [{ id: 'c1', name: 'find_account', args }] };
      },
    }),
    model: 'mock',
    maxIterations: 3,
    ...(options.credentials && { credentials: options.credentials }),
  })
    .tools([...tools])
    .build();
  const answer = await agent.run(
    {
      message: 'find acme',
      ...(options.identity !== undefined && { identity: options.identity as never }),
    },
    options.request !== undefined ? { request: options.request as never } : undefined,
  );
  const last = requests[requests.length - 1];
  const toolResults = (last?.messages ?? [])
    .filter((m) => m.role === 'tool')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
  return { answer: String(answer), requests, toolResults };
}

describe('hostFilled — the model never sees the field', () => {
  it('removes it from properties and required in every request the model receives', async () => {
    const calls: Record<string, unknown>[] = [];
    const tools = hostFilled(await crmServer(calls).tools(), {
      token: fromCredential({ service: 'crm' }),
    });
    const out = await runOnce(
      tools,
      { name: 'acme' },
      {
        credentials: staticTokens({ crm: TOKEN }),
      },
    );
    for (const req of out.requests) {
      const find = req.tools?.find((t) => t.name === 'find_account');
      expect(find).toBeDefined();
      expect(Object.keys((find!.inputSchema as { properties: object }).properties)).toEqual([
        'name',
      ]);
      expect((find!.inputSchema as { required?: string[] }).required).toEqual(['name']);
      expect(JSON.stringify(req)).not.toContain('"token"');
    }
    // …and the host filled it.
    expect(calls).toEqual([{ name: 'acme', token: TOKEN }]);
  });

  it('a tool in the list without the field is returned unchanged', async () => {
    const raw = await crmServer([]).tools();
    const wrapped = hostFilled(raw, { token: fromCredential({ service: 'crm' }) });
    expect(wrapped[1]).toBe(raw[1]);
    expect(wrapped[0]!.needs).toEqual({ credential: 'crm' });
  });
});

describe('hostFilled — a model-sent value is refused by name', () => {
  it.each([
    ['a guessed value', { name: 'acme', token: 'guess' }],
    ['the real value, if it ever leaked', { name: 'acme', token: TOKEN }],
    ['an empty value', { name: 'acme', token: '' }],
  ])('%s: the tool does not run and the result names the argument', async (_, args) => {
    const calls: Record<string, unknown>[] = [];
    const tools = hostFilled(await crmServer(calls).tools(), {
      token: fromCredential({ service: 'crm' }),
    });
    const out = await runOnce(tools, args, { credentials: staticTokens({ crm: TOKEN }) });
    expect(calls).toEqual([]);
    expect(out.toolResults.join('\n')).toContain("'token' is filled by the host");
  });

  it('the refusal is a typed error naming the tool and the argument', async () => {
    const tool = hostFilled((await crmServer([]).tools())[0]!, {
      token: fromCredential({ service: 'crm' }),
    });
    await expect(tool.execute({ name: 'a', token: 'x' }, {} as never)).rejects.toBeInstanceOf(
      HostFilledArgumentError,
    );
  });
});

describe('hostFilled — values come from the run, failing closed', () => {
  it('fills from the request credential and from the caller’s identity', async () => {
    const seen: Record<string, unknown>[] = [];
    const tool = hostFilled(
      defineTool({
        name: 'find_account',
        description: 'find',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            token: { type: 'string' },
            tenant: { type: 'string' },
          },
        },
        execute: async (args) => {
          seen.push(args as Record<string, unknown>);
          return 'ok';
        },
      }),
      { token: fromCredential({ service: 'crm' }), tenant: fromIdentity('tenant') },
    );
    await runOnce(
      [tool],
      { name: 'acme' },
      {
        credentials: requestCredentials({ services: { crm: 'crmToken' } }),
        request: requestContext({ secrets: { crmToken: TOKEN } }),
        identity: { tenant: 'acme-co', principal: 'p1', conversationId: 'c1' },
      },
    );
    expect(seen).toEqual([{ name: 'acme', token: TOKEN, tenant: 'acme-co' }]);
  });

  it('no request on the run → the call is refused by name and the tool does not run', async () => {
    const calls: Record<string, unknown>[] = [];
    const tools = hostFilled(await crmServer(calls).tools(), {
      token: fromCredential({ service: 'crm' }),
    });
    const out = await runOnce(
      tools,
      { name: 'acme' },
      {
        credentials: requestCredentials({ services: { crm: 'crmToken' } }),
      },
    );
    expect(calls).toEqual([]);
    expect(out.toolResults.join('\n')).toMatch(/credential error for 'crm'.*carries none/);
  });

  it('no identity field → refused by name', async () => {
    const tool = hostFilled(
      defineTool({
        name: 'find_account',
        description: 'find',
        inputSchema: { type: 'object', properties: { tenant: { type: 'string' } } },
        execute: async () => 'ran',
      }),
      { tenant: fromIdentity('tenant') },
    );
    const out = await runOnce([tool], {});
    expect(out.toolResults.join('\n')).toContain(
      "argument 'tenant' is filled by the host, and this run's caller named no identity tenant",
    );
  });
});

describe('hostFilled — the credential does not come back', () => {
  it('an echoing server’s result is scrubbed', async () => {
    const tools = hostFilled(await crmServer([], true).tools(), {
      token: fromCredential({ service: 'crm' }),
    });
    const out = await runOnce(
      tools,
      { name: 'acme' },
      { credentials: staticTokens({ crm: TOKEN }) },
    );
    const text = out.toolResults.join('\n');
    expect(text).toContain(`found acme with ${HOST_FILLED_PLACEHOLDER}`);
    expect(JSON.stringify(out.requests)).not.toContain(TOKEN);
  });

  it('a thrown error that quotes the request is replaced; one that does not passes as-is', async () => {
    const plain = new Error('upstream 503');
    const tool = hostFilled(
      defineTool({
        name: 't',
        description: 't',
        inputSchema: {
          type: 'object',
          properties: { token: { type: 'string' }, mode: { type: 'string' } },
        },
        execute: async (args) => {
          const a = args as { token: string; mode?: string };
          if (a.mode === 'plain') throw plain;
          const err = new Error(`401 for Authorization: Bearer ${a.token}`, {
            cause: { request: { headers: { authorization: a.token } } },
          });
          throw err;
        },
      }),
      { token: fromCredential({ service: 'crm' }) },
    );
    const ctx = { credential: staticCredential() } as never;
    const thrown = await Promise.resolve(tool.execute({}, ctx)).catch((e: unknown) => e);
    expect((thrown as Error).message).toBe(
      `401 for Authorization: Bearer ${HOST_FILLED_PLACEHOLDER}`,
    );
    expect((thrown as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(thrown) + String((thrown as Error).stack)).not.toContain(TOKEN);
    await expect(Promise.resolve(tool.execute({ mode: 'plain' }, ctx))).rejects.toBe(plain);
  });
});

describe('hostFilled — refused at build', () => {
  const base = defineTool({
    name: 'b',
    description: 'b',
    inputSchema: {
      type: 'object',
      properties: { token: { type: 'string' }, ref: { type: 'string' } },
    },
    needs: { credential: 'github' },
    execute: async () => 'ok',
  });

  it.each([
    [
      'an argument the tool does not have',
      base,
      { nope: fromCredential() },
      /has no argument 'nope'/,
    ],
    [
      'a service that disagrees with the tool’s needs',
      base,
      { token: fromCredential({ service: 'crm' }) },
      /already needs credential 'github'/,
    ],
    [
      'an argument no tool in a list has',
      [base],
      { nope: fromIdentity('tenant') },
      /no tool in the list declares 'nope'/,
    ],
    ['a fill that is not one', base, { token: { from: 'header' } }, /fromCredential/],
    ['no fills', base, {}, /names no argument/],
  ])('%s', (_, tool, fills, message) => {
    expect(() => hostFilled(tool as never, fills as never)).toThrow(message);
  });

  it('a credential fill on a tool with no needs must name its service', () => {
    const bare = defineTool({
      name: 'bare',
      description: 'b',
      inputSchema: { type: 'object', properties: { token: { type: 'string' } } },
      execute: async () => 'ok',
    });
    expect(() => hostFilled(bare, { token: fromCredential() })).toThrow(/declares no `needs`/);
    expect(
      hostFilled(bare, { token: fromCredential({ service: 's', mode: 'user' }) }).needs,
    ).toEqual({
      credential: 's',
      mode: 'user',
    });
  });
});

function staticCredential() {
  return {
    kind: 'bearer',
    token: TOKEN,
    toHeaders: () => ({ authorization: `Bearer ${TOKEN}` }),
  };
}
