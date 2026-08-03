/**
 * standingAgent — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The laws being pinned:
 *   • THE ROUND TRIP — turn 2's request to the model contains turn 1's own
 *     ASSISTANT reply, verbatim, asserted on the provider's wire. Nothing
 *     writes the final assistant turn back into `scope.history`, so this is the
 *     test that fails if `checkpoint()` ever stops appending the answer it
 *     returned. An agent that drops its own reply every turn still answers
 *     fluently — it just quietly forgets what it said, which is the silent
 *     corruption class this whole feature has to be immune to.
 *   • A crashed process resumes: new agent, new composer, same store.
 *   • Unknown envelope format is refused BY NAME and nothing is mis-restored.
 *   • 'reject' refuses a same-session collision naming the active run;
 *     'enqueue' is FIFO and the second turn sees the first turn's stored state.
 *   • A different session is never refused — it waits.
 *   • A pause is refused as unfinished work and NOTHING is written.
 *   • A failed run writes nothing.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { defineTool } from '../../src/index.js';
import { askHuman } from '../../src/core/pause.js';
import { memorySessions, nodeHost, standingAgent, toEnvelope } from '../../src/hosting/index.js';
import type { CheckpointEnvelope, SessionLifecycle } from '../../src/hosting/index.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/adapters/types.js';
import { inProcessHost } from './testHost.js';

// ─── Helpers ─────────────────────────────────────────────────────────

/** A provider that records every request it is asked to answer. */
function spyProvider(replies: readonly string[]): {
  provider: LLMProvider;
  requests: LLMRequest[];
} {
  const requests: LLMRequest[] = [];
  let index = 0;
  const provider: LLMProvider = {
    name: 'spy',
    complete(req: LLMRequest): Promise<LLMResponse> {
      requests.push(req);
      const content = replies[Math.min(index++, replies.length - 1)] ?? '';
      return Promise.resolve({ content, toolCalls: [], usage: { input: 1, output: 1 } });
    },
  };
  return { provider, requests };
}

/** A provider whose every call parks until it is released. */
function gatedProvider(reply: string): {
  provider: LLMProvider;
  release: () => void;
  started: () => number;
} {
  const waiters: (() => void)[] = [];
  let starts = 0;
  const provider: LLMProvider = {
    name: 'gated',
    async complete(): Promise<LLMResponse> {
      starts++;
      await new Promise<void>((resolve) => waiters.push(resolve));
      return { content: reply, toolCalls: [], usage: { input: 1, output: 1 } };
    },
  };
  return {
    provider,
    release: () => {
      for (const w of waiters.splice(0)) w();
    },
    started: () => starts,
  };
}

function buildAgent(provider: LLMProvider): Agent {
  return Agent.create({ provider, model: 'test-model', maxIterations: 3 })
    .system('You are terse.')
    .build();
}

// ─── unit + integration: the round trip ──────────────────────────────

