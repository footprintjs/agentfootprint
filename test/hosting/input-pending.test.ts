import { describe, expect, it } from 'vitest';
import { Agent, defineTool, requestInput } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import {
  memorySessions,
  readSessionWireOp,
  sessionWireBody,
  standingAgent,
  nodeHost,
} from '../../src/hosting/index.js';
import type {
  HostHandler,
  HostRequest,
  SessionWireResult,
  PendingAsk,
} from '../../src/hosting/index.js';

describe('reload the current input request', () => {
  it('serves the typed HTTP lifecycle, rejects bad values with 400, and reloads/cancels without a model', async () => {
    const runner = Agent.create({
      provider: mock({ replies: [{ toolCalls: [{ id: 'collect', name: 'collect', args: {} }] }] }),
      model: 'mock',
    })
      .tool(
        defineTool({
          name: 'collect',
          description: 'Collect input.',
          inputSchema: { type: 'object', properties: {} },
          execute: () =>
            requestInput({
              id: 'input',
              question: 'Year?',
              fields: [{ id: 'year', type: 'number' }],
            }),
        }),
      )
      .build();
    const handle = await standingAgent({
      agent: runner,
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
    });
    const post = (body: unknown) =>
      fetch(`${handle.url}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    try {
      const asked = await post({ input: 'Inspect this data.', sessionId: 'http-input' });
      expect(asked.status).toBe(202);
      const { awaiting } = (await asked.json()) as { awaiting: PendingAsk };
      const requestId = awaiting.awaitingInput!.requestId;
      const bad = await post({
        input: '',
        sessionId: 'http-input',
        decision: { requestId, values: { year: 'bad' } },
      });
      expect(bad.status).toBe(400);
      const reload = await post({ op: 'session-pending', sessionId: 'http-input' });
      expect(reload.status).toBe(200);
      const state = (await reload.json()) as { pending: PendingAsk };
      expect(state.pending.awaitingInput!.requestId).toBe(requestId);
      const cancelled = await post({
        input: '',
        sessionId: 'http-input',
        decision: { requestId, cancel: true },
      });
      expect(cancelled.status).toBe(200);
      expect(await (await post({ op: 'session-pending', sessionId: 'http-input' })).json()).toEqual(
        { pending: null },
      );
    } finally {
      await handle.close();
    }
  });
  it('uses the shared wire grammar', () => {
    expect(readSessionWireOp({ op: 'session-pending', sessionId: 's' })).toEqual({
      op: 'pending',
      sessionId: 's',
    });
    expect(sessionWireBody({ op: 'pending', pending: null })).toEqual({ pending: null });
  });
  it('restores a partial question after pool eviction, without exposing checkpoints or serving another owner', async () => {
    let handler: HostHandler | undefined;
    let calls = 0;
    const sessions = memorySessions();
    const served = await standingAgent({
      agentFactory: () =>
        Agent.create({
          provider: {
            name: 'spy',
            complete: async () => {
              calls++;
              return {
                content: '',
                toolCalls: [{ id: 'collect', name: 'collect', args: {} }],
                usage: { input: 0, output: 0 },
              };
            },
          },
          model: 'mock',
        })
          .tool(
            defineTool({
              name: 'collect',
              description: 'Collect fields.',
              inputSchema: { type: 'object', properties: {} },
              execute: () =>
                requestInput({
                  id: 'input',
                  question: 'Year and timezone?',
                  fields: [
                    { id: 'year', type: 'number' },
                    { id: 'zone', type: 'string' },
                  ],
                }),
            }),
          )
          .build(),
      maxActiveSessions: 1,
      sessions,
      identity: { verify: async (token) => ({ userId: token }) },
      host: {
        name: 'input-test',
        capabilities: [],
        serve: async (h) => {
          handler = h;
          return { close: async () => {} };
        },
      },
    });
    const send = async (request: HostRequest) => {
      let result: SessionWireResult | undefined;
      let awaiting: PendingAsk | undefined;
      let error: string | undefined;
      await handler!(request, {
        emit: () => {},
        complete: () => {},
        fail: (e) => {
          error = e.message;
        },
        awaiting: (p) => {
          awaiting = p;
        },
        sessions: (r) => {
          result = r;
        },
      });
      return { result, awaiting, error };
    };
    try {
      const a = await send({
        input: 'Inspect A',
        sessionId: 'a',
        headers: { authorization: 'Bearer alice' },
      });
      const requestId = a.awaiting!.awaitingInput!.requestId;
      await send({ input: 'Inspect B', sessionId: 'b', headers: { authorization: 'Bearer bob' } });
      await send({
        input: '',
        sessionId: 'a',
        headers: { authorization: 'Bearer alice' },
        decision: { requestId, values: { year: 2026 } },
      });
      const restored = await send({
        input: '',
        session: { op: 'pending', sessionId: 'a' },
        headers: { authorization: 'Bearer alice' },
      });
      expect(restored.error).toBeUndefined();
      expect(restored.result?.op).toBe('pending');
      if (restored.result?.op !== 'pending') throw new Error('expected pending');
      expect(restored.result.pending?.awaitingInput?.supplied).toEqual({ year: 2026 });
      expect(restored.result.pending?.awaitingInput?.missing).toEqual(['zone']);
      expect(JSON.stringify(restored.result)).not.toContain('sharedState');
      expect(calls).toBe(2);
      const denied = await send({
        input: '',
        session: { op: 'pending', sessionId: 'a' },
        headers: { authorization: 'Bearer bob' },
      });
      expect(denied.error).toBeDefined();
      expect(denied.result).toBeUndefined();
    } finally {
      await served.close();
    }
  });
});
