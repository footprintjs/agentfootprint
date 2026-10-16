/**
 * A REQUEST'S OWN CREDENTIAL, THROUGH A HOSTED RUN — `sealRequest` on
 * `streamHandler` and `standingAgent` (served by `nodeHost`, `httpHost` or any
 * host that delivers headers).
 *
 * The app seals the credential a request carries (`requestContext`); the host
 * hands the handle to THAT request's run and nowhere else; a
 * `requestCredentials` provider vends it to the one tool that declares it.
 *
 * Pinned:
 *   - the credential reaches the tool and never a frame, a reply, a stored
 *     session or a checkpoint — two callers at once each get their own;
 *   - a resume is served the RESUMING request's credential, never the one the
 *     run paused under;
 *   - none sealed → the tool fails closed, by name, and nothing is borrowed;
 *   - a sealer that throws refuses the request in fixed words (400), one that
 *     hands back a handle twice or a plain object is refused, and a request
 *     refused for any other reason is never sealed.
 */

import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { askHuman } from '../../src/core/pause.js';
import { requestContext, requestCredentials } from '../../src/identity.js';
import type { RequestContext } from '../../src/identity/requestContext.js';
import { memorySessions } from '../../src/hosting/memorySessions.js';
import { nodeHost } from '../../src/hosting/nodeHost.js';
import { standingAgent } from '../../src/hosting/standingAgent.js';
import { streamHandler } from '../../src/hosting/streamHandler.js';
import type { RequestSealer } from '../../src/hosting/requestSealing.js';
import type { CheckpointEnvelope, HostHandle, SessionLifecycle } from '../../src/hosting/types.js';
import { agUi } from '../../src/ag-ui/adapter.js';
import {
  crm,
  gatewayEnvelope,
  gatewayReader,
  post,
  serve,
} from '../../examples/deploy/ag-ui-gateway.js';
import { inProcessHost } from './testHost.js';

const TOKEN = (who: string) => `crm-token-${who}-zq7`;

/** A session store that keeps every envelope it was handed, as bytes. */
function keptSessions(): SessionLifecycle & { readonly bytes: () => string } {
  const inner = memorySessions();
  const written: string[] = [];
  return {
    bytes: () => written.join('\n'),
    hydrate: (id) => inner.hydrate(id),
    async persist(id, envelope: CheckpointEnvelope) {
      written.push(JSON.stringify(envelope));
      await inner.persist(id, envelope);
    },
  };
}

/** The CRM tool: declares the `crm` credential, sends it, never returns it. */
const seenByCrm: string[] = [];
const crmLookup = defineTool({
  name: 'crm_lookup',
  description: 'Look an account up.',
  inputSchema: { type: 'object', properties: {} },
  needs: { credential: 'crm' },
  execute: async (_args, ctx) => {
    const token = ctx.credential!.toHeaders().authorization?.replace(/^Bearer /, '') ?? '';
    seenByCrm.push(token);
    return 'Acme: active';
  },
});
const approve = defineTool({
  name: 'approve',
  description: 'Ask a person to approve.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => askHuman({ question: 'Look Acme up?' }),
});
const credentials = requestCredentials({ services: { crm: 'crmToken' } });

/** The sealer an app writes: the `x-crm-token` header, when the request carries one. */
const fromHeader: RequestSealer = ({ headers }) =>
  headers['x-crm-token'] === undefined
    ? undefined
    : requestContext({ secrets: { crmToken: headers['x-crm-token'] } });

afterEach(() => {
  seenByCrm.length = 0;
});

