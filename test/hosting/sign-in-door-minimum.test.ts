/**
 * The sign-in door's minimum answer time is measured on the MONOTONIC clock
 * and waited in full (`door.ts` · `signInDoor` → `login` → `answer`).
 *
 * WHY IT IS A LAW. Every login answer waits until `minimumResponseMs` has
 * passed since the login started, so "no such user" and "wrong password"
 * cannot be told apart by how fast they come back. That is a promise about a
 * DURATION, and the door used to take it off its epoch clock `now`
 * (`Date.now`). Epoch milliseconds are whole: a login that started late in one
 * millisecond and reached its answer early in a later one asked to wait up to
 * 1 ms too little, so the answer went out before the minimum. And an epoch
 * clock jumps when the system time is set: an hour ahead mid-login, and the
 * answer went out at once. The deadline is now one `performance.now()`
 * reading, and the wait is `lib/sleep`'s, which does not end before that clock
 * has passed it.
 *
 *   L1 Deterministic — the epoch clock jumps an hour ahead, then an hour back,
 *      while the password is checked. The wait the door asks for still lies in
 *      [MIN − span, MIN], where `span` is this test's own monotonic span around
 *      the login (it contains the door's). Taking the deadline off `now` again
 *      fails both directions.
 *   L2 Census — 400 logins, each timed AT THE SERVER with `performance.now()`
 *      from the request's arrival to `res.end`: none under the minimum. It
 *      cannot fail while the law holds — every span contains the door's
 *      deadline, read off the same clock, and the wait does not end before it.
 *      Reverted in a scratch copy (macOS, Node 22, 20 runs each, load
 *      120–310): with the deadline back on `now`, 11–33 of the 400 answered
 *      early (the tree before this law: 5–31); with a bare `setTimeout` wait,
 *      120–196. This door: none. The minimum is 5 ms because the shortfall it
 *      hunts is under a millisecond whatever the minimum: at 40 ms the old
 *      door showed 3–8 early per 200 logins, at 5 ms 5–11, in a sixth of the
 *      time.
 *
 * WHAT A GREEN RUN DOES NOT PROVE: a maximum, or that every outcome takes the
 * SAME time — a loaded host answers late, and a password check slower than the
 * minimum (a directory bind, a high scrypt cost) shows through it.
 */

import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import {
  memorySignIns,
  signInDoor,
  type PasswordChecker,
  type SignInDoorOptions,
} from '../../src/hosting/index.js';
import { login } from './signInDoorHarness.js';

/** Answers at once: the login's own work stays far under the minimum, so every answer WAITS. */
const INSTANT: PasswordChecker = { strategy: 'test-instant', check: async () => undefined };

interface ServedDoor {
  readonly url: string;
  /** Each answer's time at the server, request arrival → `res.end`, on the monotonic clock. */
  readonly spans: number[];
  close(): Promise<void>;
}

const open: ServedDoor[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});

/** The door alone on a bare server, so an answer is timed from the moment its request arrives. */
async function serveDoor(extra: Partial<SignInDoorOptions>): Promise<ServedDoor> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const door = signInDoor({
    passwords: INSTANT,
    store: memorySignIns({ warn: () => undefined }),
    publicUrl: `http://127.0.0.1:${port}`,
    production: false,
    limits: { backoffMs: 0 },
    warn: () => undefined,
    ...extra,
  });
  const spans: number[] = [];
  server.on('request', (req, res: ServerResponse) => {
    const arrived = performance.now();
    const end = res.end.bind(res) as (...args: unknown[]) => ServerResponse;
    res.end = ((...args: unknown[]) => {
      spans.push(performance.now() - arrived);
      return end(...args);
    }) as typeof res.end;
    void door.handle(req, res);
  });
  const served: ServedDoor = {
    url: `http://127.0.0.1:${port}`,
    spans,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  open.push(served);
  return served;
}

const HOUR = 3_600_000;

describe('the sign-in door — the minimum answer time runs on the monotonic clock', () => {
  it('L1: the epoch clock jumping an hour ahead or back mid-login does not move the minimum', async () => {
    // The most the door takes. The recorded wait is never slept, so it costs
    // nothing, and no host is slow enough to use it up.
    const MIN = 10_000;
    let offset = 0;
    let jump = 0;
    const asked: number[] = [];
    const door = await serveDoor({
      minimumResponseMs: MIN,
      now: () => Date.now() + offset,
      // The system time is set while the password is being checked.
      passwords: {
        strategy: 'test-clock-jump',
        check: async () => {
          offset += jump;
          return undefined;
        },
      },
      _sleep: async (ms) => {
        asked.push(ms);
      },
    });
    for (const [i, by] of [HOUR, -HOUR].entries()) {
      jump = by;
      const t0 = performance.now();
      const answer = await login(door.url, `jump-${i}`, 'wrong');
      const span = performance.now() - t0;
      expect(answer.status).toBe(401);
      // The answer's wait is the last one a login asks for.
      const minimumWait = asked.at(-1) as number;
      expect(minimumWait, `jump ${by} ms`).toBeGreaterThanOrEqual(MIN - span);
      expect(minimumWait, `jump ${by} ms`).toBeLessThanOrEqual(MIN);
    }
  });

  it('L2: a census of 400 logins — none answered before the minimum, timed at the server', async () => {
    const MIN = 5;
    const N = 400;
    const door = await serveDoor({ minimumResponseMs: MIN });
    for (let i = 0; i < N; i += 1) {
      expect((await login(door.url, `census-${i}`, 'wrong')).status).toBe(401);
    }
    expect(door.spans).toHaveLength(N);
    const early = door.spans.filter((span) => span < MIN);
    const shortest = Math.min(...door.spans).toFixed(3);
    expect(early, `${early.length} of ${N} answered early; shortest ${shortest} ms`).toEqual([]);
  }, 30_000); // 400 logins in a row: 3–4.3 s measured at load 155–193
});
