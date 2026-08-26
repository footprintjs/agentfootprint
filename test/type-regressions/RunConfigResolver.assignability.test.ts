/**
 * Compile-level regression test — a `.configure()` resolver is nameable from
 * the public entry.
 *
 * `.configure(fn)` is a public builder door, so the shape of `fn` is a public
 * contract. Until these exports existed a consumer who wanted to declare a
 * resolver in one module and pass it in another had to re-declare that
 * contract by hand — a copy that drifts silently the first time a field is
 * added to the context.
 *
 * Nothing here runs. The assertion IS the import: if `RunConfigFn`,
 * `RunConfigContext` or `RunConfig` ever leaves the root barrel, this file
 * stops compiling under `npm run test:types`.
 */
import { describe, expect, it } from 'vitest';

import { Agent, type RunConfig, type RunConfigContext, type RunConfigFn } from '../../src/index';
import { mock } from '../../src/doors/providers';

/** The shape a consumer writes: a resolver declared away from the builder. */
const pickBrain: RunConfigFn = (ctx: RunConfigContext) =>
  ctx.message.length > 500 ? { model: 'big-model' } : {};

/** The return type is nameable on its own — a factory can declare it. */
function houseRules(ctx: RunConfigContext): RunConfig {
  return { instructions: `${ctx.defaults.instructions}\n\nBe brief.` };
}

describe('a .configure() resolver is typeable from the public entry', () => {
  it('accepts a separately-declared resolver, and every context field is reachable', async () => {
    const agent = Agent.create({ provider: mock({ replies: ['ok'] }), model: 'small-model' })
      .system('You answer support questions.')
      .configure((ctx) => {
        // Every documented field of the context, read through the exported type.
        const seen: RunConfigContext = ctx;
        void seen.runId;
        void seen.identity?.tenant;
        return { ...pickBrain(ctx), ...houseRules(ctx) };
      })
      .build();

    expect(String(await agent.run({ message: 'hi' }))).toBe('ok');
  });

  it('a resolver may return nothing — `undefined` is "use the defaults"', () => {
    const noop: RunConfigFn = () => undefined;
    expect(noop({ message: 'm', runId: 'r', defaults: { model: 'x', instructions: 'y' } })).toBe(
      undefined,
    );
  });
});
