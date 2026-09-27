/**
 * `handle.artifactsForRequest` verifies a request the way the TURN door does —
 * the sign-in key included.
 *
 * Why this file exists: through 9.117.0 the seam called
 * `verifyRequestIdentity` without `HostRequest.signInKey`, so a person signed
 * in by the cookie door (`local-password`, `directory-password`, browser OIDC)
 * was always `'unverified'` there — while bearer, proxy and open doors bound.
 * The field app had to answer those requests "not carried" and file nothing.
 *
 * The laws being pinned:
 *   • ONE verification funnel: for every door strategy, the seam accepts and
 *     refuses exactly the requests the turn door accepts and refuses, with the
 *     same error class and failure word (the property block at the bottom).
 *   • The request the transport built goes in as it is — a `HostRequest`
 *     (and a `HostConversation`) IS an `ArtifactsForRequestInput`.
 *   • A cookie-signed-in owner binds; another cookie-signed-in person gets the
 *     one not-found; an ended / expired sign-in is `'unverified'` (`expired`);
 *     a sign-in store outage is `'unavailable'` (503, never 401); a key AND a
 *     bearer token are `'unverified'` (`two-credentials`).
 *   • A seam filing carries no `origin` — the seam executes no run, so it has
 *     no run id to vouch for, and a caller's own is dropped.
 *
 * Test types (Convention 3): integration (through `standingAgent`) · security
 * (a stranger's sign-in, an ended sign-in, two credentials) · scenario (file
 * through the seam, redeem on the wire) · boundary (store outage) · property
 * (seam ≡ turn door over strategies × requests) · regression pin (the 9.117.0
 * gap).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Agent, inMemoryArtifacts } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import {
  IdentityNotVerifiedError,
  memorySessions,
  signInKeyOf,
  signInSource,
  standingAgent,
  VerifierUnavailableError,
  type AgentHost,
  type ArtifactsForRequestInput,
  type ArtifactsForRequestResult,
  type DoorIdentity,
  type HostHandle,
  type HostHandler,
  type HostReply,
  type HostRequest,
  type StandingAgentHandle,
  type StandingAgentOptions,
} from '../../src/hosting/index.js';
import { fakeSignInStore, signInAs, type FakeSignInStore } from './fakeSignIns.js';
import { ALICE, verifier } from './turnArtifactsHarness.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.allSettled(closers.map((close) => close()));
  closers.length = 0;
});

// ─── A host whose every terminal is observable ──────────────────────

type Answer =
  | { readonly kind: 'complete'; readonly output: string }
  | { readonly kind: 'artifact'; readonly data: unknown }
  | { readonly kind: 'fail'; readonly error: Error }
  | { readonly kind: 'other' };

interface ProbeHost extends AgentHost {
  ask(request: HostRequest): Promise<Answer>;
}

function probeHost(): ProbeHost {
  let handler: HostHandler | undefined;
  return {
    name: 'probeHost',
    capabilities: [],
    serve(incoming) {
      handler = incoming;
      return Promise.resolve({ close: async () => undefined });
    },
    async ask(request) {
      let answer: Answer = { kind: 'other' };
      let settled = false;
      const end = (value: Answer): void => {
        if (settled) return;
        settled = true;
        answer = value;
      };
      const reply: HostReply = {
        complete: (output) => end({ kind: 'complete', output }),
        awaiting: () => end({ kind: 'other' }),
        artifact: (artifact) =>
          end({ kind: 'artifact', data: (artifact as { data?: unknown }).data }),
        fail: (error) => end({ kind: 'fail', error }),
      };
      await handler?.(request, reply);
      return answer;
    },
  };
}

interface Served {
  readonly host: ProbeHost;
  readonly handle: HostHandle & StandingAgentHandle;
  readonly store: FakeSignInStore;
}

async function serve(
  identity: (signIn: ReturnType<typeof signInSource>) => DoorIdentity | undefined,
): Promise<Served> {
  const store = fakeSignInStore();
  const signIns = signInSource({ store, idleMinutes: 60 });
  const host = probeHost();
  const door = identity(signIns);
  const handle = await standingAgent({
    agent: Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'm',
      artifacts: { store: inMemoryArtifacts() },
    }).build(),
    sessions: memorySessions(),
    host,
    ...(door !== undefined && { identity: door }),
  } as StandingAgentOptions<HostHandle>);
  closers.push(() => handle.close());
  return { host, handle, store };
}

/** A turn through the wire, so the session is stored under its owner. */
async function turn(host: ProbeHost, request: Omit<HostRequest, 'input'>): Promise<Answer> {
  return host.ask({ input: 'hi', ...request });
}

