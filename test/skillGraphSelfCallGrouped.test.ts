/**
 * The self-call notice under `reactMode: 'dynamic-grouped'` (9.86.0).
 *
 * THE DEFECT. 9.84.0 made the gate answer a `read_skill` on the cursor's own
 * skill by naming the tools that were genuinely on THAT call's wire — read from
 * `scope.dynamicToolSchemas` (the wire) and `scope.activeInjections` (the
 * cursor's declaration). Both are written by the Tools slot. In the GROUPED
 * chart the Tools slot runs inside `sf-llm-call` and the gate — the ToolCalls
 * stage — runs outside it, and the boundary bubbled neither key out. Its
 * outputMapper said so in a comment that had been true until the gate learned
 * to read them:
 *
 *     NOTE: dynamicToolSchemas is intentionally NOT bubbled out — it is
 *     written by the Tools slot and read ONLY by callLLM …
 *
 * So `selfSkillTools` saw `undefined`, correctly refused to guess, and the
 * notice said nothing about tools at all. Honest, and useless: the same agent,
 * same graph, same call, told the model less because of a chart shape it did
 * not choose. The fix bubbles the two keys (plus the role-hidden set, for the
 * same reason one stage further on) and the tests below pin the notice against
 * the REQUEST THE MODEL ACTUALLY GOT, not against the declaration.
 *
 * Test types (Convention 3): functional (the notice names the wire) · property
 * (never a tool the wire did not carry, at every cursor) · integration (a step
 * hold-out narrows the notice under this chart too) · security (role visibility
 * holds here, on every tool result and every `skill.rejected` payload) ·
 * regression (the flat chart's answer is unchanged — the two shapes agree).
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../src/index.js';
import { defineSkill, skillGraph } from '../src/injection-engine.js';
import { mock } from '../src/llm-providers.js';
import { PermissionPolicy } from '../src/security/PermissionPolicy.js';
import { unprovable, TOOL_RESULT, hiddenIdsNamed } from './helpers/modelFacingClaims.js';

const t = (name: string) =>
  defineTool({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => `${name}:ran`,
  });

const skill = (id: string, over: Record<string, unknown> = {}) =>
  defineSkill({
    id,
    description: `${id} does things`,
    body: `${id.toUpperCase()}_BODY`,
    tools: [t(`${id}_tool`)],
    ...over,
  } as never);

type Turn = { content: string; toolCalls: Array<{ id: string; name: string; args: unknown }> };

const NOTICE = 'named the skill you were already standing in';

const readSkill = (id: string, callId = 'c1'): Turn => ({
  content: '',
  toolCalls: [{ id: callId, name: 'read_skill', args: { id } }],
});
const callTool = (name: string, callId = 'c2'): Turn => ({
  content: '',
  toolCalls: [{ id: callId, name, args: {} }],
});

/** alpha → beta, plus a loose gamma the graph wires no edge into. */
const graph = () =>
  skillGraph({
    skills: [skill('alpha'), skill('beta'), skill('gamma')],
    start: 'alpha',
    steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
    check: 'off',
  });

/**
 * Drive an agent and capture, per request, the tool list the model was handed
 * and the tool results it read. The wire is captured from the REQUEST, which is
 * the only evidence for what the notice may claim.
 */
async function drive(
  build: (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  script: readonly Turn[],
  reactMode: 'dynamic' | 'dynamic-grouped',
  opts: { checker?: ConstructorParameters<typeof Object>[0] } = {},
) {
  const toolResults: string[] = [];
  const wire: string[][] = [];
  const rejected: Array<Record<string, unknown>> = [];
  let i = 0;
  const provider = mock({
    respond: (req: {
      messages?: ReadonlyArray<{ role: string; content: string }>;
      tools?: ReadonlyArray<{ name: string }>;
    }) => {
      for (const m of req.messages ?? []) if (m.role === 'tool') toolResults.push(m.content);
      wire.push((req.tools ?? []).map((x) => x.name));
      return script[i++] ?? { content: 'done', toolCalls: [] };
    },
  });
  const agent = build(
    Agent.create({
      provider,
      model: 'mock',
      maxIterations: 6,
      reactMode,
      ...(opts.checker !== undefined && { permissionChecker: opts.checker as never }),
    }),
  )
    .watch({
      id: 'w',
      onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
        if (e.name === 'agentfootprint.skill.rejected') rejected.push(e.payload ?? {});
      },
    })
    .build();
  const answer = await agent.run({ message: 'go' });
  return { toolResults, wire, rejected, answer };
}

/** The tool names the notice claims rode the call it is about. */
function namedTools(notice: string): string[] {
  return /tools were on that call's tool list: ([^.]+)\./.exec(notice)?.[1]?.split(', ') ?? [];
}

// ─── 1. FUNCTIONAL — the notice names the wire, not the declaration ──

