/**
 * Recipes on the run manifest (9.48.0) — which composition produced the agent
 * that answered.
 *
 * `agentfootprint.agent.run_configured` already names the provider, the model
 * and the strategies in play; what it could not say was which declared SETUP
 * the agent came from. That was the gap recipes close, so the row is the point
 * of the feature and not decoration.
 *
 * Sections: Functional (the pure composer) · Integration (through a real run)
 * · Security & containment (names and versions only — the description does not
 * travel) · Edge (resolution with zero model calls) · Regression (an agent
 * with no recipes is unchanged: no new events, no manifest noise).
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool, type Tool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { defineAgentRecipe } from '../../src/doors/recipes.js';
import { buildRunManifest } from '../../src/core/agent/runManifest.js';
import type { AgentfootprintEventMap } from '../../src/events/registry.js';

type ManifestEvent = AgentfootprintEventMap['agentfootprint.agent.run_configured'];

const minimal = {
  agentId: 'agent',
  providerName: 'mock',
  model: 'm',
  hasRunConfig: false,
  hasSkillBrains: false,
  reactMode: 'dynamic' as const,
  memories: [],
};

/** Subscribe before the run — the manifest is dispatched as the run is wired. */
const watch = (agent: Agent) => {
  const manifests: ManifestEvent[] = [];
  agent.on('agentfootprint.agent.run_configured', (e) => manifests.push(e));
  return manifests;
};

const toolNamed = (name: string): Tool =>
  defineTool({
    name,
    description: `the ${name} tool`,
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async () => 'done',
  }) as unknown as Tool;

const registers = (id: string, version: string, name: string) =>
  defineAgentRecipe({
    id,
    version,
    configure: (agent) => {
      agent.tool(toolNamed(name));
    },
  });

// ─── 1. FUNCTIONAL — the pure composer ───────────────────────────────

describe('the composer', () => {
  it('carries the rows it is given, in order', () => {
    const m = buildRunManifest({
      ...minimal,
      recipes: [
        { id: 'support-desk', version: '1.2.0' },
        { id: 'house-policy', version: '2.0.0' },
      ],
    });
    expect(m.recipes).toEqual([
      { id: 'support-desk', version: '1.2.0' },
      { id: 'house-policy', version: '2.0.0' },
    ]);
  });

  it('omits the field when none was applied — never `[]`', () => {
    // Deliberately unlike `memories: []`. "No memory is mounted" is an arm a
    // study compares against; "no recipe" is the state of every agent written
    // before recipes existed, and an empty list on all of them would be new
    // bytes in every recording for a feature nobody used.
    expect(Object.keys(buildRunManifest(minimal))).not.toContain('recipes');
    expect(Object.keys(buildRunManifest({ ...minimal, recipes: [] }))).not.toContain('recipes');
    // …and the control that keeps `memories` from drifting into the same rule.
    expect(buildRunManifest(minimal).memories).toEqual([]);
  });

  it('keeps id and version as SEPARATE fields', () => {
    // Never `'support-desk@1.2.0'`: a composed key is one string that two
    // different pairs can produce the moment either half may contain the
    // separator — the collision class this repo has fixed seven times.
    const row = buildRunManifest({
      ...minimal,
      recipes: [{ id: 'support-desk', version: '1.2.0' }],
    }).recipes?.[0];
    expect(row).toEqual({ id: 'support-desk', version: '1.2.0' });
    expect(JSON.stringify(row)).not.toContain('@');
  });

  it('a row is a COPY — the composer never hands back what it was given', () => {
    const source = [{ id: 'support-desk', version: '1.2.0' }];
    const rows = buildRunManifest({ ...minimal, recipes: source }).recipes;
    expect(rows?.[0]).not.toBe(source[0]);
  });
});

// ─── 2. INTEGRATION — through a real run ─────────────────────────────

