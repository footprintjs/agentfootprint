/**
 * `EventMeta.sessionId` — which CONVERSATION an event belongs to (9.4.0).
 *
 * Every shipped event carried `meta.runId`, and a runId is per `run()` /
 * `resume()`. A session outlives both. So a CloudWatch stream could answer
 * "what happened in this run?" and not "what happened in this conversation?" —
 * and the second is the question a session-oriented host (AgentCore above all)
 * is built around. Joining runs back into sessions after the fact is not
 * possible from the events alone, so the session has to ride on the meta.
 *
 * The rule that makes it trustworthy: **absent when there is no session.** An
 * anonymous request has none. A bare `agent.run()` has none. Neither gets a
 * fabricated one, and neither gets the runId wearing a session's name.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/index.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import { cloudwatchObservability } from '../../src/adapters/observability/cloudwatch.js';
import type {
  CloudWatchLikeClient,
  CloudwatchObservabilityOptions,
} from '../../src/adapters/observability/cloudwatch.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { inProcessHost } from './testHost.js';

function provider(...replies: string[]): LLMProvider {
  let index = 0;
  return {
    name: 'mock',
    complete: async (): Promise<LLMResponse> => ({
      content: replies[Math.min(index++, replies.length - 1)] ?? 'ok',
      toolCalls: [],
      usage: { input: 1, output: 1 },
    }),
  };
}

function buildAgent(): Agent {
  return Agent.create({ provider: provider('answered'), model: 'test-model', maxIterations: 3 })
    .system('You are terse.')
    .build();
}

/** Every session id stamped on an event this run emitted, `null` for absent. */
function sessionsSeen(agent: Agent): (string | null)[] {
  const seen: (string | null)[] = [];
  agent.on('*', (e) => {
    const meta = (e as { meta: { sessionId?: string } }).meta;
    seen.push(meta.sessionId ?? null);
  });
  return seen;
}

// ─── unit — the run option ───────────────────────────────────────────

describe('agent.run(input, { sessionId })', () => {
  it('stamps every event with the session it belongs to', async () => {
    const agent = buildAgent();
    const seen = sessionsSeen(agent);
    await agent.run({ message: 'hello' }, { sessionId: 'conv-42' });
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['conv-42']));
  });

  it('stamps NOTHING when the run is not session-bound', async () => {
    const agent = buildAgent();
    const seen = sessionsSeen(agent);
    await agent.run({ message: 'hello' });
    expect(seen.length).toBeGreaterThan(0);
    // Never the runId wearing a session's name, and never an empty string: an
    // absent session and an invented one are different facts.
    expect(new Set(seen)).toEqual(new Set([null]));
  });

  it('rides beside runId rather than replacing it — one session, many runs', async () => {
    const agent = buildAgent();
    const rows: { runId: string; sessionId?: string }[] = [];
    agent.on('*', (e) => rows.push((e as { meta: { runId: string; sessionId?: string } }).meta));
    await agent.run({ message: 'one' }, { sessionId: 'conv-42' });
    await agent.run({ message: 'two' }, { sessionId: 'conv-42' });
    expect(new Set(rows.map((r) => r.sessionId))).toEqual(new Set(['conv-42']));
    // Two runs, two runIds, one conversation — which is the whole point.
    expect(new Set(rows.map((r) => r.runId)).size).toBe(2);
  });
});

// ─── integration — the host that actually knows the session ─────────

describe('standingAgent threads the caller’s session id', () => {
  it("a request with a session id reaches the run's events", async () => {
    const agent = buildAgent();
    const seen = sessionsSeen(agent);
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions: memorySessions(), host });
    try {
      await host.deliver({ input: 'hello', sessionId: 'c-1' });
      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen)).toEqual(new Set(['c-1']));
    } finally {
      await handle.close();
    }
  });

  it('an ANONYMOUS request stamps nothing', async () => {
    const agent = buildAgent();
    const seen = sessionsSeen(agent);
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions: memorySessions(), host });
    try {
      await host.deliver({ input: 'hello' });
      expect(seen.length).toBeGreaterThan(0);
      // The host invents a `#anonymous-N` key to serialise concurrent requests.
      // That is a latch this host made up; publishing it as telemetry would be
      // handing out a fact nobody can join to.
      expect(new Set(seen)).toEqual(new Set([null]));
      expect(seen.some((s) => String(s).includes('anonymous'))).toBe(false);
    } finally {
      await handle.close();
    }
  });

  it('the same session across turns keeps its id', async () => {
    const agent = buildAgent();
    const seen = sessionsSeen(agent);
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions: memorySessions(), host });
    try {
      await host.deliver({ input: 'one', sessionId: 'c-9' });
      await host.deliver({ input: 'two', sessionId: 'c-9' });
      expect(new Set(seen)).toEqual(new Set(['c-9']));
    } finally {
      await handle.close();
    }
  });
});

// ─── the reason it exists: it reaches the shipped telemetry ─────────

describe('what CloudWatch actually receives', () => {
  function capturing(): { client: CloudWatchLikeClient; lines: string[] } {
    const lines: string[] = [];
    return {
      lines,
      client: {
        putLogEvents: async (input: {
          logEvents: ReadonlyArray<{ timestamp: number; message: string }>;
        }) => {
          for (const e of input.logEvents) lines.push(e.message);
        },
      },
    };
  }

  function shipper(client: CloudWatchLikeClient) {
    const options: CloudwatchObservabilityOptions = {
      logGroupName: '/agentfootprint/test',
      flushIntervalMs: 0,
      _client: client,
    };
    return cloudwatchObservability(options);
  }

  it('ships the session id, without the adapter knowing it exists', async () => {
    const { client, lines } = capturing();
    const strategy = shipper(client);
    const agent = buildAgent();
    agent.on('*', (e) => strategy.exportEvent(e as AgentfootprintEvent));
    await agent.run({ message: 'hello' }, { sessionId: 'conv-77' });
    await strategy.flush?.();
    strategy.stop?.();

    expect(lines.length).toBeGreaterThan(0);
    // The adapter serializes the whole envelope, so this arrives for free —
    // which is why the fix belongs on the meta and not in nine adapters.
    for (const line of lines) {
      expect(JSON.parse(line).meta.sessionId).toBe('conv-77');
    }
  });

  it('ships no session key at all for an unhosted run', async () => {
    const { client, lines } = capturing();
    const strategy = shipper(client);
    const agent = buildAgent();
    agent.on('*', (e) => strategy.exportEvent(e as AgentfootprintEvent));
    await agent.run({ message: 'hello' });
    await strategy.flush?.();
    strategy.stop?.();

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(Object.keys(JSON.parse(line).meta)).not.toContain('sessionId');
    }
  });
});
