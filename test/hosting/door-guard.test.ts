/**
 * The door guard (9.115.0) — cross-site requests, DNS rebinding and the
 * session-id bound, at every door the library ships.
 * 7-pattern tests (unit · scenario · integration · property · security ·
 * performance · ROI), every door case over a REAL socket.
 *
 * ── The finding these exist for ─────────────────────────────────────────────
 * A security review (2026-09-25) read the door and found three live holes on a
 * deployment with no verifier behind a company VPN — where being able to reach
 * the port IS the authority:
 *
 *   • BLIND CSRF — `httpHost` parsed any body as JSON whatever its
 *     content-type, so a page anybody opens could send a cross-site "simple"
 *     request (`text/plain`, no preflight) and RUN A TURN: model budget spent,
 *     tools called, a conversation stored.
 *   • DNS REBINDING — nothing checked `Host`, the default bind is `0.0.0.0`, so
 *     a page whose own name re-resolves to the app's address becomes
 *     same-origin with it and can READ the answers.
 *   • WEBSOCKET — nothing checked `Origin` on the handshake, and a WebSocket is
 *     not bound by the same-origin policy at all.
 *
 * A later privacy review added a fourth: a caller with no credentials could
 * hand the door a megabytes-long session id, which then rode every exported
 * span of the turn.
 *
 * The laws being pinned:
 *   • A state-changing request that does not say `content-type:
 *     application/json` never reaches a handler — no model call, no store
 *     write. 415.
 *   • A foreign `Origin` (including `null`) is refused at the request door AND
 *     on the WebSocket handshake, before the 101. 403. So is a request the
 *     browser marked `Sec-Fetch-Site: cross-site` whose Origin is not listed —
 *     the catch for a proxy that strips `Origin`.
 *   • With `allowedHosts`, a Host this door was not configured for is refused.
 *     421. Unset, ONE boot warning names the risk and the option.
 *   • A session id over {@link MAX_SESSION_ID_LENGTH}, or carrying a control
 *     character, is refused at both doors. 400.
 *   • Every one of those lands in the ingress record, and none of them — body,
 *     record or message — carries a credential or the session id.
 *   • Everything the field's own client sends still works, byte for byte.
 */

import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { LLMProvider } from '../../src/adapters/types.js';
import { agentCoreRuntimeHost, foundryResponsesHost } from '../../src/hosting-providers.js';
import {
  checkSessionId,
  DEFAULT_NODE_MAX_BODY_BYTES,
  doorGuard,
  HostNotAllowedError,
  httpHost,
  InvalidSessionIdError,
  jsonWire,
  MAX_SESSION_ID_LENGTH,
  memorySessions,
  nodeHost,
  OriginNotAllowedError,
  standingAgent,
  UnsupportedMediaTypeError,
} from '../../src/hosting/index.js';
import { isLoopbackBind, loopbackAllowedHosts } from '../../src/hosting/doorGuard.js';
import type {
  CrossSiteOptions,
  HostHandle,
  HostRefusal,
  HttpHostHandle,
  IngressRecord,
} from '../../src/hosting/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────

/** A credential this suite refuses to ever see printed. */
const SECRET = 'ey-door-bearer-7c1e-DO-NOT-PRINT';
/** The attacker's page. */
const EVIL = 'https://evil.example';

const open: HostHandle[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((handle) => handle.close()));
  vi.restoreAllMocks();
});

/** A provider that counts every model call it is asked to make. */
function countingProvider(): { provider: LLMProvider; calls: () => number } {
  const inner = mock({ reply: 'answered' });
  let calls = 0;
  const provider: LLMProvider = {
    name: inner.name,
    complete(req) {
      calls += 1;
      return inner.complete(req);
    },
    async *stream(req) {
      calls += 1;
      yield* inner.stream(req);
    },
  };
  return { provider, calls: () => calls };
}

/**
 * A standing agent on a REAL socket, with the ingress record on and a model
 * that counts its calls — so "never reached a handler" is measured, not
 * assumed.
 */
async function door(
  guard: CrossSiteOptions = {},
  bind = '127.0.0.1',
): Promise<{
  port: number;
  url: string;
  records: IngressRecord[];
  calls: () => number;
}> {
  const { provider, calls } = countingProvider();
  const records: IngressRecord[] = [];
  const handle = await standingAgent({
    agent: Agent.create({ provider, model: 'm' }).build(),
    sessions: memorySessions(),
    host: nodeHost({ port: 0, hostname: bind, ...guard }),
    onIngressDecision: (record) => records.push(record),
  });
  open.push(handle);
  return { port: handle.port, url: handle.url, records, calls };
}

