/**
 * foundryResponsesHost — the hosted-agent contract, asserted against a real socket.
 *
 * The host conformance suite (host-contract.test.ts) proves this adapter
 * behaves like every other host. THIS file asserts what is specific to it and
 * what the suite therefore cannot see: the two paths, the capability probe, the
 * readiness body, the session aliases, the input items it refuses, the body
 * ceiling, and the one thing a body shape alone could not express — the exact
 * order and numbering of the streaming lifecycle.
 *
 * Nothing here is mocked. The adapter is `httpHost` plus a dialect, with no SDK
 * anywhere on its path, so every assertion below is real verification of the
 * wire rather than a mapping asserted in prose.
 *
 * The port is always 0. A test that bound 8088 would pass on a laptop and fail
 * on any machine already running the thing this adapter exists to replace.
 */

import { request as httpRequest } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { foundryResponsesHost } from '../../src/hosting-providers.js';
import { memorySessions, nodeHost, standingAgent } from '../../src/hosting/index.js';
import type { HostHandler, HostRequest } from '../../src/hosting/index.js';
import type { HttpHostHandle } from '../../src/hosting/httpHost.js';

let open: HttpHostHandle | undefined;

afterEach(async () => {
  await open?.close();
  open = undefined;
});

/** Serve one handler on an ephemeral port and remember it for teardown. */
async function serve(
  handler: HostHandler,
  options: Parameters<typeof foundryResponsesHost>[0] = {},
): Promise<HttpHostHandle> {
  const handle = await foundryResponsesHost({
    port: 0,
    hostname: '127.0.0.1',
    ...options,
  }).serve(handler);
  open = handle;
  return handle;
}

const echo: HostHandler = (request, reply) => {
  reply.complete(`echo:${request.input}|session:${request.sessionId ?? 'none'}`);
};

