/**
 * Attack regressions for `HostReply.turnArtifacts` and the hosting door's
 * events — ported from the 2026-09-25 security review, each one asserting the
 * FIXED behaviour of an attack that succeeded against the first cut.
 *
 * The laws being pinned:
 *   • A hand-over is live only for its own turn. The composer AWAITS the hook
 *     while the session's lane is held, drains every operation it started, and
 *     REVOKES the binding before the reply ends; a verb called after that is
 *     refused by name (`TurnArtifactsExpiredError`) — the footprintjs
 *     `ScopeFacade · assertLive` law ("a proxy held past its stage is
 *     refused"), because a write outside its turn makes the record lie.
 *   • No event produced while serving session S enters a recording of another
 *     session's run — not a host's filing, and not the older wire redemption
 *     (`artifact-head` / `artifact-get`), which stays lane-free.
 *   • The host's hook never decides the terminal: a throw or a rejection is
 *     recorded (the ingress record, class only) and the answer or the question
 *     is still delivered. Nothing it does becomes an unhandled rejection.
 *   • `origin` is the framework's field on every path: a caller's is dropped.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Agent, inMemoryArtifacts } from '../../src/index.js';
import type { ArtifactMeta } from '../../src/index.js';
import type { AgentfootprintEvent } from '../../src/events.js';
import { mock } from '../../src/llm-providers.js';
import { eventBelongsToRun } from '../../src/bridge/eventMeta.js';
import type { IngressRecord, TurnArtifacts } from '../../src/hosting/index.js';
import type { SelfExplainBinding } from '../../src/lib/trace-toolpack/selfExplain.js';
import {
  ALICE,
  BOB,
  artifactEventsOf,
  boundOf,
  fileStory,
  filedOf,
  gatedProvider,
  harness,
  inputAgent,
  pausingAgent,
  recordingAgent,
  recordingsOf,
  redeem,
  textOf,
  unhandledDuring,
  NEVER_MINTED,
  type ArtifactMintedFact,
} from './turnArtifactsHarness.js';

const { served, closeAll } = harness();
afterEach(closeAll);

/** A hook body that keeps the hand-over — the "held past its turn" shape. */
const keep = (turn: TurnArtifacts): TurnArtifacts => turn;

/** Bob's recording text, redeemed with bob's own token. */
async function bobsRecording(
  host: Awaited<ReturnType<typeof served>>['host'],
  recordings: () => ArtifactMintedFact[],
): Promise<string> {
  const ref = recordings()[recordings().length - 1]?.ref as string;
  const got = await redeem(host, 'sB', ref, BOB);
  expect(got.error).toBeUndefined();
  return textOf(got);
}

// ─── The one owner of "which run an event belongs to" ───────────────

describe('eventBelongsToRun — the run-membership rule (unit)', () => {
  const CONSUMER = 'consumer-scope';
  const runB = { runId: 'run-B', sessionId: 'sB' };

  it('an event that names no run and no session belongs to whatever run is in flight', () => {
    expect(eventBelongsToRun({ runId: CONSUMER }, runB)).toBe(true);
    expect(eventBelongsToRun(undefined, { runId: 'run-A' })).toBe(true);
  });

  it('an event of no run, stamped with a session, belongs only to runs of that session', () => {
    expect(eventBelongsToRun({ runId: CONSUMER, sessionId: 'sB' }, runB)).toBe(true);
    expect(eventBelongsToRun({ runId: CONSUMER, sessionId: 'sA' }, runB)).toBe(false);
    // …including an anonymous run, which belongs to no session at all.
    expect(eventBelongsToRun({ runId: CONSUMER, sessionId: 'sA' }, { runId: 'run-A' })).toBe(false);
  });

  it('an event that names a run belongs to that run and no other — whatever its session', () => {
    expect(eventBelongsToRun({ runId: 'run-B', sessionId: 'sB' }, runB)).toBe(true);
    expect(eventBelongsToRun({ runId: 'run-A', sessionId: 'sB' }, runB)).toBe(false);
    // A late fact from a session-less run cannot slip in through "no session".
    expect(eventBelongsToRun({ runId: 'run-A' }, runB)).toBe(false);
  });
});

