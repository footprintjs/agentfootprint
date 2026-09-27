/**
 * ROUND 3 — the review of `7130db4c` (idfix-REVIEW.md), each attack ported as a
 * regression with its assertion INVERTED: the reviewer's test asserted the
 * problem, this one asserts the fix. Two reviewer tests were HOLDS (they
 * asserted correct behaviour) and are kept as holds. Plus the tests that kill
 * the mutants the review found surviving (S8).
 *
 * The laws being pinned:
 *   • B1 — a HOSTED request with no session is its own self-explain
 *     conversation (the host's per-request key); only a direct, unhosted run
 *     with no session shares the no-session key.
 *   • S1 — a resume never drops an identity the caller named, and never
 *     promotes a derived one.
 *   • S2/S3 — a resume that names a DIFFERENT identity from the paused run's
 *     caller is refused before anything runs (one run, one identity).
 *   • S4 — a resume that names no session keeps the paused run's.
 *   • S5 — a seam binding is revoked when its instance is retired and at close.
 *   • S6 — the seam never builds or evicts a lane (with 114d69f6's redeemerFor).
 *   • S7 — an identity-provider outage is `'unavailable'`, not `'unverified'`.
 *   • NIT 2 — the seam applies the wire's session-id check and ops bound.
 *   • NIT 5 — a tool's record is keyed by run AND call id.
 *
 * Test types (Convention 3): security · regression · integration · boundary.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { flowChart } from 'footprintjs';
import type { FlowchartCheckpoint } from 'footprintjs';

import {
  Agent,
  defineTool,
  flowchartAsTool,
  inMemoryArtifacts,
  ResumeIdentityConflictError,
  runbookAsTool,
} from '../../src/index.js';
import type { AgentfootprintEvent } from '../../src/events.js';
import type { LLMRequest } from '../../src/adapters/types.js';
import { mock } from '../../src/llm-providers.js';
import { askHuman } from '../../src/core/pause.js';
import type { MemoryIdentity } from '../../src/memory/identity/types.js';
import type { CredentialProvider, CredentialRequest } from '../../src/identity/types.js';
import {
  ArtifactOpsBusyError,
  memorySessions,
  RequestArtifactsRevokedError,
  standingAgent,
  VerifierUnavailableError,
} from '../../src/hosting/index.js';
import type {
  HostHandle,
  SessionLifecycle,
  StandingAgentHandle,
  StandingAgentOptions,
} from '../../src/hosting/index.js';
import { toEnvelope } from '../../src/hosting/envelope.js';
import {
  ALICE,
  BOB,
  filingHost,
  harness,
  recordingsOf,
  redeem,
  verifier,
} from './turnArtifactsHarness.js';

const { served, closeAll } = harness();
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await closeAll();
  await Promise.allSettled(closers.map((c) => c()));
  closers.length = 0;
});

// ─── shared fixtures (the reviewer's, unchanged) ─────────────────────

type Reply = {
  content?: string;
  toolCalls?: ReadonlyArray<{ id: string; name: string; args: object }>;
};
const ASK: Reply = { toolCalls: [{ id: 't1', name: 'approve_refund', args: { amount: 10 } }] };
const WHO: Reply = { toolCalls: [{ id: 't2', name: 'who', args: {} }] };

function spyAgent(replies: readonly Reply[]) {
  const seen: { ctxIdentity?: unknown; credentialIdentity?: unknown }[] = [];
  const credentials = {
    id: 'spy',
    getCredential: async (req: CredentialRequest) => {
      seen.push({ credentialIdentity: req.identity });
      return {
        status: 'issued',
        credential: { kind: 'bearer', toHeaders: () => ({ authorization: 'Bearer x' }) },
      };
    },
  } as unknown as CredentialProvider;
  const approve = defineTool<{ amount: number }, string>({
    name: 'approve_refund',
    description: 'refund a customer',
    inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
    execute: ({ amount }) => askHuman({ question: `Approve $${amount}?` }),
  });
  const who = defineTool<Record<string, never>, string>({
    name: 'who',
    description: 'who am I',
    inputSchema: { type: 'object', properties: {} },
    needs: { credential: 'billing' },
    execute: (_args, ctx) => {
      seen.push({ ctxIdentity: (ctx as { identity?: unknown }).identity });
      return 'ok';
    },
  });
  const agent = Agent.create({
    provider: mock({ replies: replies as never }),
    model: 'm',
    maxIterations: 4,
    credentials,
  })
    .system('terse')
    .tool(approve)
    .tool(who)
    .build();
  const principals: (string | undefined)[] = [];
  agent.on('*', (e: AgentfootprintEvent) => {
    if (e.meta.runId !== 'consumer-scope') principals.push(e.meta.principal);
  });
  return { agent, seen, principals };
}

/** STASH <secret> <id>; ASKSTASH <secret> <id> (pause first); WHY <foreign> [own]. */
function scriptedModel() {
  let seq = 0;
  const lastUser = (request: LLMRequest) => {
    const m = request.messages;
    let at = -1;
    for (let i = 0; i < m.length; i++) if (m[i]?.role === 'user') at = i;
    const c = m[at]?.content;
    return {
      text: typeof c === 'string' ? c : JSON.stringify(c ?? ''),
      toolsAfter: m.slice(at + 1).filter((x) => x.role === 'tool').length,
    };
  };
  const base = mock({
    respond: (request: LLMRequest) => {
      const { text, toolsAfter } = lastUser(request);
      const [verb, a, b] = text.split(' ');
      if (verb === 'STASH' || verb === 'RUNBOOK') {
        const tool = verb === 'STASH' ? 'stash' : 'stash_runbook';
        return toolsAfter === 0
          ? { toolCalls: [{ id: b as string, name: tool, args: { secret: a } }] }
          : { content: 'stashed' };
      }
      if (verb === 'ASKSTASH') {
        if (toolsAfter === 0)
          return { toolCalls: [{ id: `ask-${++seq}`, name: 'approve', args: {} }] };
        if (toolsAfter === 1)
          return { toolCalls: [{ id: b as string, name: 'stash', args: { secret: a } }] };
        return { content: 'stashed' };
      }
      if (verb === 'WHY') {
        const plan: Array<[string, Record<string, unknown>]> = [
          ['read_skill', { id: 'self-explain' }],
          ['read_narrative', {}],
          ['find_in_trace', { query: 'SECRET' }],
          ['inspect_tool_run', { toolCallId: a, find: 'SECRET' }],
          ...(b !== undefined
            ? [
                ['inspect_tool_run', { toolCallId: b, find: 'SECRET' }] as [
                  string,
                  Record<string, unknown>,
                ],
              ]
            : []),
        ];
        const step = plan[toolsAfter];
        if (step === undefined) return { content: 'here is why' };
        return { toolCalls: [{ id: `why-${++seq}`, name: step[0], args: step[1] }] };
      }
      return { content: 'noted' };
    },
  });
  return new Proxy(base, {
    get: (t, p) => (p === 'stream' ? undefined : Reflect.get(t, p, t)),
  });
}