const note = (text: string) => ({ kind: 'note/app', mediaType: 'text/plain', data: text });

function refusalOf(result: ArtifactsForRequestResult): { reason: string; error?: Error } {
  if (result.bound) throw new Error('expected a refusal, got a binding');
  return { reason: result.reason, ...(result.error !== undefined && { error: result.error }) };
}

// ─── 1. SCENARIO — a person signed in by the cookie ────────────────

describe('artifactsForRequest — a person signed in by the cookie door', () => {
  it("the owner binds, files, and the wire redeems the filing for the owner's sign-in", async () => {
    const { host, handle, store } = await serve((signIn) => ({ signIn }));
    const alice = await signInAs(store, 'alice');
    expect(await turn(host, { sessionId: 'sA', signInKey: alice.key })).toMatchObject({
      kind: 'complete',
    });

    const scoped = await handle.artifactsForRequest({ sessionId: 'sA', signInKey: alice.key });
    if (!scoped.bound) throw new Error(`alice was refused: ${scoped.reason}`);
    const filed = await scoped.artifacts.put(note('from the seam'));

    const redeemed = await host.ask({
      input: '',
      sessionId: 'sA',
      signInKey: alice.key,
      artifact: { op: 'get', ref: filed.ref },
    });
    expect(redeemed).toEqual({ kind: 'artifact', data: 'from the seam' });
  });

  it('another cookie-signed-in person gets the one not-found — nothing bound', async () => {
    const { host, handle, store } = await serve((signIn) => ({ signIn }));
    const alice = await signInAs(store, 'alice');
    const bob = await signInAs(store, 'bob');
    await turn(host, { sessionId: 'sA', signInKey: alice.key });

    expect(await handle.artifactsForRequest({ sessionId: 'sA', signInKey: bob.key })).toEqual({
      bound: false,
      reason: 'not-found',
    });
  });

  it("an ended, an expired and a never-issued sign-in are 'unverified' with the turn door's 'expired'", async () => {
    const { host, handle, store } = await serve((signIn) => ({ signIn }));
    const alice = await signInAs(store, 'alice');
    await turn(host, { sessionId: 'sA', signInKey: alice.key });

    const stale = await signInAs(store, 'alice', { now: Date.now() - 9 * 3_600_000, hours: 8 });
    const ended = await signInAs(store, 'alice');
    store.rows.delete(ended.key);
    for (const key of [stale.key, ended.key, signInKeyOf('never-issued')]) {
      const refused = refusalOf(
        await handle.artifactsForRequest({ sessionId: 'sA', signInKey: key }),
      );
      expect(refused.reason).toBe('unverified');
      expect(refused.error).toBeInstanceOf(IdentityNotVerifiedError);
      expect((refused.error as IdentityNotVerifiedError).failure).toBe('expired');

      const atTurnDoor = await turn(host, { sessionId: 'sA', signInKey: key });
      expect(atTurnDoor.kind).toBe('fail');
      expect((atTurnDoor as { error: IdentityNotVerifiedError }).error.failure).toBe('expired');
    }
  });

  it("a sign-in store that cannot answer is 'unavailable' — an outage, never a signed-out caller", async () => {
    const { host, handle, store } = await serve((signIn) => ({ signIn }));
    const alice = await signInAs(store, 'alice');
    await turn(host, { sessionId: 'sA', signInKey: alice.key });

    store.down = true;
    const refused = refusalOf(
      await handle.artifactsForRequest({ sessionId: 'sA', signInKey: alice.key }),
    );
    expect(refused.reason).toBe('unavailable');
    expect(refused.error).toBeInstanceOf(VerifierUnavailableError);
    const atTurnDoor = await turn(host, { sessionId: 'sA', signInKey: alice.key });
    expect((atTurnDoor as { error?: Error }).error).toBeInstanceOf(VerifierUnavailableError);
  });

  it("a sign-in key AND a bearer token are two credentials — 'unverified', as at the turn door", async () => {
    const { host, handle, store } = await serve((signIn) => ({
      verify: verifier().verify,
      signIn,
    }));
    const alice = await signInAs(store, 'alice');
    await turn(host, { sessionId: 'sA', signInKey: alice.key });

    const refused = refusalOf(
      await handle.artifactsForRequest({ sessionId: 'sA', headers: ALICE, signInKey: alice.key }),
    );
    expect(refused.reason).toBe('unverified');
    expect((refused.error as IdentityNotVerifiedError).failure).toBe('two-credentials');
    const atTurnDoor = await turn(host, { sessionId: 'sA', headers: ALICE, signInKey: alice.key });
    expect((atTurnDoor as { error: IdentityNotVerifiedError }).error.failure).toBe(
      'two-credentials',
    );
  });

  it('REGRESSION (9.117.0): without the key, the cookie-signed-in owner is not known — the key is what carries them', async () => {
    const { host, handle, store } = await serve((signIn) => ({ signIn }));
    const alice = await signInAs(store, 'alice');
    await turn(host, { sessionId: 'sA', signInKey: alice.key });
    const withoutKey = refusalOf(await handle.artifactsForRequest({ sessionId: 'sA' }));
    expect(withoutKey.reason).toBe('unverified');
    expect(
      await handle.artifactsForRequest({ sessionId: 'sA', signInKey: alice.key }),
    ).toMatchObject({
      bound: true,
    });
  });
});