interface SseEvent {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

/** Parse an SSE body into the frames a client would have rendered, in order. */
function parseSse(body: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of body.split('\n\n')) {
    const lines = block.split('\n');
    const event = lines.find((l) => l.startsWith('event: '))?.slice(7);
    const data = lines.find((l) => l.startsWith('data: '))?.slice(6);
    if (event === undefined || data === undefined) continue;
    events.push({ event, data: JSON.parse(data) as Record<string, unknown> });
  }
  return events;
}

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(`${url}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// ─── probes ──────────────────────────────────────────────────────────

describe('foundryResponsesHost — the probes the contract defines', () => {
  it('answers HEAD on the invoke path with 204 and runs nothing', async () => {
    let ran = false;
    const handle = await serve(() => {
      ran = true;
    });

    const probe = await fetch(`${handle.url}/responses`, { method: 'HEAD' });

    expect(probe.status).toBe(204);
    expect(await probe.text()).toBe('');
    // A probe asks whether the door is there. It is not a turn.
    expect(ran).toBe(false);
  });

  it('answers the readiness path with the exact documented body', async () => {
    const handle = await serve(echo);

    const probe = await fetch(`${handle.url}/readiness`);

    expect(probe.status).toBe(200);
    expect(await probe.json()).toEqual({ status: 'healthy' });
  });

  it('binds 8088 by default, and an override is honoured', async () => {
    // The default is asserted from the adapter's own declaration rather than by
    // binding it: a test that took 8088 would collide with the real thing.
    const { DEFAULT_FOUNDRY_PORT } = await import('../../src/hosting-providers.js');
    expect(DEFAULT_FOUNDRY_PORT).toBe(8088);

    const handle = await serve(echo);
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.port).not.toBe(8088);
  });
});

// ─── non-streaming ───────────────────────────────────────────────────

describe('foundryResponsesHost — a non-streaming turn', () => {
  it('parses Responses message items and answers a completed response object', async () => {
    const handle = await serve(echo);

    const response = await post(handle.url, {
      model: 'trial-model',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'LOCAL_OK' }] },
      ],
      conversation: 'conversation-1',
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(body.object).toBe('response');
    expect(body.status).toBe('completed');
    expect(body.model).toBe('trial-model');
    expect(body.conversation).toEqual({ id: 'conversation-1' });
    expect(String(body.id)).toMatch(/^resp_[0-9a-f]{32}$/);
    const output = body.output as { content: { text: string }[] }[];
    expect(output[0]?.content[0]?.text).toBe('echo:LOCAL_OK|session:conversation-1');
  });

  it('accepts input as a bare string', async () => {
    const handle = await serve(echo);

    const body = (await (await post(handle.url, { input: 'plain' })).json()) as {
      output: { content: { text: string }[] }[];
    };

    expect(body.output[0]?.content[0]?.text).toBe('echo:plain|session:none');
  });

  it('joins several user messages into one turn', async () => {
    const handle = await serve(echo);

    const body = (await (
      await post(handle.url, {
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'first' }] },
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'second' }] },
        ],
      })
    ).json()) as { output: { content: { text: string }[] }[] };

    expect(body.output[0]?.content[0]?.text).toBe('echo:first\n\nsecond|session:none');
  });
});

// ─── the streaming lifecycle ─────────────────────────────────────────

describe('foundryResponsesHost — the streaming lifecycle', () => {
  const LIFECYCLE = [
    'response.created',
    'response.in_progress',
    'response.output_item.added',
    'response.content_part.added',
    'response.output_text.delta',
    'response.output_text.done',
    'response.content_part.done',
    'response.output_item.done',
    'response.completed',
  ];

  it('is selected by body.stream, not by the Accept header', async () => {
    const handle = await serve(echo);

    // No `Accept: text/event-stream` anywhere — the body is the whole signal.
    const streamed = await post(handle.url, { input: 'hi', stream: true });
    expect(streamed.headers.get('content-type')).toMatch(/^text\/event-stream/);

    // …and the header alone does not turn a non-streaming request into one.
    const asked = await fetch(`${handle.url}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ input: 'hi' }),
    });
    expect(asked.headers.get('content-type')).toMatch(/^application\/json/);
  });

  it('emits exactly the documented event order for a successful response', async () => {
    const handle = await serve(echo);

    const events = parseSse(await (await post(handle.url, { input: 'hi', stream: true })).text());

    expect(events.map((e) => e.event)).toEqual(LIFECYCLE);
  });

  it('numbers every event monotonically from zero', async () => {
    const handle = await serve((_request, reply) => {
      reply.emit?.('one ');
      reply.emit?.('two');
      reply.complete('one two');
    });

    const events = parseSse(await (await post(handle.url, { input: 'hi', stream: true })).text());

    expect(events.map((e) => e.data.sequence_number)).toEqual(events.map((_event, index) => index));
  });

  it('carries one stable response id and one stable message id throughout', async () => {
    const handle = await serve(echo);

    const events = parseSse(await (await post(handle.url, { input: 'hi', stream: true })).text());

    const responseIds = new Set(
      events
        .map((e) => (e.data.response as { id?: string } | undefined)?.id)
        .filter((id): id is string => id !== undefined),
    );
    const messageIds = new Set(
      events.map((e) => e.data.item_id as string | undefined).filter((id) => id !== undefined),
    );
    expect(responseIds.size).toBe(1);
    expect(messageIds.size).toBe(1);
  });

  it("streams a handler's chunks as deltas and still reports the completion as the answer", async () => {
    const handle = await serve((_request, reply) => {
      reply.emit?.('par');
      reply.emit?.('tial');
      reply.complete('partial and then some');
    });

    const events = parseSse(await (await post(handle.url, { input: 'hi', stream: true })).text());
    const deltas = events.filter((e) => e.event === 'response.output_text.delta');

    // The chunks arrive as they were emitted, and the REMAINDER is sent so the
    // deltas add up to the final answer.
    expect(deltas.map((e) => e.data.delta)).toEqual(['par', 'tial', ' and then some']);
    const completed = events.at(-1);
    expect(completed?.event).toBe('response.completed');
    expect(
      (completed?.data.response as { output: { content: { text: string }[] }[] }).output[0]
        ?.content[0]?.text,
    ).toBe('partial and then some');
  });

  it('ends a failed stream with response.failed', async () => {
    const handle = await serve((_request, reply) => {
      reply.fail(new Error('refused on purpose'));
    });

    const events = parseSse(await (await post(handle.url, { input: 'hi', stream: true })).text());

    expect(events.map((e) => e.event)).toEqual([
      'response.created',
      'response.in_progress',
      'response.failed',
    ]);
    const failed = events.at(-1)?.data.response as { status: string; error: { message: string } };
    expect(failed.status).toBe('failed');
    expect(failed.error.message).toContain('refused on purpose');
  });
});

