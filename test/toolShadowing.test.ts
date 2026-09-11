/**
 * A tool name claimed by two sources stops being silent (8.7.0) — and since
 * 9.92.0 stops being a divergence at all.
 *
 * A `ToolProvider` and an active Skill can both declare `shared_tool`. The tools
 * slot merges `[static, provider, skill]` first-wins, and an
 * `autoActivate: 'currentSkill'` skill's tools are deliberately kept out of the
 * static registry, so the PROVIDER's schema is what the model reads. Until
 * 9.92.0 `lookupTool` resolved `registryByName` first, where every skill tool
 * lives and no provider tool does, so the SKILL's implementation ran: the model
 * read one contract and called another. Now DISPATCH FOLLOWS THE OFFER — the
 * provider's tool answers the provider's contract — and the record still says
 * the name was contested: `agentfootprint.tools.shadowed` every iteration names
 * the wire's party (both halves agree), `agentfootprint.tools.claim_swallowed`
 * names the skill whose claim is dead while the provider holds the name, plus
 * one dev-mode console line per name.
 *
 * 7 test types per Convention 3: unit (the merge + dispatch laws, separately),
 * functional (no shadow → no event), integration (a real run: schema seen vs.
 * result executed), property (the event's dispatchTo always names the source
 * that ran), security (no args/results/bodies in the payload), performance +
 * load (the latch holds a long loop to one line).
 */

import { describe, it, expect, vi } from 'vitest';
import { enableDevMode, disableDevMode } from 'footprintjs';
import { defineTool, Agent } from '../src/index.js';
import { skillGraph, defineSkill } from '../src/doors/context.js';
import { mock, staticTools } from '../src/doors/providers.js';
import type { LLMResponse } from '../src/adapters/types.js';
import type { ToolsClaimSwallowedPayload, ToolsShadowedPayload } from '../src/events/payloads.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const script = (...steps: readonly LLMResponse[]) => {
  let i = 0;
  return mock({
    respond: () =>
      steps[i++] ?? ({ content: 'done', toolCalls: [], stopReason: 'stop' } as LLMResponse),
  });
};

const call = (id: string, name: string, args: Record<string, unknown> = {}): LLMResponse =>
  ({ content: 'c', toolCalls: [{ id, name, args }], stopReason: 'tool_use' } as LLMResponse);

interface Capture {
  readonly offered: { name: string; description: string }[][];
  readonly results: string[];
  readonly shadowed: ToolsShadowedPayload[];
  readonly swallowed: ToolsClaimSwallowedPayload[];
}

const capture = (agent: ReturnType<typeof Agent.create> extends never ? never : never): never =>
  agent;

const watcher = (out: Capture) => ({
  id: 'cap',
  onEmit: (e: { name: string; payload: Record<string, unknown> }) => {
    if (e.name === 'agentfootprint.stream.llm_start') {
      out.offered.push(
        ((e.payload.tools ?? []) as { name: string; description: string }[]).map((t) => ({
          name: t.name,
          description: t.description,
        })),
      );
    }
    if (e.name === 'agentfootprint.stream.tool_end') out.results.push(String(e.payload.result));
    if (e.name === 'agentfootprint.tools.shadowed')
      out.shadowed.push(e.payload as unknown as ToolsShadowedPayload);
    if (e.name === 'agentfootprint.tools.claim_swallowed')
      out.swallowed.push(e.payload as unknown as ToolsClaimSwallowedPayload);
  },
});

const fresh = (): Capture => ({ offered: [], results: [], shadowed: [], swallowed: [] });

/** The contested pair: same name, two implementations, two descriptions. */
const skillImpl = () =>
  defineTool({
    name: 'shared_tool',
    description: 'SKILL VERSION',
    execute: () => 'shared_tool:FROM-SKILL',
  });
const providerImpl = () =>
  defineTool({
    name: 'shared_tool',
    description: 'PROVIDER VERSION',
    execute: () => 'shared_tool:FROM-PROVIDER',
  });

