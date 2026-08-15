/**
 * Ref ARGUMENTS at dispatch (9.22.0, Leg 1): a tool declares
 * `wants: { dataset: 'dataset/rows' }`, the model speaks the ref, and the
 * framework resolves it BEFORE execute — the handler reads the DATA (and the
 * meta on `ctx.wanted`); a stale/unknown/wrong-kind ref never reaches the
 * tool, and the model reads a teaching refusal listing the live refs of the
 * wanted kind (the innerRunRecords law).
 *
 * Sections: Functional (the two-tool data flow; events) · Refusals
 * (stale / kind-mismatch / non-string, each teaching) · Integration (scope
 * isolation at dispatch; build-time no-store refusal; defineTool-time
 * declaration refusals) · Regression (zero-delta: a tool without `wants` is
 * byte-identical).
 */

import { describe, it, expect } from 'vitest';
import {
  Agent,
  checkInApproved,
  defineTool,
  inMemoryArtifacts,
  isPaused,
  type ArtifactMeta,
  type AgentfootprintEvent,
  type RunnerPauseOutcome,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

type Caught = { name: string; payload: Record<string, unknown> };
const artifactCapture = (agent: Agent) => {
  const events: Caught[] = [];
  agent.on('agentfootprint.artifacts.*', (e: AgentfootprintEvent) => {
    events.push({ name: e.type, payload: e.payload as Record<string, unknown> });
  });
  return events;
};
const toolEndCapture = (agent: Agent) => {
  const ends: Record<string, unknown>[] = [];
  agent.on('agentfootprint.stream.tool_end', (e) =>
    ends.push(e.payload as Record<string, unknown>),
  );
  return ends;
};

/** 48k-row-shaped dataset, small enough for a test. */
const rows = Array.from({ length: 50 }, (_, i) => ({ order: i, amount: (i % 7) + 1 }));

const getData = defineTool({
  name: 'get_data',
  description: 'fetch rows and check them in',
  execute: async (_args, ctx) => {
    const meta = await ctx.artifacts.put({
      kind: 'dataset/rows',
      mediaType: 'application/json',
      data: rows,
      label: 'Q3 rows',
    });
    return `stored ${meta.ref} [${meta.kind} · ${meta.bytes} bytes]`;
  },
});

/** The consumer: declares the ref-arg; the handler reads the DATA. */
const buildTransform = (seen: {
  args?: unknown;
  wanted?: Readonly<Record<string, ArtifactMeta>>;
}) =>
  defineTool<{ dataset: string }, string>({
    name: 'transform_report',
    description: 'total a stored dataset (pass the art_… ref)',
    inputSchema: {
      type: 'object',
      properties: { dataset: { type: 'string', description: 'art_… ref of dataset/rows' } },
      required: ['dataset'],
    },
    wants: { dataset: 'dataset/rows' },
    execute: async (args, ctx) => {
      seen.args = args;
      seen.wanted = ctx.wanted;
      // `args.dataset` IS the rows — the framework already redeemed the ref.
      const data = args.dataset as unknown as ReadonlyArray<{ amount: number }>;
      return `total: ${data.reduce((sum, row) => sum + row.amount, 0)}`;
    },
  });

const buildAgent = (
  replies: unknown[],
  store = inMemoryArtifacts(),
  seen: { args?: unknown; wanted?: Readonly<Record<string, ArtifactMeta>> } = {},
) => {
  const agent = Agent.create({
    provider: mock({ replies: replies as never }),
    model: 'mock',
    maxIterations: 6,
    artifacts: store,
  })
    .system('s')
    .tool(getData)
    .tool(buildTransform(seen))
    .build();
  return { agent, seen };
};

describe('functional — the two-tool data flow, refs routed, data delivered', () => {
  it('resolves the declared arg to the DATA, hands the meta on ctx.wanted, and rides artifacts.resolved', async () => {
    const store = inMemoryArtifacts();
    let mintedRef = '';
    const probe = { args: undefined as unknown, wanted: undefined as unknown };
    // The mock cannot read the first result to learn the ref, so the flow
    // runs as two SESSION-bound runs of one conversation: mint, then consume
    // with the ref the record reported — exactly how a real model would
    // read it off the get_data result.
    const agent = Agent.create({
      provider: mock({ replies: [call('get_data', 't1'), final('minted')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
    })
      .system('s')
      .tool(getData)
      .build();
    agent.on('agentfootprint.artifacts.minted', (e) => {
      mintedRef = (e.payload as { ref: string }).ref;
    });
    await agent.run({ message: 'mint' }, { sessionId: 'flow' });
    expect(mintedRef).toMatch(/^art_/);

    const consumer = buildAgent(
      [call('transform_report', 't2', { dataset: mintedRef }), final('done')],
      store,
      probe as never,
    );
    const events = artifactCapture(consumer.agent);
    const result = await consumer.agent.run({ message: 'consume' }, { sessionId: 'flow' });
    expect(result).toBe('done');

    // The handler read the DATA, not the ref…
    expect(Array.isArray((probe.args as { dataset: unknown }).dataset)).toBe(true);
    expect((probe.args as { dataset: unknown[] }).dataset).toHaveLength(50);
    // …and the claim ticket rode ctx.wanted.
    const wanted = probe.wanted as Readonly<Record<string, ArtifactMeta>>;
    expect(wanted.dataset.ref).toBe(mintedRef);
    expect(wanted.dataset.kind).toBe('dataset/rows');

    // Resolution rides the EXISTING artifacts.resolved, via 'get'.
    const resolved = events.filter((e) => e.name === 'agentfootprint.artifacts.resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].payload).toMatchObject({
      ref: mintedRef,
      via: 'get',
      kind: 'dataset/rows',
      tool: 'transform_report',
    });
  });
});

describe('refusals — a bad ref never reaches the tool, and the lesson lists what CAN resolve', () => {
  it('stale/unknown ref: tool NOT executed, artifacts.refused op dispatch, live refs listed', async () => {
    const store = inMemoryArtifacts();
    let liveRef = '';
    const probe = { args: undefined as unknown, wanted: undefined as unknown };
    // Seed one LIVE artifact in the same session scope, so the refusal has
    // something to name.
    const seeder = Agent.create({
      provider: mock({ replies: [call('get_data', 's1'), final('ok')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
    })
      .system('s')
      .tool(getData)
      .build();
    seeder.on('agentfootprint.artifacts.minted', (e) => {
      liveRef = (e.payload as { ref: string }).ref;
    });
    await seeder.run({ message: 'seed' }, { sessionId: 'teach' });

    const { agent } = buildAgent(
      [call('transform_report', 't1', { dataset: 'art_DoesNotExist000000000' }), final('done')],
      store,
      probe as never,
    );
    const events = artifactCapture(agent);
    const ends = toolEndCapture(agent);
    await agent.run({ message: 'go' }, { sessionId: 'teach' });

    // The tool never ran.
    expect(probe.args).toBeUndefined();
    // The model read a teaching refusal naming the live ref.
    const refusalText = String(ends[0].result);
    expect(refusalText).toContain('was not executed');
    expect(refusalText).toContain('art_DoesNotExist000000000');
    expect(refusalText).toContain(liveRef);
    expect(refusalText).toContain("'dataset/rows'");
    expect(ends[0].error).toBe(true);
    // The record: refused with op 'dispatch'.
    const refused = events.filter((e) => e.name === 'agentfootprint.artifacts.refused');
    expect(refused).toHaveLength(1);
    expect(refused[0].payload).toMatchObject({
      op: 'dispatch',
      reason: 'missing-or-expired',
      ref: 'art_DoesNotExist000000000',
      tool: 'transform_report',
    });
  });

  it('wrong-kind ref: kind-mismatch names both kinds and the fitting refs', async () => {
    const store = inMemoryArtifacts();
    const probe = { args: undefined as unknown };
    const mintOther = defineTool({
      name: 'mint_report',
      description: 'mints a report/csv',
      execute: async (_args, ctx) => {
        const meta = await ctx.artifacts.put({
          kind: 'report/csv',
          mediaType: 'text/csv',
          data: 'a,b\n1,2',
        });
        return meta.ref;
      },
    });
    let csvRef = '';
    const seeder = Agent.create({
      provider: mock({ replies: [call('mint_report', 's1'), final('ok')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
    })
      .system('s')
      .tool(mintOther)
      .build();
    seeder.on('agentfootprint.artifacts.minted', (e) => {
      csvRef = (e.payload as { ref: string }).ref;
    });
    await seeder.run({ message: 'seed' }, { sessionId: 'kinds' });

    const { agent } = buildAgent(
      [call('transform_report', 't1', { dataset: csvRef }), final('done')],
      store,
      probe as never,
    );
    const events = artifactCapture(agent);
    const ends = toolEndCapture(agent);
    await agent.run({ message: 'go' }, { sessionId: 'kinds' });

    expect(probe.args).toBeUndefined();
    const text = String(ends[0].result);
    expect(text).toContain("'report/csv'");
    expect(text).toContain("wants 'dataset/rows'");
    const refused = events.filter((e) => e.name === 'agentfootprint.artifacts.refused');
    expect(refused[0].payload).toMatchObject({
      op: 'dispatch',
      reason: 'kind-mismatch',
      ref: csvRef,
      tool: 'transform_report',
    });
  });

  it('non-string arg with schema validation ON: the args gate refuses first (it judges the ref STRING the model owed)', async () => {
    const probe = { args: undefined as unknown };
    const { agent } = buildAgent(
      [call('transform_report', 't1', { dataset: [1, 2, 3] }), final('done')],
      inMemoryArtifacts(),
      probe as never,
    );
    const ends = toolEndCapture(agent);
    await agent.run({ message: 'go' });
    expect(probe.args).toBeUndefined();
    expect(String(ends[0].result)).toContain('expected string, got array');
  });

  it('non-string arg behind validation OFF: the wants belt still refuses, teaching "ref STRING"', async () => {
    const probe = { args: undefined as unknown };
    const seen = probe as { args?: unknown; wanted?: never };
    const agent = Agent.create({
      provider: mock({
        replies: [call('transform_report', 't1', { dataset: [1, 2, 3] }), final('done')] as never,
      }),
      model: 'mock',
      maxIterations: 3,
      artifacts: inMemoryArtifacts(),
      toolArgValidation: 'off',
    })
      .system('s')
      .tool(buildTransform(seen as never))
      .build();
    const events = artifactCapture(agent);
    const ends = toolEndCapture(agent);
    await agent.run({ message: 'go' });
    expect(probe.args).toBeUndefined();
    expect(String(ends[0].result)).toContain('ref STRING');
    const refused = events.filter((e) => e.name === 'agentfootprint.artifacts.refused');
    expect(refused[0].payload).toMatchObject({ op: 'dispatch', reason: 'invalid-input' });
  });

  it('a REQUIRED wants-arg the model OMITTED is refused by name behind validation OFF — the belt does not depend on the args gate', async () => {
    // The hole this pins: `toolArgValidation` is an agent-wide dial, and with
    // it off (or 'warn') an omitted ref used to reach `execute` — the handler
    // running with `args.dataset` undefined, believing the framework had
    // resolved it. The wants belt already covered a non-string ref behind the
    // same disabled gate; omission is the same class of hole.
    const store = inMemoryArtifacts();
    let liveRef = '';
    const seeder = Agent.create({
      provider: mock({ replies: [call('get_data', 's1'), final('ok')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
    })
      .system('s')
      .tool(getData)
      .build();
    seeder.on('agentfootprint.artifacts.minted', (e) => {
      liveRef = (e.payload as { ref: string }).ref;
    });
    await seeder.run({ message: 'seed' }, { sessionId: 'omitted' });

    const probe = { args: undefined as unknown };
    const agent = Agent.create({
      provider: mock({ replies: [call('transform_report', 't1', {}), final('done')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
      toolArgValidation: 'off',
    })
      .system('s')
      .tool(buildTransform(probe as never))
      .build();
    const events = artifactCapture(agent);
    const ends = toolEndCapture(agent);
    await agent.run({ message: 'go' }, { sessionId: 'omitted' });

    // The tool never ran…
    expect(probe.args).toBeUndefined();
    // …and the model read a refusal naming the argument, the kind, and what
    // CAN resolve (the same teaching shape every other wants refusal has).
    const text = String(ends[0].result);
    expect(text).toContain("'dataset' is required");
    expect(text).toContain("'dataset/rows'");
    expect(text).toContain(liveRef);
    expect(ends[0].error).toBe(true);
    const refused = events.filter((e) => e.name === 'agentfootprint.artifacts.refused');
    expect(refused[0].payload).toMatchObject({
      op: 'dispatch',
      reason: 'invalid-input',
      tool: 'transform_report',
    });
  });

  it('a null value is named as null, never "a object" — the refusal teaches the right correction', async () => {
    const probe = { args: undefined as unknown };
    const agent = Agent.create({
      provider: mock({
        replies: [call('transform_report', 't1', { dataset: null }), final('done')] as never,
      }),
      model: 'mock',
      maxIterations: 3,
      artifacts: inMemoryArtifacts(),
      toolArgValidation: 'off',
    })
      .system('s')
      .tool(buildTransform(probe as never))
      .build();
    const ends = toolEndCapture(agent);
    await agent.run({ message: 'go' });
    expect(probe.args).toBeUndefined();
    expect(String(ends[0].result)).toContain('not null');
  });
});

describe('integration — every dispatch door judges the declaration the same way', () => {
  it('the RESUME door refuses a required-but-omitted ref too — an approved call is not a waived one', async () => {
    // `resolveCredentialAndExecute` is the second dispatch door (check-in
    // approval, credential-consent resume, ask-resume). A human approving a
    // call approves the CALL, not the absence of the data it declared, so the
    // same belt runs there — with the tool's own schema, which is what makes
    // the refusal possible.
    const probe = { args: undefined as unknown };
    const gated = defineTool<{ dataset: string }, string>({
      name: 'gated_transform',
      description: 'total a stored dataset (pass the art_… ref)',
      inputSchema: {
        type: 'object',
        properties: { dataset: { type: 'string' } },
        required: ['dataset'],
      },
      wants: { dataset: 'dataset/rows' },
      checkIn: 'always',
      execute: (args) => {
        probe.args = args;
        return 'ran';
      },
    });
    const build = (replies: readonly unknown[]) =>
      Agent.create({
        provider: mock({ replies: replies as never }),
        model: 'mock',
        maxIterations: 4,
        artifacts: inMemoryArtifacts(),
        toolArgValidation: 'off',
      })
        .system('s')
        .tool(gated)
        .build();

    const first = build([call('gated_transform', 't1', {}), final('done')]);
    const out = (await first.run({ message: 'go' })) as RunnerPauseOutcome;
    expect(isPaused(out)).toBe(true);

    const second = build([final('done')]);
    const ends = toolEndCapture(second);
    await second.resume(out.checkpoint, checkInApproved({ by: 'ops' }));
    expect(probe.args).toBeUndefined();
    expect(String(ends[0].result)).toContain("'dataset' is required");
    expect(ends[0].error).toBe(true);
  });
});

describe('integration — scope isolation and configuration refusals', () => {
  it('a ref minted in another SESSION never resolves at dispatch', async () => {
    const store = inMemoryArtifacts();
    let alphaRef = '';
    const seeder = Agent.create({
      provider: mock({ replies: [call('get_data', 's1'), final('ok')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: store,
    })
      .system('s')
      .tool(getData)
      .build();
    seeder.on('agentfootprint.artifacts.minted', (e) => {
      alphaRef = (e.payload as { ref: string }).ref;
    });
    await seeder.run({ message: 'seed' }, { sessionId: 'session-alpha' });

    const probe = { args: undefined as unknown };
    const { agent } = buildAgent(
      [call('transform_report', 't1', { dataset: alphaRef }), final('done')],
      store,
      probe as never,
    );
    const events = artifactCapture(agent);
    await agent.run({ message: 'go' }, { sessionId: 'session-beta' });
    expect(probe.args).toBeUndefined();
    const refused = events.filter((e) => e.name === 'agentfootprint.artifacts.refused');
    expect(refused[0].payload).toMatchObject({
      op: 'dispatch',
      reason: 'missing-or-expired',
      ref: alphaRef,
    });
  });

  it('a statically registered wants-tool with NO store is refused at BUILD, naming the tool', () => {
    expect(() =>
      Agent.create({
        provider: mock({ replies: [final('x')] as never }),
        model: 'mock',
      })
        .system('s')
        .tool(buildTransform({}))
        .build(),
    ).toThrowError(/transform_report.*wants.*dataset\/rows.*artifacts/s);
  });

  it('defineTool refuses a wants-arg the schema never offers, and one typed non-string', () => {
    expect(() =>
      defineTool({
        name: 'bad_wants',
        description: 'd',
        inputSchema: { type: 'object', properties: {} },
        wants: { dataset: 'dataset/rows' },
        execute: () => 'x',
      }),
    ).toThrowError(/no 'dataset'/);
    expect(() =>
      defineTool({
        name: 'bad_type',
        description: 'd',
        inputSchema: { type: 'object', properties: { dataset: { type: 'object' } } },
        wants: { dataset: 'dataset/rows' },
        execute: () => 'x',
      }),
    ).toThrowError(/type 'object'.*type: 'string'/s);
    expect(() =>
      defineTool({
        name: 'empty_wants',
        description: 'd',
        wants: {},
        execute: () => 'x',
      }),
    ).toThrowError(/wants: \{\}/);
  });
});

describe('regression — an OPTIONAL declared argument is still the model’s choice', () => {
  it('omitted where the schema does not require it: the tool RUNS, args carry no key, ctx.wanted stays absent', async () => {
    const probe = { args: undefined as unknown, wanted: 'unset' as unknown, ran: false };
    const optional = defineTool<{ dataset?: string }, string>({
      name: 'optional_report',
      description: 'works with or without a stored dataset',
      // No `required` — declaring the argument does not make passing it
      // mandatory, and the framework must not invent a rule the tool did not.
      inputSchema: { type: 'object', properties: { dataset: { type: 'string' } } },
      wants: { dataset: 'dataset/rows' },
      execute: (args, ctx) => {
        probe.ran = true;
        probe.args = args;
        probe.wanted = ctx.wanted;
        return 'ok';
      },
    });
    const agent = Agent.create({
      provider: mock({ replies: [call('optional_report', 't1', {}), final('done')] as never }),
      model: 'mock',
      maxIterations: 3,
      artifacts: inMemoryArtifacts(),
    })
      .system('s')
      .tool(optional)
      .build();
    const events = artifactCapture(agent);
    await agent.run({ message: 'go' });
    expect(probe.ran).toBe(true);
    expect(probe.args).toEqual({});
    // Absent, not empty — "nothing resolved" and "an empty resolution" are
    // different facts, and only absence says the model chose not to pass one.
    expect(probe.wanted).toBeUndefined();
    expect(events).toHaveLength(0);
  });
});

describe('regression — zero-cost when undeclared', () => {
  it('a tool WITHOUT wants sees the exact args the model sent, ctx.wanted absent, no artifact events', async () => {
    const probe = { args: undefined as unknown, wanted: 'unset' as unknown };
    const plain = defineTool({
      name: 'plain',
      description: 'no declarations',
      inputSchema: { type: 'object', properties: { ref: { type: 'string' } } },
      execute: async (args, ctx) => {
        probe.args = args;
        probe.wanted = ctx.wanted;
        return 'ok';
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          call('plain', 't1', { ref: 'art_LooksLikeARef00000000' }),
          final('done'),
        ] as never,
      }),
      model: 'mock',
      maxIterations: 3,
      artifacts: inMemoryArtifacts(),
    })
      .system('s')
      .tool(plain)
      .build();
    const events = artifactCapture(agent);
    await agent.run({ message: 'go' });
    // The ref-shaped STRING arrives untouched — nothing resolved it.
    expect(probe.args).toEqual({ ref: 'art_LooksLikeARef00000000' });
    expect(probe.wanted).toBeUndefined();
    expect(events).toHaveLength(0);
  });
});