const keepChart = () =>
  flowChart<{ kept: string }>(
    'Keep',
    (scope) => {
      scope.kept = (scope.$getArgs() as { secret: string }).secret;
    },
    'keep',
  ).build();

function explainingAgent(): Agent {
  return Agent.create({
    provider: scriptedModel() as never,
    model: 'm',
    maxIterations: 8,
    artifacts: { store: inMemoryArtifacts(), recordings: true },
  })
    .tool(
      flowchartAsTool({
        name: 'stash',
        description: 'Keep a note.',
        inputSchema: {
          type: 'object',
          properties: { secret: { type: 'string' } },
          required: ['secret'],
        },
        flowchart: keepChart(),
        keepRecord: true,
      }),
    )
    .tool(
      runbookAsTool({
        name: 'stash_runbook',
        description: 'Keep a note, as a runbook.',
        procedure: () => keepChart(),
        keepRecord: true,
      }),
    )
    .tool(
      defineTool({
        name: 'approve',
        description: 'ask',
        inputSchema: { type: 'object', properties: {} },
        execute: () => askHuman({ question: 'ok?' }),
      }),
    )
    .selfExplain({})
    .build();
}

function toolEndTexts(agent: Agent): () => string {
  const ends: AgentfootprintEvent[] = [];
  agent.on('agentfootprint.stream.tool_end', (e: AgentfootprintEvent) => ends.push(e));
  let mark = 0;
  return () => {
    const text = ends
      .slice(mark)
      .map((e) => JSON.stringify(e.payload))
      .join('\n');
    mark = ends.length;
    return text;
  };
}