// ─── F1 — the cross-user leak, and its pre-existing sibling ─────────

describe('attack regressions — nothing crosses into another session’s recording', () => {
  it('a hand-over held past its turn is refused by name, and bob’s recording carries nothing of alice’s', async () => {
    const gate = gatedProvider('ok');
    const agent = recordingAgent(inMemoryArtifacts(), gate.provider);
    const recordings = recordingsOf(agent);
    const { host } = await served(agent, { verify: true });

    const aliceTurn = await host.deliver({
      input: 'refund order 1234',
      sessionId: 'sA',
      headers: ALICE,
      onTurn: keep,
    });
    expect(aliceTurn.output).toBe('ok');
    const held = aliceTurn.filed[0] as TurnArtifacts;
    if (!held.bound) throw new Error('expected a bound hand-over');

    // Bob's turn (a different user, a different session) is mid-run on the
    // same shared agent…
    const inFlight = gate.arm();
    const bobTurn = host.deliver({ input: 'hello', sessionId: 'sB', headers: BOB });
    await inFlight.started;

    // …and alice's host tries to file with the hand-over it kept.
    await expect(
      held.artifacts.put({
        kind: 'story/turn',
        mediaType: 'application/json',
        data: { beats: ['alice asked for a refund on order 1234'] },
        label: 'alice@example.com — refund order 1234',
        digest: 'sha-256',
      }),
    ).rejects.toMatchObject({
      name: 'TurnArtifactsExpiredError',
      code: 'ERR_TURN_ARTIFACTS_EXPIRED',
      op: 'put',
    });
    // Every verb, not just put.
    for (const [op, call] of [
      ['head', () => held.artifacts.head('art_x')],
      ['get', () => held.artifacts.get('art_x')],
      ['delete', () => held.artifacts.delete('art_x')],
      ['list', () => held.artifacts.list()],
    ] as const) {
      await expect(call()).rejects.toMatchObject({ code: 'ERR_TURN_ARTIFACTS_EXPIRED', op });
    }

    inFlight.release();
    expect((await bobTurn).output).toBe('ok');
    const text = await bobsRecording(host, recordings);
    expect(text).not.toContain('alice@example.com');
    expect(text).not.toContain('refund order 1234');
  });

  it('a `void put` inside the hook is drained before the reply — it never lands in the next person’s run', async () => {
    const inner = inMemoryArtifacts();
    // A slow store (file / sqlite / object storage): every put takes 30 ms.
    const slow = new Proxy(inner, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target) as unknown;
        if (typeof value !== 'function') return value;
        if (prop === 'put') {
          return async (...args: unknown[]) => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return (value as (...a: unknown[]) => unknown).bind(target);
      },
    });
    const agent = recordingAgent(slow, mock({ reply: 'ok', thinkingMs: 60 }));
    const recordings = recordingsOf(agent);
    const { host } = await served(agent, { verify: true });
    const filed: Record<string, string> = {};
    const voidPut = (label: string, session: string) => (turn: TurnArtifacts) => {
      if (!turn.bound) return;
      // Deliberately not awaited — the shape the first cut's docs showed.
      void turn.artifacts
        .put({ kind: 'story/turn', mediaType: 'application/json', data: { label }, label })
        .then((meta) => (filed[session] = meta.ref));
    };

    // Alice and bob arrive together: different sessions are never refused,
    // they queue on the shared lane.
    const [alice, bob] = await Promise.all([
      host.deliver({
        input: 'a',
        sessionId: 'sA',
        headers: ALICE,
        onTurn: voidPut('LABEL-OF-sA', 'sA'),
      }),
      host.deliver({
        input: 'b',
        sessionId: 'sB',
        headers: BOB,
        onTurn: voidPut('LABEL-OF-sB', 'sB'),
      }),
    ]);
    expect(alice.output).toBe('ok');
    expect(bob.output).toBe('ok');
    // Both filings finished INSIDE their own turns…
    expect(filed.sA).toBeDefined();
    expect(filed.sB).toBeDefined();
    // …so neither reached the other person's recording.
    const text = await bobsRecording(host, recordings);
    expect(text).not.toContain(filed.sA as string);
    expect(text).not.toContain('LABEL-OF-sA');
    expect((await redeem(host, 'sA', filed.sA as string, ALICE)).artifact?.ref).toBe(filed.sA);
  });

  it('PRE-EXISTING: a wire redemption during another session’s run stays out of that run’s recording', async () => {
    const gate = gatedProvider('ok');
    const agent = recordingAgent(inMemoryArtifacts(), gate.provider);
    const recordings = recordingsOf(agent);
    const { host } = await served(agent, { verify: true });
    await host.deliver({ input: 'a', sessionId: 'sA', headers: ALICE });
    const aliceRecording = recordings()[0]?.ref as string;

    const inFlight = gate.arm();
    const bobTurn = host.deliver({ input: 'b', sessionId: 'sB', headers: BOB });
    await inFlight.started;
    // Lane-free by design: a screen redeeming a chart is never queued behind
    // somebody else's turn — it answers while bob's run is still in flight.
    const aliceHead = await host.deliver({
      sessionId: 'sA',
      artifact: { op: 'head', ref: aliceRecording },
      headers: ALICE,
    });
    expect(aliceHead.artifact?.ref).toBe(aliceRecording);
    inFlight.release();
    expect((await bobTurn).output).toBe('ok');

    expect(await bobsRecording(host, recordings)).not.toContain(aliceRecording);
  });

  it('…while a redemption for the SAME session during its own run is still that run’s record', async () => {
    const gate = gatedProvider('ok');
    const agent = recordingAgent(inMemoryArtifacts(), gate.provider);
    const recordings = recordingsOf(agent);
    const { host } = await served(agent, { verify: true });
    await host.deliver({ input: 'first', sessionId: 'sB', headers: BOB });
    const firstRecording = recordings()[0]?.ref as string;

    const inFlight = gate.arm();
    const bobTurn = host.deliver({ input: 'second', sessionId: 'sB', headers: BOB });
    await inFlight.started;
    await host.deliver({
      sessionId: 'sB',
      artifact: { op: 'head', ref: firstRecording },
      headers: BOB,
    });
    inFlight.release();
    expect((await bobTurn).output).toBe('ok');

    // The rule is about sessions, not a ban on door facts: bob's own screen
    // redeeming during bob's own run is part of bob's record.
    expect(await bobsRecording(host, recordings)).toContain(firstRecording);
  });

  it('every door fact names the session it was produced for; a filing also names the run it was filed for', async () => {
    const agent = recordingAgent();
    const events = artifactEventsOf(agent);
    const { host } = await served(agent, { verify: true });
    const turn = await host.deliver({
      input: 'a',
      sessionId: 'sA',
      headers: ALICE,
      onTurn: fileStory(),
    });
    const filed = filedOf(turn);
    await redeem(host, 'sA', filed.ref, ALICE);
    await redeem(host, 'sA', NEVER_MINTED, ALICE);

    const door = events().filter(
      (event) =>
        (event.payload as { ref?: string }).ref === filed.ref ||
        (event.payload as { ref?: string }).ref === NEVER_MINTED,
    );
    expect(door.map((event) => event.type)).toEqual([
      'agentfootprint.artifacts.minted',
      'agentfootprint.artifacts.resolved',
      'agentfootprint.artifacts.refused',
    ]);
    for (const event of door) expect(event.meta.sessionId).toBe('sA');
    // The filing was made FOR the turn's run — the binding says whose run it is.
    expect(door[0]?.meta.runId).toBe(filed.origin?.runId);
    // A redemption belongs to no run at all.
    expect(door[1]?.meta.runId).toBe('consumer-scope');
    expect(door[2]?.meta.runId).toBe('consumer-scope');
  });

  it('the self-explain evidence of bob’s run carries no fact alice’s door produced', async () => {
    const gate = gatedProvider('ok');
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: gate.provider,
      model: 'm',
      artifacts: { store, recordings: true },
    })
      .selfExplain({})
      .build();
    const recordings = recordingsOf(agent);
    const { host } = await served(agent, { verify: true });
    await host.deliver({ input: 'a', sessionId: 'sA', headers: ALICE });
    const aliceRecording = recordings()[0]?.ref as string;

    const inFlight = gate.arm();
    const bobTurn = host.deliver({ input: 'b', sessionId: 'sB', headers: BOB });
    await inFlight.started;
    await host.deliver({
      sessionId: 'sA',
      artifact: { op: 'head', ref: aliceRecording },
      headers: ALICE,
    });
    inFlight.release();
    expect((await bobTurn).output).toBe('ok');

    const binding = (agent as unknown as { selfExplainBinding?: SelfExplainBinding })
      .selfExplainBinding;
    const captured = binding?.artifacts?.events ?? [];
    expect(captured.length).toBeGreaterThan(0);
    expect(JSON.stringify(captured)).not.toContain(aliceRecording);
  });

  it('CONTROL: the pooled shape keeps each session on its own instance', async () => {
    const store = inMemoryArtifacts();
    const gates: Array<ReturnType<typeof gatedProvider>> = [];
    const recordings: Array<{ ref: string; agent: number }> = [];
    const { host } = await served(
      {
        agentFactory: () => {
          const gate = gatedProvider('ok');
          gates.push(gate);
          const index = gates.length - 1;
          const agent = recordingAgent(store, gate.provider);
          agent.on('agentfootprint.artifacts.minted', (event: AgentfootprintEvent) => {
            const payload = event.payload as ArtifactMintedFact;
            if (payload.kind === 'recording/run')
              recordings.push({ ref: payload.ref, agent: index });
          });
          return agent;
        },
      },
      { verify: true },
    );
    const alice = await host.deliver({
      input: 'a',
      sessionId: 'sA',
      headers: ALICE,
      onTurn: fileStory('ALICE-LABEL'),
    });
    const aliceFiling = filedOf(alice);
    await host.deliver({ input: 'warm', sessionId: 'sB', headers: BOB });
    const inFlight = gates[1]!.arm();
    const bobTurn = host.deliver({ input: 'b', sessionId: 'sB', headers: BOB });
    await inFlight.started;
    await host.deliver({
      sessionId: 'sA',
      artifact: { op: 'head', ref: aliceFiling.ref },
      headers: ALICE,
    });
    inFlight.release();
    await bobTurn;
    const bobRecording = recordings.filter((r) => r.agent === 1).pop()?.ref as string;
    const text = textOf(await redeem(host, 'sB', bobRecording, BOB));
    expect(text).not.toContain(aliceFiling.ref);
    expect(text).not.toContain('ALICE-LABEL');
  });
});

