/**
 * The turn's artifact binding (`HostReply.turnArtifacts`) — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI),
 * plus the KNOWN EDGES pinned as today's behaviour.
 *
 * The field bug this exists for: a host that files ITS OWN per-turn artifacts
 * (a story, the person's own clicks) had no way to learn the scope
 * `standingAgent` composed for the request, so it re-derived one —
 * `{ conversationId: sessionId }` — and with sign-in on, every ticket it filed
 * was unredeemable: the redemption door composes
 * `{ conversationId, principal: <verified user> }` and the store answers a
 * different tuple with "no data".
 *
 * The laws being pinned:
 *   • THE REASON, PINNED — filing under a host-composed `{ conversationId }`
 *     while signed in is unredeemable (404), while the run's own recording
 *     redeems. That is today's bug shape and it stays true: the fix is not to
 *     change redemption, it is to stop the host composing.
 *   • ONE OWNER OF THE TUPLE — what the host files through the hand-over
 *     redeems through `artifact-get` for the same caller: verified user, no
 *     verifier (the session rung), a stored conversation carrying a tenant, a
 *     paused turn and the turn that resumes it, a partial answer, a cancel.
 *   • A different verified user gets the SAME not-found as a ref that never
 *     existed; no user gets not-found too.
 *   • Nothing to hand ⇒ SAID BY TYPE: `{ bound: false, reason }`.
 *   • AWAITED, once per turn, and SETTLED before the terminal; none for a
 *     request that is not a turn, or a turn that failed or was refused.
 *   • What the host files is on the record: `artifacts.minted` on the serving
 *     agent, no `tool`, `origin.runId` = the run the turn executed, and the
 *     event names the session it was filed for.
 *   • ADDITIVE — a host that does not implement the hook sees the same replies,
 *     events, store reads and snapshots.
 *   • KNOWN EDGES — the three cases where the hand-over and the run's own
 *     recording land in different scopes today, pinned so the follow-up that
 *     changes them has to flip these on purpose.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Agent, defineTool, inMemoryArtifacts } from '../../src/index.js';
import type { ArtifactMeta } from '../../src/index.js';
import type { AgentfootprintEvent } from '../../src/events.js';
import { mock } from '../../src/llm-providers.js';
import { memorySessions, nodeHost, standingAgent, toEnvelope } from '../../src/hosting/index.js';
import type {
  ArtifactWireResult,
  HostReply,
  IngressRecord,
  PendingAsk,
  SessionLifecycle,
  TurnArtifacts,
} from '../../src/hosting/index.js';
import {
  ALICE,
  BOB,
  NEVER_MINTED,
  boundOf,
  fileStory,
  filedOf,
  harness,
  inputAgent,
  pausingAgent,
  recordingAgent,
  recordingEvents,
  recordingsOf,
  redeem,
  verifier,
  withoutRef,
  type ArtifactMintedFact,
} from './turnArtifactsHarness.js';

const { served, closeAll } = harness();
afterEach(closeAll);

/** A stored conversation carrying its own identity — what an app seeded, or an
 *  earlier turn left behind. */
function storedConversation(identity: {
  tenant?: string;
  principal?: string;
  conversationId: string;
}) {
  return toEnvelope({
    version: 1,
    runId: 'run-earlier',
    history: [
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'earlier answer' },
    ],
    lastCompletedIteration: 1,
    originalInput: { message: 'earlier' },
    checkpointedAt: Date.now(),
    identity,
  });
}

// ─── 1. UNIT — the reason for the change, pinned ────────────────────

