/**
 * ROUND 4 — the recheck of 114d69f6 + 1435ae7f (idfix-RECHECK.md), identity
 * half. Each reviewer attack ported with its assertion INVERTED (it asserted
 * the finding; this asserts the fix), plus the cases the ruling asked to pin.
 *
 * The laws being pinned:
 *   • RB1 — a key the library mints never shares the client's key space: a
 *     session id spelled `#anonymous-1`, `hosted:1`, `anonymous`… reads nothing
 *     of a sessionless request, and gets its own pooled lane (N9).
 *   • RS1 + RS2 — one identity per run, fail closed: a resume that names an
 *     identity must name exactly the one the run is restored with; an ownerless
 *     pause resumed by a named person is refused; a checkpoint whose own fields
 *     disagree is refused.
 *   • RS3 — the paused run's session rides its checkpoint (`runSessionId`), so
 *     there is no key to collide and no bound to fall off.
 *   • RS4 — a run that PAUSED or FAILED owns the records its tools filed.
 *   • RS5 — a seam call that loses the race to close() binds nothing and
 *     builds nothing.
 *
 * The shared fixtures are the reviewer's, unchanged.
 *
 * Test types (Convention 3): security · regression · integration · boundary.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
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

// ─── RB1 (I1): host-minted evidence keys never share the client's key space ──

describe('RB1 — a session id spelled like a host key reads nothing of a sessionless request', () => {
  it('VERIFYING door, shared agent: bob’s session "#anonymous-1" does not read signed-in alice’s sessionless turn', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const { host } = await served(agent, { verify: true });
    const a = await host.deliver({ input: 'STASH SECRET-alice c-alice', headers: ALICE });
    expect(a.code).toBeUndefined();
    since();
    for (const spelled of ['#anonymous-1', 'hosted:1', 'anonymous', 'anonymous:1']) {
      const b = await host.deliver({ sessionId: spelled, input: 'WHY c-alice', headers: BOB });
      expect(b.code).toBeUndefined();
      const bobSaw = since();
      expect(bobSaw, spelled).not.toContain('SECRET-alice');
      expect(bobSaw, spelled).not.toContain('INSIDE TOOL CALL c-alice');
    }
  });

  it('OPEN door: the same, with no credentials at all', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const { host } = await served(agent);
    await host.deliver({ input: 'STASH SECRET-x c-x', userId: 'alice' } as never);
    since();
    await host.deliver({ sessionId: '#anonymous-1', input: 'WHY c-x' });
    expect(since()).not.toContain('SECRET-x');
  });

  it('N9: a session id spelled like the anonymous lane gets its OWN pooled lane', async () => {
    const built: Agent[] = [];
    const { host } = await served({
      agentFactory: () => {
        const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build();
        built.push(agent);
        return agent;
      },
      maxActiveSessions: 4,
    });
    await host.deliver({ input: 'hi' }); // the anonymous lane
    await host.deliver({ sessionId: 'anonymous', input: 'hi' });
    await host.deliver({ sessionId: '#anonymous', input: 'hi' });
    expect(built).toHaveLength(3);
  });
});

// ─── RS1 + RS2: one identity per run, fail closed ─────────────────────

describe('RS1 — the session marker on an edited checkpoint does not bypass the refusal', () => {
  it('bob’s checkpoint edited to alice’s tuple + runIdentitySource "session", resumed as bob → refused; nothing ran', async () => {
    const { agent, seen } = spyAgent([ASK, WHO, { content: 'done' }]);
    const bob: MemoryIdentity = { principal: 'bob', conversationId: 'cb' };
    const paused = (await agent.run({ message: 'refund me', identity: bob })) as {
      checkpoint: FlowchartCheckpoint;
    };
    agent.abandonPause();
    const tampered = structuredClone(paused.checkpoint) as FlowchartCheckpoint & {
      sharedState: Record<string, unknown>;
    };
    tampered.sharedState.runIdentity = { tenant: 'acme', principal: 'alice', conversationId: 'ca' };
    tampered.sharedState.runIdentitySource = 'session';
    seen.length = 0;
    await expect(agent.resume(tampered, 'yes', { identity: bob })).rejects.toBeInstanceOf(
      ResumeIdentityConflictError,
    );
    // …and resumed bare, the self-contradicting checkpoint is refused too.
    await expect(agent.resume(tampered, 'yes')).rejects.toBeInstanceOf(ResumeIdentityConflictError);
    expect(seen).toEqual([]);
  });
});

describe('RS2 — an ownerless pause resumed by a named person is refused', () => {
  it('per-run default checkpoint resumed with {identity: bob} → ResumeIdentityConflictError, nothing ran', async () => {
    const { agent, seen } = spyAgent([ASK, WHO, { content: 'done' }]);
    const paused = (await agent.run({ message: 'refund me' })) as {
      checkpoint: FlowchartCheckpoint;
    };
    agent.abandonPause();
    seen.length = 0;
    const bob: MemoryIdentity = { principal: 'bob', conversationId: 'cb' };
    await expect(agent.resume(paused.checkpoint, 'yes', { identity: bob })).rejects.toBeInstanceOf(
      ResumeIdentityConflictError,
    );
    expect(seen).toEqual([]);
    // Bare, it resumes as the nobody it was.
    await agent.resume(paused.checkpoint, 'yes');
    expect(agent.checkpoint()?.identity).toBeUndefined();
  });

  it('the session rung resumed with a named person is refused too', async () => {
    const { agent } = spyAgent([ASK, { content: 'done' }]);
    const paused = (await agent.run({ message: 'refund me' }, { sessionId: 's' })) as {
      checkpoint: FlowchartCheckpoint;
    };
    agent.abandonPause();
    await expect(
      agent.resume(paused.checkpoint, 'yes', {
        sessionId: 's',
        identity: { principal: 'bob', conversationId: 's' },
      }),
    ).rejects.toBeInstanceOf(ResumeIdentityConflictError);
  });
});

// ─── RS3: the session rides the checkpoint, not instance memory ───────

describe('RS3 — two sessions pausing in the same millisecond do not collide', () => {
  it('alice’s bare resume is filed under HER session; bob’s WHY reads nothing of hers', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    let pa: { checkpoint: FlowchartCheckpoint };
    try {
      pa = (await agent.run(
        {
          message: 'ASKSTASH SECRET-alice c-alice',
          identity: { principal: 'alice', conversationId: 'sA' },
        },
        { sessionId: 'sA' },
      )) as never;
      agent.abandonPause();
      await agent.run(
        {
          message: 'ASKSTASH SECRET-bob c-bob',
          identity: { principal: 'bob', conversationId: 'sB' },
        },
        { sessionId: 'sB' },
      );
      agent.abandonPause();
    } finally {
      now.mockRestore();
    }
    await agent.resume(pa!.checkpoint, 'yes', {
      identity: { principal: 'alice', conversationId: 'sA' },
    });
    since();
    await agent.run(
      { message: 'WHY c-alice', identity: { principal: 'bob', conversationId: 'sB' } },
      { sessionId: 'sB' },
    );
    expect(since()).not.toContain('SECRET-alice');
  });
});

describe('RS3 — no bound to fall off: 256 later pauses change nothing', () => {
  it('alice’s bare resume after 256 other pauses is still filed under her session', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const alice: MemoryIdentity = { principal: 'alice', conversationId: 'sA' };
    const pa = (await agent.run(
      { message: 'ASKSTASH SECRET-alice c-alice', identity: alice },
      { sessionId: 'sA' },
    )) as { checkpoint: FlowchartCheckpoint };
    agent.abandonPause();
    for (let i = 0; i < 256; i++) {
      await agent.run({ message: `ASKSTASH s${i} c${i}` }, { sessionId: `other-${i}` });
      agent.abandonPause();
    }
    await agent.resume(pa.checkpoint, 'yes', { identity: alice });
    since();
    await agent.run({ message: 'WHY c-alice' }); // a direct sessionless caller
    expect(since()).not.toContain('SECRET-alice');
  }, 120_000);
});

// ─── RS5: racing close() ──────────────────────────────────────────────

describe('RS5 — artifactsForRequest racing close() binds nothing and builds no reader', () => {
  it('a lane-less stored session, hydrate held across close → not-found, no reader built', async () => {
    const store = inMemoryArtifacts();
    const built: Agent[] = [];
    const shut: number[] = [];
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
    const handle = (await standingAgent({
      agentFactory: () => {
        const agent = Agent.create({
          provider: mock({ reply: 'ok' }),
          model: 'm',
          artifacts: { store, recordings: true },
        }).build();
        const index = built.length;
        built.push(agent);
        const shutdown = agent.shutdown.bind(agent);
        agent.shutdown = ((o: never) => {
          shut.push(index);
          return shutdown(o);
        }) as never;
        return agent;
      },
      maxActiveSessions: 1,
      sessions,
      host,
    } as unknown as StandingAgentOptions<HostHandle>)) as HostHandle & StandingAgentHandle;
    await host.deliver({ sessionId: 'sA', input: 'hi' });
    await host.deliver({ sessionId: 'sB', input: 'hi' });
    await tick();
    expect(built).toHaveLength(2);
    armed = true;
    const pending = handle.artifactsForRequest({ sessionId: 'sA' });
    await tick();
    await handle.close();
    open();
    const result = await pending;
    await tick();
    expect(result).toEqual({ bound: false, reason: 'not-found' });
    expect(built).toHaveLength(2);
    expect(shut.sort()).toEqual([0, 1]);
  });
});

// ─── RS4: a paused or failed run owns its tools' records ─────────────

describe('RS4 — the owner descends into a call made by a run that PAUSED', () => {
  it('no session: stash, pause, resume, WHY → her own record opens', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const paused = (await agent.run({ message: 'STASHASK SECRET-me c-me' })) as {
      checkpoint: FlowchartCheckpoint;
    };
    expect((paused as { checkpoint?: unknown }).checkpoint).toBeDefined();
    await agent.resume(paused.checkpoint, 'yes');
    since();
    await agent.run({ message: 'WHY c-none c-me' });
    const saw = since();
    expect(saw).toContain('INSIDE TOOL CALL c-me');
    expect(saw).toContain('SECRET-me');
  });

  it('the same, WITH a session', async () => {
    const agent = explainingAgent();
    const since = toolEndTexts(agent);
    const paused = (await agent.run(
      { message: 'STASHASK SECRET-me c-me' },
      { sessionId: 's' },
    )) as {
      checkpoint: FlowchartCheckpoint;
    };
    await agent.resume(paused.checkpoint, 'yes', { sessionId: 's' });
    since();
    await agent.run({ message: 'WHY c-none c-me' }, { sessionId: 's' });
    const saw = since();
    expect(saw).toContain('INSIDE TOOL CALL c-me');
    expect(saw).toContain('SECRET-me');
  });
});

describe('RS4 — the owner descends into a call made by a run that FAILED', () => {
  it('stash, then the model fails the run; the next WHY in the session opens the record', async () => {
    let failNext = false;
    const base = scriptedModel();
    const failing = new Proxy(base, {
      get: (t, p) =>
        p === 'complete'
          ? async (request: LLMRequest) => {
              if (failNext) {
                failNext = false;
                throw new Error('model down');
              }
              const reply = await (t as { complete: (r: LLMRequest) => Promise<unknown> }).complete(
                request,
              );
              if (JSON.stringify(reply).includes('"name":"stash"')) failNext = true;
              return reply;
            }
          : Reflect.get(t, p, t),
    });
    const agent = Agent.create({ provider: failing as never, model: 'm', maxIterations: 8 })
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
      .selfExplain({})
      .build();
    const since = toolEndTexts(agent);
    await expect(
      agent.run({ message: 'STASH SECRET-me c-me' }, { sessionId: 's' }),
    ).rejects.toThrow();
    since();
    await agent.run({ message: 'WHY c-none c-me' }, { sessionId: 's' });
    const saw = since();
    expect(saw).toContain('INSIDE TOOL CALL c-me');
  });
});

// ─── NIT 3 — the stated edge, pinned as documented ────────────────────

describe('NIT 3 (documented edge) — a run-shaped NAMED identity, a bare resume after someone else ran', () => {
  it('{conversationId:"run-1-1"} is read as the per-run default — pass identity on resume to keep it', async () => {
    const { agent } = spyAgent([
      ASK,
      { content: 'hi' },
      { content: 'done' },
      ASK,
      { content: 'hi' },
      { content: 'done' },
    ]);
    const named: MemoryIdentity = { conversationId: 'run-1-1' };
    const paused = (await agent.run({ message: 'refund me', identity: named })) as {
      checkpoint: FlowchartCheckpoint;
    };
    agent.abandonPause();
    await agent.run({ message: 'hi', identity: { principal: 'yara', conversationId: 'y' } });
    await agent.resume(structuredClone(paused.checkpoint), 'yes');
    expect(agent.checkpoint()?.identity).toBeUndefined(); // the documented edge
    await agent.resume(paused.checkpoint, 'yes', { identity: named });
    expect(agent.checkpoint()?.identity).toEqual(named); // the documented remedy
  });
});

// ─── NIT 8 — a repeated authorization header is refused, not read as none ──

describe('NIT 8 — two credentials are ambiguous', () => {
  it('at an allowAnonymous verifying door, a repeated authorization is unverified, not anonymous', async () => {
    const host = filingHost();
    const handle = (await standingAgent({
      agent: Agent.create({
        provider: mock({ reply: 'ok' }),
        model: 'm',
        artifacts: { store: inMemoryArtifacts() },
      }).build(),
      sessions: memorySessions(),
      host,
      identity: { verify: verifier().verify, allowAnonymous: true },
    } as unknown as StandingAgentOptions<HostHandle>)) as HostHandle & StandingAgentHandle;
    closers.push(() => handle.close());
    expect(
      await handle.artifactsForRequest({
        sessionId: 's',
        headers: { authorization: [ALICE.authorization, BOB.authorization] },
      }),
    ).toMatchObject({ bound: false, reason: 'unverified' });
  });
});