// ─── F5 / held past its lane — refused, whoever runs next ───────────

describe('attack regressions — a hand-over held past its turn', () => {
  it('pooled: held past its lane’s eviction, it is refused by name (never written to a stopped instance)', async () => {
    const store = inMemoryArtifacts();
    const { host } = await served(
      {
        agentFactory: () =>
          Agent.create({ provider: mock({ reply: 'ok' }), model: 'm', artifacts: store }).build(),
        maxActiveSessions: 1,
      },
      { verify: true },
    );
    const alice = await host.deliver({
      input: 'hi',
      sessionId: 'sA',
      headers: ALICE,
      onTurn: keep,
    });
    const held = alice.filed[0] as TurnArtifacts;
    if (!held.bound) throw new Error('expected a bound hand-over');
    // Bob arrives → alice's lane is evicted and its agent stopped; alice comes
    // back on a fresh instance.
    await host.deliver({ input: 'hi', sessionId: 'sB', headers: BOB });
    await host.deliver({ input: 'again', sessionId: 'sA', headers: ALICE });

    await expect(
      held.artifacts.put({ kind: 'story/turn', mediaType: 'text/plain', data: 'late' }),
    ).rejects.toMatchObject({ code: 'ERR_TURN_ARTIFACTS_EXPIRED' });
    expect((await store.list({ conversationId: 'sA', principal: 'alice' })).artifacts).toEqual([]);
  });

  it('open door: the next person on a re-used session id never receives a previous holder’s late filing', async () => {
    const { host } = await served(
      Agent.create({
        provider: mock({ reply: 'ok' }),
        model: 'm',
        artifacts: inMemoryArtifacts(),
      }).build(),
    );
    const first = await host.deliver({ input: 'person one', sessionId: 'tab-1', onTurn: keep });
    const held = first.filed[0] as TurnArtifacts;
    if (!held.bound) throw new Error('expected a bound hand-over');
    // Person one's host files late — after its turn ended.
    await expect(
      held.artifacts.put({
        kind: 'story/turn',
        mediaType: 'text/plain',
        data: "person one's late note",
      }),
    ).rejects.toMatchObject({ code: 'ERR_TURN_ARTIFACTS_EXPIRED' });
    // Whoever holds that session id next finds nothing it did not file itself.
    const second = await host.deliver({
      input: 'person two',
      sessionId: 'tab-1',
      onTurn: async (turn) => {
        if (!turn.bound) return undefined;
        return (await turn.artifacts.list()).artifacts.length;
      },
    });
    expect(second.filed).toEqual([0]);
  });
});

