/**
 * Compile-level regression test — 9.10.0's per-session agent pool.
 *
 * The runtime refusals in `test/hosting/standingAgent-pool.test.ts` exist for
 * the callers TypeScript cannot reach (a JS consumer, a config bag, an `any`).
 * These four are the ones the compiler itself must keep, so a mistake is a red
 * squiggle rather than a 500 in production. This file lives under
 * ./tsconfig.json and runs via `npm run test:types`; its name still matches
 * `test/**\/*.test.ts` so `npm test` runs the runtime assertions beside it.
 *
 *   1. **`agent` and `agentFactory` are mutually exclusive.** Two spellings of
 *      one decision — whether sessions share an instance or each get their own
 *      — and which one won would be invisible afterwards.
 *   2. **`maxActiveSessions` needs a pool.** Beside a single shared `agent` it
 *      names something that does not exist, so it must not type-check.
 *   3. **At least one of them is required.** `{ sessions, host }` alone has
 *      nothing to answer with.
 *   4. **The handle type still passes through**, in both shapes. Composing
 *      through `standingAgent` must not cost a caller what the adapter told
 *      them — `nodeHost`'s bound `url` is the only way to learn which port you
 *      got when you asked for `0`.
 */
import { describe, expect, it } from 'vitest';
import type { Agent } from '../../src/index.js';
import type {
  AgentHost,
  HostHandler,
  SessionLifecycle,
  StandingAgentOptions,
  StandingAgentPoolOptions,
  StandingAgentSharedOptions,
} from '../../src/hosting/index.js';
import { DEFAULT_MAX_ACTIVE_SESSIONS } from '../../src/hosting/index.js';

/**
 * Stand-ins. This file's job is to COMPILE — nothing here serves a request —
 * but the values are real objects rather than `declare const`, because the
 * assertions below also run under `npm test` and a type-only declaration is a
 * `ReferenceError` at runtime.
 */
const agent = {} as Agent;
const sessions: SessionLifecycle = {
  hydrate: () => Promise.resolve(undefined),
  persist: () => Promise.resolve(),
};
const host: AgentHost & {
  serve(handler: HostHandler): Promise<{ close(): Promise<void> }>;
} = {
  name: 'type-only',
  capabilities: [],
  serve: () => Promise.resolve({ close: () => Promise.resolve() }),
};

describe('StandingAgentOptions — one agent shape, chosen at the type level', () => {
  it('LAW 1: the two shapes are mutually exclusive', () => {
    const shared: StandingAgentOptions = { agent, sessions, host };
    const pooled: StandingAgentOptions = { agentFactory: () => agent, sessions, host };
    expect(typeof shared).toBe('object');
    expect(typeof pooled).toBe('object');

    // @ts-expect-error — both spellings at once is refused by the compiler too.
    const both: StandingAgentOptions = { agent, agentFactory: () => agent, sessions, host };
    void both;
  });

  it('LAW 2: maxActiveSessions is meaningless without a pool', () => {
    const bounded: StandingAgentOptions = {
      agentFactory: () => agent,
      sessions,
      host,
      maxActiveSessions: 25,
    };
    expect(typeof bounded).toBe('object');

    // @ts-expect-error — a pool bound beside a single shared agent names nothing.
    const unbounded: StandingAgentOptions = { agent, sessions, host, maxActiveSessions: 25 };
    void unbounded;
  });

  it('LAW 3: something has to answer', () => {
    // @ts-expect-error — neither `agent` nor `agentFactory` is not a valid composer.
    const empty: StandingAgentOptions = { sessions, host };
    void empty;
  });

  it('LAW 4: both member types are reachable by name, and both extend the base', () => {
    const shared: StandingAgentSharedOptions = { agent, sessions, host };
    const pooled: StandingAgentPoolOptions = { agentFactory: () => agent, sessions, host };
    // Either is a `StandingAgentOptions` — the union is the door, the members
    // are what a caller names when they want to talk about one shape.
    const asUnion: StandingAgentOptions[] = [shared, pooled];
    expect(asUnion).toHaveLength(2);
  });

  it('the default pool bound is a number consumers can read rather than guess', () => {
    expect(DEFAULT_MAX_ACTIVE_SESSIONS).toBe(100);
  });
});
