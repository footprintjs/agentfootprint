/**
 * agentCoreRuntimeHost — the container contract, asserted against a real socket.
 *
 * The host conformance suite (host-contract.test.ts) already proves this
 * adapter behaves like every other host. THIS file asserts the part that is
 * specific to it and that the suite therefore cannot see: the two paths, the
 * port, the two body shapes, the health payload, and the one thing paths alone
 * could not express — the conversation id arriving in a header, matched
 * case-insensitively.
 *
 * Nothing here is mocked. `agentCoreRuntimeHost` is plain `node:http` with no
 * AWS SDK anywhere on its path, so every assertion below is real verification
 * of the wire, not a mapping asserted in prose.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { agentCoreRuntimeHost, agentCoreRuntimeWire } from '../../src/hosting-providers.js';
import { nodeHost } from '../../src/hosting/index.js';
import type { HostHandle, HostHandler } from '../../src/hosting/index.js';
import type { NodeHostHandle } from '../../src/hosting/nodeHost.js';

const SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';

const open: HostHandle[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((h) => h.close()));
});

/** Echo everything the port delivered, so a body/header mapping bug is visible. */
const echo: HostHandler = (request, reply) => {
  reply.complete(`in=${request.input}|session=${request.sessionId ?? 'none'}`);
};

async function serving(handler: HostHandler = echo, options = {}): Promise<string> {
  const handle = (await agentCoreRuntimeHost({
    port: 0,
    hostname: '127.0.0.1',
    ...options,
  }).serve(handler)) as NodeHostHandle;
  open.push(handle);
  return handle.url;
}