interface RawReply {
  readonly status: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** One request, with every header under the test's control — `Host` included. */
function send(
  port: number,
  init: {
    readonly method?: string;
    readonly path?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  } = {},
): Promise<RawReply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: init.method ?? 'POST',
        path: init.path ?? '/invoke',
        headers: { ...init.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          }),
        );
      },
    );
    req.on('error', reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

/** What the field's own browser client sends on every call (be-server/web · `headers`). */
const fieldClient = (port: number, extra: Record<string, string> = {}) => ({
  'content-type': 'application/json',
  'x-session-id': 'c-field-1',
  origin: `http://127.0.0.1:${port}`,
  ...extra,
});

const turn = (input = 'hello') => JSON.stringify({ input });

/**
 * One raw WebSocket handshake — every header, `Host` included, under the test's
 * control. Resolves with the status line and whatever the door wrote before it
 * closed (a refusal) or the head alone (a 101, after which the socket is dropped).
 */
function handshake(
  port: number,
  init: {
    readonly path?: string;
    readonly host?: string;
    readonly headers?: Readonly<Record<string, string>>;
  } = {},
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let received = Buffer.alloc(0);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const text = received.toString('utf8');
      resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(text)?.[1] ?? 0), text });
    };
    socket.on('error', (err) => (settled ? undefined : reject(err)));
    socket.on('data', (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (received.toString('utf8').startsWith('HTTP/1.1 101') && received.includes('\r\n\r\n')) {
        finish();
        socket.destroy();
      }
    });
    socket.on('close', finish);
    socket.on('connect', () => {
      const lines = [
        `GET ${init.path ?? '/conversation'} HTTP/1.1`,
        `Host: ${init.host ?? `127.0.0.1:${port}`}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        ...Object.entries(init.headers ?? {}).map(([name, value]) => `${name}: ${value}`),
      ];
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
  });
}

/** A conversation door on nodeHost, with a handler that counts what reached it. */
async function conversationDoor(
  guard: CrossSiteOptions = {},
  bind = '127.0.0.1',
): Promise<{
  port: number;
  reached: () => number;
  refusals: HostRefusal[];
}> {
  const host = nodeHost({ port: 0, hostname: bind, ...guard });
  const refusals: HostRefusal[] = [];
  host.onRefusal?.((refusal) => refusals.push(refusal));
  let reached = 0;
  const handle = await host.serveConversations((conversation) => {
    reached += 1;
    conversation.close('done');
  });
  open.push(handle);
  return { port: handle.port, reached: () => reached, refusals };
}

// ─── 1. SECURITY — THE CRITICAL PIN: a cross-site request never runs a turn

describe('a cross-site request never reaches the agent — security', () => {
  it('refuses the blind-CSRF shape (text/plain, JSON body, foreign Origin) with no model call', async () => {
    const { port, records, calls } = await door();
    // What `fetch(url, { method: 'POST', mode: 'no-cors', body })` sends from
    // any page: a CORS-safelisted content type, so the browser never preflights.
    const reply = await send(port, {
      headers: { 'content-type': 'text/plain;charset=UTF-8', origin: EVIL },
      body: turn('spend the budget'),
    });
    expect(reply.status).toBe(403);
    expect(JSON.parse(reply.body)).toMatchObject({ code: 'ERR_ORIGIN_NOT_ALLOWED' });
    expect(calls()).toBe(0);
    expect(records).toEqual([
      expect.objectContaining({
        door: 'request',
        outcome: 'cross-site-refused',
        errorCode: 'ERR_ORIGIN_NOT_ALLOWED',
        errorName: 'OriginNotAllowedError',
        bearerPresent: false,
      }),
    ]);
  });

  it('refuses the same body with NO Origin on content type alone (415), no model call', async () => {
    // The content-type layer stands on its own: a proxy that strips Origin, a
    // page allowed by `allowedOrigins` that was taken over — the body still
    // has to say it is JSON.
    const { port, records, calls } = await door();
    const reply = await send(port, {
      headers: { 'content-type': 'text/plain' },
      body: turn(),
    });
    expect(reply.status).toBe(415);
    expect(JSON.parse(reply.body)).toMatchObject({ code: 'ERR_UNSUPPORTED_MEDIA_TYPE' });
    expect(calls()).toBe(0);
    expect(records.map((r) => [r.outcome, r.errorCode])).toEqual([
      ['cross-site-refused', 'ERR_UNSUPPORTED_MEDIA_TYPE'],
    ]);
  });

  it('refuses a form-urlencoded POST (the <form> shape) with 415', async () => {
    const { port, calls } = await door();
    const reply = await send(port, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'input=hello',
    });
    expect(reply.status).toBe(415);
    expect(calls()).toBe(0);
  });

  it('refuses a multipart POST and a POST with no content-type at all (the bodiless-POST bypass)', async () => {
    const { port, calls } = await door();
    const multipart = await send(port, {
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      body: '--x\r\n\r\n{"input":"x"}\r\n--x--',
    });
    // A Blob body with an empty type sends NO content-type header at all —
    // a simple request carrying a JSON body the old reader would have parsed.
    const untyped = await send(port, { body: turn() });
    expect([multipart.status, untyped.status]).toEqual([415, 415]);
    expect(calls()).toBe(0);
  });

  it('refuses `Origin: null` — an opaque origin any sandboxed frame can send', async () => {
    const { port, calls } = await door();
    const reply = await send(port, {
      headers: { 'content-type': 'application/json', origin: 'null' },
      body: turn(),
    });
    expect(reply.status).toBe(403);
    expect(calls()).toBe(0);
  });

  it('refuses a JSON POST from a foreign Origin too (defence in depth behind the preflight)', async () => {
    const { port, calls } = await door();
    const reply = await send(port, {
      headers: { 'content-type': 'application/json', origin: EVIL },
      body: turn(),
    });
    expect(reply.status).toBe(403);
    expect(calls()).toBe(0);
  });

  it('refuses a request the browser marked cross-site even when a proxy stripped its Origin (403)', async () => {
    // Fetch metadata as defence in depth: `Origin` is gone, but the browser's
    // own `Sec-Fetch-Site` rode through, and no page can forge either header.
    const { port, records, calls } = await door();
    const reply = await send(port, {
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: turn(),
    });
    expect(reply.status).toBe(403);
    const body = JSON.parse(reply.body) as { error: string; code: string };
    expect(body.code).toBe('ERR_ORIGIN_NOT_ALLOWED');
    // The operator is told what to fix when it is their own page.
    expect(body.error).toMatch(/forward Origin and Sec-Fetch-\* unchanged/);
    expect(calls()).toBe(0);
    expect(records.map((r) => r.errorCode)).toEqual(['ERR_ORIGIN_NOT_ALLOWED']);
  });

  it('serves a cross-site request whose Origin the deployment LISTED — another site, by design', async () => {
    const { port, calls } = await door({ allowedOrigins: ['https://portal.partner.example'] });
    const listed = await send(port, {
      headers: {
        'content-type': 'application/json',
        origin: 'https://portal.partner.example',
        'sec-fetch-site': 'cross-site',
      },
      body: turn(),
    });
    const stripped = await send(port, {
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: turn(),
    });
    expect([listed.status, stripped.status]).toEqual([200, 403]);
    expect(calls()).toBe(1);
  });

  it('refuses a rebinding-shaped request (Host = the attacker name) once allowedHosts is set, 421', async () => {
    const { port, records, calls } = await door({ allowedHosts: ['127.0.0.1'] });
    // DNS rebinding: the page's own name now resolves here, so Origin and Host
    // BOTH name the attacker and agree with each other.
    const reply = await send(port, {
      headers: {
        host: `rebind.evil.example:${port}`,
        origin: `http://rebind.evil.example:${port}`,
        'content-type': 'application/json',
      },
      body: turn('read me the answers'),
    });
    expect(reply.status).toBe(421);
    expect(JSON.parse(reply.body)).toMatchObject({ code: 'ERR_HOST_NOT_ALLOWED' });
    expect(calls()).toBe(0);
    expect(records.map((r) => [r.door, r.outcome, r.errorCode])).toEqual([
      ['request', 'cross-site-refused', 'ERR_HOST_NOT_ALLOWED'],
    ]);
  });

  it('refuses a rebinding request whose page ALSO sets X-Forwarded-Host to a listed name — Host alone decides (421)', async () => {
    // After rebinding the page is same-origin and may set any non-forbidden
    // header, X-Forwarded-Host included. `allowedHosts` must never read it.
    const { port, calls } = await door({ allowedHosts: ['neo.corp.example'] }, '0.0.0.0');
    const reply = await send(port, {
      headers: {
        host: 'rebind.evil.example',
        'x-forwarded-host': 'neo.corp.example',
        origin: 'http://rebind.evil.example',
        'content-type': 'application/json',
      },
      body: turn(),
    });
    expect(reply.status).toBe(421);
    expect(calls()).toBe(0);
  });

  it('a LOOPBACK bind refuses the rebinding shape by default — the loopback names are its only names (421)', async () => {
    const { port, calls, records } = await door();
    const reply = await send(port, {
      headers: {
        host: `rebind.evil.example:${port}`,
        origin: `http://rebind.evil.example:${port}`,
        'content-type': 'application/json',
      },
      body: turn('read me the answers'),
    });
    expect(reply.status).toBe(421);
    expect(calls()).toBe(0);
    expect(records.map((r) => r.errorCode)).toEqual(['ERR_HOST_NOT_ALLOWED']);
    // …and every loopback spelling still reaches it.
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) {
      const own = await send(port, {
        headers: { host, 'content-type': 'application/json' },
        body: turn(),
      });
      expect(own.status).toBe(200);
    }
  });

  it('a DEFAULTED loopback list says so in its 421, and names the reverse-proxy fix', async () => {
    // The same-box proxy case: nginx on this machine forwards the PUBLIC name
    // to a 127.0.0.1-bound door. The socket cannot tell it from rebinding, so
    // it is refused — and the refusal teaches the one option that fixes it.
    const { port, calls } = await door();
    const reply = await send(port, {
      headers: {
        host: 'app.example',
        'x-forwarded-for': '10.1.2.3',
        'content-type': 'application/json',
      },
      body: turn(),
    });
    expect(reply.status).toBe(421);
    const { error } = JSON.parse(reply.body) as { error: string };
    expect(error).toMatch(/bound to a loopback address/);
    expect(error).toMatch(/proxy_set_header Host \$host/);
    expect(error).toMatch(/allowedHosts/);
    expect(calls()).toBe(0);
    // An operator-set list keeps the plain sentence.
    const listed = await door({ allowedHosts: ['neo.corp.example'] });
    const plain = await send(listed.port, {
      headers: { host: 'app.example', 'content-type': 'application/json' },
      body: turn(),
    });
    expect((JSON.parse(plain.body) as { error: string }).error).not.toMatch(/loopback/);
  });

  it('an explicit allowedOrigins also refuses the rebinding shape — the attacker’s origin is not listed', async () => {
    const { port, calls } = await door({ allowedOrigins: ['https://neo.corp.example'] }, '0.0.0.0');
    const reply = await send(port, {
      headers: {
        host: `rebind.evil.example:${port}`,
        origin: `http://rebind.evil.example:${port}`,
        'content-type': 'application/json',
      },
      body: turn(),
    });
    expect(reply.status).toBe(403);
    expect(calls()).toBe(0);
  });

  it('WITHOUT allowedHosts, on a non-loopback bind, the rebinding shape is served — the same-host Origin rule cannot see it', async () => {
    // Pinned so nobody reads the Origin check as a rebinding defence: the
    // default compares Origin with Host, and under rebinding both are the
    // attacker's name. This is why the boot warning exists.
    const { port, calls } = await door({}, '0.0.0.0');
    const reply = await send(port, {
      headers: {
        host: `rebind.evil.example:${port}`,
        origin: `http://rebind.evil.example:${port}`,
        'content-type': 'application/json',
      },
      body: turn(),
    });
    expect(reply.status).toBe(200);
    expect(calls()).toBe(1);
  });
});

