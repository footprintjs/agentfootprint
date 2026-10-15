/**
 * streamHandler — the protocol-agnostic Fetch-API host (`src/hosting/streamHandler.ts`).
 *
 * Driven with a STUB adapter, so what is pinned is the host, not a protocol:
 *   - the door guard and body ceiling before any adapter sees a request;
 *     refusals by status and code; a 500 that quotes nothing;
 *   - NOTHING SHARED: a fresh runner per request (a factory that hands one
 *     back twice is refused), requests running side by side;
 *   - the thread binding: the app's port decides the key, its refusal is the
 *     caller's answer, one turn at a time per bound thread;
 *   - the session store: a conversation continued from the server's copy, a
 *     stored conversation that is another caller's refused as not found, a
 *     paused run kept BEFORE the caller is told and continued by an answer, a
 *     store that fails turning the turn into a failure;
 *   - the caller hanging up, the keep-alive, a translation fault.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { AgentfootprintEvent } from '../../src/index.js';
import { pauseHere } from '../../src/core/pause.js';
import { IdentityNotVerifiedError, WireRequestRefusal } from '../../src/hosting/errors.js';
import { memorySessions } from '../../src/hosting/memorySessions.js';
import { readPausedRun, toEnvelope } from '../../src/hosting/envelope.js';
import type {
  HeldConversation,
  ProtocolAdapter,
  RunSettlement,
  StreamRunContext,
} from '../../src/hosting/protocolAdapter.js';
import { streamHandler, type StreamRunner } from '../../src/hosting/streamHandler.js';

type Out = { readonly kind: string; readonly text?: string };
interface StubRequest {
  readonly message: string;
  readonly thread: string;
  readonly answer?: unknown;
}

/** A protocol that writes one frame per token and one per settlement. */
function stubAdapter(
  overrides: Partial<ProtocolAdapter<StubRequest, Out>> = {},
  seen: { held?: HeldConversation[]; resumed?: unknown[] } = {},
): ProtocolAdapter<StubRequest, Out> {
  return {
    name: 'stub',
    readRequest({ body }) {
      const b = body as {
        message?: string;
        thread?: string;
        answer?: unknown;
        refuse?: boolean;
        explode?: boolean;
      };
      if (b.refuse) throw new WireRequestRefusal('ERR_STUB_REFUSED', 'stub: not this one', 422);
      if (b.explode) throw new Error('internal detail sk-NEVER-SHOWN');
      return {
        message: b.message ?? '',
        thread: b.thread ?? 't1',
        ...(b.answer !== undefined && { answer: b.answer }),
      };
    },
    conversation: (request) => request.thread,
    plan(request, held) {
      seen.held?.push(held);
      return request.answer !== undefined
        ? { turn: { kind: 'answer', answer: request.answer } }
        : { turn: { kind: 'message', message: request.message } };
    },
    awaitsCaller: () => false,
    open: (_request, resumed) => {
      seen.resumed?.push(resumed);
      return {
        event: (e: AgentfootprintEvent): readonly Out[] =>
          e.type === 'agentfootprint.stream.token'
            ? [{ kind: 'token', text: (e.payload as { content: string }).content }]
            : [],
        settle: (s: RunSettlement): readonly Out[] => [{ kind: s.kind }],
        suspension: () => ({ stub: 'record' }),
      };
    },
    framing: () => ({
      contentType: 'text/event-stream',
      frame: (e: Out) => `data: ${JSON.stringify(e)}\n\n`,
    }),
    ...overrides,
  };
}

const agent = (reply = 'hello there', extra: Record<string, unknown> = {}) =>
  Agent.create({ provider: mock({ chunkDelayMs: 0, reply, ...extra }), model: 'm' })
    .system('s')
    .build();

