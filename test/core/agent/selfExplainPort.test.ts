/**
 * THE SELF-EXPLAIN PORT — `.selfExplain()` reaches the trace toolpack through a
 * registry, never an import: the toolpack reads a finished run and sits above
 * the agent in the layer table (`scripts/layering.config.cjs`).
 *
 *   unit      a deep import of the builder, past every door, refuses
 *             `.selfExplain()` at `build()` with the named sentence; without
 *             `.selfExplain()` the same builder builds, so the port is asked
 *             only when the feature is
 *   scenario  EVERY published door (package.json `exports`): a door whose module
 *             graph reaches `AgentBuilder.ts` has registered the port by the time
 *             it is imported, and a door that hands out `Agent` or
 *             `AgentBuilder` is one of them — so no consumer on a door can meet
 *             the refusal
 *
 *   law       the HOST sits on every import path from a door to the builder: no
 *             door reaches `AgentBuilder.ts` once `selfExplainHost.ts` is taken
 *             out of the graph. That is what keeps the registration in a bundle.
 *             Registering from the barrel instead (a bare import beside
 *             `export { Agent } from './core/Agent.js'`) passes the per-door
 *             check above under Node, yet webpack and rolldown skip the
 *             side-effect-free barrel and drop the import, and `.selfExplain()`
 *             refuses there. Only this law fails on that layout.
 *
 * WHAT A GREEN RUN DOES NOT PROVE: that a bundler keeps the host itself. That
 * is decided by package.json `sideEffects` (the host is listed), pinned by
 * `test/esm-packaging.test.ts`'s copy of the list.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { readEdges } from '../../../scripts/check-layering.mjs';
import layering from '../../../scripts/layering.config.cjs';

const REPO = resolve(__dirname, '../../..');
const BUILDER = 'src/core/agent/AgentBuilder.ts';
const HOST = 'src/trace-toolpack/selfExplainHost.ts';

interface Door {
  readonly door: string;
  readonly entry: string;
  /** The door's module graph (eager and lazy imports) reaches the builder. */
  readonly loadsBuilder: boolean;
  /** …and still reaches it with the self-explain host taken out of the graph. */
  readonly bypassesHost: boolean;
}

/** Every published code door, with the src module behind it and whether it can reach the builder. */
function doors(): readonly Door[] {
  const pkg = JSON.parse(readFileSync(resolve(REPO, 'package.json'), 'utf8')) as {
    exports: Record<string, string | { import: { default: string } }>;
  };
  const files = layering.listSourceFiles(REPO) as string[];
  const next = new Map<string, string[]>();
  for (const e of readEdges(REPO, files, []) as Array<{ from: string; to: string; kind: string }>) {
    if (e.kind === 'type') continue;
    next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  }
  const reaches = (entry: string, without?: string): boolean => {
    const seen = new Set([entry]);
    const queue = [entry];
    while (queue.length > 0) {
      for (const to of next.get(queue.pop()!) ?? []) {
        if (seen.has(to) || to === without) continue;
        seen.add(to);
        queue.push(to);
      }
    }
    return seen.has(BUILDER);
  };
  return Object.entries(pkg.exports)
    .filter((row): row is [string, { import: { default: string } }] => typeof row[1] !== 'string')
    .map(([door, target]) => {
      const entry = target.import.default.replace('./dist/esm/', 'src/').replace(/\.js$/, '.ts');
      return { door, entry, loadsBuilder: reaches(entry), bypassesHost: reaches(entry, HOST) };
    });
}

const DOORS = doors();

/** A fresh module registry: nothing registered unless what this test imports registers it. */
async function fresh<T>(path: string): Promise<T> {
  return (await import(resolve(REPO, path))) as T;
}

type AgentModule = typeof import('../../../src/core/Agent.js');
type PortModule = typeof import('../../../src/core/agent/selfExplainPort.js');
type MockModule = typeof import('../../../src/adapters/llm/MockProvider.js');

describe('the self-explain port — a deep import of the builder', () => {
  it('refuses `.selfExplain()` at build() with the named sentence when nothing registered', async () => {
    vi.resetModules();
    const { Agent } = await fresh<AgentModule>('src/core/Agent.ts');
    const { mock } = await fresh<MockModule>('src/adapters/llm/MockProvider.ts');
    const { SELF_EXPLAIN_UNREGISTERED } = await fresh<PortModule>(
      'src/core/agent/selfExplainPort.ts',
    );
    const builder = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' }).selfExplain();
    expect(() => builder.build()).toThrow(SELF_EXPLAIN_UNREGISTERED);
  });

  it('builds without `.selfExplain()` — the port is asked only when the feature is', async () => {
    vi.resetModules();
    const { Agent } = await fresh<AgentModule>('src/core/Agent.ts');
    const { mock } = await fresh<MockModule>('src/adapters/llm/MockProvider.ts');
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' }).build(),
    ).not.toThrow();
  });
});

describe('the self-explain port — every published door', () => {
  it('the doors whose graph reaches the builder are the root and /observe', () => {
    expect(DOORS.length).toBeGreaterThan(10);
    expect(DOORS.filter((d) => d.loadsBuilder).map((d) => d.door)).toEqual(['.', './observe']);
  });

  it('LAW: no door reaches the builder except through the self-explain host', () => {
    expect(DOORS.filter((d) => d.bypassesHost).map((d) => d.door)).toEqual([]);
  });

  it.each(DOORS.map((d) => [d.door, d] as const))(
    '%s — a door that can reach the builder has registered the port on import',
    async (_door, { entry, loadsBuilder }) => {
      vi.resetModules();
      const ns = await fresh<Record<string, unknown>>(entry);
      const { Agent, AgentBuilder } = await fresh<AgentModule>('src/core/Agent.ts');
      const port = await fresh<PortModule>('src/core/agent/selfExplainPort.ts');
      const handsOut = Object.values(ns).some((v) => v === Agent || v === AgentBuilder);
      if (handsOut) expect(loadsBuilder).toBe(true);
      if (loadsBuilder) expect(() => port.requireSelfExplain()).not.toThrow();
    },
  );

  it('the root door registers it: `Agent` from `agentfootprint` builds with `.selfExplain()`', async () => {
    vi.resetModules();
    const { Agent } = await fresh<{ Agent: AgentModule['Agent'] }>('src/index.ts');
    const { mock } = await fresh<MockModule>('src/adapters/llm/MockProvider.ts');
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .selfExplain()
      .build();
    expect(agent.canExplain()).toBe(false); // mounted, and no turn has completed yet
  });
});