// ─── 2. SECURITY — secrets never travel ──────────────────────────────

describe('what a refusal may say — security', () => {
  it('no credential, session id or attacker string in any refusal body or record', async () => {
    const { port, records } = await door({ allowedHosts: ['127.0.0.1'] });
    const sessionSecret = `sess-${'s'.repeat(MAX_SESSION_ID_LENGTH)}`;
    const replies = await Promise.all([
      send(port, {
        headers: { 'content-type': 'text/plain', authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ input: 'x', sessionId: sessionSecret }),
      }),
      send(port, {
        headers: {
          'content-type': 'application/json',
          origin: `${EVIL}/${SECRET}`,
          authorization: `Bearer ${SECRET}`,
        },
        body: turn(),
      }),
      send(port, {
        headers: { host: `x-${SECRET}.example`, 'content-type': 'application/json' },
        body: turn(),
      }),
      send(port, {
        headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ input: 'x', sessionId: sessionSecret }),
      }),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([400, 403, 415, 421]);
    const published = JSON.stringify({ bodies: replies.map((r) => r.body), records });
    expect(published).not.toContain(SECRET);
    expect(published).not.toContain(sessionSecret);
    // Presence is recorded; the value never is.
    expect(records.filter((r) => r.bearerPresent)).toHaveLength(3);
    expect(records.every((r) => r.sessionId === undefined)).toBe(true);
  });

  it('a refused WebSocket handshake answers with the rule, never the offered credential', async () => {
    const { port } = await conversationDoor();
    const refused = await handshake(port, {
      headers: { origin: EVIL, authorization: `Bearer ${SECRET}` },
    });
    expect(refused.status).toBe(403);
    expect(refused.text).not.toContain(SECRET);
    expect(refused.text).toMatch(/allowedOrigins/);
  });
});

// ─── 3. SCENARIO — the field's own client keeps working ──────────────

describe('what the field client sends still works — scenario', () => {
  it('JSON + x-session-id + its own Origin is served, and remembered', async () => {
    const { port, calls, records } = await door({ allowedHosts: ['127.0.0.1'] });
    const first = await send(port, { headers: fieldClient(port), body: turn('one') });
    const second = await send(port, { headers: fieldClient(port), body: turn('two') });
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(JSON.parse(second.body)).toEqual({ output: 'answered' });
    expect(calls()).toBe(2);
    expect(records.map((r) => r.outcome)).toEqual(['served', 'served']);
  });

  it('the streaming call (accept: text/event-stream) is served the same way', async () => {
    const { port } = await door();
    const reply = await send(port, {
      headers: fieldClient(port, { accept: 'text/event-stream' }),
      body: turn(),
    });
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('text/event-stream');
    expect(reply.body).toContain('event: complete');
  });

  it('a non-browser client (JSON, no Origin) is served — scripts and servers are not browsers', async () => {
    const { port, calls } = await door();
    const reply = await send(port, {
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: turn(),
    });
    expect(reply.status).toBe(200);
    expect(calls()).toBe(1);
  });

  it('behind a proxy that forwards X-Forwarded-Host, the page’s own Origin is still same-host', async () => {
    const { port } = await door();
    const reply = await send(port, {
      headers: {
        'content-type': 'application/json',
        host: `127.0.0.1:${port}`,
        'x-forwarded-host': 'neo.corp.example',
        origin: 'https://neo.corp.example',
      },
      body: turn(),
    });
    expect(reply.status).toBe(200);
  });

  it('an app on another origin is served once it is listed in allowedOrigins', async () => {
    const { port } = await door({ allowedOrigins: ['https://app.corp.example'] });
    const listed = await send(port, {
      headers: { 'content-type': 'application/json', origin: 'https://app.corp.example' },
      body: turn(),
    });
    const sameHostButUnlisted = await send(port, {
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
      body: turn(),
    });
    expect([listed.status, sameHostButUnlisted.status]).toEqual([200, 403]);
  });

  it('GET health and every unowned path are unchanged — probes are not doors', async () => {
    const { port } = await door({ allowedHosts: ['neo.corp.example'] });
    // A kubelet or load-balancer probe sends the TARGET's address as Host.
    const health = await send(port, {
      method: 'GET',
      path: '/health',
      headers: { host: `10.0.0.7:${port}`, origin: EVIL },
    });
    expect(health.status).toBe(200);
    const unowned = await send(port, { method: 'GET', path: '/nowhere' });
    expect(unowned.status).toBe(404);
  });

  it('the escape hatch serves a non-browser integration that cannot send JSON content-type', async () => {
    const { port, calls } = await door({ requireJsonContentType: false });
    const reply = await send(port, { headers: { 'content-type': 'text/plain' }, body: turn() });
    expect(reply.status).toBe(200);
    expect(calls()).toBe(1);
  });
});