// ─── 2. INTEGRATION — the request the transport built goes in as it is ──

describe('artifactsForRequest — handed the HostRequest itself', () => {
  it('a handler passes its own request; the sign-in key rides along and nothing is forgotten', async () => {
    const { host, handle, store } = await serve((signIn) => ({ signIn }));
    const alice = await signInAs(store, 'alice');
    await turn(host, { sessionId: 'sA', signInKey: alice.key });

    const request: HostRequest = {
      input: 'a panel read, not a turn',
      sessionId: 'sA',
      headers: { 'x-trace': 't-1' },
      signInKey: alice.key,
    };
    const input: ArtifactsForRequestInput = request; // a HostRequest IS an input
    expect(await handle.artifactsForRequest(input)).toMatchObject({ bound: true });
  });
});

// ─── 3. ORIGIN — a seam filing names no run ─────────────────────────

describe('artifactsForRequest — origin', () => {
  it('a filing carries no origin, and a caller-supplied origin is dropped', async () => {
    const { host, handle, store } = await serve((signIn) => ({ signIn }));
    const alice = await signInAs(store, 'alice');
    await turn(host, { sessionId: 'sA', signInKey: alice.key });
    const scoped = await handle.artifactsForRequest({ sessionId: 'sA', signInKey: alice.key });
    if (!scoped.bound) throw new Error(`alice was refused: ${scoped.reason}`);

    const plain = await scoped.artifacts.put(note('plain'));
    const forged = await scoped.artifacts.put({
      ...note('forged'),
      origin: { runId: 'someone-elses-run' },
    } as Parameters<typeof scoped.artifacts.put>[0]);
    expect(plain.origin).toBeUndefined();
    expect(forged.origin).toBeUndefined();
  });
});

// ─── 4. PROPERTY — the seam and the turn door judge alike ───────────

type Verdict = 'accepted' | string;