// ─── F2 / F3 — the hook never crashes the process or decides the reply ──

describe('attack regressions — the hook never decides the terminal', () => {
  it('a throwing hook: the persisted answer is still delivered, and the failure is on the ingress record', async () => {
    const records: IngressRecord[] = [];
    const agent = Agent.create({
      provider: mock({ reply: 'the answer' }),
      model: 'm',
      artifacts: inMemoryArtifacts(),
    }).build();
    const { host, sessions } = await served(agent, {
      extra: { onIngressDecision: (record) => records.push(record) },
    });
    const turn = await host.deliver({
      input: 'q1',
      sessionId: 's1',
      onTurn: () => {
        throw new Error('host hook bug — with words that must never reach a record');
      },
    });
    expect(turn.output).toBe('the answer');
    expect(turn.error).toBeUndefined();
    expect(turn.order).toEqual(['turnArtifacts', 'turnArtifacts:settled', 'complete']);
    expect(JSON.stringify(await sessions.hydrate('s1'))).toContain('the answer');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      outcome: 'served',
      turnArtifactsFailure: { cause: 'hook', errorClass: 'Error' },
    });
    expect(JSON.stringify(records[0])).not.toContain('must never reach');
  });

  it('a rejecting hook on a paused turn: the question is still delivered, so the next reply answers it', async () => {
    const records: IngressRecord[] = [];
    const { host } = await served(pausingAgent(), {
      extra: { onIngressDecision: (record) => records.push(record) },
    });
    const paused = await host.deliver({
      input: 'refund me',
      sessionId: 's-p',
      onTurn: async () => {
        await Promise.resolve();
        throw Object.assign(new Error('store outage'), { code: 'ERR_HOST_STORE' });
      },
    });
    expect(paused.awaiting?.question).toBe('Approve $10?');
    expect(paused.error).toBeUndefined();
    expect(records[0]).toMatchObject({
      outcome: 'served',
      turnArtifactsFailure: { cause: 'hook', errorClass: 'Error', errorCode: 'ERR_HOST_STORE' },
    });
    // The person saw the question, so their answer continues the run.
    const resumed = await host.deliver({ sessionId: 's-p', decision: 'yes' });
    expect(resumed.output).toBe('refund issued');
  });

  it('a store refusal inside `void put` or an async hook never becomes an unhandled rejection', async () => {
    const store = inMemoryArtifacts({ retention: { maxBytesPerScope: 1024 } });
    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'm',
      artifacts: store,
    }).build();
    const events = artifactEventsOf(agent);
    const { host } = await served(agent);
    const tooBig = { kind: 'story/turn', mediaType: 'text/plain', data: 'x'.repeat(4096) };
    const outputs: Array<string | undefined> = [];

    const unhandled = await unhandledDuring(async () => {
      // The first cut's documented form: a floating put.
      const voided = await host.deliver({
        input: 'hi',
        sessionId: 's1',
        onTurn: (turn) => {
          if (turn.bound) void turn.artifacts.put(tooBig);
        },
      });
      outputs.push(voided.output);
      // The careful form: an async hook that awaits its put and lets it throw.
      const awaited = await host.deliver({
        input: 'again',
        sessionId: 's2',
        onTurn: async (turn) => {
          if (turn.bound) await turn.artifacts.put(tooBig);
        },
      });
      outputs.push(awaited.output);
    });

    expect(unhandled).toEqual([]);
    expect(outputs).toEqual(['ok', 'ok']);
    // The refusal itself is on the record, once per put, for its own session.
    const refused = events().filter((event) => event.type === 'agentfootprint.artifacts.refused');
    expect(refused.map((event) => event.meta.sessionId)).toEqual(['s1', 's2']);
    expect(refused.map((event) => (event.payload as { reason: string }).reason)).toEqual([
      'invalid-input',
      'invalid-input',
    ]);
    // …and each failed hand-over is on the stream too, class only: one
    // 'operation' per failed put — the async hook that rethrew the SAME error
    // is not counted twice.
    const failed = events().filter(
      (event) => event.type === 'agentfootprint.artifacts.hand_over_failed',
    );
    expect(failed.map((event) => [event.meta.sessionId, event.payload])).toEqual([
      [
        's1',
        {
          cause: 'operation',
          op: 'put',
          errorClass: 'InvalidArtifactError',
          errorCode: 'ERR_INVALID_ARTIFACT',
        },
      ],
      [
        's2',
        {
          cause: 'operation',
          op: 'put',
          errorClass: 'InvalidArtifactError',
          errorCode: 'ERR_INVALID_ARTIFACT',
        },
      ],
    ]);
  });
});