// ─── sessions ────────────────────────────────────────────────────────

describe('foundryResponsesHost — session aliases', () => {
  it.each([
    ['conversation', { conversation: 'from-conversation' }, 'from-conversation'],
    ['conversation object', { conversation: { id: 'from-object' } }, 'from-object'],
    ['agent_session_id', { agent_session_id: 'from-agent' }, 'from-agent'],
    ['session_id', { session_id: 'from-session' }, 'from-session'],
  ])('reads the session from %s', async (_label, fields, expected) => {
    const handle = await serve(echo);

    const body = (await (await post(handle.url, { input: 'x', ...fields })).json()) as {
      output: { content: { text: string }[] }[];
    };

    expect(body.output[0]?.content[0]?.text).toContain(`session:${expected}`);
  });

  it('falls back in the documented precedence order', async () => {
    const handle = await serve(echo);

    const body = (await (
      await post(handle.url, {
        input: 'x',
        conversation: 'wins',
        agent_session_id: 'second',
        session_id: 'third',
      })
    ).json()) as { output: { content: { text: string }[] }[] };

    expect(body.output[0]?.content[0]?.text).toContain('session:wins');
  });
});

// ─── what it refuses ─────────────────────────────────────────────────

describe('foundryResponsesHost — refusals', () => {
  it.each([
    ['image', { type: 'input_image', image_url: 'https://example.test/x.png' }],
    ['file', { type: 'input_file', file_id: 'file-1' }],
  ])('rejects %s input before the handler is invoked', async (_label, part) => {
    let ran = false;
    const handle = await serve(() => {
      ran = true;
    });

    const response = await post(handle.url, {
      input: [{ type: 'message', role: 'user', content: [part] }],
    });
    const body = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('unsupported_input');
    expect(ran).toBe(false);
  });

  it('rejects function-call output items before the handler is invoked', async () => {
    let ran = false;
    const handle = await serve(() => {
      ran = true;
    });

    const response = await post(handle.url, {
      input: [{ type: 'function_call_output', call_id: 'call-1', output: '{}' }],
    });

    expect(response.status).toBe(400);
    expect(ran).toBe(false);
  });

  it('rejects a non-user role', async () => {
    const handle = await serve(echo);

    const response = await post(handle.url, {
      input: [{ type: 'message', role: 'assistant', content: [{ type: 'input_text', text: 'x' }] }],
    });

    expect(response.status).toBe(400);
  });

  it('rejects empty input rather than paying for an empty turn', async () => {
    let ran = false;
    const handle = await serve(() => {
      ran = true;
    });

    const response = await post(handle.url, { input: '   ' });

    expect(response.status).toBe(400);
    expect(ran).toBe(false);
  });

  it('answers invalid JSON with a sanitized 400', async () => {
    const handle = await serve(echo);

    const response = await post(handle.url, '{not json');
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(400);
    expect(body.error.message).toContain('invalid JSON body');
  });

  it('refuses a body over the ceiling with 413 and never reads it all', async () => {
    let ran = false;
    const handle = await serve(
      () => {
        ran = true;
      },
      { maxBodyBytes: 256 },
    );

    const response = await post(handle.url, { input: 'x'.repeat(4096) });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(413);
    expect(body.error.code).toBe('ERR_REQUEST_TOO_LARGE');
    expect(ran).toBe(false);
  });

  it('answers an unknown path with 404 rather than a turn', async () => {
    const handle = await serve(echo);

    expect((await fetch(`${handle.url}/nope`)).status).toBe(404);
  });
});

// ─── terminals this dialect cannot carry ─────────────────────────────

describe('foundryResponsesHost — terminals the protocol does not carry', () => {
  it.each([
    [
      'awaiting',
      (reply: Parameters<HostHandler>[1]) =>
        reply.awaiting?.({
          sessionId: 's',
          tool: 'approve',
          question: 'may I?',
          pauseData: { question: 'may I?' },
        }),
    ],
    [
      'sessions',
      (reply: Parameters<HostHandler>[1]) => reply.sessions?.({ op: 'list', sessions: [] }),
    ],
  ])('fails explicitly rather than inventing a success shape for %s', async (_label, act) => {
    const handle = await serve((_request, reply) => {
      act(reply);
    });

    const response = await post(handle.url, { input: 'x' });
    const body = (await response.json()) as Record<string, unknown>;

    // Never a 200, and never a completed response object.
    expect(response.ok).toBe(false);
    expect(body.status).not.toBe('completed');
  });
});