const shadowingAgent = (out: Capture, iterations = 3) => {
  const s = defineSkill({
    id: 'alpha',
    description: 'use alpha',
    body: 'ALPHA BODY',
    tools: [skillImpl()],
    autoActivate: 'currentSkill',
  });
  const graph = skillGraph({ skills: [s], start: 'alpha', check: 'throw' });
  return Agent.create({
    provider: script(call('c1', 'shared_tool')),
    model: 'mock',
    maxIterations: iterations,
  })
    .system('s')
    .skillGraph(graph)
    .toolProvider(staticTools([providerImpl()]))
    .watch(watcher(out))
    .build();
};

// ── 1. the two laws, separately ──────────────────────────────────────────────

describe('the offer and the answer are one party (9.92.0)', () => {
  it('unit: the LLM is shown the PROVIDER description (merge order, first-wins)', async () => {
    const out = fresh();
    await shadowingAgent(out).run({ message: 'hi' });
    const shared = out.offered[0]!.find((t) => t.name === 'shared_tool');
    expect(shared!.description).toBe('PROVIDER VERSION');
  });

  it('unit: dispatch runs the PROVIDER implementation — the party whose contract was on the wire', async () => {
    // Until 9.92.0 this asserted FROM-SKILL: `registryByName` was consulted
    // first, so the skill's execute answered the provider's contract.
    const out = fresh();
    await shadowingAgent(out).run({ message: 'hi' });
    expect(out.results).toContain('shared_tool:FROM-PROVIDER');
    expect(out.results).not.toContain('shared_tool:FROM-SKILL');
  });
});

// ── 2. the report ────────────────────────────────────────────────────────────

describe('agentfootprint.tools.shadowed', () => {
  it('integration: the event names the wire’s party in both halves, and claim_swallowed names the loser', async () => {
    const out = fresh();
    await shadowingAgent(out).run({ message: 'hi' });
    expect(out.shadowed.length).toBeGreaterThan(0);
    const first = out.shadowed[0]!;
    expect(first.toolName).toBe('shared_tool');
    expect(first.schemaFrom).toBe('provider');
    expect(first.schemaFromId).toBe('static');
    // Since 9.92.0 the party that answers IS the party the model read.
    expect(first.dispatchTo).toBe('provider');
    expect(first.dispatchToId).toBe('static');
    expect(first.iteration).toBeGreaterThanOrEqual(1);
    // The loser is named beside it, once per epoch it lost.
    expect(out.swallowed.length).toBeGreaterThan(0);
    const lost = out.swallowed[0]!;
    expect(lost.toolName).toBe('shared_tool');
    expect(lost.lostBy).toBe('skill');
    expect(lost.lostById).toBe('alpha');
    expect(lost.wonBy).toBe('provider');
    expect(lost.wonById).toBe('static');
    expect(lost.iteration).toBe(first.iteration);
  });

  it('property: dispatchTo always names the source whose result actually came back', async () => {
    const out = fresh();
    await shadowingAgent(out).run({ message: 'hi' });
    expect(out.shadowed.every((e) => e.dispatchTo === 'provider')).toBe(true);
    expect(out.shadowed.every((e) => e.dispatchTo === e.schemaFrom)).toBe(true);
    // and the run agrees
    expect(out.results.some((r) => r.endsWith('FROM-PROVIDER'))).toBe(true);
  });

  it('security: the payload carries NAMES only — no args, no results, no body', async () => {
    const out = fresh();
    await shadowingAgent(out).run({ message: 'hi' });
    const text = JSON.stringify([out.shadowed, out.swallowed]);
    expect(text).not.toContain('ALPHA BODY');
    expect(text).not.toContain('FROM-SKILL');
    expect(text).not.toContain('FROM-PROVIDER');
    expect(text).not.toContain('PROVIDER VERSION');
    expect(Object.keys(out.shadowed[0]!).sort()).toEqual([
      'dispatchTo',
      'dispatchToId',
      'iteration',
      'schemaFrom',
      'schemaFromId',
      'toolName',
    ]);
    expect(Object.keys(out.swallowed[0]!).sort()).toEqual([
      'iteration',
      'lostBy',
      'lostById',
      'toolName',
      'wonBy',
      'wonById',
    ]);
  });

  it('functional: no provider, or no collision → no event and no warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enableDevMode();
    try {
      const out = fresh();
      const s = defineSkill({
        id: 'alpha',
        description: 'use alpha',
        body: 'b',
        tools: [defineTool({ name: 'alpha_tool', description: 'a', execute: () => 'ok' })],
        autoActivate: 'currentSkill',
      });
      const graph = skillGraph({ skills: [s], start: 'alpha', check: 'throw' });
      const agent = Agent.create({ provider: script(), model: 'mock', maxIterations: 2 })
        .system('s')
        .skillGraph(graph)
        .toolProvider(
          staticTools([defineTool({ name: 'other_tool', description: 'o', execute: () => 'ok' })]),
        )
        .watch(watcher(out))
        .build();
      await agent.run({ message: 'hi' });
      expect(out.shadowed).toEqual([]);
      expect(out.swallowed).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      disableDevMode();
      warn.mockRestore();
    }
  });
});