const post = (body: unknown, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request('http://localhost/agent', {
    method: 'POST',
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** The frames of a streamed response, parsed. */
async function frames(response: Response): Promise<Out[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter((f) => f.startsWith('data: '))
    .map((f) => JSON.parse(f.slice('data: '.length)) as Out);
}

/** The app's binder: the signed-in user is the `x-user` header; the thread key is theirs. */
const byUser = {
  bind: ({ conversation, headers }: { conversation: string; headers: Record<string, string> }) => {
    const user = headers['x-user'];
    if (user === undefined) throw new WireRequestRefusal('ERR_NOT_SIGNED_IN', 'sign in', 401);
    return {
      sessionId: `${user}:${conversation}`,
      identity: { principal: user, conversationId: conversation },
    };
  },
};

describe('streamHandler — before any adapter sees a request', () => {
  const handle = streamHandler({ agent: () => agent(), adapter: stubAdapter(), heartbeatMs: 0 });

  it('answers POST only (405, Allow: POST)', async () => {
    const res = await handle(new Request('http://localhost/agent', { method: 'GET' }));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(await res.json()).toMatchObject({ code: 'ERR_METHOD_NOT_ALLOWED' });
  });

  it('refuses a POST that does not say it is JSON (415), on the headers alone', async () => {
    const res = await handle(
      post({ message: 'hi' }, { headers: { 'content-type': 'text/plain' } }),
    );
    expect(res.status).toBe(415);
  });

  it('refuses a browser origin from another site (403)', async () => {
    const res = await handle(
      post({ message: 'hi' }, { headers: { origin: 'https://evil.example' } }),
    );
    expect(res.status).toBe(403);
  });

  it('refuses a body over the ceiling (413)', async () => {
    const small = streamHandler({
      agent: () => agent(),
      adapter: stubAdapter(),
      maxBodyBytes: 16,
      heartbeatMs: 0,
    });
    expect((await small(post({ message: 'x'.repeat(64) }))).status).toBe(413);
  });

  it('refuses a body that is not JSON (400)', async () => {
    const res = await handle(post('{not json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'ERR_INVALID_JSON' });
  });

  it("answers an adapter's refusal with the adapter's status and code", async () => {
    const res = await handle(post({ refuse: true }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'ERR_STUB_REFUSED' });
  });

  it('answers anything else with a 500 that quotes nothing', async () => {
    const res = await handle(post({ explode: true }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('sk-NEVER-SHOWN');
  });

  it('refuses at construction what cannot be served', () => {
    expect(() => streamHandler({ agent: agent() as never, adapter: stubAdapter() })).toThrow(
      /FRESH runner/,
    );
    expect(() =>
      streamHandler({ agent: () => agent(), adapter: stubAdapter(), sessions: memorySessions() }),
    ).toThrow(/sessions needs threads/);
    expect(() =>
      streamHandler({ agent: () => agent(), adapter: stubAdapter(), maxBodyBytes: 0 }),
    ).toThrow(/maxBodyBytes/);
    const broken = stubAdapter({
      framing: () => {
        throw new Error('peer missing');
      },
    });
    expect(() => streamHandler({ agent: () => agent(), adapter: broken })).toThrow('peer missing');
  });
});

describe('streamHandler — nothing is shared between requests', () => {
  it('builds a fresh runner for every request, handed what that request runs with', async () => {
    const contexts: StreamRunContext[] = [];
    const handle = streamHandler({
      agent: (run) => {
        contexts.push(run);
        return agent();
      },
      adapter: stubAdapter(),
      heartbeatMs: 0,
    });
    await (await handle(post({ message: 'a' }))).text();
    await (await handle(post({ message: 'b' }))).text();
    expect(contexts).toEqual([
      { tools: [], accepted: {} },
      { tools: [], accepted: {} },
    ]);
  });

  it('refuses a factory that hands back a runner it handed back before', async () => {
    const shared = agent();
    const handle = streamHandler({ agent: () => shared, adapter: stubAdapter(), heartbeatMs: 0 });
    expect((await handle(post({ message: 'a' }))).status).toBe(200);
    const again = await handle(post({ message: 'b' }));
    expect(again.status).toBe(500);
    expect(await again.json()).toMatchObject({ code: 'ERR_RUNNER_REUSED' });
  });

  it('runs requests side by side — none waits on another, none sees another', async () => {
    let inFlight = 0;
    let most = 0;
    const slowly = (reply: string) => ({
      name: 'slow',
      complete: async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 40));
        inFlight -= 1;
        return {
          content: reply,
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'stop',
        };
      },
    });
    let n = 0;
    const handle = streamHandler({
      agent: () =>
        Agent.create({ provider: slowly(`reply ${++n}`) as never, model: 'm' })
          .system('s')
          .build(),
      adapter: stubAdapter({
        open: () => ({
          event: (e) =>
            e.type === 'agentfootprint.agent.turn_end'
              ? [{ kind: 'answer', text: (e.payload as { finalContent: string }).finalContent }]
              : [],
          settle: (s) => [{ kind: s.kind }],
        }),
      }),
      heartbeatMs: 0,
    });
    const [a, b] = await Promise.all([
      handle(post({ message: 'a' })),
      handle(post({ message: 'b' })),
    ]);
    const [fa, fb] = await Promise.all([frames(a), frames(b)]);
    expect(most).toBe(2);
    expect(fa.filter((f) => f.kind === 'answer')).toHaveLength(1);
    expect(fb.filter((f) => f.kind === 'answer')).toHaveLength(1);
    expect(new Set([fa[0]!.text, fb[0]!.text])).toEqual(new Set(['reply 1', 'reply 2']));
  });
});

describe('streamHandler — the thread is bound by the app, never by the request', () => {
  it("the binder's refusal is the caller's answer; an unverified identity is a 401", async () => {
    const handle = streamHandler({
      agent: () => agent(),
      adapter: stubAdapter(),
      threads: byUser,
      heartbeatMs: 0,
    });
    const anonymous = await handle(post({ message: 'hi' }));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ code: 'ERR_NOT_SIGNED_IN' });

    const verifying = streamHandler({
      agent: () => agent(),
      adapter: stubAdapter(),
      threads: {
        bind: () => {
          throw new IdentityNotVerifiedError('expired');
        },
      },
      heartbeatMs: 0,
    });
    expect((await verifying(post({ message: 'hi' }))).status).toBe(401);
  });

  it('a key the binder composes is held to the session-id rule', async () => {
    const handle = streamHandler({
      agent: () => agent(),
      adapter: stubAdapter(),
      threads: { bind: () => ({ sessionId: 'x'.repeat(5_000) }) },
      heartbeatMs: 0,
    });
    const res = await handle(post({ message: 'hi' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'ERR_INVALID_SESSION_ID' });
  });

  it('one turn at a time per bound thread: a second is refused (409), another thread is not', async () => {
    const handle = streamHandler({
      agent: () => agent('slow answer', { thinkingMs: 60 }),
      adapter: stubAdapter(),
      threads: byUser,
      heartbeatMs: 0,
    });
    const alice = { headers: { 'x-user': 'alice' } };
    const first = await handle(post({ message: 'a', thread: 't1' }, alice));
    const second = await handle(post({ message: 'b', thread: 't1' }, alice));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: 'ERR_CONCURRENT_RUN' });
    // The same thread NAME for another caller is another conversation.
    const bob = await handle(
      post({ message: 'c', thread: 't1' }, { headers: { 'x-user': 'bob' } }),
    );
    expect(bob.status).toBe(200);
    await Promise.all([first.text(), bob.text()]);
    // Released when the turn ends.
    const third = await handle(post({ message: 'd', thread: 't1' }, alice));
    expect(third.status).toBe(200);
    await third.text();
  });
});

describe('streamHandler — the server keeps the conversation', () => {
  it("continues the server's copy, under the bound key — never the request's", async () => {
    const sessions = memorySessions();
    const requests: unknown[][] = [];
    const spy = {
      name: 'spy',
      complete: async (req: { messages: unknown[] }) => {
        requests.push(req.messages);
        return {
          content: `answer ${requests.length}`,
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'stop',
        };
      },
    };
    const handle = streamHandler({
      agent: () =>
        Agent.create({ provider: spy as never, model: 'm' })
          .system('s')
          .build(),
      adapter: stubAdapter(),
      threads: byUser,
      sessions,
      heartbeatMs: 0,
    });
    const alice = { headers: { 'x-user': 'alice' } };
    await (await handle(post({ message: 'first question', thread: 't1' }, alice))).text();
    await (await handle(post({ message: 'second question', thread: 't1' }, alice))).text();
    const second = JSON.stringify(requests[1]);
    expect(second).toContain('first question');
    expect(second).toContain('answer 1');
    expect(await sessions.hydrate('alice:t1')).toBeDefined();
    expect(await sessions.hydrate('t1')).toBeUndefined();
  });

  it('a stored conversation that is another caller’s is not found (404), whatever its key', async () => {
    const sessions = memorySessions();
    // A binder bug maps bob onto alice's key; the stored owner still refuses him.
    const careless = {
      bind: ({ headers }: { headers: Record<string, string> }) => ({
        sessionId: 'shared-key',
        identity: { principal: headers['x-user'] as string, conversationId: 'c' },
      }),
    };
    const handle = streamHandler({
      agent: () => agent(),
      adapter: stubAdapter(),
      threads: careless,
      sessions,
      heartbeatMs: 0,
    });
    await (await handle(post({ message: 'mine' }, { headers: { 'x-user': 'alice' } }))).text();
    const res = await handle(post({ message: 'theirs' }, { headers: { 'x-user': 'bob' } }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ code: 'ERR_SESSION_NOT_FOUND' });
    expect(JSON.stringify(body)).not.toContain('shared-key');
  });

  it('keeps a paused run with the protocol’s record BEFORE telling the caller, then continues it', async () => {
    const sessions = memorySessions();
    const ask = defineTool({
      name: 'ask',
      description: 'Ask a person.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => pauseHere({ question: 'Sure?' }),
    });
    // One script across the two requests' runners: the call, then the answer.
    const provider = mock({
      chunkDelayMs: 0,
      replies: [{ content: '', toolCalls: [{ id: 'q1', name: 'ask', args: {} }] }, 'done'],
    });
    const build = (): StreamRunner =>
      Agent.create({ provider, model: 'm' }).system('s').tool(ask).build();
    const seen: { held: HeldConversation[]; resumed: unknown[] } = { held: [], resumed: [] };
    const handle = streamHandler({
      agent: build,
      adapter: stubAdapter({}, seen),
      threads: byUser,
      sessions,
      heartbeatMs: 0,
    });
    const alice = { headers: { 'x-user': 'alice' } };
    expect(await frames(await handle(post({ message: 'go' }, alice)))).toEqual([
      { kind: 'paused' },
    ]);
    const stored = readPausedRun(await sessions.hydrate('alice:t1'));
    expect(stored.wire).toEqual({ protocol: 'stub', record: { stub: 'record' } });

    const answered = await frames(await handle(post({ answer: 'yes' }, alice)));
    expect(answered.at(-1)).toEqual({ kind: 'finished' });
    expect(seen.held[1]!.awaiting?.suspension).toEqual({ stub: 'record' });
    expect(seen.resumed[1]).toEqual({ stub: 'record' });
    // The pause is gone; the conversation is what is kept.
    expect((await sessions.hydrate('alice:t1'))?.format).not.toBe('flowchart-v1');
  });

  it('a store that cannot keep the turn turns it into a failure — never a quiet success', async () => {
    const sessions = memorySessions();
    const failing = {
      ...sessions,
      hydrate: sessions.hydrate.bind(sessions),
      persist: async () => {
        throw new Error('disk full');
      },
    };
    const handle = streamHandler({
      agent: () => agent(),
      adapter: stubAdapter(),
      threads: byUser,
      sessions: failing,
      heartbeatMs: 0,
    });
    const out = await frames(await handle(post({ message: 'hi' }, { headers: { 'x-user': 'a' } })));
    expect(out.at(-1)).toEqual({ kind: 'failed' });
  });

  it('a runner that keeps no conversation stores none, and continues a request on its own', async () => {
    const sessions = memorySessions();
    await sessions.persist(
      'alice:t1',
      toEnvelope({
        version: 1,
        runId: 'r',
        history: [{ role: 'user', content: 'old' }],
        lastCompletedIteration: 0,
        originalInput: { message: 'old' },
        checkpointedAt: 0,
        identity: { principal: 'alice', conversationId: 't1' },
      }),
    );
    const inputs: unknown[] = [];
    const plain: StreamRunner = {
      on: () => () => undefined,
      run: async (input: unknown) => {
        inputs.push(input);
        return 'ok';
      },
      resume: async () => 'ok',
    } as unknown as StreamRunner;
    const handle = streamHandler({
      agent: () => ({ ...plain }),
      adapter: stubAdapter(),
      threads: byUser,
      sessions,
      heartbeatMs: 0,
    });
    await (await handle(post({ message: 'new' }, { headers: { 'x-user': 'alice' } }))).text();
    expect(inputs).toEqual([{ message: 'new' }]);
  });
});

describe('streamHandler — the stream', () => {
  it('streams the run in the protocol’s frames, then its settlement', async () => {
    const handle = streamHandler({ agent: () => agent(), adapter: stubAdapter(), heartbeatMs: 0 });
    const res = await handle(post({ message: 'hi' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    expect(await frames(res)).toEqual([
      { kind: 'token', text: 'hello ' },
      { kind: 'token', text: 'there' },
      { kind: 'finished' },
    ]);
  });

  it('a failed run settles as failed, and the stream ends', async () => {
    const down = () =>
      Agent.create({
        provider: { name: 'down', complete: async () => Promise.reject(new Error('x')) } as never,
        model: 'm',
      })
        .system('s')
        .build();
    const handle = streamHandler({ agent: down, adapter: stubAdapter(), heartbeatMs: 0 });
    expect(await frames(await handle(post({ message: 'hi' })))).toEqual([{ kind: 'failed' }]);
  });

  it('a caller that hangs up mid-run cuts it; one gone before it starts never runs it', async () => {
    let started = 0;
    const slow = {
      name: 'slow',
      complete: () => {
        started += 1;
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                content: 'late',
                toolCalls: [],
                usage: { input: 1, output: 1 },
                stopReason: 'stop',
              }),
            2_000,
          ),
        );
      },
    };
    const handle = streamHandler({
      agent: () =>
        Agent.create({ provider: slow as never, model: 'm' })
          .system('s')
          .build(),
      adapter: stubAdapter(),
      heartbeatMs: 0,
    });
    const gone = new AbortController();
    gone.abort();
    const never = await handle(post({ message: 'a' }, { signal: gone.signal }));
    await never.text().catch(() => '');
    expect(started).toBe(0);

    const first = new AbortController();
    const res = await handle(post({ message: 'b' }, { signal: first.signal }));
    await new Promise((r) => setTimeout(r, 30));
    const cutAt = Date.now();
    first.abort();
    await res.text().catch(() => '');
    expect(Date.now() - cutAt).toBeLessThan(1_500);
    expect(started).toBe(1);
  });

  it('keeps a quiet stream alive with SSE comments', async () => {
    const handle = streamHandler({
      agent: () => agent('done', { thinkingMs: 60 }),
      adapter: stubAdapter(),
      heartbeatMs: 10,
    });
    expect(await (await handle(post({ message: 'hi' }))).text()).toContain(': ping\n\n');
  });

  it('a translation that throws is the adapter’s fault, never the run’s: the stream still ends', async () => {
    const faulty = stubAdapter({
      open: () => ({
        event: () => {
          throw new Error('translation bug');
        },
        settle: (s) => [{ kind: s.kind }],
      }),
    });
    const handle = streamHandler({ agent: () => agent(), adapter: faulty, heartbeatMs: 0 });
    expect(await frames(await handle(post({ message: 'hi' })))).toEqual([{ kind: 'finished' }]);
  });
});
