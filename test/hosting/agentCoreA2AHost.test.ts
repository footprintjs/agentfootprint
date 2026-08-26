/**
 * agentCoreA2AHost — the A2A container contract, asserted against a real socket.
 *
 * The request and response shapes below are the AWS developer guide's own
 * examples, copied literally rather than paraphrased: if the platform's
 * spelling moves, these must fail, not merely agree with our own helpers.
 *
 * The conformance suite (host-contract.test.ts) proves this adapter behaves
 * like every other host. Here is what only this one has: the agent card, the
 * JSON-RPC envelope and its echoed id, the session header, the runtime's error
 * table, and the deviation that makes A2A on AgentCore different from A2A
 * anywhere else — a real HTTP status carrying a JSON-RPC error body.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { agentCoreA2AHost, agentCoreA2AErrorCode } from '../../src/hosting-providers.js';
import { A2A_AGENT_CARD_PATH, A2A_PROTOCOL_VERSION } from '../../src/hosting-providers.js';
import type { HostHandler } from '../../src/hosting/index.js';
import type { HttpHostHandle } from '../../src/hosting/httpHost.js';

let open: HttpHostHandle | undefined;
afterEach(async () => {
  await open?.close();
  open = undefined;
});

const CARD = {
  name: 'triage',
  description: 'Triages SAN alerts.',
  version: '1.0.0',
  skills: [{ id: 'triage', name: 'Triage', description: 'Read an alert and say what broke.' }],
};

async function serve(handler: HostHandler, extra = {}): Promise<HttpHostHandle> {
  const handle = await agentCoreA2AHost({
    card: CARD,
    port: 0,
    hostname: '127.0.0.1',
    ...extra,
  }).serve(handler);
  open = handle;
  return handle;
}

const echo: HostHandler = (request, reply) => {
  reply.complete(`echo:${request.input}|session:${request.sessionId ?? 'none'}`);
};

/** AWS's own request example, with the text and id parameterised. */
function sendMessage(text: string, id: string | number = 'req-001'): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'message/send',
    params: {
      message: { role: 'user', parts: [{ kind: 'text', text }], messageId: 'unique-message-id' },
    },
  });
}

async function post(url: string, body: string, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

// ─── the three paths ─────────────────────────────────────────────────

describe('agentCoreA2AHost — the container contract', () => {
  it('answers /ping with the runtime’s exact health shape', async () => {
    const handle = await serve(echo);
    const res = await fetch(`${handle.url}/ping`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'Healthy' });
  });

  it('serves the agent card at the protocol’s well-known path', async () => {
    const handle = await serve(echo);
    const res = await fetch(`${handle.url}${A2A_AGENT_CARD_PATH}`);
    const card = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(card.name).toBe('triage');
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.preferredTransport).toBe('JSONRPC');
    expect(card.defaultInputModes).toEqual(['text']);
    expect(card.skills).toEqual([
      { id: 'triage', name: 'Triage', description: 'Read an alert and say what broke.', tags: [] },
    ]);
  });

  it('declares streaming FALSE — the wire carries message/send only', async () => {
    const handle = await serve(echo);
    const card = (await (await fetch(`${handle.url}${A2A_AGENT_CARD_PATH}`)).json()) as {
      capabilities: { streaming: boolean };
    };
    // AWS's sample card says true. Ours says what is true of ours: advertising
    // a capability this wire cannot honour leaves a caller waiting.
    expect(card.capabilities.streaming).toBe(false);
  });

  it('binds 9000 by default, and the default is asserted without taking the port', async () => {
    const { DEFAULT_AGENTCORE_A2A_PORT } = await import('../../src/hosting-providers.js');
    expect(DEFAULT_AGENTCORE_A2A_PORT).toBe(9000);
    const handle = await serve(echo);
    expect(handle.port).not.toBe(9000);
  });
});

// ─── the JSON-RPC envelope ───────────────────────────────────────────

