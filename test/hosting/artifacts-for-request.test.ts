/**
 * `handle.artifactsForRequest(request)` — the artifact store bound to a
 * VERIFIED request's scope, for the paths that are not a chat turn (a read
 * before a run, an app-owned route that files beside a conversation).
 *
 * Why it exists: `reply.turnArtifacts` arrives only at the END of a turn, so an
 * app that needed its request's scope earlier copied the library's scope logic
 * (the verifier, the stored identity, the composition) or bypassed it
 * (`{ conversationId }` only — an empty result for the signed-in owner).
 *
 * The laws being pinned:
 *   • ONE composer. The scope it binds is the scope a wire redemption by the
 *     same caller reads: a ref filed through it is redeemed on the wire, and a
 *     ref a turn minted is read through it.
 *   • Refused as a VALUE when a verifier is configured and the request does not
 *     pass it (`'unverified'`), and for a session the caller cannot open
 *     (`'not-found'`, the redemption door's own rule) — never a fall-back to
 *     the unscoped store.
 *   • Another person's ref answers exactly like a ref that never existed.
 *   • With sign-in off it works as the open door does: the session id is the
 *     key.
 *
 * Test types (Convention 3): integration (through `standingAgent`) · security
 * (a stranger's ref, a stranger's session, an unverified request) · scenario
 * (two users) · boundary (no session, no store, first turn not persisted,
 * after close) · regression pin (seam and redemption compose one scope).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Agent, inMemoryArtifacts } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { HostClosedError, memorySessions, standingAgent } from '../../src/hosting/index.js';
import type {
  HostHandle,
  StandingAgentHandle,
  StandingAgentOptions,
} from '../../src/hosting/index.js';
import {
  ALICE,
  BOB,
  NEVER_MINTED,
  filingHost,
  recordingsOf,
  redeem,
  textOf,
  verifier,
  type FilingHost,
} from './turnArtifactsHarness.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.allSettled(closers.map((close) => close()));
  closers.length = 0;
});

async function serve(
  agent: Agent,
  options: { readonly verify?: boolean } = {},
): Promise<{ host: FilingHost; handle: HostHandle & StandingAgentHandle }> {
  const host = filingHost();
  const handle = await standingAgent({
    agent,
    sessions: memorySessions(),
    host,
    ...(options.verify === true && { identity: { verify: verifier().verify } }),
  } as StandingAgentOptions<HostHandle>);
  closers.push(() => handle.close());
  return { host, handle };
}

const recordingAgent = () =>
  Agent.create({
    provider: mock({ reply: 'ok' }),
    model: 'm',
    artifacts: { store: inMemoryArtifacts(), recordings: true },
  }).build();

const note = (text: string) => ({ kind: 'note/app', mediaType: 'text/plain', data: text });

describe('artifactsForRequest — two signed-in users on one agent', () => {
  it('the owner reads their own ref; the other user gets the same not-found as a missing ref', async () => {
    const agent = recordingAgent();
    const recordings = recordingsOf(agent);
    const { host, handle } = await serve(agent, { verify: true });
    await host.deliver({ sessionId: 'sA', input: 'hi', headers: ALICE });
    await host.deliver({ sessionId: 'sB', input: 'hi', headers: BOB });
    const aliceRef = recordings()[0]?.ref as string;

    const alice = await handle.artifactsForRequest({ sessionId: 'sA', headers: ALICE });
    if (!alice.bound) throw new Error(`alice was refused: ${alice.reason}`);
    expect(await alice.artifacts.head(aliceRef)).not.toBeNull();

    const bob = await handle.artifactsForRequest({ sessionId: 'sB', headers: BOB });
    if (!bob.bound) throw new Error(`bob was refused: ${bob.reason}`);
    const foreign = await bob.artifacts.get(aliceRef);
    const missing = await bob.artifacts.get(NEVER_MINTED);
    expect(foreign).toBeNull();
    expect(foreign).toEqual(missing);
  });

  it('a session the caller cannot open is refused as not-found — no store, nothing bound', async () => {
    const { host, handle } = await serve(recordingAgent(), { verify: true });
    await host.deliver({ sessionId: 'sA', input: 'hi', headers: ALICE });
    expect(await handle.artifactsForRequest({ sessionId: 'sA', headers: BOB })).toEqual({
      bound: false,
      reason: 'not-found',
    });
    // A session whose first turn has not persisted proves nobody's ownership yet.
    expect(await handle.artifactsForRequest({ sessionId: 'fresh', headers: ALICE })).toEqual({
      bound: false,
      reason: 'not-found',
    });
  });

  it('an unverified request is refused with the verifier’s own error — never the unscoped store', async () => {
    const { handle } = await serve(recordingAgent(), { verify: true });
    const noToken = await handle.artifactsForRequest({ sessionId: 'sA' });
    expect(noToken.bound).toBe(false);
    if (noToken.bound) return;
    expect(noToken.reason).toBe('unverified');
    expect((noToken.error as { code?: string } | undefined)?.code).toBe(
      'ERR_IDENTITY_NOT_VERIFIED',
    );

    const badToken = await handle.artifactsForRequest({
      sessionId: 'sA',
      headers: { authorization: 'Bearer tok-mallory' },
    });
    expect(badToken).toMatchObject({ bound: false, reason: 'unverified' });

    const claimsAnother = await handle.artifactsForRequest({
      sessionId: 'sA',
      headers: BOB,
      userId: 'alice',
    });
    expect(claimsAnother).toMatchObject({ bound: false, reason: 'unverified' });
  });
});

describe('artifactsForRequest and redemption compose ONE scope', () => {
  it('a ref filed through the seam is redeemed on the wire by the same caller, and only by them', async () => {
    const { host, handle } = await serve(recordingAgent(), { verify: true });
    await host.deliver({ sessionId: 'sA', input: 'hi', headers: ALICE });
    await host.deliver({ sessionId: 'sB', input: 'hi', headers: BOB });

    const alice = await handle.artifactsForRequest({ sessionId: 'sA', headers: ALICE });
    if (!alice.bound) throw new Error(alice.reason);
    const filed = await alice.artifacts.put(note('dashboard guide for alice'));

    const own = await redeem(host, 'sA', filed.ref, ALICE);
    expect(own.error).toBeUndefined();
    expect(textOf(own)).toContain('dashboard guide for alice');

    const stranger = await redeem(host, 'sB', filed.ref, BOB);
    const neverMinted = await redeem(host, 'sB', NEVER_MINTED, BOB);
    expect(stranger.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    expect(stranger.code).toBe(neverMinted.code);
  });

  it('with sign-in OFF the session id is the key — seam and wire still agree, with and without a claimed user', async () => {
    const agent = recordingAgent();
    const recordings = recordingsOf(agent);
    const { host, handle } = await serve(agent);
    await host.deliver({ sessionId: 'sOpen', input: 'hi' });
    await host.deliver({ sessionId: 'sClaim', input: 'hi', userId: 'carol' });

    const open = await handle.artifactsForRequest({ sessionId: 'sOpen' });
    if (!open.bound) throw new Error(open.reason);
    expect(await open.artifacts.head(recordings()[0]?.ref as string)).not.toBeNull();
    const openFiled = await open.artifacts.put(note('open'));
    expect((await redeem(host, 'sOpen', openFiled.ref)).error).toBeUndefined();

    const claimed = await handle.artifactsForRequest({ sessionId: 'sClaim', userId: 'carol' });
    if (!claimed.bound) throw new Error(claimed.reason);
    expect(await claimed.artifacts.head(recordings()[1]?.ref as string)).not.toBeNull();
    const claimedFiled = await claimed.artifacts.put(note('claimed'));
    expect(
      (await redeem(host, 'sClaim', claimedFiled.ref, undefined, 'carol')).error,
    ).toBeUndefined();
    // A different claim composes a different scope — the same not-found as ever.
    expect((await redeem(host, 'sClaim', claimedFiled.ref, undefined, 'dave')).code).toBe(
      'ERR_ARTIFACT_NOT_FOUND',
    );
  });
});

describe('artifactsForRequest — nothing to bind is said by type', () => {
  it('no session → no-session; no store → no-store; after close → HostClosedError', async () => {
    const { handle } = await serve(recordingAgent());
    expect(await handle.artifactsForRequest({})).toEqual({ bound: false, reason: 'no-session' });

    const bare = await serve(Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build());
    expect(await bare.handle.artifactsForRequest({ sessionId: 's' })).toEqual({
      bound: false,
      reason: 'no-store',
    });

    await handle.close();
    await expect(handle.artifactsForRequest({ sessionId: 's' })).rejects.toBeInstanceOf(
      HostClosedError,
    );
  });
});