async function pooled(options: { verify?: boolean; max: number }) {
  const store = inMemoryArtifacts();
  const built: Agent[] = [];
  const evicted: Array<{ agent: number; reason?: string }> = [];
  const shut: number[] = [];
  const sessions = memorySessions();
  const host = filingHost();
  const handle = (await standingAgent({
    agentFactory: () => {
      const agent = Agent.create({
        provider: mock({ reply: 'ok' }),
        model: 'm',
        artifacts: { store, recordings: true },
      }).build();
      const index = built.length;
      built.push(agent);
      const close = agent.closeToolSessions.bind(agent);
      agent.closeToolSessions = ((o: { reason?: string }) => {
        evicted.push({ agent: index, reason: o?.reason });
        return close(o as never);
      }) as never;
      const shutdown = agent.shutdown.bind(agent);
      agent.shutdown = ((o: never) => {
        shut.push(index);
        return shutdown(o);
      }) as never;
      return agent;
    },
    maxActiveSessions: options.max,
    sessions,
    host,
    ...(options.verify === true && { identity: { verify: verifier().verify } }),
  } as unknown as StandingAgentOptions<HostHandle>)) as HostHandle & StandingAgentHandle;
  closers.push(() => handle.close());
  return { host, handle, built, evicted, shut, sessions };
}

const note = (text: string) => ({ kind: 'note/app', mediaType: 'text/plain', data: text });
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

// ─── Bug A — resume identity (A1, A2, A3) ────────────────────────────

describe('A1 — an edited checkpoint cannot walk a host that passes its verified identity into another person’s run', () => {
  it('bob’s checkpoint edited to name alice, resumed with bob’s identity → refused; nothing ran', async () => {
    const { agent, seen, principals } = spyAgent([ASK, WHO, { content: 'done' }]);
    const bob: MemoryIdentity = { principal: 'bob', conversationId: 'cb' };
    const paused = (await agent.run({ message: 'refund me', identity: bob })) as {
      checkpoint: FlowchartCheckpoint;
    };
    agent.abandonPause();
    const tampered = structuredClone(paused.checkpoint) as FlowchartCheckpoint & {
      sharedState: Record<string, unknown>;
    };
    tampered.sharedState.runIdentity = { tenant: 'acme', principal: 'alice', conversationId: 'ca' };
    principals.length = 0;
    seen.length = 0;
    await expect(agent.resume(tampered, 'yes', { identity: bob })).rejects.toBeInstanceOf(
      ResumeIdentityConflictError,
    );
    expect(seen).toEqual([]);
    expect(principals).toEqual([]);
  });
});

describe('A2 — a resume that names a different person is refused: one run, one identity', () => {
  it('alice’s checkpoint resumed as bob → ResumeIdentityConflictError before any tool or event', async () => {
    const { agent, seen, principals } = spyAgent([ASK, WHO, { content: 'done' }]);
    const alice: MemoryIdentity = { tenant: 'acme', principal: 'alice', conversationId: 'ca' };
    const paused = (await agent.run({ message: 'refund me', identity: alice })) as {
      checkpoint: FlowchartCheckpoint;
    };
    agent.abandonPause();
    principals.length = 0;
    seen.length = 0;
    const bob: MemoryIdentity = { principal: 'bob', conversationId: 'cb' };
    const refusal = await agent.resume(paused.checkpoint, 'yes', { identity: bob }).catch((e) => e);
    expect(refusal).toBeInstanceOf(ResumeIdentityConflictError);
    expect((refusal as { code: string }).code).toBe('ERR_SESSION_OWNERSHIP_CONFLICT');
    expect(String(refusal)).not.toMatch(/alice|bob/);
    expect(seen).toEqual([]);
    expect(principals).toEqual([]);
    // …and the same identity resumes normally, with ONE identity throughout.
    await agent.resume(paused.checkpoint, 'yes', { identity: alice });
    expect(seen.find((s) => 'ctxIdentity' in s)?.ctxIdentity).toEqual(alice);
    expect(seen.find((s) => 'credentialIdentity' in s)?.credentialIdentity).toEqual({
      principal: 'alice',
      tenant: 'acme',
    });
    expect(new Set(principals)).toEqual(new Set(['alice']));
  });
});