describe('agentCoreA2AHost — the envelope', () => {
  it('answers AWS’s example request with AWS’s example result shape', async () => {
    const handle = await serve(echo);
    const body = (await (
      await post(handle.url, sendMessage('Your message content here'))
    ).json()) as {
      jsonrpc: string;
      id: string;
      result: {
        artifacts: { artifactId: string; name: string; parts: { kind: string; text: string }[] }[];
      };
    };

    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe('req-001');
    const artifact = body.result.artifacts[0]!;
    expect(artifact.name).toBe('agent_response');
    expect(artifact.parts[0]).toEqual({
      kind: 'text',
      text: 'echo:Your message content here|session:none',
    });
  });

  it('echoes the id it was given — string, number, and absent alike', async () => {
    const handle = await serve(echo);

    const withString = (await (await post(handle.url, sendMessage('a', 'abc'))).json()) as {
      id: unknown;
    };
    const withNumber = (await (await post(handle.url, sendMessage('a', 42))).json()) as {
      id: unknown;
    };
    const withNone = (await (
      await post(
        handle.url,
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: { message: { role: 'user', parts: [{ kind: 'text', text: 'a' }] } },
        }),
      )
    ).json()) as { id: unknown };

    expect(withString.id).toBe('abc');
    expect(withNumber.id).toBe(42);
    // JSON-RPC's own rule: a reply to a request with no id carries `null`,
    // which is a value and not the same as leaving the field out.
    expect(withNone.id).toBeNull();
  });

  it('joins several text parts into one turn', async () => {
    const handle = await serve(echo);
    const body = (await (
      await post(
        handle.url,
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'x',
          method: 'message/send',
          params: {
            message: {
              role: 'user',
              parts: [
                { kind: 'text', text: 'first ' },
                { kind: 'text', text: 'second' },
              ],
            },
          },
        }),
      )
    ).json()) as { result: { artifacts: { parts: { text: string }[] }[] } };
    expect(body.result.artifacts[0]?.parts[0]?.text).toContain('echo:first second');
  });
});

// ─── the session header ──────────────────────────────────────────────

describe('agentCoreA2AHost — the platform’s session header', () => {
  it('reaches the handler as HostRequest.sessionId', async () => {
    const handle = await serve(echo);
    const body = (await (
      await post(handle.url, sendMessage('hi'), {
        'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': 'conversation-7',
      })
    ).json()) as { result: { artifacts: { parts: { text: string }[] }[] } };
    expect(body.result.artifacts[0]?.parts[0]?.text).toContain('session:conversation-7');
  });

  it('is matched case-insensitively, as HTTP headers are', async () => {
    const handle = await serve(echo);
    const body = (await (
      await post(handle.url, sendMessage('hi'), {
        'x-amzn-bedrock-agentcore-runtime-session-id': 'lower-7',
      })
    ).json()) as { result: { artifacts: { parts: { text: string }[] }[] } };
    expect(body.result.artifacts[0]?.parts[0]?.text).toContain('session:lower-7');
  });
});

// ─── refusals, and the deviation ─────────────────────────────────────