// ─── 4. INTEGRATION — the WebSocket door, and the other doors ────────

describe('the conversation door checks the handshake before the 101 — integration', () => {
  it('refuses a foreign Origin (403) and the handler never runs', async () => {
    const { port, reached, refusals } = await conversationDoor();
    const refused = await handshake(port, { headers: { origin: EVIL } });
    expect(refused.status).toBe(403);
    expect(reached()).toBe(0);
    expect(refusals.map((r) => [r.door, r.error.code])).toEqual([
      ['conversation', 'ERR_ORIGIN_NOT_ALLOWED'],
    ]);
  });

  it('refuses `Origin: null` on the handshake too', async () => {
    const { port, reached } = await conversationDoor();
    expect((await handshake(port, { headers: { origin: 'null' } })).status).toBe(403);
    expect(reached()).toBe(0);
  });

  it('refuses a handshake carrying Sec-Fetch-Site but no Origin — a browser always sends both (403)', async () => {
    const { port, reached } = await conversationDoor();
    const refused = await handshake(port, {
      headers: { 'sec-fetch-mode': 'websocket', 'sec-fetch-site': 'same-site' },
    });
    expect(refused.status).toBe(403);
    expect(reached()).toBe(0);
    // Node's own WebSocket client sends `Sec-Fetch-Mode: websocket` and no
    // Origin — it is not a page, and it still opens.
    const native = await handshake(port, { headers: { 'sec-fetch-mode': 'websocket' } });
    expect(native.status).toBe(101);
  });

  it('refuses a handshake the browser marked cross-site with its Origin stripped (403)', async () => {
    // A browser WebSocket cannot carry a custom header, so there is no
    // preflight to force: Origin and Fetch metadata are the whole defence.
    const { port, reached } = await conversationDoor();
    const refused = await handshake(port, { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(refused.status).toBe(403);
    expect(refused.text).toMatch(/Sec-Fetch-\*/);
    expect(reached()).toBe(0);
  });

  it('opens for the page’s own origin and for a non-browser client with no Origin', async () => {
    const { port } = await conversationDoor();
    const own = await handshake(port, { headers: { origin: `http://127.0.0.1:${port}` } });
    const script = await handshake(port);
    expect([own.status, script.status]).toEqual([101, 101]);
  });

  it('refuses a Host this door was not configured for (421) when allowedHosts is set', async () => {
    const { port, reached } = await conversationDoor({ allowedHosts: ['127.0.0.1'] });
    const refused = await handshake(port, {
      host: `rebind.evil.example:${port}`,
      headers: { origin: `http://rebind.evil.example:${port}` },
    });
    expect(refused.status).toBe(421);
    expect(reached()).toBe(0);
  });

  it('refuses a session id over the ceiling in the query, before the 101 (400)', async () => {
    const { port, reached, refusals } = await conversationDoor();
    const long = 'q'.repeat(MAX_SESSION_ID_LENGTH + 1);
    const refused = await handshake(port, { path: `/conversation?sessionId=${long}` });
    expect(refused.status).toBe(400);
    expect(refused.text).not.toContain(long);
    expect(reached()).toBe(0);
    expect(refusals.map((r) => r.error.code)).toEqual(['ERR_INVALID_SESSION_ID']);
  });

  it('a WebSocket refusal lands in the ingress record of the standing agent on the same host', async () => {
    const records: IngressRecord[] = [];
    const host = nodeHost({ port: 0, hostname: '127.0.0.1' });
    const agentHandle = await standingAgent({
      agent: Agent.create({ provider: mock({ reply: 'x' }), model: 'm' }).build(),
      sessions: memorySessions(),
      host,
      onIngressDecision: (record) => records.push(record),
    });
    open.push(agentHandle);
    const conversations = await host.serveConversations((c) => c.close('done'));
    open.push(conversations);
    await handshake(conversations.port, { headers: { origin: EVIL } });
    expect(records).toEqual([
      expect.objectContaining({
        door: 'conversation',
        outcome: 'cross-site-refused',
        errorCode: 'ERR_ORIGIN_NOT_ALLOWED',
      }),
    ]);
  });
});

describe('the session-id bound holds at the request door — integration', () => {
  it('refuses a session id over the ceiling from the body, the header and the cookie (400), no model call', async () => {
    const { port, calls, records } = await door();
    const long = 'b'.repeat(MAX_SESSION_ID_LENGTH + 1);
    const body = await send(port, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'x', sessionId: long }),
    });
    const header = await send(port, {
      headers: { 'content-type': 'application/json', 'x-session-id': long },
      body: turn(),
    });
    expect([body.status, header.status]).toEqual([400, 400]);
    expect(JSON.parse(body.body)).toMatchObject({ code: 'ERR_INVALID_SESSION_ID' });
    expect(calls()).toBe(0);
    expect(records.map((r) => [r.door, r.outcome, r.errorCode])).toEqual([
      ['request', 'refused', 'ERR_INVALID_SESSION_ID'],
      ['request', 'refused', 'ERR_INVALID_SESSION_ID'],
    ]);

    const cookieHost = await nodeHost({
      port: 0,
      hostname: '127.0.0.1',
      sessionCookie: 'sid',
    }).serve((_request, reply) => reply.complete('served'));
    open.push(cookieHost);
    const cookie = await send(cookieHost.port, {
      headers: { 'content-type': 'application/json', cookie: `sid=${long}` },
      body: turn(),
    });
    expect(cookie.status).toBe(400);
  });

  it('accepts a session id AT the ceiling — the bound is a ceiling, not a guess', async () => {
    const { port } = await door();
    const reply = await send(port, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'x', sessionId: 'c'.repeat(MAX_SESSION_ID_LENGTH) }),
    });
    expect(reply.status).toBe(200);
  });

  it('refuses a session id carrying a control character (a forged log line) — 400', async () => {
    const { port, calls } = await door();
    const reply = await send(port, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'x', sessionId: 'c-1\nforged: entry' }),
    });
    expect(reply.status).toBe(400);
    expect(calls()).toBe(0);
  });

  it('refuses the empty id, separators, bidi and zero-width characters, lone surrogates and non-ASCII (400)', async () => {
    const { port, calls } = await door();
    const refused = [
      '',
      'a\u2028b',
      'a\u2029b',
      'a\u202eb',
      'a\u200bb',
      'a\ud800',
      'caf\u00e9',
      'two words',
    ];
    for (const sessionId of refused) {
      const reply = await send(port, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'x', sessionId }),
      });
      expect([sessionId, reply.status]).toEqual([sessionId, 400]);
    }
    // The same id read from a HEADER (node decodes it as latin1) is refused
    // just the same, so one logical id cannot be two conversations.
    const header = await send(port, {
      headers: { 'content-type': 'application/json', 'x-session-id': 'caf\u00e9' },
      body: turn(),
    });
    expect(header.status).toBe(400);
    expect(calls()).toBe(0);
  });

  it('bounds the id a session-history op names inside the op itself', async () => {
    const handle = await nodeHost({ port: 0, hostname: '127.0.0.1' }).serve((_request, reply) =>
      reply.complete('reached'),
    );
    open.push(handle);
    const reply = await send(handle.port, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        op: 'session-transcript',
        sessionId: 't'.repeat(MAX_SESSION_ID_LENGTH + 1),
      }),
    });
    expect(reply.status).toBe(400);
    expect(reply.body).not.toContain('reached');
  });

  it('holds on the hosted-runtime adapter too — its session header is bounded like any other', async () => {
    const handle = (await agentCoreRuntimeHost({ port: 0, hostname: '127.0.0.1' }).serve(
      (_request, reply) => reply.complete('reached'),
    )) as HttpHostHandle;
    open.push(handle);
    const reply = await send(handle.port, {
      path: '/invocations',
      headers: {
        'content-type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': 'a'.repeat(MAX_SESSION_ID_LENGTH + 1),
      },
      body: JSON.stringify({ prompt: 'x' }),
    });
    expect(reply.status).toBe(400);
  });
});

