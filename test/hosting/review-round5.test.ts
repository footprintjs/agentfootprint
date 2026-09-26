/**
 * ROUND 5 — the second recheck (idfix-RECHECK2.md, of 84a2ec95), identity half.
 * The reviewer's round-4 attacks J2, J3, J5 and J7 ported with their assertion
 * INVERTED; J6 kept as a HOLD; plus the shared-shape close race the review
 * found unpinned. (J1 is pinned by the RULED test in turn-artifacts.test.ts;
 * J4 is the documented checkpoint-trust edge.)
 *
 * The laws being pinned:
 *   • NIT 2 — an identity that is not one is refused when the run BEGINS.
 *   • NIT 3 — a checkpoint written before `runSessionId` existed, carrying a
 *     named identity, is never filed as sessionless on a bare resume: the
 *     session is recovered from the identity's `conversationId`. A new named
 *     run with no session records `runSessionId: null` and stays sessionless.
 *   • NIT 4 — sessionless (one-shot) evidence has its own bound.
 *   • NIT 5 + 6 — a seam call that loses the race to close() throws
 *     HostClosedError in the pooled AND the shared shape.
 *
 * The shared fixtures are the reviewer's, unchanged.
 *
 * Test types (Convention 3): security · regression · boundary · integration.
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
  HostClosedError,
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
} from '../hosting/turnArtifactsHarness.js';

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
      if (verb === 'STASHASK') {
        if (toolsAfter === 0)
          return { toolCalls: [{ id: b as string, name: 'stash', args: { secret: a } }] };
        if (toolsAfter === 1)
          return { toolCalls: [{ id: `ask-${++seq}`, name: 'approve', args: {} }] };
        return { content: 'stashed' };
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

// ─── NIT 2 (J2): an identity that is not one is refused when the run BEGINS ──

describe('NIT 2 (J2) — a JavaScript caller’s malformed identity is refused at run(), not at the resume', () => {
  for (const identity of [{}, { conversationId: 7 }, { conversationId: 'c', tenant: null }]) {
    it(`run({ identity: ${JSON.stringify(
      identity,
    )} }) throws TypeError before anything runs`, async () => {
      const { agent, principals } = spyAgent([ASK, { content: 'done' }]);
      await expect(
        agent.run({ message: 'refund me', identity: identity as never }),
      ).rejects.toBeInstanceOf(TypeError);
      expect(principals).toEqual([]);
      // …and the instance is not left refusing: a good run goes through.
      await expect(
        agent.run({ message: 'refund me', identity: { conversationId: 'c' } }),
      ).resolves.toBeDefined();
    });
  }

  it('the same refusal on run(input, { identity }) and on resume(cp, x, { identity })', async () => {
    const { agent } = spyAgent([ASK, { content: 'done' }]);
    await expect(
      agent.run({ message: 'refund me' }, { identity: { conversationId: 7 } as never }),
    ).rejects.toBeInstanceOf(TypeError);
    const paused = (await agent.run({ message: 'refund me' })) as {
      checkpoint: FlowchartCheckpoint;
    };
    await expect(
      agent.resume(paused.checkpoint, 'yes', { identity: { principal: null } as never }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

// ─── NIT 3 (J3): an OLD checkpoint is never filed as sessionless ─────────────

describe('NIT 3 (J3) — an old checkpoint (no runSessionId) with a named identity + session, resumed bare', () => {
  it('recovers the session from the identity’s conversationId; the next sessionless caller reads nothing', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const alice: MemoryIdentity = { principal: 'alice', conversationId: 'sA' };
    const paused = (await agent.run(
      { message: 'ASKSTASH SECRET-alice c-alice', identity: alice },
      { sessionId: 'sA' },
    )) as { checkpoint: FlowchartCheckpoint & { sharedState: Record<string, unknown> } };
    const old = structuredClone(paused.checkpoint);
    expect(old.sharedState.runSessionId).toBe('sA');
    delete old.sharedState.runSessionId; // as written by 9.116.x
    agent.abandonPause();
    await agent.resume(old, 'yes');
    since();
    await agent.run({ message: 'WHY c-alice' });
    expect(since()).not.toContain('SECRET-alice');
    // …and alice's own session explains it.
    await agent.run({ message: 'WHY c-none c-alice', identity: alice }, { sessionId: 'sA' });
    expect(since()).toContain('SECRET-alice');
  });

  it('a NEW checkpoint of a named run with no session records that (null) and stays sessionless', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const me: MemoryIdentity = { principal: 'me', conversationId: 'c-me' };
    const paused = (await agent.run({ message: 'ASKSTASH SECRET-me c-me', identity: me })) as {
      checkpoint: FlowchartCheckpoint & { sharedState: Record<string, unknown> };
    };
    expect(paused.checkpoint.sharedState.runSessionId).toBeNull();
    await agent.resume(paused.checkpoint, 'yes');
    since();
    await agent.run({ message: 'WHY c-none c-me', identity: me });
    expect(since()).toContain('SECRET-me');
  });
});

// ─── NIT 4 (J5): sessionless evidence has its own shelf ─────────────────────

describe('NIT 4 (J5) — a flood of sessionless requests does not evict a session’s evidence', () => {
  it('allowAnonymous door: s0’s WHY after 64 anonymous sessionless turns still finds its own run', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const { host } = await served(agent, { verify: true, allowAnonymous: true });
    await host.deliver({ sessionId: 's0', input: 'STASH SECRET-0 c-0' });
    for (let i = 0; i < 64; i++) await host.deliver({ input: `hi ${i}` });
    since();
    await host.deliver({ sessionId: 's0', input: 'WHY c-none c-0' });
    const saw = since();
    expect(saw).toContain('SECRET-0');
    expect(saw).toContain('INSIDE TOOL CALL c-0');
  }, 60_000);
});

// ─── J6 (HOLD): key spaces ──────────────────────────────────────────────────

describe('HOLD J6 — session ids spelled like the composer’s own keys are just sessions', () => {
  it('pooled: "anonymous", "session:x", "anonymous:1", "hosted:abc", "#anonymous" each get a lane; sessionless its own', async () => {
    const { host, built } = await pooled({ max: 8 });
    await host.deliver({ input: 'hi' });
    for (const s of ['anonymous', 'session:x', 'anonymous:1', 'hosted:abc', '#anonymous'])
      await host.deliver({ sessionId: s, input: 'hi' });
    expect(built).toHaveLength(6);
  });
});

// ─── NIT 5 + NIT 6 (J7): the close race, pooled AND shared ──────────────────

describe('NIT 6 (J7) — a seam call that loses the race to close() throws HostClosedError, like the wire', () => {
  it('pooled: hydrate held across close → HostClosedError', async () => {
    const base = memorySessions();
    let armed = false;
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const sessions = new Proxy(base, {
      get: (t, p) =>
        p === 'hydrate'
          ? async (id: string) => {
              if (armed) await gate;
              return (t as { hydrate: (id: string) => Promise<unknown> }).hydrate(id);
            }
          : Reflect.get(t, p, t),
    });
    const host = filingHost();
    const store = inMemoryArtifacts();
    const handle = (await standingAgent({
      agentFactory: () =>
        Agent.create({
          provider: mock({ reply: 'ok' }),
          model: 'm',
          artifacts: { store, recordings: true },
        }).build(),
      maxActiveSessions: 1,
      sessions,
      host,
    } as unknown as StandingAgentOptions<HostHandle>)) as HostHandle & StandingAgentHandle;
    await host.deliver({ sessionId: 'sA', input: 'hi' });
    await host.deliver({ sessionId: 'sB', input: 'hi' });
    await tick();
    armed = true;
    const pending = handle.artifactsForRequest({ sessionId: 'sA' });
    await tick();
    await handle.close();
    open();
    await expect(pending).rejects.toBeInstanceOf(HostClosedError);
  });

  it('SHARED shape: the verifier held across close → HostClosedError, never bound:true (NIT 5)', async () => {
    let armed = false;
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const verify = async (token: string) => {
      if (armed) await gate;
      return verifier().verify(token);
    };
    const host = filingHost();
    const handle = (await standingAgent({
      agent: Agent.create({
        provider: mock({ reply: 'ok' }),
        model: 'm',
        artifacts: { store: inMemoryArtifacts(), recordings: true },
      }).build(),
      sessions: memorySessions(),
      host,
      identity: { verify },
    } as unknown as StandingAgentOptions<HostHandle>)) as HostHandle & StandingAgentHandle;
    await host.deliver({ sessionId: 'sA', input: 'hi', headers: ALICE });
    armed = true;
    const pending = handle.artifactsForRequest({ sessionId: 'sA', headers: ALICE });
    await tick();
    await handle.close();
    open();
    await expect(pending).rejects.toBeInstanceOf(HostClosedError);
  });
});