describe('turnArtifacts — the field bug, pinned (unit)', () => {
  it('filing under a host-composed { conversationId } while signed in is unredeemable', async () => {
    const store = inMemoryArtifacts();
    const agent = recordingAgent(store);
    const recordings = recordingsOf(agent);
    const { host } = await served(agent, { verify: true });

    const turn = await host.deliver({ input: 'hi', sessionId: 's1', headers: ALICE });
    expect(turn.output).toBe('ok');

    // The run's own recording redeems for the person it was served for…
    const recordingRef = recordings()[0]?.ref as string;
    const recording = await redeem(host, 's1', recordingRef, ALICE);
    expect(recording.artifact?.ref).toBe(recordingRef);

    // …and the ticket a host files under the tuple it re-derived does not:
    // `_/_/s1` is not `_/alice/s1`, and the store answers a wrong tuple with
    // "no data". This is today's bug shape; it stays true after the fix.
    const rederived = await store.put(
      { conversationId: 's1' },
      { kind: 'story/turn', mediaType: 'application/json', data: { beats: [] } },
    );
    const refused = await redeem(host, 's1', rederived.meta.ref, ALICE);
    expect(refused.code).toBe('ERR_ARTIFACT_NOT_FOUND');
  });

  it('the hand-over files where the door redeems — the same caller redeems it', async () => {
    const { host } = await served(recordingAgent(), { verify: true });

    const turn = await host.deliver({
      input: 'hi',
      sessionId: 's1',
      headers: ALICE,
      onTurn: fileStory(),
    });
    const filed = filedOf(turn);

    const got = await redeem(host, 's1', filed.ref, ALICE);
    expect(got.error).toBeUndefined();
    expect(got.artifact?.ref).toBe(filed.ref);
    expect((got.artifact as { data?: unknown }).data).toEqual({
      beats: ['asked', 'answered'],
      label: 'turn story',
    });
  });
});

// ─── 2. UNIT — nothing to hand is said by type; awaited, once ───────

describe('turnArtifacts — absence is typed, the hook is awaited (unit)', () => {
  it('an anonymous request (no session) is handed { bound: false, reason: no-session }', async () => {
    const { host } = await served(recordingAgent());
    const turn = await host.deliver({ input: 'hi' });
    expect(turn.output).toBe('ok');
    expect(turn.turns).toEqual([{ bound: false, reason: 'no-session' }]);
  });

  it('an agent with no store is handed { bound: false, reason: no-store }', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build();
    const { host } = await served(agent);
    const turn = await host.deliver({ input: 'hi', sessionId: 's1' });
    expect(turn.output).toBe('ok');
    expect(turn.turns).toEqual([{ bound: false, reason: 'no-store' }]);
  });

  it('with both absent, no-session is the reason given — there is no scope to name at all', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build();
    const { host } = await served(agent);
    const turn = await host.deliver({ input: 'hi' });
    expect(turn.turns).toEqual([{ bound: false, reason: 'no-session' }]);
  });

  it('once per turn, AWAITED — the hook settles before the terminal', async () => {
    const { host } = await served(recordingAgent());
    const turn = await host.deliver({
      input: 'hi',
      sessionId: 's1',
      onTurn: async (handed) => {
        // A slow store, or a host doing real work: the composer waits.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return fileStory()(handed);
      },
    });
    expect(turn.order).toEqual(['turnArtifacts', 'turnArtifacts:settled', 'complete']);
    expect(filedOf(turn).ref).toMatch(/^art_/);
  });

  it('nothing is handed for a request that is not a turn, or a turn that did not answer', async () => {
    const agent = recordingAgent();
    const { host } = await served(agent, { verify: true });
    await host.deliver({ input: 'hi', sessionId: 's1', headers: ALICE });

    // A redemption is not a turn.
    const redemption = await redeem(host, 's1', NEVER_MINTED, ALICE);
    expect(redemption.turns).toEqual([]);
    // A session op is not a turn.
    const pending = await host.deliver({
      session: { op: 'pending', sessionId: 's1' },
      headers: ALICE,
    });
    expect(pending.turns).toEqual([]);
    // A turn refused at the door (somebody else's session) hands nothing.
    const foreign = await host.deliver({ input: 'mine now', sessionId: 's1', headers: BOB });
    expect(foreign.code).toBe('ERR_SESSION_NOT_FOUND');
    expect(foreign.turns).toEqual([]);
  });

  it('a turn that FAILED hands nothing', async () => {
    const agent = Agent.create({
      provider: {
        name: 'broken',
        complete: () => Promise.reject(new Error('provider down')),
      } as never,
      model: 'm',
      artifacts: inMemoryArtifacts(),
    }).build();
    const { host } = await served(agent);
    const turn = await host.deliver({ input: 'hi', sessionId: 's1' });
    expect(turn.error).toBeDefined();
    expect(turn.turns).toEqual([]);
  });
});