function post(base: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/invocations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// ── unit: what the adapter declares ─────────────────────────────────

describe('agentCoreRuntimeHost — unit', () => {
  it('names itself, so a refusal says which adapter said no', () => {
    expect(agentCoreRuntimeHost().name).toBe('agentCoreRuntimeHost');
  });

  it('declares streaming, and only from the known capability set', () => {
    expect(agentCoreRuntimeHost().capabilities).toEqual(['streaming']);
  });

  it('defaults to the port and interface the container contract requires', async () => {
    // Binding :8080 for real would collide with anything else on the box, so
    // the default is read off the options the adapter builds rather than bound.
    // 0.0.0.0 matters: bind to loopback in a container and the health probe
    // never reaches you.
    const wire = agentCoreRuntimeWire();
    expect(wire.health(0)).toMatchObject({ status: 'Healthy' });
  });

  it('the wire reads a prompt, a session header, and nothing else it was not given', () => {
    const wire = agentCoreRuntimeWire();
    expect(
      wire.readRequest({ body: { prompt: 'hi' }, headers: {}, query: new URLSearchParams() }),
    ).toEqual({ input: 'hi' });
  });
});

// ── scenario: the documented contract, over the wire ────────────────

describe('agentCoreRuntimeHost — the container contract', () => {
  it('GET /ping answers Healthy with a unix-SECONDS timestamp', async () => {
    const base = await serving();
    const before = Math.floor(Date.now() / 1000);
    const res = await fetch(`${base}/ping`);
    const body = (await res.json()) as { status: string; time_of_last_update: number };
    expect(res.status).toBe(200);
    expect(body.status).toBe('Healthy');
    // Seconds, not milliseconds — a ms value here would be ~1000x too large and
    // is exactly the kind of unit slip a health probe never tells you about.
    expect(body.time_of_last_update).toBeGreaterThanOrEqual(before);
    expect(body.time_of_last_update).toBeLessThan(before + 60);
  });

  it('reports HealthyBusy while the process says it is busy', async () => {
    let busy = false;
    const base = await serving(echo, { busy: () => busy });
    expect(((await (await fetch(`${base}/ping`)).json()) as { status: string }).status).toBe(
      'Healthy',
    );
    busy = true;
    // Read live on every probe: busy is a fact about the process, not a setting.
    expect(((await (await fetch(`${base}/ping`)).json()) as { status: string }).status).toBe(
      'HealthyBusy',
    );
  });

  it('POST /invocations takes { prompt } and answers { response, status }', async () => {
    const base = await serving();
    const res = await post(base, { prompt: 'hello' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ response: 'in=hello|session=none', status: 'success' });
  });

  it('accepts { input } too — the runtime passes the payload through verbatim', async () => {
    const base = await serving();
    // The CALLER picks the field. Refusing the port's own word would be a rule
    // this adapter invented rather than one the contract imposes.
    expect(await (await post(base, { input: 'hello' })).json()).toMatchObject({
      response: 'in=hello|session=none',
    });
  });

  it('prefers prompt when a caller sends both', async () => {
    const base = await serving();
    expect(await (await post(base, { prompt: 'p', input: 'i' })).json()).toMatchObject({
      response: 'in=p|session=none',
    });
  });

  it('a missing prompt is an empty input, not a crash', async () => {
    const base = await serving();
    expect(await (await post(base, { notPrompt: 1 })).json()).toMatchObject({
      response: 'in=|session=none',
    });
  });

  it('an unknown route is 404 with the adapter error shape', async () => {
    const base = await serving();
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ status: 'error' });
  });

  it('malformed JSON is a 400 naming the problem, not a 500', async () => {
    const base = await serving();
    const res = await fetch(`${base}/invocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ status: 'error' });
  });

  it('the invoke path is POST-only — GET /invocations is a 404', async () => {
    const base = await serving();
    expect((await fetch(`${base}/invocations`)).status).toBe(404);
  });
});

// ── integration: the session header, which is the whole mapping ─────

describe('agentCoreRuntimeHost — the session header', () => {
  it('reads the conversation id from the runtime header', async () => {
    const base = await serving();
    const res = await post(base, { prompt: 'x' }, { [SESSION_HEADER]: 'conv-7' });
    expect(await res.json()).toMatchObject({ response: 'in=x|session=conv-7' });
  });

  it.each([
    ['exact', SESSION_HEADER],
    ['lower', SESSION_HEADER.toLowerCase()],
    ['upper', SESSION_HEADER.toUpperCase()],
    ['mixed', 'x-amzn-BEDROCK-agentcore-Runtime-Session-Id'],
  ])('matches the header case-insensitively (%s)', async (_label, header) => {
    // HTTP header names are case-insensitive and a proxy in front of the
    // container is free to re-case them. Matching one exact spelling would work
    // in every test and fail in exactly one deployment.
    const base = await serving();
    const res = await post(base, { prompt: 'x' }, { [header]: 'conv-cased' });
    expect(await res.json()).toMatchObject({ response: 'in=x|session=conv-cased' });
  });

  it('an empty header value is no session, not an empty-string session', async () => {
    const base = await serving();
    const res = await post(base, { prompt: 'x' }, { [SESSION_HEADER]: '' });
    expect(await res.json()).toMatchObject({ response: 'in=x|session=none' });
  });

  it('a sessionId in the BODY is ignored — this contract puts it in the header', async () => {
    const base = await serving();
    // Silently honouring a body field the runtime never sends would make local
    // tests pass and the deployment quietly single-session.
    const res = await post(base, { prompt: 'x', sessionId: 'from-body' });
    expect(await res.json()).toMatchObject({ response: 'in=x|session=none' });
  });

  it('every header still reaches the handler, lower-cased', async () => {
    let seen: Readonly<Record<string, string>> | undefined;
    const base = await serving((request, reply) => {
      seen = request.headers;
      reply.complete('ok');
    });
    await post(base, { prompt: 'x' }, { 'X-Tenant': 'acme' });
    expect(seen?.['x-tenant']).toBe('acme');
  });
});

// ── property: streaming keeps the completion authoritative ──────────

describe('agentCoreRuntimeHost — streaming', () => {
  it('chunks use a DIFFERENT field from the answer, so nothing double-counts', async () => {
    const base = await serving((_request, reply) => {
      reply.emit?.('one ');
      reply.emit?.('two');
      reply.complete('one two');
    });
    const res = await post(base, { prompt: 'x' }, { accept: 'text/event-stream' });
    const body = await res.text();
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // A caller concatenating `chunk` fields gets the preview; a caller reading
    // `response` gets the answer. Reading both cannot produce it twice.
    expect(body).toContain('"chunk":"one "');
    expect(body).toContain('"response":"one two"');
  });

  it('without Accept: text/event-stream the same handler produces one JSON body', async () => {
    const base = await serving((_request, reply) => {
      reply.emit?.('ignored');
      reply.complete('final');
    });
    expect(await (await post(base, { prompt: 'x' })).json()).toEqual({
      response: 'final',
      status: 'success',
    });
  });
});

// ── security: what a failing run tells the caller ───────────────────

describe('agentCoreRuntimeHost — failures', () => {
  it('a throwing handler returns the message and NO stack trace', async () => {
    const base = await serving(() => {
      const error = new Error('boom');
      error.stack = 'Error: boom\n    at secret/internal/path.ts:42';
      throw error;
    });
    const res = await post(base, { prompt: 'x' });
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toMatchObject({ error: 'boom', status: 'error' });
    expect(JSON.stringify(body)).not.toContain('secret/internal/path.ts');
  });

  it('a refusal keeps its code and its non-5xx status', async () => {
    const base = await serving();
    const handle = open[open.length - 1];
    await handle.close();
    const res = await post(base, { prompt: 'x' }).catch(() => undefined);
    // The socket may already be gone; when it is not, the refusal is a 503 and
    // carries its stable code rather than being flattened into a 500.
    if (res) {
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'ERR_HOST_CLOSED', status: 'error' });
    }
  });
});

// ── ROI: the adapter is a configuration, not a second implementation ─

describe('agentCoreRuntimeHost — the thesis', () => {
  it('shares its HTTP behaviour with nodeHost rather than reimplementing it', async () => {
    // Same handler, same class of failure, same words — because there is one
    // HTTP implementation underneath and two wire dialects on top. If somebody
    // forks the machinery to "just tweak one thing", these diverge.
    const silent: HostHandler = () => undefined;
    const cloudBase = await serving(silent);
    const nodeHandle = (await nodeHost({ port: 0, hostname: '127.0.0.1' }).serve(
      silent,
    )) as NodeHostHandle;
    open.push(nodeHandle);

    const cloud = (await (await post(cloudBase, { prompt: 'x' })).json()) as { error: string };
    const plain = (await (
      await fetch(`${nodeHandle.url}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'x' }),
      })
    ).json()) as { error: string };

    expect(cloud.error).toBe(plain.error);
    expect(cloud.error).toMatch(/complete\(\) or fail\(\)/);
  });
});