describe('through the Agent', () => {
  it('names every applied composition, in declaration order', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .recipe(registers('support-desk', '1.2.0', 'lookup_order'))
      .recipe(registers('crm-basics', '0.4.0', 'lookup_account'))
      .build();
    const manifests = watch(agent);

    await agent.run({ message: 'hi' });

    expect(manifests[0]?.payload.recipes).toEqual([
      { id: 'support-desk', version: '1.2.0' },
      { id: 'crm-basics', version: '0.4.0' },
    ]);
  });

  it('WORKED EXAMPLE — two arms named by the composition that produced them', async () => {
    const arms = new Map<string, string>(); // runId → arm label
    const answers = new Map<string, string>();

    for (const version of ['1.2.0', '1.3.0']) {
      const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
        .recipe(registers('support-desk', version, 'lookup_order'))
        .build();
      agent.on('agentfootprint.agent.run_configured', (e) => {
        const recipe = e.payload.recipes?.[0];
        arms.set(e.meta.runId, `${recipe?.id}@${recipe?.version}`);
      });
      agent.on('agentfootprint.agent.turn_end', (e) => answers.set(e.meta.runId, 'done'));
      await agent.run({ message: 'hi' });
    }

    // The join every experiment needed and had to keep by hand: two runs of
    // "the support agent" that differ ONLY in which version of the
    // composition built them are now two labelled arms.
    expect([...answers.keys()].map((runId) => arms.get(runId)).sort()).toEqual([
      'support-desk@1.2.0',
      'support-desk@1.3.0',
    ]);
  });

  it('is stamped on a SECOND run too — one manifest per runId', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .recipe(registers('support-desk', '1.2.0', 'lookup_order'))
      .build();
    const manifests = watch(agent);

    await agent.run({ message: 'one' });
    await agent.run({ message: 'two' });

    expect(manifests).toHaveLength(2);
    expect(manifests[1]?.payload.recipes).toEqual([{ id: 'support-desk', version: '1.2.0' }]);
  });

  it('a recipe whose application was REFUSED half-way gets no row', async () => {
    // The manifest may not assert something that did not happen. A recipe that
    // threw out of `configure` did not produce this agent — some of its calls
    // landed, and the throw is the record of that; a row claiming a completed
    // composition would be the manifest lying about its own subject.
    const builder = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).tool(
      toolNamed('search'),
    );
    expect(() => builder.recipe(registers('doomed', '1.0.0', 'search'))).toThrow();
    const agent = builder.build();
    const manifests = watch(agent);

    await agent.run({ message: 'hi' });

    expect(Object.keys(manifests[0]?.payload ?? {})).not.toContain('recipes');
  });

  it('a later `.recipe()` cannot retroactively edit an agent already built', async () => {
    const builder = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).recipe(
      registers('support-desk', '1.2.0', 'lookup_order'),
    );
    const first = builder.build();
    builder.recipe(registers('crm-basics', '0.4.0', 'lookup_account'));
    const manifests = watch(first);

    await first.run({ message: 'hi' });

    expect(manifests[0]?.payload.recipes).toEqual([{ id: 'support-desk', version: '1.2.0' }]);
  });
});

// ─── 3. SECURITY & CONTAINMENT — names and versions only ─────────────

describe('the manifest carries names and versions, and nothing else', () => {
  it('never carries the description, however much is written in it', async () => {
    const secret = 'postgres://admin:hunter2@db.internal:5432/prod';
    const chatty = defineAgentRecipe({
      id: 'support-desk',
      version: '1.2.0',
      description: `Talks to ${secret} and holds the key sk-live-51H8xQqAaBbCcDdEe.`,
      configure: (agent) => {
        agent.tool(toolNamed('lookup_order'));
      },
    });
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .recipe(chatty)
      .build();
    const manifests = watch(agent);

    await agent.run({ message: 'hi' });

    const serialized = JSON.stringify(manifests[0]?.payload);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('sk-live-');
    expect(manifests[0]?.payload.recipes).toEqual([{ id: 'support-desk', version: '1.2.0' }]);
  });

  it('never carries the `configure` function', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .recipe(registers('support-desk', '1.2.0', 'lookup_order'))
      .build();
    const manifests = watch(agent);

    await agent.run({ message: 'hi' });

    const row = manifests[0]?.payload.recipes?.[0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['id', 'version']);
    // A recording is JSON. A function would vanish silently there; the row is
    // built field by field so it cannot be in the object at all.
    expect(JSON.parse(JSON.stringify(manifests[0]?.payload)).recipes).toEqual([
      { id: 'support-desk', version: '1.2.0' },
    ]);
  });
});

