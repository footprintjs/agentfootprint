/**
 * A READ NEVER TAKES A PERSON'S INSTANCE AWAY (R2-12) — a redemption
 * (`artifact-head` / `artifact-get` / `answer-account`) and
 * `handle.artifactsForRequest` never build a pooled lane and never evict one.
 *
 * Before this fix both doors called `laneFor`, so at a door with no verifier
 * (where the session id is the key, by law) anybody naming made-up session ids
 * built one pooled instance per id and evicted the least recently used idle
 * session to make room — closing that person's tool sessions as `'evicted'`.
 *
 * The laws being pinned:
 *   • A session with a live lane is redeemed on it.
 *   • A session with no live lane and no stored conversation is the one
 *     not-found — no instance built, nothing evicted, nothing emitted.
 *   • A session with no live lane but a stored conversation (its instance was
 *     evicted) is redeemed by ONE reader instance held outside the pool — so
 *     the pool is exactly what the turns made it.
 *
 * Test types (Convention 3): security (the flood) · regression (a live
 * session and an evicted one still redeem) · boundary (the reader is built
 * once and stopped at close) · integration (through `standingAgent`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Agent, inMemoryArtifacts } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import type {
  HostHandle,
  StandingAgentHandle,
  StandingAgentOptions,
} from '../../src/hosting/index.js';
import { NEVER_MINTED, filingHost, redeem, type FilingHost } from './turnArtifactsHarness.js';
import type { ArtifactStore } from '../../src/artifacts/types.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.allSettled(closers.map((close) => close()));
  closers.length = 0;
});

/** A pooled door whose factory counts what it built, retired and evicted. */
async function pooledDoor(options: {
  readonly maxActiveSessions: number;
  readonly store?: () => ArtifactStore;
}) {
  const counts = { built: 0, stopped: 0, evictedToolCloses: 0 };
  const minted: string[] = [];
  const host: FilingHost = filingHost();
  const handle = (await standingAgent({
    agentFactory: () => {
      counts.built += 1;
      const agent = Agent.create({
        provider: mock({ reply: 'ok' }),
        model: 'm',
        artifacts: { store: options.store?.() ?? inMemoryArtifacts(), recordings: true },
      }).build();
      agent.on('agentfootprint.artifacts.minted', (event) => {
        const payload = event.payload as { ref: string; kind: string };
        if (payload.kind === 'recording/run') minted.push(payload.ref);
      });
      const closeToolSessions = agent.closeToolSessions.bind(agent);
      agent.closeToolSessions = (async (request: { reason?: string }) => {
        if (request?.reason === 'evicted') counts.evictedToolCloses += 1;
        return closeToolSessions(request as never);
      }) as typeof agent.closeToolSessions;
      const shutdown = agent.shutdown.bind(agent);
      agent.shutdown = (async (o?: unknown) => {
        counts.stopped += 1;
        return shutdown(o as never);
      }) as typeof agent.shutdown;
      return agent;
    },
    maxActiveSessions: options.maxActiveSessions,
    sessions: memorySessions(),
    host,
  } as StandingAgentOptions<HostHandle>)) as HostHandle & StandingAgentHandle;
  closers.push(() => handle.close());
  return { host, handle, counts, minted };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('R2-12 — a flood of redemptions for made-up sessions at an OPEN door', () => {
  it('builds no instance and retires no live lane — no tool session closes as evicted', async () => {
    const { host, handle, counts, minted } = await pooledDoor({ maxActiveSessions: 2 });
    await host.deliver({ sessionId: 'sA', input: 'hi' });
    expect(counts.built).toBe(1);

    const flood = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        host.deliver({ sessionId: `junk-${i}`, artifact: { op: 'head', ref: NEVER_MINTED } }),
      ),
    );
    expect(flood.map((d) => d.code)).toEqual(Array(12).fill('ERR_ARTIFACT_NOT_FOUND'));
    for (let i = 0; i < 5; i++) {
      expect(await handle.artifactsForRequest({ sessionId: `seam-junk-${i}` })).toEqual({
        bound: false,
        reason: 'not-found',
      });
    }
    await settle();
    expect(counts).toEqual({ built: 1, stopped: 0, evictedToolCloses: 0 });

    // …and the live session is served on its own lane, as before.
    const own = await redeem(host, 'sA', minted[0] as string);
    expect(own.error).toBeUndefined();
    expect(counts.built).toBe(1);
  });
});

describe('R2-12 — a session whose instance was evicted still redeems, without evicting anyone', () => {
  it('is answered by the one reader outside the pool (one shared store)', async () => {
    const store = inMemoryArtifacts();
    const { host, handle, counts, minted } = await pooledDoor({
      maxActiveSessions: 1,
      store: () => store,
    });
    await host.deliver({ sessionId: 'sA', input: 'hi' });
    await host.deliver({ sessionId: 'sB', input: 'hi' }); // evicts sA's instance
    await settle();
    expect(counts).toMatchObject({ built: 2, stopped: 1 });

    for (let i = 0; i < 3; i++) {
      const again = await redeem(host, 'sA', minted[0] as string);
      expect(again.error).toBeUndefined();
    }
    const seam = await handle.artifactsForRequest({ sessionId: 'sA' });
    if (!seam.bound) throw new Error(seam.reason);
    expect(await seam.artifacts.head(minted[0] as string)).not.toBeNull();
    await settle();
    // One reader, built once; sB's live instance untouched.
    expect(counts).toMatchObject({ built: 3, stopped: 1 });

    // sB is still live: its next turn runs on its own instance.
    await host.deliver({ sessionId: 'sB', input: 'again' });
    expect(counts.built).toBe(3);

    await handle.close();
    expect(counts.stopped).toBe(3); // sB's instance and the reader
  });
});
