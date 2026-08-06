/**
 * A skill's body has to land SOMEWHERE (8.5.0).
 *
 * `surfaceMode: 'tool-only'` says "deliver the body as the read_skill tool result",
 * and the system slot suppresses a tool-only body by design so the two channels
 * don't duplicate. That pairing is exactly right for a skill read_skill activates —
 * and a hole for a skill the GRAPH activates: a route target, an entry and a tree
 * leaf all activate off the cursor, so no read_skill call ever happens, the system
 * slot suppresses the body anyway, and the body reaches the model through no channel
 * at all. Its TOOLS still arrive, which is worse than the skill not loading: the
 * model gets the tools of a procedure nobody told it.
 *
 * The rule that closes it is the one 8.4.0 already applies at the read_skill gate —
 * `trigger.kind === 'llm-activated'` is "read_skill can really activate this" — so a
 * skill may claim the read_skill delivery channel exactly when read_skill activates
 * it. Refusal, not a silent fallback to the system slot: the author wrote
 * 'tool-only' to keep the body OUT of the system prompt, and quietly putting it back
 * would honour the activation while breaking the declaration.
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../src/index.js';
import { defineSkill, skillGraph, decideSkill } from '../src/injection-engine.js';
import {
  activatesByRead,
  resolvedSurfaceModeOf,
  toolOnlyDeliveryRefusal,
} from '../src/lib/injection-engine/skillBodyDelivery.js';
import { mock } from '../src/llm-providers.js';

const t = (name: string) =>
  defineTool({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => `${name}:ran`,
  });

const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
});

const skill = (id: string, mode?: 'auto' | 'system-prompt' | 'tool-only' | 'both') =>
  defineSkill({
    id,
    description: `${id} skill`,
    body: `${id.toUpperCase()}_BODY`,
    tools: [t(`${id}_tool`)],
    ...(mode && { surfaceMode: mode }),
  });

/** Run an agent and report every channel the model could have read a body from. */
async function channels(
  build: (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  script: ReadonlyArray<ReturnType<typeof call> | { content: string; toolCalls: [] }>,
): Promise<{ systems: string[]; toolResults: string[]; active: string[][] }> {
  const systems: string[] = [];
  const toolResults: string[] = [];
  const active: string[][] = [];
  let i = 0;
  const provider = mock({
    respond: (req: {
      systemPrompt?: string;
      messages?: ReadonlyArray<{ role: string; content: string }>;
    }) => {
      systems.push(req.systemPrompt ?? '');
      for (const m of req.messages ?? []) if (m.role === 'tool') toolResults.push(m.content);
      return script[i++] ?? { content: 'done', toolCalls: [] };
    },
  });
  const agent = build(Agent.create({ provider, model: 'mock', maxIterations: 5 }))
    .watch({
      id: 'w',
      onEmit: (e: { name: string; payload: Record<string, unknown> }) => {
        if (e.name === 'agentfootprint.context.evaluated')
          active.push(e.payload.activeIds as string[]);
      },
    })
    .build();
  await agent.run({ message: 'go' });
  return { systems, toolResults, active };
}

// ─── 1. UNIT — which triggers may claim the read_skill channel ────

describe('tool-only delivery — the trigger partition', () => {
  it('a skill outside a graph activates by read_skill, so tool-only is honest', () => {
    const s = skill('solo', 'tool-only');
    expect(activatesByRead(s)).toBe(true);
    expect(toolOnlyDeliveryRefusal([s])).toBeUndefined();
  });

  it('a bare model edge target keeps llm-activated — still allowed', () => {
    const a = skill('alpha');
    const m = skill('modelonly', 'tool-only');
    // `.route(a, m)` with no when/onToolReturn is a MODEL edge: the graph draws it
    // but never fires it, so read_skill is still the only thing that activates m.
    const g = skillGraph().entry(a).route(a, m).build({ check: 'off' });
    const compiled = g.skills.find((s) => s.id === 'modelonly')!;
    expect(compiled.trigger.kind).toBe('llm-activated');
    expect(toolOnlyDeliveryRefusal(g.skills)).toBeUndefined();
  });

  it('a deterministic route target compiles to a rule — refused', () => {
    const alpha = skill('alpha');
    const g = skillGraph()
      .entry(alpha)
      .route(alpha, skill('beta', 'tool-only'), { onToolReturn: 'alpha_tool' })
      .build({ check: 'off' });
    expect(toolOnlyDeliveryRefusal(g.skills)).toContain('"beta"');
  });

  it('a graph entry is refused, and named as an entry', () => {
    const g = skillGraph().entry(skill('alpha', 'tool-only')).build({ check: 'off' });
    const msg = toolOnlyDeliveryRefusal(g.skills)!;
    expect(msg).toContain('"alpha"');
    expect(msg).toContain('a graph entry');
  });

  it('a decision-tree leaf is refused, and named as a leaf', () => {
    const g = skillGraph()
      .tree(decideSkill(() => true, skill('leaf1', 'tool-only'), skill('leaf2')))
      .build({ check: 'off' });
    const msg = toolOnlyDeliveryRefusal(g.skills)!;
    expect(msg).toContain('"leaf1"');
    expect(msg).toContain('a decision-tree leaf');
  });

  it("'both' and 'system-prompt' are never refused — they reach the system slot", () => {
    for (const mode of ['both', 'system-prompt'] as const) {
      const alpha = skill('alpha');
      const g = skillGraph()
        .entry(alpha)
        .route(alpha, skill('beta', mode), { onToolReturn: 'alpha_tool' })
        .build({ check: 'off' });
      expect(toolOnlyDeliveryRefusal(g.skills)).toBeUndefined();
    }
  });
});

// ─── 2. SCENARIO — the refusal fires on the agent, on the real shape ──

describe('tool-only delivery — the agent refuses at build', () => {
  const graph = () => {
    const alpha = skill('alpha');
    const beta = skill('beta', 'tool-only');
    return skillGraph({
      skills: [alpha, beta],
      start: 'alpha',
      steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
      check: 'throw',
    });
  };

  it('refuses, and the message names the fix', () => {
    expect(() =>
      Agent.create({
        provider: mock({ respond: () => ({ content: '', toolCalls: [] }) }),
        model: 'm',
      })
        .skillGraph(graph())
        .build(),
    ).toThrow(/surfaceMode: 'tool-only'/);
    expect(() =>
      Agent.create({
        provider: mock({ respond: () => ({ content: '', toolCalls: [] }) }),
        model: 'm',
      })
        .skillGraph(graph())
        .build(),
    ).toThrow(/Use 'both'/);
  });

  it('names the skill AND its routing, so a directory-sized refusal reads as a list', () => {
    const a = skill('alpha');
    const b = skill('beta', 'tool-only');
    const c = skill('gamma', 'tool-only');
    const g = skillGraph({
      skills: [a, b, c],
      start: 'alpha',
      steps: [
        { from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' },
        { from: 'beta', to: 'gamma', onToolReturn: 'beta_tool' },
      ],
      check: 'throw',
    });
    let msg = '';
    try {
      Agent.create({
        provider: mock({ respond: () => ({ content: '', toolCalls: [] }) }),
        model: 'm',
      })
        .skillGraph(g)
        .build();
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toContain('"beta"');
    expect(msg).toContain('"gamma"');
    expect(msg).toContain('"alpha" → "beta"');
    expect(msg).toContain('"beta" → "gamma"');
  });
});

// ─── 3. INTEGRATION — the allowed shapes still deliver, end to end ────

describe('tool-only delivery — what still works', () => {
  it('a read_skill-activated tool-only skill still delivers via the tool result', async () => {
    const s = skill('billing', 'tool-only');
    const { systems, toolResults } = await channels(
      (a) => a.system('BASE').skill(s),
      [call('c1', 'read_skill', { id: 'billing' })],
    );
    expect(systems.every((x) => !x.includes('BILLING_BODY'))).toBe(true);
    expect(toolResults.some((r) => r.includes('BILLING_BODY'))).toBe(true);
  });

  it("'both' on a route target delivers on a CURSOR hop — the fix the refusal names", async () => {
    const alpha = skill('alpha');
    const beta = skill('beta', 'both');
    const g = skillGraph({
      skills: [alpha, beta],
      start: 'alpha',
      steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
      check: 'throw',
    });
    const { systems, active } = await channels(
      (a) => a.system('BASE').skillGraph(g),
      [call('c1', 'alpha_tool')],
    );
    expect(active.some((ids) => ids.includes('beta'))).toBe(true);
    expect(systems.some((s) => s.includes('BETA_BODY'))).toBe(true);
  });
});

// ─── 4. PROPERTY — the invariant, stated directly ────────────────

describe('tool-only delivery — properties', () => {
  it('every skill an agent ACCEPTS has at least one live body channel', () => {
    const modes = ['auto', 'system-prompt', 'tool-only', 'both'] as const;
    for (const mode of modes) {
      const entry = skill('alpha', mode);
      const g = skillGraph().entry(entry).build({ check: 'off' });
      const accepted = toolOnlyDeliveryRefusal(g.skills) === undefined;
      const compiled = g.skills[0]!;
      // A live channel is: the system slot (any mode but tool-only), or the
      // read_skill tool result (tool-only, and only when read_skill activates it).
      const hasChannel =
        resolvedSurfaceModeOf(compiled) !== 'tool-only' || activatesByRead(compiled);
      expect(accepted).toBe(hasChannel);
    }
  });

  it('an empty-bodied tool-only skill is not refused — there is no body to lose', () => {
    const hollow = {
      id: 'hollow',
      description: 'h',
      flavor: 'skill' as const,
      trigger: { kind: 'rule' as const, activeWhen: () => true },
      inject: { systemPrompt: '' },
      metadata: { surfaceMode: 'tool-only' as const },
    };
    expect(
      toolOnlyDeliveryRefusal([
        hollow as unknown as Parameters<typeof toolOnlyDeliveryRefusal>[0][number],
      ]),
    ).toBeUndefined();
  });
});

// ─── 5. SECURITY — the refusal must not become an exfiltration path ──

describe('tool-only delivery — security', () => {
  it('the refusal names ids and routing, never the body it is protecting', () => {
    const secret = defineSkill({
      id: 'beta',
      description: 'B',
      body: 'SUPER_SECRET_PROCEDURE_TEXT',
      surfaceMode: 'tool-only',
    });
    const alpha = skill('alpha');
    const g = skillGraph()
      .entry(alpha)
      .route(alpha, secret, { onToolReturn: 'alpha_tool' })
      .build({ check: 'off' });
    const msg = toolOnlyDeliveryRefusal(g.skills)!;
    expect(msg).not.toContain('SUPER_SECRET_PROCEDURE_TEXT');
  });
});

// ─── 6. PERFORMANCE — the check is linear and build-time only ────

describe('tool-only delivery — performance', () => {
  it('scans the injection list once, with no per-iteration cost', () => {
    const many = Array.from({ length: 2_000 }, (_, i) => skill(`s${i}`));
    const start = Date.now();
    for (let i = 0; i < 20; i++) toolOnlyDeliveryRefusal(many);
    // 40k skill inspections; a pure filter. Generous bound — this is a smoke test
    // against someone making the check quadratic, not a benchmark.
    expect(Date.now() - start).toBeLessThan(2_000);
  });
});

// ─── 7. ROI — the 'auto' trap the helper closes structurally ─────

describe("tool-only delivery — the 'auto' cascade stays behind one door", () => {
  it("'auto' is its own mode today: it lands in the system slot, unresolved", async () => {
    const { systems } = await channels(
      (a) => a.system('BASE').skill(skill('solo', 'auto')),
      [call('c1', 'read_skill', { id: 'solo' })],
    );
    expect(systems.some((s) => s.includes('SOLO_BODY'))).toBe(true);
    expect(resolvedSurfaceModeOf(skill('solo', 'auto'))).toBe('auto');
  });

  it("resolving 'auto' against a provider is where it would become 'tool-only'", () => {
    const s = skill('solo', 'auto');
    // The cascade every non-Claude provider hits. It is NOT wired into the runtime;
    // routing both questions through one helper is what makes the refusal cover it
    // the day it is, instead of opening the hole for every OpenAI user at once.
    expect(resolvedSurfaceModeOf(s, 'openai', 'gpt-4o')).toBe('tool-only');
    expect(resolvedSurfaceModeOf(s, 'anthropic', 'claude-sonnet-4-5')).toBe('both');
  });
});