describe("dynamic-grouped: the notice names that request's own tools", () => {
  it('names exactly the skill tools the captured request carried', async () => {
    const { toolResults, wire } = await drive(
      (a) => a.system('s').skillGraph(graph()),
      [readSkill('alpha'), callTool('alpha_tool')],
      'dynamic-grouped',
    );
    const notice = toolResults.find((r) => r.includes(NOTICE));
    expect(notice).toBeDefined();
    // Not "nothing about tools" — which is what the boundary's missing keys
    // produced, and what silently made this chart shape worse than the other.
    expect(namedTools(notice!)).toEqual(['alpha_tool']);
    // …and every name it used is in the tool list of the call it describes:
    // request 0, the one the read_skill was issued from.
    for (const name of namedTools(notice!)) expect(wire[0]).toContain(name);
    expect(unprovable(notice!, TOOL_RESULT)).toEqual([]);
  });

  it('the two chart shapes now answer the same call the same way', async () => {
    // The regression this file exists to hold: a chart shape is a rendering
    // choice, and it must not change what the model is told.
    const run = (reactMode: 'dynamic' | 'dynamic-grouped') =>
      drive(
        (a) => a.system('s').skillGraph(graph()),
        [readSkill('alpha'), callTool('alpha_tool')],
        reactMode,
      );
    const flat = await run('dynamic');
    const grouped = await run('dynamic-grouped');
    expect(grouped.toolResults.find((r) => r.includes(NOTICE))).toBe(
      flat.toolResults.find((r) => r.includes(NOTICE)),
    );
  });
});

// ─── 2. INTEGRATION — a dial that takes tools OFF the wire ──────────

describe('dynamic-grouped: the notice tracks a step hold-out', () => {
  it('names only the step tool that rode the request, not the declaration', async () => {
    const refund = defineSkill({
      id: 'refund',
      description: 'refund handling',
      body: 'REFUND_BODY',
      tools: [t('lookup'), t('charge'), t('export')],
      steps: [
        { tool: 'lookup', note: 'find the order' },
        { tool: 'charge', note: 'refund it' },
        { tool: 'export', note: 'file the receipt' },
      ],
    } as never);
    const g = skillGraph({
      skills: [refund, skill('beta')],
      start: 'refund',
      steps: [{ from: 'refund', to: 'beta', onToolReturn: 'export' }],
      check: 'off',
    });
    const { toolResults, wire } = await drive(
      (a) => a.system('s').skillGraph(g),
      [readSkill('refund')],
      'dynamic-grouped',
    );
    const notice = toolResults.find((r) => r.includes(NOTICE))!;
    expect(namedTools(notice)).toEqual(['lookup']);
    expect(wire[0]).toContain('lookup');
    expect(wire[0]).not.toContain('charge');
  });
});

// ─── 3. PROPERTY — bounded by the wire, at every cursor ─────────────

describe('dynamic-grouped: every tool the notice names was on that call', () => {
  it('holds across a run that moves the cursor', async () => {
    const { toolResults, wire } = await drive(
      (a) => a.system('s').skillGraph(graph()),
      [readSkill('alpha'), callTool('alpha_tool'), readSkill('beta')],
      'dynamic-grouped',
    );
    const notices = toolResults.filter((r) => r.includes(NOTICE));
    expect(notices.length).toBeGreaterThan(0);
    for (const [i, notice] of notices.entries()) {
      for (const name of namedTools(notice)) expect(wire[i]).toContain(name);
      expect(unprovable(notice, TOOL_RESULT)).toEqual([]);
    }
  });
});

// ─── 4. SECURITY — role visibility, on the grouped path too ─────────

describe('dynamic-grouped: a hidden skill is never named in a tool result', () => {
  it('the gate filters its refusal AND its payload through the same hidden set', async () => {
    // The hidden set is resolved by the Tools slot, inside `sf-llm-call`, and
    // read by the gate outside it — the third key the boundary now bubbles.
    // Without it the refusal names the graph's raw hop set, which is exactly
    // the leak the description closed one stage upstream.
    const policy = PermissionPolicy.fromRoles(
      { support: ['read_skill', 'alpha_tool', 'beta_tool', 'gamma_tool', 'delta_tool'] },
      'support',
      // `beta` is the hidden one. `delta` must be VISIBLE, or the skill_read
      // permission gate refuses the call with the policy's own message and the
      // graph gate — the composer under test — never runs.
      { skills: { support: ['alpha', 'gamma', 'delta'] } },
    );
    const g = skillGraph({
      skills: [skill('alpha'), skill('beta'), skill('gamma'), skill('delta')],
      start: 'alpha',
      // Two hops out of alpha, one of them hidden from this role; `delta` is
      // registered and wired to nothing out of alpha, so a pick of it is a
      // genuine reachability refusal rather than a policy denial.
      steps: [
        { from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' },
        { from: 'alpha', to: 'gamma', onToolReturn: 'gamma_tool' },
        { from: 'gamma', to: 'delta', onToolReturn: 'delta_tool' },
      ],
      check: 'off',
    });
    const { toolResults, rejected } = await drive(
      (a) => a.system('s').skillGraph(g),
      [readSkill('delta')],
      'dynamic-grouped',
      { checker: policy },
    );
    const refusal = toolResults.find((r) => r.includes('was not granted on that call'));
    expect(refusal).toBeDefined();
    // beta is a real hop from alpha and this role may not see it.
    expect(hiddenIdsNamed(refusal!, ['beta'])).toEqual([]);
    // gamma is the OTHER hop out of alpha and this role may see it, so the
    // refusal is filtered rather than merely mute.
    expect(refusal).toContain('gamma');
    for (const row of rejected) {
      expect(hiddenIdsNamed(JSON.stringify(row), ['beta'])).toEqual([]);
    }
  });
});
