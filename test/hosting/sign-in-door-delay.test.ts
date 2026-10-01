/**
 * The sign-in door WAITS the attempt limiter's delay before it checks the
 * password (`door.ts` · `signInDoor` → `login`: `await wait(verdict.delayMs)`).
 *
 * WHY IT IS A LAW. The attempt limiter decides how long a client that keeps
 * guessing must wait (`limits.ts` · `attemptLimiter`: a back-off that grows to
 * 8 × `backoffMs`). Deciding is half of it. The door must also APPLY the
 * decision, before the password reaches the checker: a guess the delay does
 * not hold back reaches the checker (a directory, say) at full speed, and that
 * is the brute force the delay exists to slow. One dropped `await`
 * (`void wait(verdict.delayMs)`) leaves every decision exactly right and turns
 * the slow-down off.
 *
 * The X-Forwarded-For tests read the limiter's DECISION off the door
 * (`signInDoorHarness.ts` · `doorWaits`), because a login's wall time is
 * mostly the password check, so timing a login measured the check. But
 * `doorWaits` ends every wait at once, and a wait that ends at once ends the
 * same whether the door awaits it or not. So those tests cannot see whether
 * the decision is APPLIED: with the `await` dropped, every door test passed.
 * The timed tests they replaced had caught it. This file guards it with no
 * clock.
 *
 * HOW. The door's wait is HELD: `_sleep` records `wait <ms>` and ends on the
 * event loop's next turn (`setImmediate`), recording `waited <ms>` as it ends.
 * The checker records `check`, and the server records `answer` at `res.end`.
 * The order of those steps IS the law:
 *  - A door that awaits the delay checks in the wait's own continuation, so
 *    `check` comes after `waited`, every run, whatever the load.
 *  - A door that does not await it reaches the check first, every run. Its
 *    path from the wait to the check is promise continuations only, with no
 *    I/O between them, and the event loop takes its next turn only after
 *    every pending continuation has run.
 * Reverted in a scratch copy (`void wait(verdict.delayMs)`), the order reads
 * `wait 480`, `check`, `answer`, `waited 480`, and this test fails every run.
 * The second argument rests on the door as it is. If the door ever puts I/O
 * between the delay and the check (a store lookup, say), a door that does not
 * await could still be inside that I/O when the hold ends, and pass; the hold
 * would then have to outlast that I/O.
 *
 * WHAT A GREEN RUN DOES NOT PROVE: how LONG a wait lasts (`lib/sleep` owns
 * that, test/lib/sleep.test.ts), or how long the limiter decides it should be
 * (`limits.ts`; the X-Forwarded-For tests for the address it is keyed on).
 * The minimum answer time is the door's other wait and has its own law
 * (sign-in-door-minimum.test.ts).
 */

import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { memorySignIns, signInDoor, type SignInDoorOptions } from '../../src/hosting/index.js';
import { login } from './signInDoorHarness.js';

interface OrderedDoor {
  readonly url: string;
  /** Each step of each login, in order: `wait <ms>`, `waited <ms>`, `check`, `answer`. */
  readonly order: string[];
  close(): Promise<void>;
}

const open: OrderedDoor[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});

/**
 * The door alone on a bare server, so `res.end` is the door's own answer. Its
 * waits are HELD for one turn of the event loop, and every step is recorded.
 */
async function orderedDoor(extra: Partial<SignInDoorOptions>): Promise<OrderedDoor> {
  const order: string[] = [];
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const door = signInDoor({
    // Wrong, at once: the check's own time plays no part in what is asserted.
    passwords: {
      strategy: 'test-ordered',
      check: async () => {
        order.push('check');
        return undefined;
      },
    },
    store: memorySignIns({ warn: () => undefined }),
    publicUrl: `http://127.0.0.1:${port}`,
    production: false,
    // No minimum, so the answer's own wait asks for no time: every wait that
    // does is the limiter's.
    minimumResponseMs: 0,
    warn: () => undefined,
    // HELD, never slept. A wait of 0 ms or less is no wait (`lib/sleep`), so
    // it ends at once and is not recorded.
    _sleep: (ms) => {
      if (ms <= 0) return Promise.resolve();
      order.push(`wait ${ms}`);
      return new Promise<void>((resolve) =>
        setImmediate(() => {
          order.push(`waited ${ms}`);
          resolve();
        }),
      );
    },
    ...extra,
  });
  server.on('request', (req, res: ServerResponse) => {
    const end = res.end.bind(res) as (...args: unknown[]) => ServerResponse;
    res.end = ((...args: unknown[]) => {
      order.push('answer');
      return end(...args);
    }) as typeof res.end;
    void door.handle(req, res);
  });
  const served: OrderedDoor = {
    url: `http://127.0.0.1:${port}`,
    order,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  open.push(served);
  return served;
}

describe('the sign-in door — the attempt delay is waited before the password is checked', () => {
  it('a delayed attempt goes wait, waited, check, answer — never check before waited', async () => {
    // One address. Past its first attempt its delay is at the cap: 8 × 60 ms.
    const door = await orderedDoor({ limits: { perName: 100, perAddress: 2, backoffMs: 60 } });

    // The first attempt has no delay: no wait, and the check at once.
    expect((await login(door.url, 'first', 'wrong')).status).toBe(401);
    expect(door.order.splice(0)).toEqual(['check', 'answer']);

    // Every later attempt waits 480 ms, and is checked only once that wait
    // has ENDED.
    for (const name of ['second', 'third']) {
      expect((await login(door.url, name, 'wrong')).status).toBe(401);
      expect(door.order.splice(0), name).toEqual(['wait 480', 'waited 480', 'check', 'answer']);
    }
  });
});
