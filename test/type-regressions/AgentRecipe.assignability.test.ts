/**
 * Compile-level regression test — a recipe is a composition over the REAL
 * builder, and its two closed choices stay closed.
 *
 * The runtime suite (`test/recipes/`) proves what a recipe DOES. This file
 * proves the shape a consumer writes still compiles, in the direction they
 * write it, under the real compiler (`npm run test:types`). Three things a
 * runtime test cannot pin:
 *
 *   1. `configure` receives the whole `AgentBuilder` — not a narrowed subset
 *      that would freeze today's methods and rot. If the parameter ever
 *      narrowed, the fluent chain below stops compiling.
 *   2. The fluent one-liner `(agent) => agent.system('…').tool(t)` is legal
 *      against a `void` return. Recipe authors write that; if the return type
 *      were ever tightened away from `void`, they could not.
 *   3. `conflict` is a CLOSED union with one member today. `'skip'` is a real
 *      design that is not implemented, so it is refused at compile time as
 *      well as at run time — the `@ts-expect-error` lines below FAIL THE BUILD
 *      if either ever silently starts being accepted.
 *
 * Lives under its own tsconfig so the compiler checks the assignments, while
 * the `.test.ts` name lets vitest run the assertions.
 */
import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index';
import { mock } from '../../src/doors/providers';
import { defineAgentRecipe, type AgentRecipe, type RecipeOptions } from '../../src/doors/recipes';
import type { Payloads } from '../../src/events';

const aTool = defineTool({
  name: 'lookup_order',
  description: 'Look up one order.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  execute: async () => 'done',
});

describe('a recipe composes over the real builder', () => {
  it('reaches every builder method, and chains', () => {
    const recipe: AgentRecipe = {
      id: 'support-desk',
      version: '1.2.0',
      configure: (agent) => {
        // A narrowed parameter type would break this line, which is the point.
        agent.system('You answer support questions.').tool(aTool).maxIterations(3);
      },
    };
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
        .recipe(recipe)
        .build(),
    ).not.toThrow();
  });

  it('accepts the fluent one-liner against a void return', () => {
    // TypeScript's void-return rule: a function returning something is
    // assignable where `void` is expected. Recipe authors rely on it.
    const recipe = defineAgentRecipe({
      id: 'one-liner',
      version: '1.0.0',
      configure: (agent) => agent.system('You answer support questions.').tool(aTool),
    });
    expect(recipe.id).toBe('one-liner');
  });
});

describe('the declaration is read-only, and its options are closed', () => {
  it('refuses a field write and an unimplemented policy at compile time', () => {
    const recipe = defineAgentRecipe({
      id: 'support-desk',
      version: '1.2.0',
      configure: () => undefined,
    });

    expect(() => {
      // @ts-expect-error — `id` is readonly: a recipe handed to several agents
      // must not be editable for all of them by one of them. (The compiler
      // refuses the line; the freeze refuses it again at run time, which is
      // what the `toThrow` proves.)
      recipe.id = 'something-else';
    }).toThrow(TypeError);

    const ok: RecipeOptions = { conflict: 'error' };
    // @ts-expect-error — 'skip' is a design that is NOT implemented. It is
    // refused by name at run time; this line keeps it refused at compile time.
    const notOk: RecipeOptions = { conflict: 'skip' };

    expect(ok.conflict).toBe('error');
    expect(notOk.conflict).toBe('skip');
  });
});

describe('the manifest row is the id/version pair', () => {
  it('an AppliedRecipe is exactly what the payload carries', () => {
    // Two declarations, one shape — so the composer can map one to the other
    // field by field without a cast, and neither can drift alone.
    const applied: import('../../src/doors/recipes').AppliedRecipe = {
      id: 'support-desk',
      version: '1.2.0',
    };
    const row: Payloads.RunConfiguredRecipePayload = applied;
    const backAgain: import('../../src/doors/recipes').AppliedRecipe = row;
    expect(backAgain).toEqual({ id: 'support-desk', version: '1.2.0' });
  });
});
