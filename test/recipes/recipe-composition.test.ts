/**
 * `AgentBuilder.recipe()` (9.48.0) — applying compositions, and the refusal
 * that names both sides of a collision.
 *
 * The builder has always refused a duplicate tool name: the model dispatches by
 * name, so two tools called `search` is a coin flip whose loser is never called
 * and never mentioned. What it could not say was WHERE each one came from —
 * which stops being obvious with one recipe in the chain ("I never registered a
 * `search` tool") and is unrecoverable with two.
 *
 * Sections: Functional (declaration order) · Integration (conflicts across
 * every source pair, through a real build) · Security & containment (a refusal
 * inside `configure` cannot leave the attribution stack dirty) · Edge (nested
 * recipes, two namespaces, a policy this library does not have) · Regression
 * (an agent with no recipes keeps the message it always had).
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool, type Tool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { defineAgentRecipe } from '../../src/doors/recipes.js';
import { describeRecipeSource } from '../../src/recipes/provenance.js';
import { defineSteering } from '../../src/doors/context.js';

const provider = () => mock({ reply: 'ok' });
const create = () => Agent.create({ provider: provider(), model: 'm' });

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

// ─── 1. FUNCTIONAL — declaration order is application order ──────────

describe('recipes apply in declaration order', () => {
  it('runs each `configure` at the position it was written', () => {
    const order: string[] = [];
    const note = (id: string) =>
      defineAgentRecipe({ id, version: '1.0.0', configure: () => order.push(id) });

    create().recipe(note('first')).recipe(note('second')).recipe(note('third')).build();

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('the ORDER shows up where it is observable — the tools on the wire', async () => {
    const seen: string[][] = [];
    const agent = Agent.create({
      provider: mock({
        respond: (req) => {
          seen.push((req.tools ?? []).map((t) => t.name));
          return 'ok';
        },
      }),
      model: 'm',
    })
      .recipe(registers('alpha', '1.0.0', 'from_alpha'))
      .recipe(registers('beta', '1.0.0', 'from_beta'))
      .tool(toolNamed('from_the_app'))
      .build();

    await agent.run({ message: 'hi' });

    expect(seen[0]).toEqual(['from_alpha', 'from_beta', 'from_the_app']);
  });

  it('a recipe reaches the whole builder, not a narrowed subset', () => {
    // The claim the design rests on: a recipe is a composition over methods
    // that ALREADY EXIST. Nothing here is recipe-specific machinery.
    const full = defineAgentRecipe({
      id: 'full-house',
      version: '1.0.0',
      configure: (agent) => {
        agent
          .system('You answer support questions.')
          .tool(toolNamed('lookup'))
          .steering(defineSteering({ id: 'house', prompt: 'Be brief.' }))
          .maxIterations(3);
      },
    });
    expect(() => create().recipe(full).build()).not.toThrow();
  });
});

// ─── 2. INTEGRATION — the conflict, from every source pair ───────────

describe('a duplicate tool name names BOTH sources', () => {
  it('recipe vs recipe', () => {
    expect(() =>
      create()
        .recipe(registers('support-desk', '1.2.0', 'search'))
        .recipe(registers('crm-basics', '0.4.0', 'search'))
        .build(),
    ).toThrow(
      /duplicate tool name 'search' — already registered by recipe 'support-desk' 1\.2\.0, and now by recipe 'crm-basics' 0\.4\.0/,
    );
  });

  it('recipe first, then the app', () => {
    expect(() =>
      create().recipe(registers('support-desk', '1.2.0', 'search')).tool(toolNamed('search')),
    ).toThrow(
      /already registered by recipe 'support-desk' 1\.2\.0, and now by this agent, directly/,
    );
  });

  it('the app first, then a recipe', () => {
    // Both directions, because the app is as likely to be the second half.
    expect(() =>
      create().tool(toolNamed('search')).recipe(registers('support-desk', '1.2.0', 'search')),
    ).toThrow(
      /already registered by this agent, directly, and now by recipe 'support-desk' 1\.2\.0/,
    );
  });

  it('says WHY it matters and what to do — not just that it happened', () => {
    let message = '';
    try {
      create()
        .recipe(registers('a-recipe', '1.0.0', 'search'))
        .recipe(registers('b-recipe', '1.0.0', 'search'));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/dispatches tools BY NAME/);
    expect(message).toMatch(/rename one of them/);
    // …and it points at the option rather than leaving the reader to hope one
    // exists.
    expect(message).toMatch(/\.recipe\(recipe, \{ conflict \}\)/);
  });
});

describe('a duplicate injection id names BOTH sources', () => {
  const steers = (id: string, version: string, injectionId: string) =>
    defineAgentRecipe({
      id,
      version,
      configure: (agent) => {
        agent.steering(defineSteering({ id: injectionId, prompt: 'Be brief.' }));
      },
    });

  it('recipe vs recipe', () => {
    expect(() =>
      create().recipe(steers('house', '2.0.0', 'tone')).recipe(steers('team', '1.1.0', 'tone')),
    ).toThrow(
      /duplicate injection id 'tone' — already registered by recipe 'house' 2\.0\.0, and now by recipe 'team' 1\.1\.0/,
    );
  });

  it('explains what an injection id addresses, not what a tool name does', () => {
    let message = '';
    try {
      create().recipe(steers('house', '2.0.0', 'tone')).recipe(steers('team', '1.1.0', 'tone'));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/how the engine addresses one piece of context/);
    expect(message).not.toMatch(/dispatches tools BY NAME/);
  });
});

// ─── 3. SECURITY & CONTAINMENT — the attribution stack ───────────────

describe('attribution cannot be left dirty', () => {
  it('a refusal raised INSIDE configure does not leave the recipe "still applying"', () => {
    const builder = create().tool(toolNamed('search'));
    // This recipe collides on its first call and throws out of `configure`.
    expect(() => builder.recipe(registers('doomed', '1.0.0', 'search'))).toThrow();
    // The next registration is the APP's, and a stack that never unwound would
    // blame 'doomed' for it — an attribution that sends the reader to the wrong
    // file. (`unwind` is registered locally, so the collision message below
    // must say "this agent, directly" on BOTH sides.)
    expect(() => builder.tool(toolNamed('search'))).toThrow(
      /^Agent\.tool\(\): duplicate tool name 'search'$/,
    );
  });

  it('a recipe cannot apply itself — recursion is refused, not run 1000 deep', () => {
    const recipe: { current?: ReturnType<typeof defineAgentRecipe> } = {};
    recipe.current = defineAgentRecipe({
      id: 'ouroboros',
      version: '1.0.0',
      configure: (agent) => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        agent.recipe(recipe.current!);
      },
    });
    // A SEPARATE refusal from the duplicate one: the fix here is not "apply it
    // once", it is "stop the cycle", and the message shows the cycle.
    expect(() => create().recipe(recipe.current!)).toThrow(/is applying itself/);
    expect(() => create().recipe(recipe.current!)).toThrow(
      /'ouroboros' 1\.0\.0 → 'ouroboros' 1\.0\.0/,
    );
    expect(() => create().recipe(recipe.current!)).not.toThrow(/already applied/);
  });

  it('tells recursion and a repeated application APART', () => {
    // Two different facts. Folding them into one message would send an author
    // whose recipe is its own ancestor to look at the wrong line.
    const twice = registers('support-desk', '1.2.0', 'search_a');
    expect(() => create().recipe(twice).recipe(twice)).toThrow(/is already applied to this agent/);
    expect(() => create().recipe(twice).recipe(twice)).not.toThrow(/applying itself/);
  });

  it('an async `configure` is refused by name, never left unawaited', () => {
    const asyncRecipe = defineAgentRecipe({
      id: 'fetches-things',
      version: '1.0.0',
      configure: (() => Promise.resolve()) as unknown as (b: never) => void,
    });
    expect(() => create().recipe(asyncRecipe)).toThrow(/returned a promise from `configure`/);
    expect(() => create().recipe(asyncRecipe)).toThrow(/Do the async part before you build/);
  });
});

// ─── 4. EDGE — nesting, namespaces, a policy that does not exist ─────

describe('edges', () => {
  it('a recipe applying a recipe is attributed innermost-first', () => {
    const inner = registers('crm-basics', '0.4.0', 'search');
    const outer = defineAgentRecipe({
      id: 'house-standard',
      version: '2.1.0',
      configure: (agent) => {
        agent.recipe(inner);
      },
    });
    expect(() => create().tool(toolNamed('search')).recipe(outer)).toThrow(
      /now by recipe 'crm-basics' 0\.4\.0 ← applied by recipe 'house-standard' 2\.1\.0/,
    );
  });

  it('a tool NAME and an injection ID are separate namespaces', () => {
    // Two maps keyed by the raw name, never one keyed by a composed string:
    // the same word in both namespaces must not collide.
    expect(() =>
      create()
        .recipe(registers('tools', '1.0.0', 'billing'))
        .recipe(
          defineAgentRecipe({
            id: 'context',
            version: '1.0.0',
            configure: (agent) => {
              agent.steering(defineSteering({ id: 'billing', prompt: 'Be brief.' }));
            },
          }),
        )
        .build(),
    ).not.toThrow();
  });

  it('applying one composition twice is refused, at any version', () => {
    const v1 = registers('support-desk', '1.2.0', 'search_a');
    const v2 = registers('support-desk', '2.0.0', 'search_b');
    expect(() => create().recipe(v1).recipe(v2)).toThrow(
      /'support-desk' is already applied to this agent at 1\.2\.0, and this one is 2\.0\.0/,
    );
    expect(() => create().recipe(v1).recipe(v1)).toThrow(/\(both at 1\.2\.0\)/);
  });

  it('two DIFFERENT compositions may of course both apply', () => {
    // The control: if `.recipe()` refused any second call, the test above
    // would pass for the wrong reason.
    expect(() =>
      create()
        .recipe(registers('support-desk', '1.2.0', 'search_a'))
        .recipe(registers('crm-basics', '0.4.0', 'search_b'))
        .build(),
    ).not.toThrow();
  });

  it('refuses a conflict policy this library does not have, BY NAME', () => {
    const recipe = registers('support-desk', '1.2.0', 'search');
    expect(() => create().recipe(recipe, { conflict: 'skip' as unknown as 'error' })).toThrow(
      /conflict policy 'skip' is not implemented/,
    );
    // …and it says what the missing designs would each have to answer first.
    expect(() => create().recipe(recipe, { conflict: 'skip' as unknown as 'error' })).toThrow(
      /where the dropped or overridden registration is RECORDED/,
    );
  });

  it('refuses the unknown policy BEFORE applying anything', () => {
    // Half-applying a composition and then refusing would leave a builder
    // carrying tools from a recipe it never accepted.
    const builder = create();
    expect(() =>
      builder.recipe(registers('support-desk', '1.2.0', 'search'), {
        conflict: 'replace' as unknown as 'error',
      }),
    ).toThrow(/not implemented/);
    // Nothing landed: the app can still register the same name itself.
    expect(() => builder.tool(toolNamed('search'))).not.toThrow();
  });

  it('accepts the policy that DOES exist, spelled out', () => {
    expect(() =>
      create().recipe(registers('support-desk', '1.2.0', 'search'), { conflict: 'error' }).build(),
    ).not.toThrow();
  });
});

// ─── 5. REGRESSION — nothing changes for an agent with no recipes ────

describe('an agent that uses no recipes is untouched', () => {
  it('keeps the duplicate-tool message it has always had, to the byte', () => {
    expect(() => create().tool(toolNamed('search')).tool(toolNamed('search'))).toThrow(
      /^Agent\.tool\(\): duplicate tool name 'search'$/,
    );
  });

  it('keeps the duplicate-injection message it has always had, to the byte', () => {
    const steering = defineSteering({ id: 'tone', prompt: 'Be brief.' });
    expect(() => create().steering(steering).steering(steering)).toThrow(
      /^Agent\.injection\(\): duplicate id 'tone'$/,
    );
  });

  it('`.outputSchema()` mounts its instruction as a LOCAL registration', () => {
    // The second door into the injection list. Without provenance recorded
    // there, a later collision would read as "unattributed" — honest, but a
    // worse answer than the true one, and a changed message for an agent that
    // never touched a recipe.
    const parser = { safeParse: (v: unknown) => ({ success: true as const, data: v }) };
    expect(() =>
      create()
        .outputSchema(parser, { name: 'shape' })
        .steering(defineSteering({ id: 'shape', prompt: 'Be brief.' })),
    ).toThrow(/^Agent\.injection\(\): duplicate id 'shape'$/);
  });
});

// ─── 6. UNIT — the formatter's third answer ──────────────────────────

describe('describeRecipeSource', () => {
  it('tells "the app did it" and "nobody recorded it" apart', () => {
    // Two different facts. Folding the second into the first would make the
    // refusal name a caller who did nothing — the shape this library refuses
    // everywhere else.
    expect(describeRecipeSource({ kind: 'local' })).toBe('this agent, directly');
    expect(describeRecipeSource(undefined)).toMatch(/no recorded source/);
    expect(describeRecipeSource(undefined)).not.toMatch(/this agent, directly/);
  });

  it('reads innermost-first for a chain', () => {
    expect(
      describeRecipeSource({
        kind: 'recipe',
        stack: [
          { id: 'outer', version: '2.1.0' },
          { id: 'inner', version: '0.4.0' },
        ],
      }),
    ).toBe("recipe 'inner' 0.4.0 ← applied by recipe 'outer' 2.1.0");
  });
});