// ─── F4 — origin is the framework's field on every path ────────────

describe('attack regressions — a smuggled origin', () => {
  it('is dropped on the turns that run nothing (a partial answer, a cancel) — and never reaches the record', async () => {
    const agent = inputAgent();
    const minted: ArtifactMintedFact[] = [];
    agent.on('agentfootprint.artifacts.minted', (event: AgentfootprintEvent) => {
      minted.push(event.payload as ArtifactMintedFact);
    });
    const { host } = await served(agent, { verify: true });
    const forged = { origin: { runId: 'bobs-run-id', toolCallId: 'forged-call' } };

    const asked = await host.deliver({ input: 'Inspect.', sessionId: 's-in', headers: ALICE });
    const requestId = asked.awaiting?.awaitingInput?.requestId as string;
    const partial = await host.deliver({
      sessionId: 's-in',
      decision: { requestId, values: { year: 2026 } },
      headers: ALICE,
      onTurn: fileStory('partial', forged),
    });
    const cancelled = await host.deliver({
      sessionId: 's-in',
      decision: { requestId, cancel: true },
      headers: ALICE,
      onTurn: fileStory('cancelled', forged),
    });

    for (const filed of [filedOf(partial), filedOf(cancelled)] as ArtifactMeta[]) {
      expect(filed.origin).toBeUndefined();
      expect(minted.find((fact) => fact.ref === filed.ref)?.origin).toBeUndefined();
    }
    expect(boundOf(cancelled).bound).toBe(true);
  });
});
