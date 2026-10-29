/**
 * DOCUMENTED LIMIT of "a listing never makes a callable tool lose its checks"
 * (`listingKeepsChecks.test.ts`; Codex review of #248 at 3c4c2a14, P2).
 *
 * The library counts the `tools/list` requests IT sends — those of `tools()`
 * and `refresh()`, on every `mcpClient` over the same client
 * (`listingGenerations.ts`). A listing it does not send replaces the SDK
 * `Client`'s per-tool checks without the library knowing, so a one-page tool
 * it handed out still believes the SDK holds them:
 *
 *   - the SDK's own automatic discovery (`listChanged.tools`, whose
 *     `autoRefresh` is on by default), answering the server's notice;
 *   - your own code calling `listTools` on a client passed as `connection`.
 *
 * Then neither the output checks nor the required-task refusal run, even with
 * a `jsonSchemaValidator`: the library leaves the call to the SDK. These tests
 * PIN that limit, as it stands — they are not a guarantee — and show the safe
 * setup that keeps it: the SDK's automatic refresh off, the server's notice
 * routed through `refresh()`. Driven through a real SDK `Server` and `Client`
 * over the SDK's in-memory transport, so the server's `list_changed` notice and
 * the SDK's own refresh are the real ones.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { describe, expect, it } from 'vitest';

import type { Tool, ToolExecutionContext } from '../../src/index.js';
import { mcpClient } from '../../src/tool-providers/index.js';
import type { McpClient } from '../../src/mcp/types.js';

const OBJECT = { type: 'object' } as const;
const COUNT_SCHEMA = {
  type: 'object',
  properties: { count: { type: 'integer' } },
  required: ['count'],
};
const first = { name: 'first', inputSchema: OBJECT, outputSchema: COUNT_SCHEMA };
const needsTask = {
  name: 'needsTask',
  inputSchema: OBJECT,
  execution: { taskSupport: 'required' },
};
const plain = { name: 'plain', inputSchema: OBJECT };

const ANSWERS = {
  malformed: { content: [{ type: 'text', text: 'x' }], structuredContent: { count: 'wrong' } },
  missing: { content: [{ type: 'text', text: 'no structure' }] },
  valid: { content: [{ type: 'text', text: 'counted' }], structuredContent: { count: 3 } },
} as const;
type Answer = keyof typeof ANSWERS;

const CTX = { toolCallId: 'tc-limit', iteration: 1 } as unknown as ToolExecutionContext;

/** How the caller's own client learns that the server's tools changed. */
type Discovery =
  | 'the SDK refreshes itself' // listChanged.tools with autoRefresh (the SDK's default)
  | 'the app calls listTools' // the caller's own code lists on the client it passed
  | 'routed through refresh()'; // the safe setup: autoRefresh off, onChanged → refresh()

/**
 * A real SDK server whose tool list changes, a caller-built SDK client over the
 * in-memory transport — given a validator — and `mcpClient` over that client.
 * Lists the one page, then changes the server's list and lets `discovery` learn
 * of it. Returns the tools `mcpClient` handed out before the change.
 */
async function retainedAcrossUnseenListing(discovery: Discovery): Promise<{
  held: readonly Tool[];
  answerWith: (answer: Answer) => void;
  calls: string[];
  close: () => Promise<void>;
}> {
  let catalogue: object[] = [first, needsTask];
  let answer: Answer = 'valid';
  const calls: string[] = [];
  const server = new Server(
    { name: 'limit', version: '1.0.0' },
    { capabilities: { tools: { listChanged: true } } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: catalogue } as never));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    calls.push(request.params.name);
    return ANSWERS[answer] as never;
  });

  // Built after the client connects; the notice handler reaches it through here.
  const owner: { catalog?: McpClient } = {};
  let noticed!: () => void;
  const notice = new Promise<void>((resolve) => (noticed = resolve));
  const jsonSchemaValidator = new AjvJsonSchemaValidator();
  const routed = discovery === 'routed through refresh()';
  const connection = new Client(
    { name: 'own', version: '1.0.0' },
    {
      capabilities: {},
      jsonSchemaValidator,
      listChanged: {
        tools: {
          // The safe setup turns the SDK's own refresh off and routes the notice
          // through `refresh()`; otherwise the SDK lists by itself (its default).
          autoRefresh: !routed,
          debounceMs: 0,
          onChanged: () => {
            if (routed) void owner.catalog?.refresh().then(() => noticed());
            else noticed();
          },
        },
      },
    },
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await connection.connect(clientSide);
  const catalog = await mcpClient({ name: 'limit', connection, jsonSchemaValidator });
  owner.catalog = catalog;
  const held = await catalog.tools();

  // The server's tools change.
  catalogue = [plain];
  if (discovery === 'the app calls listTools') {
    await connection.listTools();
  } else {
    await server.sendToolListChanged();
    await notice;
  }
  return {
    held,
    answerWith: (next) => (answer = next),
    calls,
    close: async () => {
      await connection.close();
      await server.close();
    },
  };
}

function named(tools: readonly Tool[], name: string): Tool {
  const tool = tools.find((t) => t.schema.name === name);
  if (tool === undefined) throw new Error(`no tool '${name}' listed`);
  return tool;
}

async function settle(tool: Tool): Promise<{ value?: unknown; error?: unknown }> {
  return tool.execute({}, CTX).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
}

describe('documented limit — a listing the library does not send is not counted', () => {
  it.each(['the SDK refreshes itself', 'the app calls listTools'] as const)(
    'LIMIT (%s): a retained one-page tool is left unchecked, even with jsonSchemaValidator',
    async (discovery) => {
      const { held, answerWith, calls, close } = await retainedAcrossUnseenListing(discovery);
      // The SDK's checks now belong to the new list, and the library did not see
      // it: malformed and missing output come back unchecked…
      answerWith('malformed');
      expect(await settle(named(held, 'first'))).toEqual({ value: 'x' });
      answerWith('missing');
      expect(await settle(named(held, 'first'))).toEqual({ value: 'no structure' });
      // …and a tool that requires a task is sent as a plain call.
      answerWith('valid');
      expect(await settle(named(held, 'needsTask'))).toEqual({ value: 'counted' });
      expect(calls).toEqual(['first', 'first', 'needsTask']);
      await close();
    },
  );

  it('the safe setup — autoRefresh off, the notice routed through refresh(): the retained tools keep their checks', async () => {
    const { held, answerWith, calls, close } = await retainedAcrossUnseenListing(
      'routed through refresh()',
    );
    answerWith('malformed');
    const malformed = await settle(named(held, 'first'));
    expect(malformed.value).toBeUndefined();
    expect(malformed.error).toMatchObject({ name: 'McpError', code: -32602 });
    answerWith('missing');
    expect((await settle(named(held, 'first'))).error).toMatchObject({ code: -32600 });
    const task = await settle(named(held, 'needsTask'));
    expect(task.error).toMatchObject({ name: 'McpError', code: -32600 });
    // The required task was refused before anything was sent.
    expect(calls).toEqual(['first', 'first']);
    await close();
  });
});