describe('agentCoreA2AHost — errors carry a real HTTP status AND a JSON-RPC body', () => {
  it('refuses a method it does not implement, naming the one it does', async () => {
    const handle = await serve(echo);
    const res = await post(
      handle.url,
      JSON.stringify({ jsonrpc: '2.0', id: 'x', method: 'message/stream', params: {} }),
    );
    const body = (await res.json()) as {
      jsonrpc: string;
      id: string;
      error: { code: number; message: string };
    };

    // THE DEVIATION: the A2A spec would wrap this in HTTP 200. AgentCore does
    // not, so a client must read the body even on a non-2xx.
    expect(res.ok).toBe(false);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe('x');
    expect(body.error.code).toBe(-32051);
    expect(body.error.message).toContain('message/send');
  });

  it('refuses a non-text part by name, before the agent runs', async () => {
    let ran = false;
    const handle = await serve(() => {
      ran = true;
    });
    const res = await post(
      handle.url,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'x',
        method: 'message/send',
        params: { message: { role: 'user', parts: [{ kind: 'file', file: {} }] } },
      }),
    );
    const body = (await res.json()) as { error: { code: number; message: string } };

    expect(res.status).toBe(400);
    expect(body.error.code).toBe(-32052);
    expect(body.error.message).toContain('text parts only');
    expect(ran).toBe(false);
  });

  it('refuses a body that is not JSON-RPC 2.0', async () => {
    const handle = await serve(echo);
    const res = await post(handle.url, JSON.stringify({ method: 'message/send', params: {} }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32052);
  });

  it('sanitizes a thrown handler, and keeps a chosen refusal', async () => {
    const thrower = await serve(() => {
      throw new Error('connection string postgres://user:pw@host/db');
    });
    const thrown = (await (await post(thrower.url, sendMessage('hi'))).json()) as {
      error: { code: number; message: string };
    };
    expect(thrown.error.code).toBe(-32603);
    expect(thrown.error.message).not.toContain('postgres://');
    await thrower.close();
    open = undefined;

    const refuser = await serve((_req, reply) => {
      reply.fail(new Error('this alert is not mine to triage'));
    });
    const refused = (await (await post(refuser.url, sendMessage('hi'))).json()) as {
      error: { message: string };
    };
    expect(refused.error.message).toContain('not mine to triage');
  });
});

// ─── the error table, shared with clients ────────────────────────────

describe('agentCoreA2AErrorCode', () => {
  it('maps this library’s refusals onto the runtime’s published codes', () => {
    expect(agentCoreA2AErrorCode('ERR_SESSION_NOT_FOUND')).toBe(-32051);
    expect(agentCoreA2AErrorCode('invalid_params')).toBe(-32052);
    expect(agentCoreA2AErrorCode('ERR_ADMISSION_REFUSED')).toBe(-32053);
    // The retryable one: a client seeing -32054 must back off and retry,
    // because A2A clients do not do it on their own.
    expect(agentCoreA2AErrorCode('ERR_CONCURRENT_RUN')).toBe(-32054);
    expect(agentCoreA2AErrorCode('ERR_HOST_CLOSED')).toBe(-32054);
    expect(agentCoreA2AErrorCode(undefined)).toBe(-32603);
    expect(agentCoreA2AErrorCode('something-nobody-mapped')).toBe(-32603);
  });
});

// ─── the seam the adapter must not consume ───────────────────────────

describe('the card does not cost the consumer their own routes', () => {
  it('serves the card AND still calls a caller’s onUnhandled for everything else', async () => {
    let sawOther = false;
    const handle = await serve(echo, {
      onUnhandled: (
        _req: unknown,
        res: { writeHead: (n: number) => void; end: (s: string) => void },
      ) => {
        sawOther = true;
        res.writeHead(200);
        res.end('mine');
      },
    });

    expect((await fetch(`${handle.url}${A2A_AGENT_CARD_PATH}`)).status).toBe(200);
    expect(sawOther).toBe(false);

    expect(await (await fetch(`${handle.url}/mine`)).text()).toBe('mine');
    expect(sawOther).toBe(true);
  });
});

// ─── the claim and the capability must tell one story ────────────────

describe('what the card advertises is what the host declares', () => {
  it('declares no streaming capability, matching the card', async () => {
    const host = agentCoreA2AHost({ card: CARD, port: 0, hostname: '127.0.0.1' });
    // The bug this pins: `httpHost` declares `['streaming']` by default, and
    // `message/send` has nowhere to put a chunk. A host that claimed it would
    // pass `requireCapability` and then deliver nothing — and would say the
    // opposite of its own agent card. The conformance suite found this; this
    // test keeps it found.
    expect(host.capabilities).toEqual([]);

    const handle = await host.serve(echo);
    open = handle as HttpHostHandle;
    const card = (await (
      await fetch(`${(handle as HttpHostHandle).url}${A2A_AGENT_CARD_PATH}`)
    ).json()) as { capabilities: { streaming: boolean } };
    expect(card.capabilities.streaming).toBe(host.capabilities.includes('streaming'));
  });
});