describe('A3 — a caller-NAMED identity survives a bare resume (single-user regression)', () => {
  for (const conversationId of ['default', 'run-1-1', 'run-20260925-7']) {
    it(`{ conversationId: '${conversationId}' } named on run() is kept across a bare resume`, async () => {
      const { agent } = spyAgent([ASK, { content: 'done' }]);
      const named: MemoryIdentity = { conversationId };
      const paused = (await agent.run({ message: 'refund me', identity: named })) as {
        checkpoint: FlowchartCheckpoint;
      };
      await agent.resume(paused.checkpoint, 'yes');
      expect(agent.checkpoint()?.identity).toEqual(named);
    });
  }

  it('the returned identity is a copy — editing the checkpoint afterwards changes nothing stored', async () => {
    const { agent } = spyAgent([ASK, { content: 'done' }]);
    const named: MemoryIdentity = { principal: 'p', conversationId: 'c' };
    const paused = (await agent.run({ message: 'refund me', identity: named })) as {
      checkpoint: FlowchartCheckpoint & { sharedState: { runIdentity: { principal: string } } };
    };
    await agent.resume(paused.checkpoint, 'yes');
    paused.checkpoint.sharedState.runIdentity.principal = 'mallory';
    expect(agent.checkpoint()?.identity).toEqual(named);
  });
});

// ─── R2-11 follow-ups (S1 → B1, S2, S3 hold, S4, S5) ─────────────────

describe('B1 — every hosted sessionless request is its own self-explain conversation', () => {
  it('VERIFYING door, shared agent: signed-in bob (no sessionId) reads nothing of signed-in alice’s', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const { host } = await served(agent, { verify: true });
    const a = await host.deliver({ input: 'STASH SECRET-alice c-alice', headers: ALICE });
    expect(a.code).toBeUndefined();
    since();
    const b = await host.deliver({ input: 'WHY c-alice', headers: BOB });
    expect(b.code).toBeUndefined();
    const bobSaw = since();
    expect(bobSaw).not.toContain('SECRET-alice');
    expect(bobSaw).not.toContain('INSIDE TOOL CALL c-alice');
  });

  it('POOLED + verifying door: sessionless requests on the one anonymous lane are isolated too', async () => {
    const built: Agent[] = [];
    const texts: Array<() => string> = [];
    const { host } = await served(
      {
        agentFactory: () => {
          const agent = explainingAgent();
          built.push(agent);
          texts.push(toolEndTexts(agent));
          return agent;
        },
        maxActiveSessions: 4,
      },
      { verify: true },
    );
    await host.deliver({ input: 'STASH SECRET-alice c-alice', headers: ALICE });
    texts.forEach((t) => t());
    await host.deliver({ input: 'WHY c-alice', headers: BOB });
    expect(built).toHaveLength(1);
    expect(texts[0]?.()).not.toContain('SECRET-alice');
  });

  it('a DIRECT, unhosted agent with no session still explains its own previous run', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    await agent.run({ message: 'STASH SECRET-me c-me' });
    since();
    await agent.run({ message: 'WHY c-none c-me' });
    const saw = since();
    expect(saw).toContain('SECRET-me');
    expect(saw).toContain('INSIDE TOOL CALL c-me');
  });
});

describe('S2 (NIT 5) — a tool record is keyed by run AND call id', () => {
  it('bob reusing alice’s call id neither leaks nor displaces her record', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const { host } = await served(agent, { verify: true });
    await host.deliver({ sessionId: 'sA', input: 'STASH SECRET-alice c1', headers: ALICE });
    await host.deliver({ sessionId: 'sB', input: 'STASH SECRET-bob c1', headers: BOB });
    since();
    await host.deliver({ sessionId: 'sA', input: 'WHY c1', headers: ALICE });
    const aliceSaw = since();
    expect(aliceSaw).not.toContain('SECRET-bob');
    expect(aliceSaw).toContain('INSIDE TOOL CALL c1');
    expect(aliceSaw).toContain('SECRET-alice');
  });
});

describe('HOLD S3 — LRU eviction at 64 never falls back to another conversation', () => {
  it('65 sessions later, the first session’s WHY reads nothing of anyone else’s', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const { host } = await served(agent, { verify: true, allowAnonymous: true });
    await host.deliver({ sessionId: 's0', input: 'STASH SECRET-0 c-0' });
    for (let i = 1; i <= 65; i++)
      await host.deliver({ sessionId: `s${i}`, input: `STASH SECRET-${i} c-${i}` });
    since();
    await host.deliver({ sessionId: 's0', input: 'WHY c-65' });
    expect(since()).not.toMatch(/SECRET-\d/);
  }, 60_000);
});