// ─── the disconnect ──────────────────────────────────────────────────

describe('foundryResponsesHost — the caller hanging up', () => {
  it('aborts the HostRequest signal when the client disconnects', async () => {
    let aborted: (() => void) | undefined;
    const sawAbort = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    let signal: AbortSignal | undefined;

    // The handler parks until the abort arrives, then RESOLVES — a handler that
    // never returned would leave close() draining it forever, which is the
    // adapter behaving correctly and the test hanging.
    const handle = await serve(
      (request) =>
        new Promise<void>((done) => {
          signal = request.signal;
          request.signal?.addEventListener('abort', () => {
            aborted?.();
            done();
          });
        }),
    );

    const req = httpRequest({
      hostname: '127.0.0.1',
      port: handle.port,
      path: '/responses',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    req.on('error', () => undefined); // destroying our own socket raises here
    req.write(JSON.stringify({ input: 'x' }));
    req.end();

    // Let the request reach the handler and park there before hanging up.
    await new Promise((resolve) => setTimeout(resolve, 50));
    req.destroy();

    await sawAbort;
    expect(signal?.aborted).toBe(true);
  }, 20_000);
});

// ─── the gap this adapter closes ─────────────────────────────────────

describe('the generic host still does not speak this contract', () => {
  it('nodeHost on the same paths satisfies neither probe nor protocol', async () => {
    // The trial's gap probe, kept as a regression: if the generic host ever
    // starts answering these, this adapter has stopped being the thing that
    // added the capability and somebody has put a vendor's contract in a port.
    const handle = await nodeHost({
      port: 0,
      hostname: '127.0.0.1',
      invokePath: '/responses',
      healthPath: '/readiness',
    }).serve((request, reply) => {
      reply.complete(`echo:${request.input}`);
    });
    try {
      expect((await fetch(`${handle.url}/responses`, { method: 'HEAD' })).status).toBe(404);

      const response = await fetch(`${handle.url}/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: [
            { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'LOCAL_OK' }] },
          ],
          stream: true,
        }),
      });

      expect(response.headers.get('content-type')).toMatch(/^application\/json/);
      // The Responses input array is not its vocabulary, so the turn ran empty.
      expect(await response.json()).toEqual({ output: 'echo:' });
    } finally {
      await handle.close();
    }
  });
});

// ─── the documented composition, end to end ──────────────────────────

describe('foundryResponsesHost — the documented standingAgent composition', () => {
  it('serves a real Agent through standingAgent with sessions, over the Inspector shape', async () => {
    // The exact public API the adapter is documented with — nothing test-only
    // between the four names.
    const agent = Agent.create({ provider: mock(), model: 'mock', maxIterations: 3 })
      .system('You are terse.')
      .build();

    const handle = await standingAgent({
      agent,
      sessions: memorySessions(),
      host: foundryResponsesHost({ port: 0, hostname: '127.0.0.1' }),
    });
    open = handle as HttpHostHandle;

    const url = (handle as HttpHostHandle).url;

    // A non-streaming Inspector-shaped turn answers a completed response object.
    const first = await post(url, {
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello there' }] },
      ],
      conversation: 'inspector-session-1',
    });
    const firstBody = (await first.json()) as {
      status: string;
      conversation: { id: string };
      output: { content: { text: string }[] }[];
    };
    expect(first.status).toBe(200);
    expect(firstBody.status).toBe('completed');
    expect(firstBody.conversation).toEqual({ id: 'inspector-session-1' });
    expect(firstBody.output[0]?.content[0]?.text.length).toBeGreaterThan(0);

    // A streamed turn in the SAME conversation walks the full lifecycle — the
    // session survived the first turn, which is what `sessions` is for.
    const events = parseSse(
      await (
        await post(url, {
          input: 'and again',
          stream: true,
          conversation: 'inspector-session-1',
        })
      ).text(),
    );
    expect(events[0]?.event).toBe('response.created');
    expect(events.at(-1)?.event).toBe('response.completed');
  }, 20_000);
});