// ─── 3. SCENARIO — every rung redeems through the same door ─────────

describe('turnArtifacts — the same scope as redemption (scenario)', () => {
  it('another verified user gets the same not-found as a ref that never existed', async () => {
    const { host } = await served(recordingAgent(), { verify: true });
    const turn = await host.deliver({
      input: 'hi',
      sessionId: 's1',
      headers: ALICE,
      onTurn: fileStory(),
    });
    const filed = filedOf(turn);

    const asBob = await redeem(host, 's1', filed.ref, BOB);
    const never = await redeem(host, 's1', NEVER_MINTED, BOB);
    expect(asBob.code).toBe('ERR_ARTIFACT_NOT_FOUND');
    expect(withoutRef(asBob, filed.ref)).toEqual(withoutRef(never, NEVER_MINTED));
  });

  it('no user (an anonymous caller at an allowAnonymous door) gets not-found', async () => {
    const { host } = await served(recordingAgent(), { verify: true, allowAnonymous: true });
    const turn = await host.deliver({
      input: 'hi',
      sessionId: 's1',
      headers: ALICE,
      onTurn: fileStory(),
    });
    const filed = filedOf(turn);

    expect((await redeem(host, 's1', filed.ref)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
    // …while the owner still redeems it.
    expect((await redeem(host, 's1', filed.ref, ALICE)).artifact?.ref).toBe(filed.ref);
  });

  it('verifier off: the session rung — filed and redeemed under { conversationId: session }', async () => {
    const store = inMemoryArtifacts();
    const { host } = await served(recordingAgent(store));
    const turn = await host.deliver({ input: 'hi', sessionId: 's-open', onTurn: fileStory() });
    const filed = filedOf(turn);

    expect((await redeem(host, 's-open', filed.ref)).artifact?.ref).toBe(filed.ref);
    expect(await store.head({ conversationId: 's-open' }, filed.ref)).not.toBeNull();
  });

  it('a stored conversation carrying a tenant: the tenant rides the hand-over', async () => {
    const store = inMemoryArtifacts();
    const sessions = memorySessions();
    await sessions.persist(
      's-t',
      storedConversation({ tenant: 'acme', principal: 'alice', conversationId: 'chosen-ns' }),
    );
    const { host } = await served(recordingAgent(store), { verify: true, sessions });

    const turn = await host.deliver({
      input: 'again',
      sessionId: 's-t',
      headers: ALICE,
      onTurn: fileStory(),
    });
    expect(turn.output).toBe('ok');
    const filed = filedOf(turn);

    expect((await redeem(host, 's-t', filed.ref, ALICE)).artifact?.ref).toBe(filed.ref);
    // The tuple a host would have composed even KNOWING about principals is
    // still wrong — the tenant and namespace belong to the stored conversation,
    // which the host never read. That is why the host must not compose.
    expect(await store.head({ conversationId: 's-t', principal: 'alice' }, filed.ref)).toBeNull();
    expect(
      await store.head(
        { tenant: 'acme', principal: 'alice', conversationId: 'chosen-ns' },
        filed.ref,
      ),
    ).not.toBeNull();
  });

  it('a paused turn and the turn that resumes it both file where the door redeems', async () => {
    const agent = pausingAgent();
    const recordings = recordingsOf(agent);
    const { host } = await served(agent, { verify: true });

    const paused = await host.deliver({
      input: 'refund me',
      sessionId: 's-p',
      headers: ALICE,
      onTurn: fileStory('the question'),
    });
    expect(paused.awaiting?.question).toBe('Approve $10?');
    expect(paused.order).toEqual(['turnArtifacts', 'turnArtifacts:settled', 'awaiting']);
    const beforeResume = filedOf(paused);

    const resumed = await host.deliver({
      sessionId: 's-p',
      decision: 'yes',
      headers: ALICE,
      onTurn: fileStory('the answer'),
    });
    expect(resumed.output).toBe('refund issued');
    const afterResume = filedOf(resumed);

    // The resumed run's own recording and the two host filings: one scope, for
    // one verified owner (the rung this packet exists for — see KNOWN EDGES for
    // the unverified ones).
    const recordingRef = recordings()[0]?.ref as string;
    for (const ref of [beforeResume.ref, afterResume.ref, recordingRef]) {
      expect((await redeem(host, 's-p', ref, ALICE)).artifact?.ref).toBe(ref);
      expect((await redeem(host, 's-p', ref, BOB)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
    }
    // A paused turn's `origin.runId` names a run that files NO recording (a
    // pause is not a finished run): the resumed run's recording carries its
    // own id, never the paused one.
    expect(beforeResume.origin?.runId).toBeDefined();
    expect(recordings().map((r) => r.origin?.runId)).not.toContain(beforeResume.origin?.runId);
    expect(recordings()[0]?.origin?.runId).toBe(afterResume.origin?.runId);
  });

  it('an input request answered in part, then cancelled: handed each time, no borrowed run id', async () => {
    const { host } = await served(inputAgent(), { verify: true });

    const asked = await host.deliver({
      input: 'Inspect.',
      sessionId: 's-in',
      headers: ALICE,
      onTurn: fileStory('asked'),
    });
    const requestId = asked.awaiting?.awaitingInput?.requestId as string;
    expect(asked.order).toEqual(['turnArtifacts', 'turnArtifacts:settled', 'awaiting']);
    const askedFiling = filedOf(asked);
    expect(askedFiling.origin?.runId).toBeDefined();

    // A partial answer re-persists the same pause WITHOUT a run — so the
    // filing names no run rather than whichever run the instance ran last.
    const partial = await host.deliver({
      sessionId: 's-in',
      decision: { requestId, values: { year: 2026 } },
      headers: ALICE,
      onTurn: fileStory('partial'),
    });
    expect(partial.awaiting?.awaitingInput?.requestId).toBe(requestId);
    const partialFiling = filedOf(partial);
    expect(partialFiling.origin).toBeUndefined();

    // A cancellation ends the turn with no run at all.
    const cancelled = await host.deliver({
      sessionId: 's-in',
      decision: { requestId, cancel: true },
      headers: ALICE,
      onTurn: fileStory('cancelled'),
    });
    expect(cancelled.output).toBe('Input request cancelled.');
    expect(cancelled.order).toEqual(['turnArtifacts', 'turnArtifacts:settled', 'complete']);
    const cancelFiling = filedOf(cancelled);
    expect(cancelFiling.origin).toBeUndefined();

    for (const ref of [askedFiling.ref, partialFiling.ref, cancelFiling.ref]) {
      expect((await redeem(host, 's-in', ref, ALICE)).artifact?.ref).toBe(ref);
      expect((await redeem(host, 's-in', ref, BOB)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
    }
  });
});

// ─── 4. INTEGRATION — the field app's shape, over a real socket ─────

describe('turnArtifacts — a wrapping host over a real socket (integration)', () => {
  it('a host that files its story INSIDE the hook — the answer leaves after the filing', async () => {
    const store = inMemoryArtifacts();
    const agent = recordingAgent(store);
    const recordings = recordingsOf(agent);
    const minted: AgentfootprintEvent[] = [];
    agent.on('agentfootprint.artifacts.minted', (event: AgentfootprintEvent) => {
      minted.push(event);
    });
    const filed: ArtifactMeta[] = [];
    const base = nodeHost({ port: 0, hostname: '127.0.0.1' });
    // The field app's shape: wrap the host, forward every member BY PRESENCE,
    // and file inside the awaited hook. No held completion: the composer ends
    // the reply only after the hook settles, so the ticket exists before the
    // body is composed.
    const wrapping: typeof base = {
      ...base,
      serve: (handler) =>
        base.serve(async (request, reply) => {
          const wrapped: HostReply = {
            complete: (output) => reply.complete(output),
            fail: (error) => reply.fail(error),
            ...(reply.awaiting && { awaiting: (p: PendingAsk) => reply.awaiting?.(p) }),
            ...(reply.artifact && { artifact: (r: ArtifactWireResult) => reply.artifact?.(r) }),
            ...(reply.sessions && { sessions: (r) => reply.sessions?.(r) }),
            ...(reply.emit && { emit: (chunk: string) => reply.emit?.(chunk) }),
            turnArtifacts: async (turn: TurnArtifacts) => {
              if (!turn.bound) return;
              filed.push(
                await turn.artifacts.put({
                  kind: 'story/turn',
                  mediaType: 'application/json',
                  data: { question: request.input },
                }),
              );
            },
          };
          await handler(request, wrapped);
        }),
    };
    const records: IngressRecord[] = [];
    const handle = await standingAgent({
      agent,
      sessions: memorySessions(),
      host: wrapping,
      identity: { verify: verifier().verify },
      // The ingress record wraps the reply too — the hook must survive it.
      onIngressDecision: (record) => records.push(record),
    });
    try {
      const post = async (body: object, headers: Record<string, string>) => {
        const response = await fetch(`${handle.url}/invoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
        });
        return {
          status: response.status,
          body: (await response.json()) as Record<string, unknown>,
        };
      };

      const answered = await post({ input: 'hi', sessionId: 'w1' }, ALICE);
      expect(answered.status).toBe(200);
      // Filed BEFORE the answer left: the reply waited for the hook.
      expect(filed).toHaveLength(1);
      const ref = filed[0]?.ref as string;

      const mine = await post({ op: 'artifact-get', ref, sessionId: 'w1' }, ALICE);
      expect(mine.status).toBe(200);
      expect((mine.body.artifact as { ref: string }).ref).toBe(ref);
      const theirs = await post({ op: 'artifact-get', ref, sessionId: 'w1' }, BOB);
      expect(theirs.status).toBe(404);
      expect(theirs.body.code).toBe('ERR_ARTIFACT_NOT_FOUND');

      // On the record, once: the host's mint rides artifacts.minted on the
      // serving agent — no `tool` (no tool minted it), joined to the turn's
      // run, and naming the session it was filed for.
      const hostMint = minted.filter((event) => (event.payload as ArtifactMintedFact).ref === ref);
      expect(hostMint).toHaveLength(1);
      const payload = hostMint[0]?.payload as ArtifactMintedFact;
      expect(payload.tool).toBeUndefined();
      expect(payload.kind).toBe('story/turn');
      expect(payload.origin?.runId).toBeDefined();
      expect(payload.origin?.runId).toBe(recordings()[0]?.origin?.runId);
      expect(hostMint[0]?.meta.sessionId).toBe('w1');
      expect(records.some((record) => record.outcome === 'served')).toBe(true);
    } finally {
      await handle.close();
    }
  });
});

describe('turnArtifacts — a hosted run keeps its own record (integration)', () => {
  it('a hosted run’s recording keeps its own events AND a consumer’s own emit from inside a tool', async () => {
    // The run-membership rule decides what a recording keeps. Flip its sides
    // or drop its "names no session" clause and a HOSTED run's recording loses
    // its own events and every consumer emit — this is the integration-level
    // pin for that, beyond the rule's own unit tests.
    const holder: { agent?: Agent } = {};
    const ping = defineTool<Record<string, never>, string>({
      name: 'ping',
      description: 'ping',
      inputSchema: { type: 'object', properties: {} },
      execute: () => {
        holder.agent?.emit('myapp.ping_seen', { n: 1 });
        return 'pong';
      },
    });
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 't1', name: 'ping', args: {} }] }, { content: 'done' }],
      }),
      model: 'm',
      maxIterations: 3,
      artifacts: { store, recordings: true },
    })
      .tool(ping)
      .build();
    holder.agent = agent;
    const recordings = recordingsOf(agent);
    const { host } = await served(agent);
    expect((await host.deliver({ input: 'go', sessionId: 'S' })).output).toBe('done');

    const types = (await recordingEvents(host, 'S', recordings()[0]?.ref as string)).map(
      (event) => event.type,
    );
    expect(types).toContain('agentfootprint.agent.turn_start');
    expect(types).toContain('agentfootprint.stream.tool_start');
    expect(types).toContain('agentfootprint.stream.tool_end');
    expect(types).toContain('agentfootprint.agent.turn_end');
    expect(types).toContain('myapp.ping_seen');
    expect(types.length).toBeGreaterThan(10);
  });
});

// ─── 5. PROPERTY — every rung, one law ──────────────────────────────

describe('turnArtifacts — property: filed ⇒ redeemable by the same caller, by nobody else', () => {
  it('holds across verifier on/off, claimed/verified/absent users and stored tenants', async () => {
    type Row = {
      readonly name: string;
      readonly verify: boolean;
      readonly headers?: Readonly<Record<string, string>>;
      readonly userId?: string;
      readonly stranger: {
        readonly headers?: Readonly<Record<string, string>>;
        readonly userId?: string;
      };
      readonly tenant?: string;
    };
    const rows: Row[] = [
      { name: 'verified', verify: true, headers: ALICE, stranger: { headers: BOB } },
      {
        name: 'verified+tenant',
        verify: true,
        headers: ALICE,
        stranger: { headers: BOB },
        tenant: 'acme',
      },
      { name: 'open, anonymous', verify: false, stranger: { userId: 'mallory' } },
      { name: 'open, claimed user', verify: false, userId: 'carol', stranger: {} },
      {
        name: 'open, claimed user+tenant',
        verify: false,
        userId: 'carol',
        stranger: { userId: 'dave' },
        tenant: 't9',
      },
    ];
    for (const row of rows) {
      const sessions = memorySessions();
      if (row.tenant !== undefined) {
        await sessions.persist(
          'sp',
          storedConversation({
            tenant: row.tenant,
            conversationId: `ns-${row.name}`,
            ...(row.verify && { principal: 'alice' }),
          }),
        );
      }
      const { host } = await served(recordingAgent(), { verify: row.verify, sessions });
      const turn = await host.deliver({
        input: 'hi',
        sessionId: 'sp',
        onTurn: fileStory(),
        ...(row.headers !== undefined && { headers: row.headers }),
        ...(row.userId !== undefined && { userId: row.userId }),
      });
      expect(turn.output, row.name).toBe('ok');
      const filed = filedOf(turn);

      const same = await redeem(host, 'sp', filed.ref, row.headers, row.userId);
      expect(same.artifact?.ref, row.name).toBe(filed.ref);
      const other = await redeem(host, 'sp', filed.ref, row.stranger.headers, row.stranger.userId);
      expect(other.code, row.name).toBe('ERR_ARTIFACT_NOT_FOUND');
    }
  });
});

// ─── 6. SECURITY — one scope, and only one ──────────────────────────

describe('turnArtifacts — security', () => {
  it('the hand-over carries no scope: nothing on it names a tenant, principal or conversation', async () => {
    const { host } = await served(recordingAgent(), { verify: true });
    const turn = boundOf(await host.deliver({ input: 'hi', sessionId: 's1', headers: ALICE }));
    const text = JSON.stringify(turn);
    expect(text).not.toContain('alice');
    expect(text).not.toContain('s1');
    expect(Object.keys(turn).sort()).toEqual(['artifacts', 'bound']);
    expect(Object.keys(turn.artifacts).sort()).toEqual(['delete', 'get', 'head', 'list', 'put']);
    expect(Object.isFrozen(turn)).toBe(true);
    expect(Object.isFrozen(turn.artifacts)).toBe(true);
  });

  it("a hand-over cannot reach another session's artifacts — not even the same user's", async () => {
    const { host } = await served(recordingAgent(), { verify: true });
    const first = await host.deliver({
      input: 'hi',
      sessionId: 's1',
      headers: ALICE,
      onTurn: fileStory(),
    });
    const filed = filedOf(first);
    const second = await host.deliver({
      input: 'hi',
      sessionId: 's2',
      headers: ALICE,
      onTurn: async (turn) => {
        if (!turn.bound) return undefined;
        return {
          head: await turn.artifacts.head(filed.ref),
          get: await turn.artifacts.get(filed.ref),
          listed: (await turn.artifacts.list()).artifacts.map((meta) => meta.ref),
        };
      },
    });
    const seen = second.filed[0] as { head: unknown; get: unknown; listed: string[] };
    expect(seen.head).toBeNull();
    expect(seen.get).toBeNull();
    expect(seen.listed).not.toContain(filed.ref);
  });

  it('origin is the framework’s fact — a smuggled origin is replaced by the turn’s own run', async () => {
    const agent = recordingAgent();
    const recordings = recordingsOf(agent);
    const { host } = await served(agent);
    const turn = await host.deliver({
      input: 'hi',
      sessionId: 's1',
      // Not on the type; a JavaScript caller can still try.
      onTurn: fileStory('forged', { origin: { runId: 'someone-elses-run', toolCallId: 'forged' } }),
    });
    expect(filedOf(turn).origin).toEqual({ runId: recordings()[0]?.origin?.runId });
  });
});

// ─── 7. PERFORMANCE — additive, and no extra round-trip ─────────────

describe('turnArtifacts — performance / zero delta', () => {
  it('a host without the hook: same reply, same event sequence, same store reads', async () => {
    async function trace(hook: boolean) {
      const agent = recordingAgent();
      const events: string[] = [];
      agent.on('*', (event: AgentfootprintEvent) => events.push(event.type));
      let hydrates = 0;
      const inner = memorySessions();
      const sessions: SessionLifecycle = {
        ...inner,
        hydrate: (id) => {
          hydrates += 1;
          return inner.hydrate(id);
        },
        persist: (id, envelope) => inner.persist(id, envelope),
      };
      let snapshots = 0;
      const checkpoint = agent.checkpoint.bind(agent);
      agent.checkpoint = () => {
        snapshots += 1;
        return checkpoint();
      };
      const { host } = await served(agent, { hook, sessions });
      const first = await host.deliver({ input: 'hi', sessionId: 's1' });
      const second = await host.deliver({ input: 'again', sessionId: 's1' });
      return { outputs: [first.output, second.output], events, hydrates, snapshots };
    }
    const without = await trace(false);
    const withHook = await trace(true);
    expect(withHook.outputs).toEqual(without.outputs);
    expect(withHook.events).toEqual(without.events);
    expect(withHook.hydrates).toBe(without.hydrates);
    // A completed turn reuses the conversation snapshot the composer already
    // takes to persist — the run id for `origin` costs nothing extra.
    expect(withHook.snapshots).toBe(without.snapshots);
  });

  it('fifty filed turns cost fifty filings and nothing more', async () => {
    const inner = inMemoryArtifacts();
    let puts = 0;
    const store = new Proxy(inner, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target) as unknown;
        if (typeof value !== 'function') return value;
        if (prop === 'put') {
          return (...args: unknown[]) => {
            puts += 1;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return (value as (...a: unknown[]) => unknown).bind(target);
      },
    });
    const { host } = await served(recordingAgent(store));
    for (let i = 0; i < 50; i++) {
      const turn = await host.deliver({
        input: `q${i}`,
        sessionId: 's-many',
        onTurn: fileStory(`turn ${i}`),
      });
      expect(filedOf(turn).ref).toMatch(/^art_/);
    }
    // Fifty recordings the agent filed, fifty stories the host filed.
    expect(puts).toBe(100);
  });
});

// ─── 8. ROI — one hook replaces a re-derivation that was wrong ──────

describe('turnArtifacts — ROI', () => {
  it('the same host code redeems at a signed-in door AND an open one', async () => {
    // The field app composed `{ conversationId }`, which is right at an open
    // door and wrong at a signed-in one — so it worked in development and
    // 404'd for every signed-in user. The hand-over is right at both.
    for (const signedIn of [false, true]) {
      const { host } = await served(recordingAgent(), { verify: signedIn });
      const headers = signedIn ? ALICE : undefined;
      const turn = await host.deliver({
        input: 'hi',
        sessionId: 'roi',
        onTurn: fileStory(),
        ...(headers !== undefined && { headers }),
      });
      const filed = filedOf(turn);
      expect((await redeem(host, 'roi', filed.ref, headers)).artifact?.ref).toBe(filed.ref);
    }
  });
});

// ─── 9. KNOWN EDGES — where the hand-over and the recording diverge ─
//
// The hand-over always files where the door redeems for the SAME caller. The
// run's own recording files where the run's seeded identity says — and at an
// UNVERIFIED door those two can name different tuples today. These tests pin
// today's behaviour on purpose: the follow-up that decides what a no-user (or
// changed-user) request on a conversation with an identity of its own MEANS
// must flip them deliberately, not by accident.

describe('turnArtifacts — KNOWN EDGES (unverified door): the recording and the hand-over diverge', () => {
  it('KNOWN EDGE: no verifier, no user, a stored identity → the recording files where no redemption looks', async () => {
    const store = inMemoryArtifacts();
    const sessions = memorySessions();
    await sessions.persist('s', storedConversation({ tenant: 'acme', conversationId: 'ns' }));
    const agent = recordingAgent(store);
    const recordings = recordingsOf(agent);
    const { host } = await served(agent, { sessions });

    const turn = await host.deliver({ input: 'hi', sessionId: 's', onTurn: fileStory() });
    const filed = filedOf(turn);
    const recordingRef = recordings()[0]?.ref as string;

    // The run continued under the stored identity (an explicit identity wins
    // in seed), so its recording sits under { acme, ns }…
    expect(await store.head({ tenant: 'acme', conversationId: 'ns' }, recordingRef)).not.toBeNull();
    // …which the door never composes for a request that names nobody.
    expect((await redeem(host, 's', recordingRef)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
    // The hand-over follows the DOOR, so what the host filed does redeem.
    expect((await redeem(host, 's', filed.ref)).artifact?.ref).toBe(filed.ref);
  });

  it('KNOWN EDGE: open door, turn 1 claims a user, turn 2 names nobody → recording and hand-over split', async () => {
    const store = inMemoryArtifacts();
    const agent = recordingAgent(store);
    const recordings = recordingsOf(agent);
    const { host } = await served(agent);

    await host.deliver({ input: 'one', sessionId: 's', userId: 'alice' });
    const second = await host.deliver({ input: 'two', sessionId: 's', onTurn: fileStory() });
    const filed = filedOf(second);
    const secondRecording = recordings()[1]?.ref as string;

    // Turn 2's recording kept the conversation's sticky principal…
    expect(
      await store.head({ conversationId: 's', principal: 'alice' }, secondRecording),
    ).not.toBeNull();
    expect((await redeem(host, 's', secondRecording)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
    expect((await redeem(host, 's', secondRecording, undefined, 'alice')).artifact?.ref).toBe(
      secondRecording,
    );
    // …while the hand-over bound the session rung, where a no-user request redeems.
    expect((await redeem(host, 's', filed.ref)).artifact?.ref).toBe(filed.ref);
  });

  it('KNOWN EDGE: open door, a pause that names nobody resumed by a claimed user → the resumed recording keeps the pause’s tuple', async () => {
    const store = inMemoryArtifacts();
    const agent = pausingAgent(store);
    const recordings = recordingsOf(agent);
    const { host } = await served(agent);

    const paused = await host.deliver({ input: 'refund me', sessionId: 's' });
    expect(paused.awaiting).toBeDefined();
    const resumed = await host.deliver({
      sessionId: 's',
      userId: 'bob',
      decision: 'yes',
      onTurn: fileStory(),
    });
    expect(resumed.output).toBe('refund issued');
    const filed = filedOf(resumed);
    const recordingRef = recordings()[0]?.ref as string;

    // A resumed run files under the PAUSED run's seeded identity (resume never
    // re-seeds) — the session rung — while the hand-over composed bob's tuple.
    expect(await store.head({ conversationId: 's' }, recordingRef)).not.toBeNull();
    expect((await redeem(host, 's', recordingRef, undefined, 'bob')).code).toBe(
      'ERR_ARTIFACT_NOT_FOUND',
    );
    expect((await redeem(host, 's', filed.ref, undefined, 'bob')).artifact?.ref).toBe(filed.ref);
  });
});