describe('standingAgent — the conversation round trip', () => {
  it("turn 2's model request contains turn 1's ASSISTANT reply verbatim", async () => {
    const { provider, requests } = spyProvider([
      'The sky is blue.',
      'You asked about the colour of the sky.',
    ]);
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: buildAgent(provider),
      sessions: memorySessions(),
      host,
    });
    try {
      const first = await host.deliver({ input: 'What colour is the sky?', sessionId: 'c-1' });
      expect(first.output).toBe('The sky is blue.');

      const second = await host.deliver({ input: 'What did I just ask?', sessionId: 'c-1' });
      expect(second.output).toBe('You asked about the colour of the sky.');

      // THE LAW. Turn 2 went to the model carrying turn 1's own answer.
      expect(requests).toHaveLength(2);
      const wire = requests[1]!.messages;
      expect(wire).toContainEqual({ role: 'assistant', content: 'The sky is blue.' });
      // …in the right place: user → assistant → user.
      const roles = wire.filter((m) => m.role !== 'system').map((m) => m.role);
      expect(roles).toEqual(['user', 'assistant', 'user']);
      const contents = wire.filter((m) => m.role !== 'system').map((m) => m.content);
      expect(contents).toEqual([
        'What colour is the sky?',
        'The sky is blue.',
        'What did I just ask?',
      ]);
    } finally {
      await handle.close();
    }
  });

  it('turn 3 keeps both earlier turns — the conversation accumulates', async () => {
    const { provider, requests } = spyProvider(['one', 'two', 'three']);
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: buildAgent(provider),
      sessions: memorySessions(),
      host,
    });
    try {
      await host.deliver({ input: 'a', sessionId: 'c-1' });
      await host.deliver({ input: 'b', sessionId: 'c-1' });
      await host.deliver({ input: 'c', sessionId: 'c-1' });
      const contents = requests[2]!.messages
        .filter((m) => m.role !== 'system')
        .map((m) => m.content);
      expect(contents).toEqual(['a', 'one', 'b', 'two', 'c']);
    } finally {
      await handle.close();
    }
  });

  it('a session with no stored conversation starts fresh', async () => {
    const { provider, requests } = spyProvider(['hi']);
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: buildAgent(provider),
      sessions: memorySessions(),
      host,
    });
    try {
      await host.deliver({ input: 'first contact', sessionId: 'brand-new' });
      const contents = requests[0]!.messages
        .filter((m) => m.role !== 'system')
        .map((m) => m.content);
      expect(contents).toEqual(['first contact']);
    } finally {
      await handle.close();
    }
  });
});

// ─── scenario: state crosses the process boundary ────────────────────

describe('standingAgent — a crashed process resumes', () => {
  it('new agent, new composer, same store: the conversation comes back', async () => {
    const sessions = memorySessions();

    const first = spyProvider(['Your name is Ada.']);
    const hostA = inProcessHost();
    const handleA = await standingAgent({
      agent: buildAgent(first.provider),
      sessions,
      host: hostA,
    });
    await hostA.deliver({ input: 'My name is Ada.', sessionId: 'survivor' });
    await handleA.close(); // the "crash" — everything but the store goes away

    const second = spyProvider(['Ada.']);
    const hostB = inProcessHost();
    const handleB = await standingAgent({
      agent: buildAgent(second.provider),
      sessions,
      host: hostB,
    });
    try {
      const reply = await hostB.deliver({ input: 'What is my name?', sessionId: 'survivor' });
      expect(reply.output).toBe('Ada.');
      const contents = second.requests[0]!.messages.filter((m) => m.role !== 'system').map(
        (m) => m.content,
      );
      // Nothing but the envelope crossed the boundary — and all of it did.
      expect(contents).toEqual(['My name is Ada.', 'Your name is Ada.', 'What is my name?']);
    } finally {
      await handleB.close();
    }
  });

  it('round trip through hydrate → persist → hydrate is lossless', async () => {
    const sessions = memorySessions();
    const { provider } = spyProvider(['stored']);
    const host = inProcessHost();
    const handle = await standingAgent({ agent: buildAgent(provider), sessions, host });
    try {
      await host.deliver({ input: 'remember this', sessionId: 's' });
      const stored = await sessions.hydrate('s');
      expect(stored?.format).toBe('conversation-v1');
      expect(stored?.data.history).toEqual([
        { role: 'user', content: 'remember this' },
        { role: 'assistant', content: 'stored' },
      ]);
      // Survives the wire it will actually travel on.
      const roundTripped = JSON.parse(JSON.stringify(stored)) as CheckpointEnvelope;
      expect(roundTripped).toEqual(stored);
    } finally {
      await handle.close();
    }
  });
});

// ─── security: a format this runtime cannot read ─────────────────────

describe('standingAgent — an envelope it cannot read', () => {
  it('refuses BY NAME rather than mis-restoring, and answers nothing', async () => {
    const { provider, requests } = spyProvider(['should never run']);
    const sessions: SessionLifecycle = {
      hydrate: () =>
        Promise.resolve({
          format: 'conversation-v2',
          data: { version: 1, history: [] },
          savedAt: Date.now(),
        } as unknown as CheckpointEnvelope),
      persist: () => Promise.resolve(),
    };
    const host = inProcessHost();
    const handle = await standingAgent({ agent: buildAgent(provider), sessions, host });
    try {
      const reply = await host.deliver({ input: 'hello', sessionId: 'future' });
      expect(reply.output).toBeUndefined();
      expect(reply.error).toContain("unknown checkpoint format 'conversation-v2'");
      expect(reply.error).toContain('conversation-v1');
      // The agent never ran on a conversation it could not read.
      expect(requests).toHaveLength(0);
    } finally {
      await handle.close();
    }
  });
});