function turnVerdict(answer: Answer): Verdict {
  if (answer.kind !== 'fail') return 'accepted';
  const error = answer.error as { code?: string; failure?: string };
  if (
    error.code === 'ERR_IDENTITY_NOT_VERIFIED' ||
    error.code === 'ERR_IDENTITY_VERIFIER_UNAVAILABLE'
  ) {
    return `${error.code}:${error.failure ?? '-'}`;
  }
  return 'accepted'; // judged, then refused for something that is not identity
}

function seamVerdict(result: ArtifactsForRequestResult): Verdict {
  if (result.bound) return 'accepted';
  if (result.reason !== 'unverified' && result.reason !== 'unavailable') return 'accepted';
  const error = result.error as { code?: string; failure?: string } | undefined;
  return `${error?.code ?? '?'}:${error?.failure ?? '-'}`;
}

describe('PROPERTY — for every door strategy, the seam accepts and refuses what the turn door does', () => {
  const strategies: Record<
    string,
    (signIn: ReturnType<typeof signInSource>) => DoorIdentity | undefined
  > = {
    open: () => undefined,
    bearer: () => ({ verify: verifier().verify }),
    'bearer, anonymous allowed': () => ({ verify: verifier().verify, allowAnonymous: true }),
    'sign-in only': (signIn) => ({ signIn }),
    'bearer + sign-in': (signIn) => ({ verify: verifier().verify, signIn }),
    'proxy header': () => ({ verify: verifier().verify, tokenHeader: 'x-forwarded-access-token' }),
  };

  interface Case {
    readonly name: string;
    readonly request: (keys: { alice: string; ended: string }) => Omit<HostRequest, 'input'>;
    readonly storeDown?: boolean;
  }
  const cases: readonly Case[] = [
    { name: 'no credential', request: () => ({}) },
    { name: 'a good bearer', request: () => ({ headers: ALICE }) },
    { name: 'a bad bearer', request: () => ({ headers: { authorization: 'Bearer tok-mallory' } }) },
    {
      name: 'a proxy header',
      request: () => ({ headers: { 'x-forwarded-access-token': 'tok-alice' } }),
    },
    { name: 'a live sign-in', request: (k) => ({ signInKey: k.alice }) },
    { name: 'an ended sign-in', request: (k) => ({ signInKey: k.ended }) },
    { name: 'a sign-in and a bearer', request: (k) => ({ signInKey: k.alice, headers: ALICE }) },
    { name: 'a claimed user, no credential', request: () => ({ userId: 'alice' }) },
    {
      name: 'a claimed user the bearer disproves',
      request: () => ({ userId: 'bob', headers: ALICE }),
    },
    {
      name: 'a sign-in naming its own user',
      request: (k) => ({ signInKey: k.alice, userId: 'alice' }),
    },
    { name: 'a sign-in, store down', request: (k) => ({ signInKey: k.alice }), storeDown: true },
  ];

  for (const [strategy, identity] of Object.entries(strategies)) {
    it(strategy, async () => {
      const { host, handle, store } = await serve(identity);
      const alice = await signInAs(store, 'alice');
      const ended = await signInAs(store, 'alice');
      const keys = { alice: alice.key, ended: ended.key };
      let n = 0;
      const table: string[] = [];
      for (const c of cases) {
        // Re-issued per case: a sign-in the previous case ENDED is ended for real.
        store.rows.delete(ended.key);
        const request = c.request(keys);
        store.down = c.storeDown === true;
        const seam = seamVerdict(
          await handle.artifactsForRequest({ sessionId: `probe-${++n}`, ...request }),
        );
        const wire = turnVerdict(await turn(host, { sessionId: `probe-${++n}`, ...request }));
        store.down = false;
        table.push(`${c.name}: seam=${seam} turn=${wire}`);
        expect(seam, `${strategy} — ${c.name}`).toBe(wire);
      }
      // At least one refusal and one acceptance in every non-open strategy, so
      // the pin cannot pass by both doors accepting (or refusing) everything.
      if (strategy !== 'open') {
        expect(table.some((row) => row.includes('seam=accepted'))).toBe(true);
        expect(table.some((row) => !row.includes('seam=accepted'))).toBe(true);
      }
    });
  }
});