// ─── 4. EDGE — resolution costs no model call ────────────────────────

describe('a recipe resolves against the mock provider with zero model calls', () => {
  it('applies, composes and refuses entirely at build time', () => {
    let calls = 0;
    const counting = mock({
      respond: () => {
        calls += 1;
        return 'ok';
      },
    });

    // Applying two recipes, registering a local tool, and taking a conflict
    // refusal — none of it consults the model.
    Agent.create({ provider: counting, model: 'm' })
      .recipe(registers('support-desk', '1.2.0', 'lookup_order'))
      .recipe(registers('crm-basics', '0.4.0', 'lookup_account'))
      .tool(toolNamed('escalate'))
      .build();
    expect(() =>
      Agent.create({ provider: counting, model: 'm' })
        .recipe(registers('support-desk', '1.2.0', 'search'))
        .recipe(registers('crm-basics', '0.4.0', 'search'))
        .build(),
    ).toThrow(/duplicate tool name 'search'/);

    expect(calls).toBe(0);
  });

  it('and the counter is real — one run is one call', async () => {
    // The control. Without it, a provider that was never wired would satisfy
    // the assertion above for the wrong reason.
    let calls = 0;
    const counting = mock({
      respond: () => {
        calls += 1;
        return 'ok';
      },
    });
    const agent = Agent.create({ provider: counting, model: 'm' })
      .recipe(registers('support-desk', '1.2.0', 'lookup_order'))
      .build();

    await agent.run({ message: 'hi' });

    expect(calls).toBe(1);
  });
});

// ─── 5. REGRESSION — zero recipes, zero delta ────────────────────────

describe('an agent built with no recipes is unchanged', () => {
  /** Build the same agent twice: once directly, once through a recipe that
   *  makes the identical calls. Everything except the manifest row must match. */
  const buildBoth = () => {
    const direct = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .system('You answer support questions.')
      .tool(toolNamed('lookup_order'))
      .build();
    const viaRecipe = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .recipe(
        defineAgentRecipe({
          id: 'support-desk',
          version: '1.2.0',
          configure: (agent) => {
            agent.system('You answer support questions.').tool(toolNamed('lookup_order'));
          },
        }),
      )
      .build();
    return { direct, viaRecipe };
  };

  it('emits no new events — a recipe adds a manifest ROW, not a channel', async () => {
    const { direct, viaRecipe } = buildBoth();
    const seen = { direct: [] as string[], viaRecipe: [] as string[] };
    direct.on('*', (e) => seen.direct.push(e.type));
    viaRecipe.on('*', (e) => seen.viaRecipe.push(e.type));

    await direct.run({ message: 'hi' });
    await viaRecipe.run({ message: 'hi' });

    expect(seen.viaRecipe).toEqual(seen.direct);
  });

  it('adds exactly ONE key to the manifest, and only when a recipe was applied', async () => {
    const { direct, viaRecipe } = buildBoth();
    const directManifests = watch(direct);
    const recipeManifests = watch(viaRecipe);

    await direct.run({ message: 'hi' });
    await viaRecipe.run({ message: 'hi' });

    const directKeys = Object.keys(directManifests[0]?.payload ?? {});
    const recipeKeys = Object.keys(recipeManifests[0]?.payload ?? {});
    expect(directKeys).not.toContain('recipes');
    expect(recipeKeys.filter((k) => !directKeys.includes(k))).toEqual(['recipes']);
  });

  it('answers the same thing, with the same tools on the wire', async () => {
    const wires: string[][] = [];
    const spy = () =>
      mock({
        respond: (req) => {
          wires.push((req.tools ?? []).map((t) => t.name));
          return 'ok';
        },
      });
    const direct = Agent.create({ provider: spy(), model: 'm' })
      .system('You answer support questions.')
      .tool(toolNamed('lookup_order'))
      .build();
    const viaRecipe = Agent.create({ provider: spy(), model: 'm' })
      .recipe(registers('support-desk', '1.2.0', 'lookup_order'))
      .system('You answer support questions.')
      .build();

    const a = await direct.run({ message: 'hi' });
    const b = await viaRecipe.run({ message: 'hi' });

    expect(b).toBe(a);
    expect(wires[1]).toEqual(wires[0]);
  });
});