describe('S4 — a direct resume that names no session keeps the paused run’s', () => {
  it('alice’s resumed session turn is NOT served to the next sessionless caller', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const paused = (await agent.run(
      {
        message: 'ASKSTASH SECRET-alice c-alice',
        identity: { principal: 'alice', conversationId: 'sA' },
      },
      { sessionId: 'sA' },
    )) as { checkpoint: FlowchartCheckpoint };
    await agent.resume(paused.checkpoint, 'yes');
    since();
    await agent.run({
      message: 'WHY c-alice',
      identity: { principal: 'mallory', conversationId: 'm' },
    });
    expect(since()).not.toContain('SECRET-alice');
  });
});

describe('S5 — a session app that resumes WITHOUT sessionId keeps the resumed turn (single-user regression)', () => {
  it('run(sessionId s) pauses → resume(cp) → WHY in session s is served its own turn', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const paused = (await agent.run(
      { message: 'ASKSTASH SECRET-me c-me' },
      { sessionId: 's' },
    )) as {
      checkpoint: FlowchartCheckpoint;
    };
    await agent.resume(paused.checkpoint, 'yes');
    since();
    await agent.run({ message: 'WHY c-me' }, { sessionId: 's' });
    const saw = since();
    expect(saw).toContain('SECRET-me');
    expect(saw).toContain('INSIDE TOOL CALL c-me');
  });

  it('a checkpoint from ANOTHER instance recovers the session from the session rung', async () => {
    const first = explainingAgent();
    const paused = (await first.run(
      { message: 'ASKSTASH SECRET-me c-me' },
      { sessionId: 's' },
    )) as {
      checkpoint: FlowchartCheckpoint;
    };
    const second = explainingAgent();
    const since = toolEndTexts(second);
    await second.resume(structuredClone(paused.checkpoint), 'yes');
    since();
    await second.run({ message: 'WHY c-me' }, { sessionId: 's' });
    expect(since()).toContain('SECRET-me');
  });
});

// ─── item C — artifactsForRequest (C1–C4, holds) ─────────────────────

describe('C1 (S6) — at an OPEN door the seam never builds a lane or evicts one', () => {
  it('naming sessions nobody ever ran is the one not-found; the real person’s lane stays', async () => {
    const { host, handle, built, evicted } = await pooled({ max: 1 });
    await host.deliver({ sessionId: 'real-user', input: 'hi' });
    expect(built).toHaveLength(1);
    expect(await handle.artifactsForRequest({ sessionId: 'made-up-1' })).toEqual({
      bound: false,
      reason: 'not-found',
    });
    expect(built).toHaveLength(1);
    await tick();
    expect(evicted).toEqual([]);
  });
});

describe('C2 (S5) — a seam binding is revoked with its instance', () => {
  it('pooled: alice’s lane evicted → her binding refuses by name, nothing lands on the retired agent', async () => {
    const { host, handle, built, shut } = await pooled({ verify: true, max: 1 });
    await host.deliver({ sessionId: 'sA', input: 'hi', headers: ALICE });
    const alice = await handle.artifactsForRequest({ sessionId: 'sA', headers: ALICE });
    if (!alice.bound) throw new Error(alice.reason);
    await host.deliver({ sessionId: 'sB', input: 'hi', headers: BOB });
    await tick();
    expect(shut).toContain(0);
    const facts: unknown[] = [];
    built[0]?.on('*', (e: unknown) => facts.push(e));
    await expect(alice.artifacts.put(note('after eviction'))).rejects.toBeInstanceOf(
      RequestArtifactsRevokedError,
    );
    expect(facts).toEqual([]);
    // A fresh ask is served (by the reader — nothing built into the pool, nothing evicted).
    const again = await handle.artifactsForRequest({ sessionId: 'sA', headers: ALICE });
    if (!again.bound) throw new Error(again.reason);
    expect((await again.artifacts.put(note('fresh binding'))).ref).toMatch(/^art_/);
  });

  it('a binding obtained before close() is refused after close()', async () => {
    const { host, handle } = await pooled({ verify: true, max: 4 });
    await host.deliver({ sessionId: 'sA', input: 'hi', headers: ALICE });
    const alice = await handle.artifactsForRequest({ sessionId: 'sA', headers: ALICE });
    if (!alice.bound) throw new Error(alice.reason);
    await handle.close();
    await expect(alice.artifacts.put(note('after close'))).rejects.toBeInstanceOf(
      RequestArtifactsRevokedError,
    );
  });
});

