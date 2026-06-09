/**
 * AgentCore Runtime handler — contract + robustness tests for the deploy template
 * (examples/deploy/agentcore-runtime.ts). Covers the AgentCore HTTP contract
 * (/ping, /invocations), routing, and the error paths the happy-path example
 * doesn't: malformed JSON, a throwing agent, and the no-stack-leak guarantee.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { agentCoreHandler } from '../../examples/deploy/agentcore-runtime.js';

// Minimal agent stub — the handler only needs `.run({ message })`.
const agentStub = (run: (i: { message: string }) => Promise<string>) =>
  ({ run } as unknown as Parameters<typeof agentCoreHandler>[0]);

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

async function listen(agent: Parameters<typeof agentCoreHandler>[0]): Promise<string> {
  server = createServer(agentCoreHandler(agent));
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const addr = server.address();
  return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}

describe('agentCoreHandler — AgentCore Runtime HTTP contract', () => {
  it('GET /ping → 200 Healthy with a unix timestamp', async () => {
    const base = await listen(agentStub(async () => 'x'));
    const res = await fetch(`${base}/ping`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('Healthy');
    expect(typeof body.time_of_last_update).toBe('number');
  });

  it('POST /invocations → 200 with the agent answer and prompt passed through', async () => {
    const base = await listen(agentStub(async ({ message }) => `echo:${message}`));
    const res = await fetch(`${base}/invocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ response: 'echo:hello', status: 'success' });
  });

  it('unknown route → 404', async () => {
    const base = await listen(agentStub(async () => 'x'));
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it('malformed JSON body → 500 (not a crash)', async () => {
    const base = await listen(agentStub(async () => 'x'));
    const res = await fetch(`${base}/invocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(500);
  });

  it('a throwing agent → 500 and does NOT leak a stack trace', async () => {
    const base = await listen(
      agentStub(async () => {
        const e = new Error('boom');
        e.stack = 'Error: boom\n    at secret/internal/path.ts:42';
        throw e;
      }),
    );
    const res = await fetch(`${base}/invocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x' }),
    });
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe('boom'); // message only
    expect(JSON.stringify(body)).not.toContain('secret/internal/path.ts'); // no stack
  });

  it('missing prompt → treated as empty message (no crash)', async () => {
    const base = await listen(agentStub(async ({ message }) => `len:${message.length}`));
    const res = await fetch(`${base}/invocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notPrompt: 1 }),
    });
    expect((await res.json()).response).toBe('len:0');
  });
});
