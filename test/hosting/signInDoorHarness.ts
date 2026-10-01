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

/**
 * The door's waits, RECORDED instead of slept: pass `sleep` as the door's
 * `_sleep`, and `of(login)` returns what that one login asked to wait. A wait
 * of 0 ms or less is no wait (`lib/sleep`) and is not recorded, so on a door
 * with no minimum answer time (the harness's `minimumResponseMs: 0`) what is
 * recorded is exactly the attempt limiter's delay — its decision, read off the
 * door, with none of the login's own time (the scrypt check) in it.
 *
 * Every wait here ends at once, so it ends the same whether the door awaits it
 * or not: what this reads is the DECISION, never that the door applied it.
 * That the door waits the delay before it checks the password is its own law,
 * with each wait held one turn of the event loop (sign-in-door-delay.test.ts).
 */
export function doorWaits(): {
  readonly sleep: (ms: number) => Promise<void>;
  of(run: () => Promise<unknown>): Promise<number[]>;
} {
  const asked: number[] = [];
  return {
    sleep: async (ms) => {
      if (ms > 0) asked.push(ms);
    },
    async of(run) {
      const from = asked.length;
      await run();
      return asked.slice(from);
    },
  };
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