describe('C3 (NIT 2) — the seam applies the bounds the wire enforces', () => {
  it('an oversized session id is refused as invalid-session; nothing is built', async () => {
    const { handle, built } = await pooled({ max: 2 });
    const r = await handle.artifactsForRequest({ sessionId: 'x'.repeat(200_000) });
    expect(r).toMatchObject({ bound: false, reason: 'invalid-session' });
    if (r.bound) return;
    expect((r.error as { code?: string } | undefined)?.code).toBe('ERR_INVALID_SESSION_ID');
    expect(built).toHaveLength(0);
  });

  it('artifactOpsPerSession applies to the handed-back verbs', async () => {
    const { host, handle } = await pooled({ verify: true, max: 2 });
    await host.deliver({ sessionId: 'sA', input: 'hi', headers: ALICE });
    const alice = await handle.artifactsForRequest({ sessionId: 'sA', headers: ALICE });
    if (!alice.bound) throw new Error(alice.reason);
    const burst = await Promise.allSettled(
      Array.from({ length: 64 }, (_, i) => alice.artifacts.put(note(`n${i}`))),
    );
    const refused = burst.filter((s) => s.status === 'rejected');
    expect(refused.length).toBeGreaterThan(0);
    for (const r of refused) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ArtifactOpsBusyError);
    }
    expect(burst.filter((s) => s.status === 'fulfilled').length).toBeGreaterThanOrEqual(8);
  });

  it('Express’s IncomingHttpHeaders type-checks as it is; a repeated authorization is no token', async () => {
    const { host, handle } = await pooled({ verify: true, max: 2 });
    await host.deliver({ sessionId: 'sA', input: 'hi', headers: ALICE });
    const expressHeaders: Record<string, string | string[] | undefined> = {
      authorization: ALICE.authorization,
      'x-forwarded-for': ['1.1.1.1', '2.2.2.2'],
      'x-absent': undefined,
    };
    expect(
      (await handle.artifactsForRequest({ sessionId: 'sA', headers: expressHeaders })).bound,
    ).toBe(true);
    const repeated = await handle.artifactsForRequest({
      sessionId: 'sA',
      headers: { authorization: [ALICE.authorization, BOB.authorization] },
    });
    expect(repeated).toMatchObject({ bound: false, reason: 'unverified' });
  });
});

describe('HOLDS — identity rungs', () => {
  it('verifying door: bob naming alice’s session, bob claiming alice, a claim with no token → all refused; alice’s filing is hers alone', async () => {
    const { host, handle } = await pooled({ verify: true, max: 4 });
    await host.deliver({ sessionId: 'sA', input: 'hi', headers: ALICE });
    expect(await handle.artifactsForRequest({ sessionId: 'sA', headers: BOB })).toEqual({
      bound: false,
      reason: 'not-found',
    });
    expect(
      (await handle.artifactsForRequest({ sessionId: 'sA', headers: BOB, userId: 'alice' })).bound,
    ).toBe(false);
    expect((await handle.artifactsForRequest({ sessionId: 'sA', userId: 'alice' })).bound).toBe(
      false,
    );
    const alice = await handle.artifactsForRequest({ sessionId: 'sA', headers: ALICE });
    if (!alice.bound) throw new Error(alice.reason);
    const filed = await alice.artifacts.put(note('alice only'));
    expect((await redeem(host, 'sA', filed.ref, ALICE)).error).toBeUndefined();
    expect((await redeem(host, 'sA', filed.ref, BOB)).code).toBe('ERR_ARTIFACT_NOT_FOUND');
  });
});