// ─── property: concurrency ───────────────────────────────────────────

describe('standingAgent — two turns of one conversation', () => {
  it("'reject' (default) refuses the second, naming the session and the active run", async () => {
    const gated = gatedProvider('done');
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: buildAgent(gated.provider),
      sessions: memorySessions(),
      host,
    });
    try {
      const first = host.deliver({ input: 'one', sessionId: 'busy' });
      await vi_waitFor(() => gated.started() === 1);

      const second = await host.deliver({ input: 'two', sessionId: 'busy' });
      expect(second.output).toBeUndefined();
      expect(second.code).toBe('ERR_CONCURRENT_RUN');
      expect(second.error).toContain("session 'busy'");
      expect(second.error).toMatch(/run '[^']+'/);

      gated.release();
      expect((await first).output).toBe('done');
    } finally {
      gated.release();
      await handle.close();
    }
  });

  it("'enqueue' runs them FIFO and the second sees the first's persisted state", async () => {
    const { provider, requests } = spyProvider(['first answer', 'second answer']);
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: buildAgent(provider),
      sessions: memorySessions(),
      host,
      onConcurrentInvoke: 'enqueue',
    });
    try {
      const [one, two] = await Promise.all([
        host.deliver({ input: 'first', sessionId: 'queued' }),
        host.deliver({ input: 'second', sessionId: 'queued' }),
      ]);
      expect(one.output).toBe('first answer');
      expect(two.output).toBe('second answer');
      // The second turn started from what the first turn STORED.
      const contents = requests[1]!.messages
        .filter((m) => m.role !== 'system')
        .map((m) => m.content);
      expect(contents).toEqual(['first', 'first answer', 'second']);
    } finally {
      await handle.close();
    }
  });

  it('a DIFFERENT session is never refused — it waits its turn', async () => {
    const { provider } = spyProvider(['a', 'b']);
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: buildAgent(provider),
      sessions: memorySessions(),
      host,
    });
    try {
      const [one, two] = await Promise.all([
        host.deliver({ input: 'x', sessionId: 'session-a' }),
        host.deliver({ input: 'y', sessionId: 'session-b' }),
      ]);
      expect(one.error).toBeUndefined();
      expect(two.error).toBeUndefined();
      expect(one.output).toBeDefined();
      expect(two.output).toBeDefined();
    } finally {
      await handle.close();
    }
  });

  it('sessions never bleed into each other', async () => {
    const { provider, requests } = spyProvider(['alpha reply', 'beta reply', 'alpha again']);
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: buildAgent(provider),
      sessions: memorySessions(),
      host,
    });
    try {
      await host.deliver({ input: 'alpha-1', sessionId: 'alpha' });
      await host.deliver({ input: 'beta-1', sessionId: 'beta' });
      await host.deliver({ input: 'alpha-2', sessionId: 'alpha' });
      const contents = requests[2]!.messages
        .filter((m) => m.role !== 'system')
        .map((m) => m.content);
      expect(contents).toEqual(['alpha-1', 'alpha reply', 'alpha-2']);
      expect(contents).not.toContain('beta-1');
    } finally {
      await handle.close();
    }
  });
});

// ─── scenario: a pause is unfinished work, not a failure ─────────────