// ── 3. the dev warning + its latch ───────────────────────────────────────────

describe('the dev-mode console line', () => {
  it('integration: warns once, names both sources and the fix', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enableDevMode();
    try {
      const out = fresh();
      await shadowingAgent(out).run({ message: 'hi' });
      const lines = warn.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes('shared_tool'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/is claimed by provider 'static' AND by skill 'alpha'/);
      expect(lines[0]).toMatch(/provider 'static''s implementation answers/);
      expect(lines[0]).toMatch(/Rename one of them/);
    } finally {
      disableDevMode();
      warn.mockRestore();
    }
  });

  it('load: a long loop prints ONE line while the event fires every iteration', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enableDevMode();
    try {
      const out = fresh();
      const s = defineSkill({
        id: 'alpha',
        description: 'use alpha',
        body: 'b',
        tools: [skillImpl()],
        autoActivate: 'currentSkill',
      });
      const graph = skillGraph({ skills: [s], start: 'alpha', check: 'throw' });
      const agent = Agent.create({
        // keep calling the tool so the loop keeps going
        provider: mock({ respond: () => call('c', 'shared_tool') }),
        model: 'mock',
        maxIterations: 6,
      })
        .system('s')
        .skillGraph(graph)
        .toolProvider(staticTools([providerImpl()]))
        .watch(watcher(out))
        .build();
      await agent.run({ message: 'hi' });
      const lines = warn.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes('shared_tool'));
      expect(lines).toHaveLength(1); // latched
      expect(out.shadowed.length).toBeGreaterThan(1); // unlatched
    } finally {
      disableDevMode();
      warn.mockRestore();
    }
  });

  it('performance: outside dev mode there is no console cost, and the event still fires', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const out = fresh();
      await shadowingAgent(out).run({ message: 'hi' });
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('shared_tool'))).toHaveLength(0);
      expect(out.shadowed.length).toBeGreaterThan(0);
    } finally {
      warn.mockRestore();
    }
  });
});

// ── 4. the pair that is caught EARLIER stays caught earlier ──────────────────

describe('a static .tool() colliding with a skill tool is still a build-time throw', () => {
  it('functional: the static-vs-skill pair is refused early, so no runtime report is needed', () => {
    const s = defineSkill({
      id: 'alpha',
      description: 'use alpha',
      body: 'b',
      tools: [skillImpl()],
    });
    const graph = skillGraph({ skills: [s], start: 'alpha', check: 'throw' });
    expect(() =>
      Agent.create({ provider: script(), model: 'mock' })
        .skillGraph(graph)
        .tool(providerImpl())
        .build()
        .run({ message: 'x' }),
    ).toThrow(/collides with the static \.tool\(\)/);
  });
});

void capture;