describe('C4 (S7) — an identity-provider outage is its own reason', () => {
  it('the seam answers unavailable (a 503), the wire keeps ERR_IDENTITY_VERIFIER_UNAVAILABLE', async () => {
    const host = filingHost();
    const handle = (await standingAgent({
      agent: Agent.create({
        provider: mock({ reply: 'ok' }),
        model: 'm',
        artifacts: { store: inMemoryArtifacts() },
      }).build(),
      sessions: memorySessions(),
      host,
      identity: { verify: () => Promise.reject(new VerifierUnavailableError('jwks', 'timeout')) },
    } as unknown as StandingAgentOptions<HostHandle>)) as HostHandle & StandingAgentHandle;
    closers.push(() => handle.close());
    const r = await handle.artifactsForRequest({ sessionId: 's', headers: ALICE });
    expect(r).toMatchObject({ bound: false, reason: 'unavailable' });
    if (!r.bound) expect(r.error).toBeInstanceOf(VerifierUnavailableError);
    const wire = await redeem(host, 's', `art_${'N'.repeat(22)}`, ALICE);
    expect(wire.code).toBe('ERR_IDENTITY_VERIFIER_UNAVAILABLE');
  });
});

// ─── S8 — the surviving mutants ──────────────────────────────────────

describe('S8 — the owner’s OWN descent (kills M6 runbookAsTool, M7 flowchartAsTool)', () => {
  it('a session’s WHY opens its own flowchart and runbook records, and no one else’s', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const { host } = await served(agent, { verify: true });
    await host.deliver({ sessionId: 'sA', input: 'STASH SECRET-a1 fa', headers: ALICE });
    await host.deliver({ sessionId: 'sA', input: 'RUNBOOK SECRET-a2 ra', headers: ALICE });
    await host.deliver({ sessionId: 'sB', input: 'STASH SECRET-b1 fb', headers: BOB });
    since();
    await host.deliver({ sessionId: 'sA', input: 'WHY fb fa', headers: ALICE });
    const flow = since();
    expect(flow).toContain('INSIDE TOOL CALL fa');
    expect(flow).not.toContain('INSIDE TOOL CALL fb');
    await host.deliver({ sessionId: 'sA', input: 'WHY fb ra', headers: ALICE });
    const book = since();
    expect(book).toContain('INSIDE TOOL CALL ra');
    expect(book).not.toContain('SECRET-b1');
  });
});

describe('S8 — the 64-conversation bound (kills M4)', () => {
  it('the least recently completed conversation is dropped past 64, and answers "no completed run"', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    await agent.run({ message: 'STASH SECRET-0 c-0' }, { sessionId: 's0' });
    for (let i = 1; i <= 64; i++) {
      await agent.run({ message: `STASH SECRET-${i} c-${i}` }, { sessionId: `s${i}` });
    }
    since();
    await agent.run({ message: 'WHY c-0' }, { sessionId: 's0' });
    const dropped = since();
    expect(dropped).not.toMatch(/SECRET-\d/);
    expect(dropped).toContain('No completed run');
    await agent.run({ message: 'WHY c-none c-64' }, { sessionId: 's64' });
    expect(since()).toContain('SECRET-64');
  }, 60_000);
});

describe('S8 — seam and wire compose ONE scope from the STORED identity (kills M9)', () => {
  it('a conversation whose stored identity carries a tenant and another conversation id', async () => {
    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'm',
      artifacts: { store: inMemoryArtifacts(), recordings: true },
    }).build();
    const recordings = recordingsOf(agent);
    const { host, handle, sessions } = await pooledShared(agent);
    await host.deliver({ sessionId: 'sA', input: 'hi', headers: ALICE });
    // The app seeded a tenant and its own conversation id for this session.
    const stored = (await sessions.hydrate('sA')) as { data: Record<string, unknown> };
    await sessions.persist(
      'sA',
      toEnvelope({
        ...(stored.data as never),
        identity: { tenant: 'acme', conversationId: 'c-other', principal: 'alice' },
      }),
    );
    await host.deliver({ sessionId: 'sA', input: 'again', headers: ALICE });
    const ref = recordings()[1]?.ref as string;
    expect((await redeem(host, 'sA', ref, ALICE)).error).toBeUndefined();
    const seam = await handle.artifactsForRequest({ sessionId: 'sA', headers: ALICE });
    if (!seam.bound) throw new Error(seam.reason);
    expect(await seam.artifacts.head(ref)).not.toBeNull();
  });
});

async function pooledShared(agent: Agent) {
  const sessions: SessionLifecycle = memorySessions();
  const host = filingHost();
  const handle = (await standingAgent({
    agent,
    sessions,
    host,
    identity: { verify: verifier().verify },
  } as unknown as StandingAgentOptions<HostHandle>)) as HostHandle & StandingAgentHandle;
  closers.push(() => handle.close());
  return { host, handle, sessions };
}