describe('standingAgent — a run that paused', () => {
  it('refuses by name, says the session is untouched, and writes nothing', async () => {
    const approve = defineTool<{ amount: number }, string>({
      name: 'approve_refund',
      description: 'approve a refund',
      parameters: {
        type: 'object',
        properties: { amount: { type: 'number' } },
        required: ['amount'],
      },
      execute: () => askHuman({ question: 'ok?' }),
    });
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 't1', name: 'approve_refund', args: { amount: 10 } }] }],
      }),
      model: 'test-model',
      maxIterations: 3,
    })
      .system('terse')
      .tool(approve)
      .build();

    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host });
    try {
      const reply = await host.deliver({ input: 'refund me', sessionId: 'pausing' });
      expect(reply.code).toBe('ERR_PAUSE_NOT_CARRIED');
      expect(reply.error).toContain('approve_refund');
      expect(reply.error).toContain('did not fail');
      expect(reply.error).toContain("session 'pausing'");
      // Nothing written — the session keeps exactly what it had (nothing).
      expect(await sessions.hydrate('pausing')).toBeUndefined();
    } finally {
      await handle.close();
    }
  });

  it('leaves an EXISTING conversation exactly as it was', async () => {
    const sessions = memorySessions();
    const before = toEnvelope({
      version: 1,
      runId: 'earlier',
      history: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
      lastCompletedIteration: 1,
      originalInput: { message: 'hello' },
      checkpointedAt: 1,
    });
    await sessions.persist('kept', before);

    const pausing = defineTool<Record<string, never>, string>({
      name: 'ask_first',
      description: 'ask a person',
      parameters: { type: 'object', properties: {} },
      execute: () => askHuman({ question: 'ok?' }),
    });
    const agent = Agent.create({
      provider: mock({ replies: [{ toolCalls: [{ id: 't1', name: 'ask_first', args: {} }] }] }),
      model: 'test-model',
      maxIterations: 3,
    })
      .system('terse')
      .tool(pausing)
      .build();

    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host });
    try {
      const reply = await host.deliver({ input: 'go on', sessionId: 'kept' });
      expect(reply.code).toBe('ERR_PAUSE_NOT_CARRIED');
      expect(await sessions.hydrate('kept')).toEqual(before);
    } finally {
      await handle.close();
    }
  });
});

// ─── scenario: a run that failed ─────────────────────────────────────

describe('standingAgent — a run that failed', () => {
  it('reports the failure and writes nothing', async () => {
    const exploding: LLMProvider = {
      name: 'exploding',
      complete: () => Promise.reject(new Error('vendor is down')),
    };
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent: buildAgent(exploding), sessions, host });
    try {
      const reply = await host.deliver({ input: 'hello', sessionId: 'doomed' });
      expect(reply.output).toBeUndefined();
      expect(reply.error).toContain('vendor is down');
      expect(await sessions.hydrate('doomed')).toBeUndefined();
    } finally {
      await handle.close();
    }
  });

  it('one failed request does not wedge the ones behind it', async () => {
    let calls = 0;
    const flaky: LLMProvider = {
      name: 'flaky',
      complete: () =>
        ++calls === 1
          ? Promise.reject(new Error('first one fails'))
          : Promise.resolve({ content: 'fine now', toolCalls: [], usage: { input: 1, output: 1 } }),
    };
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: buildAgent(flaky),
      sessions: memorySessions(),
      host,
    });
    try {
      const [bad, good] = await Promise.all([
        host.deliver({ input: 'one', sessionId: 'a' }),
        host.deliver({ input: 'two', sessionId: 'b' }),
      ]);
      expect(bad.error).toBeDefined();
      expect(good.output).toBe('fine now');
    } finally {
      await handle.close();
    }
  });
});

// ─── unit: sessions, wake, streaming, anonymity ──────────────────────

