/**
 * A sign-in door mounted the way an app mounts it: in front of nodeHost's own
 * routes (`onUnhandled`), the host carrying the sign-in cookie, and
 * standingAgent verifying with the door's sign-ins.
 */

import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import {
  memorySessions,
  memorySignIns,
  nodeHost,
  signInDoor,
  standingAgent,
  type IngressRecord,
  type MemorySignIns,
  type SignInDoor,
  type SignInDoorOptions,
} from '../../src/hosting/index.js';
import { hashPassword, localPasswords } from '../../src/identity.js';

/** Fast scrypt for tests (the floor); production hashes use the default. */
export const TEST_COST = { log2N: 14, r: 8, p: 1 } as const;

let cachedUsers: string | undefined;
/** `alice`/`bob` with passwords `alice-pw`/`bob-pw`, hashed once per test file. */
export async function testUsers(): Promise<string> {
  cachedUsers ??= [
    `alice:${await hashPassword('alice-pw', TEST_COST)}`,
    `bob:${await hashPassword('bob-pw', TEST_COST)}`,
  ].join(',');
  return cachedUsers;
}

export interface MountedDoor {
  readonly url: string;
  readonly port: number;
  readonly door: SignInDoor;
  readonly store: MemorySignIns;
  readonly records: IngressRecord[];
  close(): Promise<void>;
}

export async function mountDoor(extra: Partial<SignInDoorOptions> = {}): Promise<MountedDoor> {
  const store = memorySignIns({ warn: () => undefined });
  const port = await freePort();
  const door = signInDoor({
    passwords: localPasswords(await testUsers()),
    store,
    publicUrl: `http://127.0.0.1:${port}`,
    production: false,
    minimumResponseMs: 0,
    limits: { backoffMs: 0 },
    ...extra,
  });
  const records: IngressRecord[] = [];
  const host = nodeHost({
    port,
    hostname: '127.0.0.1',
    signIn: door.hostSignIn,
    onUnhandled: (req, res) => {
      void door.handle(req, res).then((handled) => {
        if (!handled) res.writeHead(404).end();
      });
    },
  });
  const handle = await standingAgent({
    agent: Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build(),
    sessions: memorySessions(),
    host,
    identity: door.identity,
    onIngressDecision: (r) => records.push(r),
  });
  await host.serveConversations((conversation) => {
    conversation.onFrame((frame) => conversation.send(`echo:${frame}`));
  });
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    door,
    store,
    records,
    close: () => handle.close(),
  };
}

async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      server.close(() => resolve(address.port));
    });
  });
}

/** One HTTP call; returns status, JSON body, raw text, and headers. */
export async function call(
  url: string,
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; text: string; body: Record<string, unknown>; headers: Headers }> {
  const res = await fetch(`${url}${path}`, {
    method: init.method ?? 'GET',
    headers: init.headers ?? {},
    ...(init.body !== undefined && { body: init.body }),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, text, body, headers: res.headers };
}

/** POST /auth/login with JSON; returns the response and the cookie pair to send back. */
export async function login(
  url: string,
  username: string,
  password: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown>; cookie?: string; setCookie?: string }> {
  const res = await call(url, '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.get('set-cookie') ?? undefined;
  const pair = setCookie?.split(';')[0];
  return {
    status: res.status,
    body: res.body,
    ...(setCookie !== undefined && { setCookie }),
    ...(pair !== undefined && !pair.endsWith('=') && { cookie: pair }),
  };
}