describe('streamHandler — sealRequest', () => {
  const lookupAgent = () =>
    Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [
          { content: '', toolCalls: [{ id: 'c1', name: 'crm_lookup', args: {} }] },
          'Done.',
        ],
      }),
      model: 'm',
      credentials,
    })
      .system('s')
      .tool(crmLookup)
      .build();
  const byUser = {
    bind: ({
      conversation,
      headers,
    }: {
      conversation: string;
      headers: Record<string, string>;
    }) => ({
      sessionId: `${headers['x-user']}:${conversation}`,
      identity: { principal: headers['x-user'] ?? 'nobody', conversationId: conversation },
    }),
  };
  const send = (
    handle: (r: Request) => Promise<Response>,
    body: unknown,
    headers: Record<string, string>,
  ) =>
    handle(
      new Request('http://localhost/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    ).then(async (r) => ({ status: r.status, wire: await r.text() }));

  it('the example: two callers at once, each tool call with its own credential, none on the wire', async () => {
    crm.calls.length = 0;
    const handler = serve(() =>
      mock({
        chunkDelayMs: 0,
        replies: [
          { content: '', toolCalls: [{ id: 'c1', name: 'crm_lookup', args: { name: 'Acme' } }] },
          'Active.',
        ],
      }),
    );
    const [ada, bo] = await Promise.all([
      post(handler, 'ada', { conversationId: 'c', requestId: 'r-1', text: 'Acme?' }),
      post(handler, 'bo', { conversationId: 'c', requestId: 'r-2', text: 'Acme?' }),
    ]);
    expect([...crm.calls].sort()).toEqual(['crm-token-ada', 'crm-token-bo']);
    for (const out of [ada, bo]) {
      expect(out.status).toBe(200);
      expect(out.wire).not.toContain('crm-token-');
    }
  });

  it('the credential reaches the tool and never the wire nor the stored session', async () => {
    const sessions = keptSessions();
    const handle = streamHandler({
      agent: lookupAgent,
      adapter: agUi({ reader: gatewayReader, framing: gatewayEnvelope }),
      threads: byUser,
      sessions,
      sealRequest: fromHeader,
      heartbeatMs: 0,
    });
    const out = await send(
      handle,
      { conversationId: 'c', requestId: 'r-1', text: 'Acme?' },
      { 'x-user': 'alice', 'x-crm-token': TOKEN('alice') },
    );
    expect(out.status).toBe(200);
    expect(seenByCrm).toEqual([TOKEN('alice')]);
    expect(out.wire).toContain('Acme: active');
    expect(out.wire).not.toContain(TOKEN('alice'));
    expect(sessions.bytes()).not.toBe('');
    expect(sessions.bytes()).not.toContain(TOKEN('alice'));
  });

  it('a resume is served the RESUMING request’s credential — never the one the run paused under', async () => {
    const scripts: unknown[][] = [
      [{ content: '', toolCalls: [{ id: 'p1', name: 'approve', args: {} }] }],
      [{ content: '', toolCalls: [{ id: 'c1', name: 'crm_lookup', args: {} }] }, 'Done.'],
    ];
    const sessions = keptSessions();
    const handle = streamHandler({
      agent: () =>
        Agent.create({
          provider: mock({ chunkDelayMs: 0, replies: scripts.shift() as never }),
          model: 'm',
          credentials,
        })
          .system('s')
          .tools([approve, crmLookup])
          .build(),
      adapter: agUi({ reader: gatewayReader, framing: gatewayEnvelope }),
      threads: byUser,
      sessions,
      sealRequest: fromHeader,
      heartbeatMs: 0,
    });
    const first = await send(
      handle,
      { conversationId: 'c', requestId: 'r-1', text: 'Acme?' },
      { 'x-user': 'alice', 'x-crm-token': TOKEN('first') },
    );
    const finished = JSON.parse(first.wire.trim().split('\n\n').at(-1)!.slice('data: '.length)) as {
      event: { outcome: { interrupts: { id: string }[] } };
    };
    const second = await send(
      handle,
      {
        conversationId: 'c',
        requestId: 'r-2',
        answer: { interruptId: finished.event.outcome.interrupts[0]!.id, value: 'yes' },
      },
      { 'x-user': 'alice', 'x-crm-token': TOKEN('second') },
    );
    expect(second.status).toBe(200);
    expect(seenByCrm).toEqual([TOKEN('second')]);
    for (const wire of [first.wire, second.wire]) {
      expect(wire).not.toContain(TOKEN('first'));
      expect(wire).not.toContain(TOKEN('second'));
    }
    expect(sessions.bytes()).not.toContain('crm-token-');
  });

  it('a request that carries none: the tool fails closed by name, nothing borrowed', async () => {
    const handle = streamHandler({
      agent: lookupAgent,
      adapter: agUi({ reader: gatewayReader, framing: gatewayEnvelope }),
      threads: byUser,
      sessions: memorySessions(),
      sealRequest: fromHeader,
      heartbeatMs: 0,
    });
    // One caller with a credential first — the next caller must not get it.
    await send(
      handle,
      { conversationId: 'c', requestId: 'r-1', text: 'Acme?' },
      { 'x-user': 'alice', 'x-crm-token': TOKEN('alice') },
    );
    const out = await send(
      handle,
      { conversationId: 'c', requestId: 'r-2', text: 'Acme?' },
      { 'x-user': 'bob' },
    );
    expect(out.status).toBe(200);
    expect(seenByCrm).toEqual([TOKEN('alice')]); // bob's call never reached the CRM
    expect(out.wire).toContain('The tool failed.');
    expect(out.wire).not.toContain(TOKEN('alice'));
  });

  it('a sealer that throws refuses the request in fixed words; a reused handle or a plain object is refused', async () => {
    let builds = 0;
    const agent = () => {
      builds += 1;
      return lookupAgent();
    };
    const body = { conversationId: 'c', requestId: 'r-1', text: 'Acme?' };
    const thrower = streamHandler({
      agent,
      adapter: agUi({ reader: gatewayReader }),
      sealRequest: () => {
        throw new Error(`could not decrypt ${TOKEN('leak')}`);
      },
      heartbeatMs: 0,
    });
    const refused = await send(thrower, body, {});
    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.wire)).toMatchObject({ code: 'ERR_REQUEST_NOT_SEALED' });
    expect(refused.wire).not.toContain(TOKEN('leak'));

    // `requestContext` itself refuses a missing value — the request is refused, not the process.
    const missing = streamHandler({
      agent,
      adapter: agUi({ reader: gatewayReader }),
      sealRequest: ({ headers }) =>
        requestContext({ secrets: { crmToken: headers['x-crm-token'] as string } }),
      heartbeatMs: 0,
    });
    expect((await send(missing, body, {})).status).toBe(400);

    const cached = requestContext({ secrets: { crmToken: TOKEN('cached') } });
    const reusing = streamHandler({
      agent,
      adapter: agUi({ reader: gatewayReader }),
      sealRequest: () => cached,
      heartbeatMs: 0,
    });
    expect((await send(reusing, body, {})).status).toBe(200);
    const again = await send(reusing, { ...body, requestId: 'r-2' }, {});
    expect(again.status).toBe(500);
    expect(again.wire).not.toContain(TOKEN('cached'));

    const plain = streamHandler({
      agent,
      adapter: agUi({ reader: gatewayReader }),
      sealRequest: () => ({ crmToken: TOKEN('plain') } as unknown as RequestContext),
      heartbeatMs: 0,
    });
    const refusedPlain = await send(plain, body, {});
    expect(refusedPlain.status).toBe(500);
    expect(refusedPlain.wire).not.toContain(TOKEN('plain'));
    // Only the one request that was sealed ran.
    expect(builds).toBe(1);

    expect(() =>
      streamHandler({
        agent,
        adapter: agUi(),
        sealRequest: 'x-crm-token' as never,
      }),
    ).toThrow(/sealRequest must be a function/);
  });

  it('a request refused for any other reason is never sealed', async () => {
    let sealed = 0;
    const handle = streamHandler({
      agent: lookupAgent,
      adapter: agUi({ reader: gatewayReader }),
      threads: byUser,
      sessions: memorySessions(),
      sealRequest: (facts) => {
        sealed += 1;
        return fromHeader(facts);
      },
      heartbeatMs: 0,
    });
    const answerToNothing = await send(
      handle,
      { conversationId: 'c', requestId: 'r-1', answer: { interruptId: 'x', value: 'yes' } },
      { 'x-user': 'alice', 'x-crm-token': TOKEN('alice') },
    );
    expect(answerToNothing.status).toBe(409);
    const badId = await send(
      handle,
      { conversationId: '../x', requestId: 'r-2', text: 'hi' },
      { 'x-user': 'alice', 'x-crm-token': TOKEN('alice') },
    );
    expect(badId.status).toBe(400);
    expect(sealed).toBe(0);
  });
});

