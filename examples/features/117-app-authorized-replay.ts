/**
 * 117 — App-authorized replay: YOU decide which MCP tool calls are sent again.
 *
 * A 429 says the request was rate-limited — not that the server ran nothing —
 * so permission to send a tool call again is the app's, declared per tool when
 * the client is built. Each attempt in the run's record then says three things
 * apart: why it failed, what is known of its effect, and what permitted the
 * next attempt.
 *
 * Nothing leaves the process: the MCP server is a stand-in `fetch` that answers
 * the FIRST call of each tool with HTTP 429. `search_tickets` is declared
 * repeatable on 429, so it is sent again and answers; `create_ticket` makes
 * changes and the call carries no idempotency key, so the side-effect guard
 * never sends it again: its 429 reaches the model as the server sent it — a
 * received refusal is an answer, though not proof that nothing ran, so the
 * record keeps its effect `unknown`.
 *
 * Run:  npm run example examples/features/117-app-authorized-replay.ts
 */
import assert from 'node:assert/strict';
import { Agent, type LLMProvider } from '../../src/index.js';
import { mcpClient, mock } from '../../src/doors/providers.js';
import { recordRun } from '../../src/doors/observe.js';
import type { Payloads } from '../../src/events.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/117-app-authorized-replay',
  title: 'App-authorized replay — you decide which MCP calls are sent again',
  group: 'features',
  description:
    'mcpClient({ replay }): a 429 is sent again only for a tool you declared; a tool that makes changes is never sent again without a key the server deduplicates by; every attempt records its effect and what permitted the next one.',
  defaultInput: 'The printer is down — check for a ticket, then open one.',
  providerSlots: ['default'],
  tags: ['features', 'mcp', 'retry', 'evidence'],
};

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const server = standInServer();

  // #region replay
  const tickets = await mcpClient({
    name: 'tickets',
    transport: { transport: 'http', url: 'https://tickets.example.test/mcp', fetch: server.fetch },
    retryOnThrottle: { baseDelayMs: 1, jitter: 'none' },
    replay: {
      // Only what you declare is sent again (the default from the next major).
      policy: 'app-authorized',
      tools: {
        search_tickets: { on: ['throttle'] },
        // Makes changes: never sent again unless the server is declared to
        // deduplicate (`deduplicates: { argument }`) and the call carries the key.
        create_ticket: { on: ['throttle'], changes: true },
      },
    },
  });
  // #endregion replay

  const agent = Agent.create({
    provider:
      provider ??
      mock({
        chunkDelayMs: 0,
        replies: [
          { toolCalls: [{ id: 'c1', name: 'search_tickets', args: { q: 'printer' } }] },
          { toolCalls: [{ id: 'c2', name: 'create_ticket', args: { title: 'Printer down' } }] },
          { content: 'No open ticket was found, and opening one was refused for now.' },
        ],
      }),
    model: 'mock',
    maxIterations: 4,
  })
    .system('You look tickets up and open them with the tools you have.')
    .tools([...(await tickets.tools())])
    .build();

  const recording = recordRun(agent);
  const answer = await agent.run({ message: input });
  const saved = JSON.parse(JSON.stringify(recording.toRecording())) as {
    events: { type: string; payload: Payloads.ToolsRequestAttemptsPayload }[];
  };
  recording.stop();
  await tickets.close();

  // #region record
  const requests = saved.events
    .filter((event) => event.type === 'agentfootprint.tools.request_attempts')
    .map((event) => event.payload);
  const search = requests.find((r) => r.toolName === 'search_tickets');
  const create = requests.find((r) => r.toolName === 'create_ticket');
  // search_tickets: refused once, then sent again — on YOUR declaration. A 429
  // does not prove nothing ran, so its effect stays unknown, and so does the
  // series': the answer that followed does not prove it happened only once.
  assert.deepEqual(search?.attempts[0]?.permission, { by: 'declaration', on: 'throttle' });
  assert.equal(search?.attempts[0]?.effect, 'unknown');
  assert.equal(search?.attempts[1]?.effect, 'applied');
  assert.equal(search?.end.effect, 'unknown');
  // create_ticket: the side-effect guard — no key, so it is never sent again.
  // The 429 was received — an answer, its effect unknown — so it is not "may have run".
  assert.equal(create?.attempts.length, 1);
  assert.equal(create?.attempts[0]?.reason, 'changes-without-key');
  assert.equal(create?.attempts[0]?.effect, 'unknown');
  assert.equal(create?.end.mayHaveRun, undefined);
  // #endregion record
  assert.equal(server.callsOf('search_tickets'), 2);
  assert.equal(server.callsOf('create_ticket'), 1);

  return {
    answer,
    search: search?.attempts.map(({ outcome, reason, effect, permission }) => ({
      outcome,
      reason,
      effect,
      permission,
    })),
    create: create?.attempts.map(({ outcome, reason, effect }) => ({ outcome, reason, effect })),
  };
}

/** A stand-in MCP server: answers the first call of each tool with HTTP 429, then the tool. */
function standInServer() {
  const calls = new Map<string, number>();
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? 'GET').toUpperCase() !== 'POST') return new Response(null, { status: 405 });
    const rpc = JSON.parse(String(init?.body)) as {
      id?: number;
      method: string;
      params?: { protocolVersion?: string; name?: string };
    };
    const result = (value: unknown): Response => json({ jsonrpc: '2.0', id: rpc.id, result: value });
    switch (rpc.method) {
      case 'initialize':
        return result({
          protocolVersion: rpc.params?.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'tickets', version: '1.0.0' },
        });
      case 'tools/list':
        return result({
          tools: [
            {
              name: 'search_tickets',
              description: 'Search open tickets.',
              inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
            },
            {
              name: 'create_ticket',
              description: 'Open a ticket.',
              inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
            },
          ],
        });
      case 'tools/call': {
        const tool = String(rpc.params?.name);
        const n = (calls.get(tool) ?? 0) + 1;
        calls.set(tool, n);
        if (n === 1) return json({ message: 'Too many requests' }, 429);
        return result({ content: [{ type: 'text', text: `${tool}: no open ticket` }] });
      }
      default:
        // A notification: accepted, no body.
        return new Response(null, { status: 202 });
    }
  };
  return { fetch, callsOf: (tool: string): number => calls.get(tool) ?? 0 };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