describe('standingAgent — the small contracts', () => {
  it('calls onWake once per served request, before hydrate', async () => {
    const order: string[] = [];
    const inner = memorySessions();
    const sessions: SessionLifecycle = {
      hydrate: (id) => {
        order.push('hydrate');
        return inner.hydrate(id);
      },
      persist: (id, env) => inner.persist(id, env),
      onWake: (id, reason) => {
        order.push(`wake:${id}:${reason}`);
      },
    };
    const { provider } = spyProvider(['ok']);
    const host = inProcessHost();
    const handle = await standingAgent({ agent: buildAgent(provider), sessions, host });
    try {
      await host.deliver({ input: 'hello', sessionId: 'w-1' });
      expect(order).toEqual(['wake:w-1:invoke', 'hydrate']);
    } finally {
      await handle.close();
    }
  });

  it('a request with no sessionId is answered and NOT stored', async () => {
    const stored: string[] = [];
    const inner = memorySessions();
    const sessions: SessionLifecycle = {
      hydrate: (id) => inner.hydrate(id),
      persist: (id, env) => {
        stored.push(id);
        return inner.persist(id, env);
      },
    };
    const { provider } = spyProvider(['anonymous answer']);
    const host = inProcessHost();
    const handle = await standingAgent({ agent: buildAgent(provider), sessions, host });
    try {
      const reply = await host.deliver({ input: 'no session here' });
      expect(reply.output).toBe('anonymous answer');
      expect(stored).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  it('forwards model tokens to a host that streams', async () => {
    const streaming: LLMProvider = {
      name: 'streamer',
      complete: () =>
        Promise.resolve({ content: 'hello world', toolCalls: [], usage: { input: 1, output: 2 } }),
      // eslint-disable-next-line @typescript-eslint/require-await
      async *stream() {
        yield { content: 'hello ', done: false };
        yield { content: 'world', done: false };
        yield {
          content: '',
          done: true,
          response: { content: 'hello world', toolCalls: [], usage: { input: 1, output: 2 } },
        };
      },
    };
    const host = inProcessHost({ streaming: true });
    const handle = await standingAgent({
      agent: buildAgent(streaming),
      sessions: memorySessions(),
      host,
    });
    try {
      const reply = await host.deliver({ input: 'greet', sessionId: 's' });
      expect(reply.output).toBe('hello world');
      expect(reply.chunks.join('')).toBe('hello world');
    } finally {
      await handle.close();
    }
  });

  it('closing the standing agent closes the host underneath it', async () => {
    const { provider } = spyProvider(['ok']);
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: buildAgent(provider),
      sessions: memorySessions(),
      host,
    });
    await handle.close();
    const afterClose = await host.deliver({ input: 'too late', sessionId: 's' });
    expect(afterClose.code).toBe('ERR_HOST_CLOSED');
  });
});

// ─── integration: the same composer over a real socket ───────────────

describe('standingAgent — over nodeHost, for real', () => {
  it('holds a two-turn conversation over HTTP and keeps the adapter’s own handle', async () => {
    const { provider, requests } = spyProvider(['Nice to meet you, Ada.', 'Your name is Ada.']);
    // The handle is nodeHost's, not a lossy wrapper — composing keeps the URL
    // the adapter bound, which is the only way to know it when you asked for 0.
    const handle = await standingAgent({
      agent: buildAgent(provider),
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
    });
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    try {
      const say = async (input: string): Promise<string> => {
        const response = await fetch(`${handle.url}/invoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input, sessionId: 'over-http' }),
        });
        return ((await response.json()) as { output: string }).output;
      };
      expect(await say('My name is Ada.')).toBe('Nice to meet you, Ada.');
      expect(await say('What is my name?')).toBe('Your name is Ada.');
      const contents = requests[1]!.messages
        .filter((m) => m.role !== 'system')
        .map((m) => m.content);
      expect(contents).toEqual(['My name is Ada.', 'Nice to meet you, Ada.', 'What is my name?']);
    } finally {
      await handle.close();
    }
  });

  it('refuses a same-session collision with a 409 over the wire', async () => {
    const gated = gatedProvider('done');
    const handle = await standingAgent({
      agent: buildAgent(gated.provider),
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
    });
    try {
      const post = (input: string): Promise<Response> =>
        fetch(`${handle.url}/invoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input, sessionId: 'busy-http' }),
        });
      const first = post('one');
      await vi_waitFor(() => gated.started() === 1);
      const second = await post('two');
      expect(second.status).toBe(409);
      expect((await second.json()) as { code: string }).toMatchObject({
        code: 'ERR_CONCURRENT_RUN',
      });
      gated.release();
      expect((await first).status).toBe(200);
    } finally {
      gated.release();
      await handle.close();
    }
  });
});

/** Poll until `predicate` holds. Small enough not to warrant a dependency. */
async function vi_waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