describe('standingAgent — sealRequest (any host that delivers headers)', () => {
  const opened: HostHandle[] = [];
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((h) => h.close()));
  });

  const lookupAgent = (extra: unknown[] = []) =>
    Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [
          ...(extra as never[]),
          { content: '', toolCalls: [{ id: 'c1', name: 'crm_lookup', args: {} }] },
          'Acme is active.',
        ],
      }),
      model: 'm',
      credentials,
    })
      .system('s')
      .tools([approve, crmLookup])
      .build();

  it('in process: the credential reaches the tool, never the reply or the stored session', async () => {
    const host = inProcessHost();
    const sessions = keptSessions();
    opened.push(
      await standingAgent({ agent: lookupAgent(), sessions, host, sealRequest: fromHeader }),
    );
    const out = await host.deliver({
      input: 'Acme?',
      sessionId: 'c-1',
      headers: { 'x-crm-token': TOKEN('alice') },
    });
    expect(out.output).toBe('Acme is active.');
    expect(seenByCrm).toEqual([TOKEN('alice')]);
    expect(JSON.stringify(out)).not.toContain(TOKEN('alice'));
    expect(sessions.bytes()).not.toBe('');
    expect(sessions.bytes()).not.toContain(TOKEN('alice'));
  });

  it('a resume is served the resuming request’s credential', async () => {
    const host = inProcessHost();
    const sessions = keptSessions();
    opened.push(
      await standingAgent({
        agent: lookupAgent([{ content: '', toolCalls: [{ id: 'p1', name: 'approve', args: {} }] }]),
        sessions,
        host,
        sealRequest: fromHeader,
      }),
    );
    const paused = await host.deliver({
      input: 'Acme?',
      sessionId: 'c-2',
      headers: { 'x-crm-token': TOKEN('first') },
    });
    expect(paused.awaiting).toBeDefined();
    const resumed = await host.deliver({
      input: '',
      sessionId: 'c-2',
      decision: 'yes',
      headers: { 'x-crm-token': TOKEN('second') },
    });
    expect(resumed.output).toBe('Acme is active.');
    expect(seenByCrm).toEqual([TOKEN('second')]);
    expect(sessions.bytes()).not.toContain('crm-token-');
  });

  it('never sealed for a refused request; a sealer that throws refuses in fixed words', async () => {
    const host = inProcessHost();
    let sealed = 0;
    opened.push(
      await standingAgent({
        agent: lookupAgent(),
        sessions: memorySessions(),
        host,
        sealRequest: (facts) => {
          sealed += 1;
          if (facts.headers['x-crm-token'] === 'explode') throw new Error(`bad ${TOKEN('leak')}`);
          return fromHeader(facts);
        },
      }),
    );
    const noPending = await host.deliver({ input: '', sessionId: 'c-3', decision: 'yes' });
    expect(noPending.code).toBe('ERR_NO_PENDING_ASK');
    expect(sealed).toBe(0);
    const exploded = await host.deliver({
      input: 'Acme?',
      sessionId: 'c-4',
      headers: { 'x-crm-token': 'explode' },
    });
    expect(exploded.code).toBe('ERR_REQUEST_NOT_SEALED');
    expect(exploded.error).not.toContain(TOKEN('leak'));
    expect(seenByCrm).toEqual([]);
  });

  it('over nodeHost (real HTTP): sealed per request, refused with a 400, never in a reply', async () => {
    const handle = await standingAgent({
      agent: lookupAgent(),
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
      sealRequest: ({ headers }) =>
        requestContext({ secrets: { crmToken: headers['x-crm-token'] as string } }),
    });
    opened.push(handle);
    const port = (handle as unknown as { port: number }).port;
    const ok = await raw(
      port,
      { input: 'Acme?', sessionId: 'n-1' },
      { 'x-crm-token': TOKEN('node') },
    );
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ output: 'Acme is active.' });
    expect(seenByCrm).toEqual([TOKEN('node')]);
    expect(ok.body).not.toContain(TOKEN('node'));
    // No header → requestContext refuses an empty value → the request is refused, fixed words.
    const missing = await raw(port, { input: 'Acme?', sessionId: 'n-2' }, {});
    expect(missing.status).toBe(400);
    expect(JSON.parse(missing.body)).toMatchObject({ code: 'ERR_REQUEST_NOT_SEALED' });
  });
});

function raw(
  port: number,
  body: unknown,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/invoke',
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}