describe('the hosted-runtime adapters — exempt from the browser rules on a platform bind, and why', () => {
  it('agentCoreRuntimeHost on a non-loopback bind serves what its platform forwards, and says the rules are off', async () => {
    // The platform's front door is the only way to this port and it demands a
    // credential no page holds; which headers it forwards is not a fact this
    // library can verify. So the adapter keeps today's behaviour…
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const exempt = (await agentCoreRuntimeHost({ port: 0, hostname: '0.0.0.0' }).serve(
      (_request, reply) => reply.complete('reached'),
    )) as HttpHostHandle;
    open.push(exempt);
    const forwarded = await send(exempt.port, {
      path: '/invocations',
      headers: { 'content-type': 'text/plain', origin: EVIL },
      body: JSON.stringify({ prompt: 'x' }),
    });
    expect(forwarded.status).toBe(200);
    // …and says so once at boot, so a self-hoster on 0.0.0.0 is told.
    expect(
      warn.mock.calls.filter((call) => String(call[0]).includes('browser rules OFF')),
    ).toHaveLength(1);

    // …and one option opts it in, with the same rule every other door keeps.
    const guarded = (await agentCoreRuntimeHost({
      port: 0,
      hostname: '0.0.0.0',
      requireJsonContentType: true,
      allowedOrigins: [],
    }).serve((_request, reply) => reply.complete('reached'))) as HttpHostHandle;
    open.push(guarded);
    const refused = await send(guarded.port, {
      path: '/invocations',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ prompt: 'x' }),
    });
    expect(refused.status).toBe(415);
  });

  it('on a LOOPBACK bind (a laptop, no platform in front) every plain-host default applies', async () => {
    const adapters = [
      { path: '/invocations', host: agentCoreRuntimeHost({ port: 0, hostname: '127.0.0.1' }) },
      { path: '/responses', host: foundryResponsesHost({ port: 0, hostname: '127.0.0.1' }) },
    ];
    for (const { path, host } of adapters) {
      const handle = (await host.serve((_request, reply) =>
        reply.complete('reached'),
      )) as HttpHostHandle;
      open.push(handle);
      const csrf = await send(handle.port, {
        path,
        headers: { 'content-type': 'text/plain', origin: EVIL },
        body: JSON.stringify({ prompt: 'x', input: 'x' }),
      });
      const rebinding = await send(handle.port, {
        path,
        headers: {
          host: `rebind.evil.example:${handle.port}`,
          origin: `http://rebind.evil.example:${handle.port}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ prompt: 'x', input: 'x' }),
      });
      expect([path, csrf.status, rebinding.status]).toEqual([path, 403, 421]);
    }
  });
});

// ─── 5. UNIT — the one rule, as a pure function ──────────────────────

describe('doorGuard — unit', () => {
  const guard = doorGuard({ name: 'unit' });
  const post = (headers: Record<string, string>) => guard.check({ method: 'POST', headers });

  it('leaves GET, HEAD and OPTIONS alone, whatever they carry', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(guard.check({ method, headers: { origin: EVIL } })).toBeUndefined();
    }
  });

  it('treats a WebSocket upgrade as state-changing even though it is a GET', () => {
    const refusal = guard.check({
      method: 'GET',
      headers: { upgrade: 'websocket', origin: EVIL, host: 'door.example' },
    });
    expect(refusal).toBeInstanceOf(OriginNotAllowedError);
    expect(refusal?.status).toBe(403);
  });

  it('accepts the JSON essence only — never a CORS exception type, never a list', () => {
    const accepted = ['application/json', 'application/json; charset=utf-8', 'Application/JSON'];
    const refused = [
      'text/plain',
      'text/plain; application/json',
      'application/json, text/plain',
      'application/csp-report',
      'application/expect-ct-report+json',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      '',
    ];
    for (const value of accepted) expect(post({ 'content-type': value })).toBeUndefined();
    for (const value of refused) {
      expect(post({ 'content-type': value })).toBeInstanceOf(UnsupportedMediaTypeError);
    }
    expect(post({})).toBeInstanceOf(UnsupportedMediaTypeError);
  });

  it('compares a default Origin with Host or any X-Forwarded-Host entry, by authority', () => {
    const json = { 'content-type': 'application/json' };
    expect(post({ ...json, host: 'neo.corp:443', origin: 'https://neo.corp' })).toBeUndefined();
    expect(post({ ...json, host: 'neo.corp', origin: 'http://neo.corp:8080' })).toBeInstanceOf(
      OriginNotAllowedError,
    );
    expect(
      post({
        ...json,
        host: '127.0.0.1:5230',
        'x-forwarded-host': 'a.b, neo.corp',
        origin: 'https://neo.corp',
      }),
    ).toBeUndefined();
    expect(post({ ...json, host: 'neo.corp', origin: 'not an origin' })).toBeInstanceOf(
      OriginNotAllowedError,
    );
  });

  it('reads Fetch metadata only as a refusal, and only for `cross-site`', () => {
    const json = { 'content-type': 'application/json' };
    for (const site of ['same-origin', 'same-site', 'none']) {
      expect(post({ ...json, 'sec-fetch-site': site })).toBeUndefined();
    }
    const refusal = post({ ...json, 'sec-fetch-site': 'Cross-Site' });
    expect(refusal).toBeInstanceOf(OriginNotAllowedError);
    expect((refusal as OriginNotAllowedError).rule).toBe('fetch-metadata');
    // `'any'` turns both browser checks off — the platform-fronted door's setting.
    const open = doorGuard({ name: 'unit', allowedOrigins: 'any' });
    expect(
      open.check({
        method: 'POST',
        headers: { ...json, origin: EVIL, 'sec-fetch-site': 'cross-site' },
      }),
    ).toBeUndefined();
    // Under the default rule a same-host Origin the browser calls cross-site is
    // not a combination a real page produces: refused, closed.
    expect(
      post({
        ...json,
        host: 'neo.corp',
        origin: 'https://neo.corp',
        'sec-fetch-site': 'cross-site',
      }),
    ).toBeInstanceOf(OriginNotAllowedError);
  });

  it('judges Host on every method once allowedHosts is set — an app’s own GET routes included', () => {
    const hosts = doorGuard({ name: 'unit', allowedHosts: ['neo.corp.example'] });
    expect(hosts.check({ method: 'GET', headers: { host: 'rebind.evil.example' } })).toBeInstanceOf(
      HostNotAllowedError,
    );
    expect(hosts.check({ method: 'GET', headers: { host: 'neo.corp.example' } })).toBeUndefined();
  });

  it('matches allowedHosts by name, case- and trailing-dot-insensitively, a port only when listed', () => {
    const hosts = doorGuard({
      name: 'unit',
      allowedHosts: ['Neo.Corp.Example', '[::1]', 'lab.corp:8443'],
    });
    const at = (host: string) =>
      hosts.check({ method: 'POST', headers: { host, 'content-type': 'application/json' } });
    for (const host of [
      'neo.corp.example',
      'NEO.corp.example:5230',
      'neo.corp.example.',
      '[::1]:5230',
      'lab.corp:8443',
    ]) {
      expect(at(host)).toBeUndefined();
    }
    for (const host of [
      'evil.example',
      'neo.corp.example.evil.example',
      'lab.corp:8444',
      'lab.corp',
      '',
    ]) {
      expect(at(host)).toBeInstanceOf(HostNotAllowedError);
    }
    expect(at('evil.example')?.status).toBe(421);
  });

  it('refuses configurations that could only ever be mistakes, at construction', () => {
    expect(() => doorGuard({ name: 'x', allowedOrigins: ['null'] })).toThrow(/null/);
    expect(() => doorGuard({ name: 'x', allowedOrigins: ['*'] })).toThrow(/'any'/);
    expect(() => doorGuard({ name: 'x', allowedOrigins: ['https://a.example/app'] })).toThrow(
      /origin/,
    );
    expect(() => doorGuard({ name: 'x', allowedHosts: [] })).toThrow(/every request/);
    expect(() => doorGuard({ name: 'x', allowedHosts: ['a.example/path'] })).toThrow(/host/);
    expect(() =>
      httpHost({
        name: 'x',
        wire: jsonWire,
        invokePath: '/i',
        healthPath: '/h',
        allowedOrigins: 'https://a.example' as unknown as readonly string[],
      }),
    ).toThrow(/allowedOrigins/);
  });

  it('checkSessionId: absent is fine, the ceiling is inclusive, only visible ASCII passes', () => {
    expect(checkSessionId(undefined, 'unit')).toBeUndefined();
    expect(checkSessionId('c'.repeat(MAX_SESSION_ID_LENGTH), 'unit')).toBeUndefined();
    expect(checkSessionId('c'.repeat(MAX_SESSION_ID_LENGTH + 1), 'unit')?.reason).toBe('too-long');
    expect(checkSessionId('', 'unit')?.reason).toBe('empty');
    expect(checkSessionId('a\u0000b', 'unit')?.status).toBe(400);
    for (const bad of [
      'a\u0085b',
      'a\u2028b',
      'a\u202eb',
      'a\ufeffb',
      'a\ud800',
      'ünïcode',
      'a b',
    ]) {
      expect(checkSessionId(bad, 'unit')?.reason).toBe('invalid-character');
    }
    for (const good of ['3f2b6c1e-8d4a-4a3e-9b1c-0f5e7a2d9c41', 'conv_ABC123', '!~#$%&*+.:=?@^|']) {
      expect(checkSessionId(good, 'unit')).toBeUndefined();
    }
  });

  it('never trusts X-Forwarded-Host for allowedHosts — the pin a mutation once survived', () => {
    const hosts = doorGuard({ name: 'unit', allowedHosts: ['neo.corp.example'] });
    expect(
      hosts.check({
        method: 'POST',
        headers: {
          host: 'rebind.evil.example',
          'x-forwarded-host': 'neo.corp.example',
          'content-type': 'application/json',
        },
      }),
    ).toBeInstanceOf(HostNotAllowedError);
  });

  it('reads a portless Host under X-Forwarded-Proto, so port 80 and port 443 are two origins', () => {
    const json = { 'content-type': 'application/json' };
    const behindTls = { ...json, host: 'neo.corp.example', 'x-forwarded-proto': 'https' };
    expect(post({ ...behindTls, origin: 'https://neo.corp.example' })).toBeUndefined();
    expect(post({ ...behindTls, origin: 'http://neo.corp.example' })).toBeInstanceOf(
      OriginNotAllowedError,
    );
    // No proxy said which scheme: the Origin's own is used, as before.
    expect(
      post({ ...json, host: 'neo.corp.example', origin: 'http://neo.corp.example' }),
    ).toBeUndefined();
  });

  it('refuses a WebSocket upgrade that carries Sec-Fetch-Site but no Origin — a stripped Origin', () => {
    const upgrade = { upgrade: 'websocket', host: 'door.example' };
    expect(guard.check({ method: 'GET', headers: upgrade })).toBeUndefined();
    const stripped = guard.check({
      method: 'GET',
      headers: { ...upgrade, 'sec-fetch-mode': 'websocket', 'sec-fetch-site': 'same-site' },
    });
    expect((stripped as OriginNotAllowedError | undefined)?.rule).toBe('fetch-metadata');
    expect(
      guard.check({ method: 'GET', headers: { ...upgrade, 'sec-fetch-mode': 'websocket' } }),
    ).toBeUndefined();
  });

  it('knows a loopback bind when it sees one, and names only loopback names for it', () => {
    for (const bind of [
      '127.0.0.1',
      '127.1.2.3',
      'localhost',
      '::1',
      '[::1]',
      '0:0:0:0:0:0:0:1',
      '[0000:0000:0000:0000:0000:0000:0000:0001]',
      '::ffff:127.0.0.1',
    ]) {
      expect([bind, isLoopbackBind(bind)]).toEqual([bind, true]);
    }
    for (const bind of [
      undefined,
      '0.0.0.0',
      '::',
      '::2',
      '::ffff:10.0.0.1',
      '10.0.0.7',
      'neo.corp.example',
    ]) {
      expect([bind, isLoopbackBind(bind)]).toEqual([bind, false]);
    }
    expect(loopbackAllowedHosts('127.0.0.1')).toEqual(['localhost', '127.0.0.1', '[::1]']);
    expect(loopbackAllowedHosts('127.0.0.2')).toContain('127.0.0.2');
    expect(loopbackAllowedHosts('0.0.0.0')).toBeUndefined();
  });
});

describe('the boot warning — unit', () => {
  const warningsAbout = (warn: { mock: { calls: readonly (readonly unknown[])[] } }) =>
    warn.mock.calls.filter((call) => String(call[0]).includes('allowedHosts'));

  it('fires exactly once per host name when allowedHosts is unset, naming the risk and the option', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const name = `boot-warning-${Date.now()}`;
    const build = () =>
      httpHost({
        name,
        wire: jsonWire,
        invokePath: '/invoke',
        healthPath: '/health',
        conversationPath: '/conversation',
        port: 0,
        hostname: '0.0.0.0',
      });
    const host = build();
    open.push(await host.serve((_r, reply) => reply.complete('x')));
    open.push(await host.serveConversations((c) => c.close('x')));
    open.push(await build().serve((_r, reply) => reply.complete('x')));
    const warnings = warningsAbout(warn);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toMatch(/rebinding/i);
    expect(String(warnings[0]?.[0])).toContain(name);
  });

  it("stays silent when allowedHosts is a list or deliberately 'any'", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stamp = Date.now();
    for (const allowedHosts of [['127.0.0.1'], 'any'] as const) {
      open.push(
        await httpHost({
          name: `boot-quiet-${stamp}-${String(allowedHosts)}`,
          wire: jsonWire,
          invokePath: '/invoke',
          healthPath: '/health',
          port: 0,
          hostname: '127.0.0.1',
          allowedHosts,
        }).serve((_r, reply) => reply.complete('x')),
      );
    }
    expect(warningsAbout(warn)).toHaveLength(0);
  });

  it('stays silent on a loopback bind — its loopback names ARE its allowedHosts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    open.push(
      await httpHost({
        name: `boot-loopback-${Date.now()}`,
        wire: jsonWire,
        invokePath: '/invoke',
        healthPath: '/health',
        port: 0,
        hostname: '127.0.0.1',
      }).serve((_r, reply) => reply.complete('x')),
    );
    expect(warningsAbout(warn)).toHaveLength(0);
  });
});

describe('each refusal answers with its own status — unit', () => {
  it('a handler that fails a reply with a door refusal gets the status the class carries', async () => {
    const refusals = [
      new UnsupportedMediaTypeError('pin'),
      new OriginNotAllowedError('pin', 'same-host'),
      new HostNotAllowedError('pin'),
      new InvalidSessionIdError('too-long', 'pin', 401, MAX_SESSION_ID_LENGTH),
    ];
    for (const refusal of refusals) {
      const handle = await nodeHost({ port: 0, hostname: '127.0.0.1' }).serve((_r, reply) =>
        reply.fail(refusal),
      );
      open.push(handle);
      const reply = await send(handle.port, {
        headers: { 'content-type': 'application/json' },
        body: turn(),
      });
      // The host's code→status table and the class's own `status` are two
      // spellings of one number; this is what keeps them one.
      expect([refusal.code, reply.status]).toEqual([refusal.code, refusal.status]);
    }
  });
});

// ─── 6. PROPERTY — the bound and the essence, over many inputs ───────

/** A small seeded generator — fast-check is not a dependency of this repo. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** The Fetch standard's own test: does a browser send this content-type WITHOUT a preflight? */
function corsSafelisted(value: string): boolean {
  const trimmed = value.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
  const slash = trimmed.indexOf('/');
  if (slash <= 0) return false;
  const type = trimmed.slice(0, slash);
  const rest = trimmed.slice(slash + 1);
  const semi = rest.indexOf(';');
  const subtype = (semi < 0 ? rest : rest.slice(0, semi)).replace(/[\t\n\r ]+$/, '');
  const token = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
  if (!token.test(type) || !token.test(subtype)) return false;
  const essence = `${type}/${subtype}`.toLowerCase();
  return ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'].includes(
    essence,
  );
}

describe('properties — property', () => {
  it('a session id is refused exactly when it is empty, over the ceiling, or not visible ASCII', () => {
    const next = seeded(115);
    const alphabet = [
      'a',
      'Z',
      '9',
      '-',
      '_',
      ':',
      '~',
      'é',
      '✓',
      '\u0000',
      '\n',
      '\u007f',
      '\u0085',
      ' ',
      '\u2028',
      '\u202e',
      '\u200b',
      '\ud800',
    ];
    for (let i = 0; i < 2000; i++) {
      const length = Math.floor(next() * (MAX_SESSION_ID_LENGTH + 40));
      let id = '';
      for (let j = 0; j < length; j++) {
        // Mostly visible ASCII, sometimes anything else — both halves of the rule get exercised.
        const pick = next() < 0.995 ? Math.floor(next() * 7) : 7 + Math.floor(next() * 11);
        id += alphabet[pick];
      }
      const refused = checkSessionId(id, 'property');
      const expected =
        id.length === 0 || id.length > MAX_SESSION_ID_LENGTH || /[^\x21-\x7e]/.test(id);
      expect(refused !== undefined).toBe(expected);
      if (refused && id.length > 0) expect(refused.message).not.toContain(id);
    }
  });

  it('every content-type the door accepts is one a browser would have had to preflight', () => {
    const next = seeded(9110);
    const pick = <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)] as T;
    const space = ['', ' ', '\t', '  '];
    const types = [
      'application',
      'Application',
      'text',
      'multipart',
      'APPLICATION',
      'app lication',
    ];
    const subtypes = [
      'reports+json',
      'vnd.api+json',
      'merge-patch+json',
      'expect-ct-report+json',
      'csp-report',
      'json',
      'JSON',
      'plain',
      'form-data',
      'x-www-form-urlencoded',
      'json, text/plain',
      'json text',
    ];
    const params = [
      '',
      ';charset=utf-8',
      '; charset=UTF-8',
      '; boundary=x',
      ', text/plain',
      '; application/json',
      ';',
    ];
    const guard = doorGuard({ name: 'property', allowedOrigins: 'any' });
    let accepted = 0;
    let refused = 0;
    for (let i = 0; i < 5000; i++) {
      const value = `${pick(space)}${pick(types)}/${pick(space)}${pick(subtypes)}${pick(
        space,
      )}${pick(params)}${pick(space)}`;
      const passes =
        guard.check({ method: 'POST', headers: { 'content-type': value } }) === undefined;
      // The door's own contract: in exactly when the essence is
      // `application/json` — so no `+json` cousin (Fetch §3.3.7 lets pages send
      // some of those without a preflight) and no CSP report ever gets in.
      const essence = (value.split(';', 1)[0] ?? '').trim().toLowerCase();
      expect([value, passes]).toEqual([value, essence === 'application/json']);
      if (passes) {
        accepted += 1;
        // The security property: nothing the door lets in could have been
        // sent cross-site without the browser asking first.
        expect(corsSafelisted(value)).toBe(false);
      } else {
        refused += 1;
      }
    }
    // Both halves occur — the property is not vacuous.
    expect(accepted).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });
});

// ─── 7. PERFORMANCE — refused before the body is read ────────────────

describe('the refusal costs nothing it does not have to — performance', () => {
  it('answers 415 without waiting for a body the caller never sends, and closes the connection', async () => {
    const { port, calls } = await door();
    const started = performance.now();
    const seen = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1');
      let text = '';
      socket.on('error', reject);
      socket.on('data', (chunk: Buffer) => {
        text += chunk.toString('utf8');
      });
      // The SERVER ends it: the body it is still owed is one it will never read.
      socket.on('close', () => resolve(text));
      socket.on('connect', () => {
        // Announces a gigabyte, sends none of it.
        socket.write(
          `POST /invoke HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
            `content-type: text/plain\r\ncontent-length: 1073741824\r\n\r\n`,
        );
      });
    });
    expect(Number(/^HTTP\/1\.1 (\d+)/.exec(seen)?.[1])).toBe(415);
    expect(seen).toMatch(/connection: close/i);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(calls()).toBe(0);
  });

  it('a client still uploading a refused body up to the drain bound READS the 415 — drained, not reset', async () => {
    const { port, calls } = await door();
    const size = 1024 * 1024;
    const results: { status: string; error?: string }[] = [];
    for (let run = 0; run < 3; run++) {
      results.push(
        await new Promise<{ status: string; error?: string }>((resolve) => {
          const socket = connect(port, '127.0.0.1');
          let text = '';
          let error: string | undefined;
          socket.on('data', (chunk: Buffer) => {
            text += chunk.toString('latin1');
          });
          socket.on('error', (err: NodeJS.ErrnoException) => {
            error = err.code ?? err.message;
          });
          socket.on('close', () =>
            resolve({ status: text.split('\r\n')[0] ?? '', ...(error !== undefined && { error }) }),
          );
          socket.on('connect', () => {
            socket.write(
              `POST /invoke HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
                `content-type: text/plain\r\ncontent-length: ${size}\r\n\r\n`,
            );
            // Upload as fast as the socket takes it: mid-upload when refused.
            const piece = Buffer.alloc(64 * 1024, 97);
            let sent = 0;
            const pump = (): void => {
              while (sent < size && !socket.destroyed) {
                sent += piece.length;
                if (!socket.write(piece)) {
                  socket.once('drain', pump);
                  return;
                }
              }
            };
            pump();
          });
          setTimeout(() => socket.destroy(), 5000);
        }),
      );
    }
    expect(results).toEqual([
      { status: 'HTTP/1.1 415 Unsupported Media Type' },
      { status: 'HTTP/1.1 415 Unsupported Media Type' },
      { status: 'HTTP/1.1 415 Unsupported Media Type' },
    ]);
    expect(calls()).toBe(0);
  });

  it('`Expect: 100-continue` on a refused request is answered 415 — never invited with a 100', async () => {
    const { port, calls } = await door();
    const text = await new Promise<string>((resolve) => {
      const socket = connect(port, '127.0.0.1');
      let seen = '';
      socket.on('data', (chunk: Buffer) => {
        seen += chunk.toString('latin1');
      });
      socket.on('error', () => undefined);
      socket.on('close', () => resolve(seen));
      socket.on('connect', () => {
        socket.write(
          `POST /invoke HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\ncontent-type: text/plain\r\n` +
            `expect: 100-continue\r\ncontent-length: 5000000\r\n\r\n`,
        );
      });
      setTimeout(() => socket.destroy(), 3000);
    });
    expect(text.split('\r\n')[0]).toBe('HTTP/1.1 415 Unsupported Media Type');
    expect(text).not.toContain('100 Continue');
    expect(calls()).toBe(0);
  });

  it('`Expect: 100-continue` on an allowed request still gets its 100 and is served', async () => {
    const { port } = await door();
    const text = await new Promise<string>((resolve) => {
      const socket = connect(port, '127.0.0.1');
      let seen = '';
      const body = turn();
      socket.on('data', (chunk: Buffer) => {
        seen += chunk.toString('latin1');
        if (seen.startsWith('HTTP/1.1 100') && !seen.includes('200')) socket.write(body);
        if (seen.includes('"output"')) socket.destroy();
      });
      socket.on('error', () => undefined);
      socket.on('close', () => resolve(seen));
      socket.on('connect', () => {
        socket.write(
          `POST /invoke HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\ncontent-type: application/json\r\n` +
            `expect: 100-continue\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n`,
        );
      });
      setTimeout(() => socket.destroy(), 3000);
    });
    expect(text).toMatch(/^HTTP\/1\.1 100 Continue/);
    expect(text).toContain('HTTP/1.1 200');
  });

  it('nodeHost bounds the body by default, so no rule ever runs after an unbounded read (413)', async () => {
    const { port, calls } = await door();
    const reply = await send(port, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'x', sessionId: 's'.repeat(DEFAULT_NODE_MAX_BODY_BYTES) }),
    });
    expect(reply.status).toBe(413);
    expect(calls()).toBe(0);
  });

  it('the pure check is cheap: 100k decisions well under a second', () => {
    const guard = doorGuard({ name: 'perf', allowedHosts: ['neo.corp.example'] });
    const headers = {
      host: 'neo.corp.example',
      origin: 'https://neo.corp.example',
      'content-type': 'application/json',
    };
    const started = performance.now();
    for (let i = 0; i < 100_000; i++) guard.check({ method: 'POST', headers });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

// ─── 8. ROI — the census shows the attempt ───────────────────────────

describe('what the record buys — ROI', () => {
  it('a mixed burst reads back as a census an operator can act on', async () => {
    const { port, records, calls } = await door({ allowedHosts: ['127.0.0.1'] });
    await send(port, { headers: fieldClient(port), body: turn() });
    await send(port, { headers: { 'content-type': 'text/plain', origin: EVIL }, body: turn() });
    await send(port, { headers: { 'content-type': 'text/plain' }, body: turn() });
    await send(port, {
      headers: { host: 'rebind.evil.example', 'content-type': 'application/json' },
      body: turn(),
    });
    const census = records.reduce<Record<string, number>>((acc, r) => {
      acc[`${r.outcome}:${r.errorCode ?? '-'}`] =
        (acc[`${r.outcome}:${r.errorCode ?? '-'}`] ?? 0) + 1;
      return acc;
    }, {});
    expect(census).toEqual({
      'served:-': 1,
      'cross-site-refused:ERR_ORIGIN_NOT_ALLOWED': 1,
      'cross-site-refused:ERR_UNSUPPORTED_MEDIA_TYPE': 1,
      'cross-site-refused:ERR_HOST_NOT_ALLOWED': 1,
    });
    // Three attempts, one model call: the served one.
    expect(calls()).toBe(1);
  });
});
