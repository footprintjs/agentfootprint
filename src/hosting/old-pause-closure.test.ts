import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { Agent, checkInApproved, defineTool } from '../index.js';
import { memorySessions, standingAgent } from './index.js';
import { inProcessHost } from '../../test/hosting/testHost.js';
import type { LLMProvider } from '../provider-contract/types.js';
import type { CheckpointEnvelope, PendingAsk } from './types.js';
import { streamHandler } from './streamHandler.js';
import { NoPendingAskError } from './errors.js';
import type { ProtocolAdapter } from './protocolAdapter.js';

interface Saved {
  readonly env: CheckpointEnvelope;
  readonly awaiting: PendingAsk;
}

const provider: LLMProvider = {
  name: 'continue-only',
  async complete() {
    return { content: 'new message ran', toolCalls: [], usage: { input: 1, output: 1 } };
  },
};

it.each(['typed', 'checkin'] as const)(
  'closes an old %s carrier on answer, cancel or a new message without trapping the session',
  async (kind) => {
    const saved = JSON.parse(
      readFileSync(new URL(`./fixtures/old-pause/old-${kind}.json`, import.meta.url), 'utf8'),
    ) as Saved;
    let ran = 0;
    const tool = defineTool({
      name: 'hold',
      description: 'hold',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        ran++;
        return 'ran';
      },
    });

    for (const action of ['answer', 'cancel', 'message'] as const) {
      const agent = Agent.create({ provider, model: 'test' }).tool(tool).build();
      const sessions = memorySessions();
      await sessions.persist('a', structuredClone(saved.env));
      const host = inProcessHost();
      const handle = await standingAgent({ agent, sessions, host });
      const decision =
        kind === 'typed'
          ? {
              requestId: saved.awaiting.awaitingInput?.requestId,
              ...(action === 'cancel' ? { cancel: true } : { values: { y: 2026 } }),
            }
          : checkInApproved({ request: saved.awaiting.checkIn!, by: 'alice' });
      try {
        const first = await host.deliver({
          sessionId: 'a',
          input: 'new message',
          ...(action !== 'message' && { decision }),
        });
        expect(first.error).toBeUndefined();
        expect(first.awaiting).toBeUndefined();
        if (action !== 'message')
          expect(first.output).toContain('question can no longer be answered');
        expect((await sessions.hydrate('a'))?.format).toBe('conversation-v1');
        const next = await host.deliver({ sessionId: 'a', input: 'next message' });
        expect(next.error).toBeUndefined();
        expect(next.output).toBe('new message ran');
        expect(ran).toBe(0);
      } finally {
        await handle.close();
      }
    }
  },
);

it.each(['typed', 'checkin'] as const)(
  'the protocol door closes an old %s carrier before calling resume',
  async (kind) => {
    const saved = JSON.parse(
      readFileSync(new URL(`./fixtures/old-pause/old-${kind}.json`, import.meta.url), 'utf8'),
    ) as Saved;
    const sessions = memorySessions();
    await sessions.persist('a', saved.env);
    const adapter: ProtocolAdapter<{ readonly answer?: boolean }, string> = {
      name: 'closure-test',
      readRequest: ({ body }) => body as { readonly answer?: boolean },
      conversation: () => 'a',
      plan(request, held) {
        if (request.answer && held.awaiting === undefined) throw new NoPendingAskError('a');
        return request.answer
          ? { turn: { kind: 'answer', answer: {} } }
          : { turn: { kind: 'message', message: 'continue' } };
      },
      open: () => ({ event: () => [], settle: (value) => [value.kind] }),
      framing: () => ({
        contentType: 'text/event-stream',
        frame: (value) => `data: ${value}\n\n`,
      }),
    };
    const resume = vi.fn();
    const handle = streamHandler({
      sessions,
      threads: { bind: () => ({ sessionId: 'a' }) },
      adapter,
      heartbeatMs: 0,
      agent: () => {
        const agent = Agent.create({ provider, model: 'test' }).build();
        const original = agent.resume.bind(agent);
        agent.resume = (...args) => {
          resume();
          return original(...args);
        };
        return agent;
      },
    });
    const post = (body: object) =>
      new Request('http://localhost/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect(await (await handle(post({ answer: true }))).text()).toContain('data: cancelled');
    expect(resume).not.toHaveBeenCalled();
    expect((await sessions.hydrate('a'))?.format).toBe('conversation-v1');
    expect(await (await handle(post({}))).text()).toContain('data: finished');
  },
);
