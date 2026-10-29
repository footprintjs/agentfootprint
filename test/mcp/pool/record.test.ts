/**
 * The record (§ 8): every pool use in a run files ONE
 * `agentfootprint.tools.mcp_client` — the tools slot after `list(ctx)`, the
 * dispatch loop for each call — with the fields of the payload and nothing
 * else. Never an identity value, a session id, a header, an argument, a result
 * or a definition, in an event, a report or `stats()`.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { servedUse } from '../../../src/tools/mcpClientUse.js';
import { fakeEndpoint } from './fakeEndpoint.js';
import { everything, id, poolOver } from './harness.js';

const FIELDS = new Set([
  'server',
  'at',
  'toolCallId',
  'keyHash',
  'clientId',
  'generation',
  'client',
  'previous',
  'evidence',
  'refusal',
  'initMs',
  'definitions',
  'definitionsAgeMs',
  'revalidated',
]);

function agentOver(pool: ReturnType<typeof poolOver>['pool'], args: Record<string, unknown>) {
  return Agent.create({
    provider: mock({
      chunkDelayMs: 0,
      respond: (req) =>
        req.messages.some((m) => m.role === 'tool')
          ? { content: 'Order 7712 shipped yesterday.' }
          : { toolCalls: [{ id: 'call-1', name: 'status', args }] },
    }),
    model: 'mock',
    maxIterations: 4,
  })
    .system('You look orders up with the tools you have.')
    .toolProvider(pool.toolProvider())
    .build();
}

describe('tools.mcp_client in a run', () => {
  it('one event per listing and per call, with the fields of § 8 and nothing else', async () => {
    const endpoint = fakeEndpoint({
      onCall: () => ({ content: [{ type: 'text', text: 'RESULT-CANARY-4410 shipped' }] }),
    });
    const { pool, reports } = poolOver(endpoint);
    const agent = agentOver(pool, { order: 'ARGUMENT-CANARY-8812' });
    const events: { type: string; payload: Record<string, unknown> }[] = [];
    agent.on('agentfootprint.tools.mcp_client', (event) =>
      events.push({
        type: event.type,
        payload: event.payload as unknown as Record<string, unknown>,
      }),
    );
    const identity = id('PRINCIPAL-CANARY-7731', 'CONVERSATION-CANARY-5520', 'TENANT-CANARY-9902');
    await agent.run({ message: 'Where is order 7712?', identity });

    const lists = events.filter((e) => e.payload['at'] === 'list');
    const calls = events.filter((e) => e.payload['at'] === 'call');
    expect(lists.length).toBeGreaterThanOrEqual(1);
    expect(calls).toHaveLength(1);
    expect(lists[0]!.payload).toMatchObject({
      server: 'orders',
      client: 'opened',
      generation: 1,
      definitions: 'listed',
    });
    expect(lists[0]!.payload['keyHash']).toMatch(/^[0-9a-f]{8,16}$/);
    expect(lists[0]!.payload['clientId']).toMatch(/^[0-9a-f]{16}$/);
    expect(calls[0]!.payload).toMatchObject({
      server: 'orders',
      toolCallId: 'call-1',
      client: 'reused',
      keyHash: lists[0]!.payload['keyHash'],
      clientId: lists[0]!.payload['clientId'],
    });
    for (const event of events) {
      for (const key of Object.keys(event.payload)) expect(FIELDS.has(key)).toBe(true);
    }
    await pool.terminate({ tenant: 'TENANT-CANARY-9902', principal: 'PRINCIPAL-CANARY-7731' });
    await pool.settled();

    const sessions = endpoint.sessions();
    const servedSessions = endpoint.requests.map((r) => r.session).filter((s) => s !== undefined);
    const all = everything(events, reports, pool.stats());
    for (const canary of [
      'PRINCIPAL-CANARY',
      'CONVERSATION-CANARY',
      'TENANT-CANARY',
      'ARGUMENT-CANARY',
      'RESULT-CANARY',
      ...sessions,
      ...servedSessions,
    ]) {
      expect(all).not.toContain(canary);
    }
  });

  it('an agent without a pool emits no tools.mcp_client — byte identity for everyone else', async () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, respond: () => ({ content: 'hi' }) }),
      model: 'mock',
    }).build();
    const events: unknown[] = [];
    agent.on('agentfootprint.tools.mcp_client', (event) => events.push(event));
    await agent.run({ message: 'hello' });
    expect(events).toEqual([]);
  });

  it('a refused listing files its use and fails that iteration’s discovery', async () => {
    const endpoint = fakeEndpoint();
    const { pool } = poolOver(endpoint);
    const agent = agentOver(pool, {});
    const events: Record<string, unknown>[] = [];
    const failures: unknown[] = [];
    agent.on('agentfootprint.tools.mcp_client', (event) =>
      events.push(event.payload as unknown as Record<string, unknown>),
    );
    agent.on('agentfootprint.tools.discovery_failed', (event) => failures.push(event.payload));
    // No identity named: the pool refuses, by name, and nothing is opened.
    await agent.run({ message: 'hello' }).catch(() => undefined);
    expect(events[0]).toMatchObject({ at: 'list', client: 'refused', refusal: 'no-identity' });
    expect(events[0]!['keyHash']).toBeUndefined();
    expect(failures.length).toBeGreaterThan(0);
    expect(endpoint.requests).toEqual([]);
  });
});

describe('the allow-list', () => {
  it('a filing with a field nobody listed, or a word outside its set, is refused whole', () => {
    const base = { server: 'orders', at: 'call', client: 'reused' } as const;
    expect(servedUse(base)).toEqual(base);
    expect(servedUse({ ...base, sessionId: 'abc' } as never)).toBeUndefined();
    expect(servedUse({ ...base, client: 'borrowed' } as never)).toBeUndefined();
    expect(servedUse({ ...base, keyHash: 'tenant/alice' } as never)).toBeUndefined();
    expect(servedUse({ ...base, refusal: 'because' } as never)).toBeUndefined();
  });
});
