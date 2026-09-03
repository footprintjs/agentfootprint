/**
 * Typed tool effects through the REAL Agent loop (9.19.0): the result
 * envelope (strict recognition — zero-delta for every shape tools return
 * today), propose-transition under the graph's own law (accept / refuse /
 * same-batch edge wins / proposal-vs-proposal conflict / rails), the
 * require-instruction push with both leases (delivery + expiry), and
 * outcome-status routing (`onToolStatus` — a denied call must never route
 * like a success).
 *
 * Sections follow Convention 3: Unit (envelope recognition) · Functional
 * (transitions) · Integration (leases, status routing) · Security
 * (posture-independence, no-graph refusal) · Regression (zero-delta,
 * builder refusals).
 */

import { describe, it, expect, vi } from 'vitest';
import { enableDevMode, disableDevMode } from 'footprintjs';
import {
  Agent,
  defineTool,
  explainStatusOnlyNearMiss,
  readToolResultEnvelope,
  type ToolResultEnvelope,
} from '../../../src/index.js';
import { defineSkill, defineInstruction, skillGraph } from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';
import type { Injection } from '../../../src/lib/injection-engine/types.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

const skill = (id: string, over: Partial<Parameters<typeof defineSkill>[0]> = {}) =>
  defineSkill({ id, description: `use ${id}`, body: `${id} body`, ...over });

const effectTool = (name: string, result: unknown) =>
  defineTool<Record<string, never>, unknown>({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => result,
  });

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const batch = (calls: Array<{ name: string; id: string }>) => ({
  content: '',
  toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: {} })),
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

type Ev = Record<string, unknown>;
const capture = () => {
  const effects: Ev[] = [];
  const evaluated: Ev[] = [];
  const superseded: Ev[] = [];
  const conflicts: Ev[] = [];
  const toolEnds: Ev[] = [];
  const rejections: Ev[] = [];
  const recorder = {
    id: 'capture-effects',
    onEmit: (e: { name: string; payload?: Ev }) => {
      if (e.name === 'agentfootprint.skill.rejected') rejections.push(e.payload ?? {});
      if (e.name === 'agentfootprint.tools.effect') effects.push(e.payload ?? {});
      if (e.name === 'agentfootprint.context.evaluated') evaluated.push(e.payload ?? {});
      if (e.name === 'agentfootprint.skill.reroute_superseded') superseded.push(e.payload ?? {});
      if (e.name === 'agentfootprint.skill.route_conflict') conflicts.push(e.payload ?? {});
      if (e.name === 'agentfootprint.stream.tool_end') toolEnds.push(e.payload ?? {});
    },
  };
  return { effects, evaluated, superseded, conflicts, toolEnds, rejections, recorder };
};

const buildAgent = (args: {
  replies: readonly unknown[];
  tools?: readonly unknown[];
  injections?: readonly Injection[];
  graph?: Parameters<InstanceType<typeof Object>['valueOf']> extends never
    ? never
    : ReturnType<typeof skillGraph>['build'] extends () => infer G
    ? G
    : never;
  options?: Record<string, unknown>;
  reactMode?: 'dynamic-grouped';
}) => {
  const caps = capture();
  let builder = Agent.create({
    provider: mock({ replies: args.replies as never }),
    model: 'mock',
    maxIterations: 6,
    ...(args.reactMode && { reactMode: args.reactMode }),
  }).system('s');
  for (const t of args.tools ?? []) builder = builder.tool(t as never);
  for (const inj of args.injections ?? []) builder = builder.injection(inj);
  if (args.graph) builder = builder.skillGraph(args.graph as never, args.options as never);
  const agent = builder.watch(caps.recorder).build();
  return { agent, ...caps };
};

const historyOf = (
  agent: Agent,
): ReadonlyArray<{ role: string; content: string; toolName?: string }> =>
  (
    agent.getLastSnapshot()?.sharedState as {
      history: Array<{ role: string; content: string; toolName?: string }>;
    }
  ).history;

const cursorMoveOf = (evaluated: Ev): { by?: string; to?: string } | undefined =>
  (evaluated as { cursorMove?: { by?: string; to?: string } }).cursorMove;

/** triage (entry) → model edge to billing: billing reachable from triage. */
const hopGraph = () => {
  const triage = skill('triage');
  return skillGraph().entry(triage).route(triage, skill('billing')).build();
};

const propose = (target: string, reason = 'the data says so') => ({
  kind: 'propose-transition' as const,
  targetSkillId: target,
  reason,
});

// ─────────────────────────────────────────────────────────────────────────
// Unit — envelope recognition is STRICT (the zero-delta boundary)
// ─────────────────────────────────────────────────────────────────────────

describe('unit: readToolResultEnvelope', () => {
  it('recognizes { content, effects } and { content, effects: [], status }', () => {
    const withEffect = readToolResultEnvelope({ content: 'x', effects: [propose('a')] });
    expect(withEffect?.content).toBe('x');
    expect(withEffect?.effects).toHaveLength(1);
    const statusOnly = readToolResultEnvelope({ content: 'x', effects: [], status: 'denied' });
    expect(statusOnly?.status).toBe('denied');
  });

  it('declines everything tools return today — strings, arrays, plain objects, {content} alone', () => {
    expect(readToolResultEnvelope('plain string')).toBeUndefined();
    expect(readToolResultEnvelope(['a', 'b'])).toBeUndefined();
    expect(readToolResultEnvelope({ rows: 3 })).toBeUndefined();
    // {content} alone is DATA — unwrapping it would change existing bytes.
    expect(readToolResultEnvelope({ content: 'x' })).toBeUndefined();
    // An empty effects array with nothing else says nothing — data.
    expect(readToolResultEnvelope({ content: 'x', effects: [] })).toBeUndefined();
    // An extra key = a domain object, whatever the other keys look like.
    expect(
      readToolResultEnvelope({ content: 'x', effects: [propose('a')], extra: 1 }),
    ).toBeUndefined();
    // A domain "effects" vocabulary (unknown kind) = data, byte-identical.
    expect(readToolResultEnvelope({ content: 'x', effects: [{ kind: 'poison' }] })).toBeUndefined();
    // A status outside the closed six-value set = data.
    expect(readToolResultEnvelope({ content: 'x', effects: [], status: 'active' })).toBeUndefined();
  });

  it('a KNOWN kind with malformed fields is a recognized envelope with a named refusal — never half-applied', () => {
    const read = readToolResultEnvelope({
      content: 'x',
      effects: [{ kind: 'propose-transition' }, propose('ok')],
    });
    expect(read?.effects).toHaveLength(1);
    expect(read?.malformed).toHaveLength(1);
    expect(read?.malformed[0]).toMatchObject({ kind: 'propose-transition' });
    expect(read?.malformed[0]!.refusalReason).toContain('names no targetSkillId');
    const badLease = readToolResultEnvelope({
      content: 'x',
      effects: [{ kind: 'require-instruction', instructionId: 'i', deliveryLease: 'forever' }],
    });
    expect(badLease?.malformed[0]!.refusalReason).toContain('not a lease this library has');
  });

  it("the exported type IS the recognizer's contract — `effects` is required, status-only is `effects: []`", () => {
    // Anything assignable to ToolResultEnvelope must be recognized — the
    // minimal status-only envelope spells its marker as an empty array.
    const statusOnly: ToolResultEnvelope = {
      content: 'refund blocked',
      effects: [],
      status: 'denied',
    };
    expect(readToolResultEnvelope(statusOnly)?.status).toBe('denied');
    // The near-miss the type now refuses to compile: status without the
    // effects marker. At runtime it stays DATA — but the miss is named.
    // @ts-expect-error — `effects` is required: it is the envelope marker itself
    const nearMiss: ToolResultEnvelope = { content: 'refund blocked', status: 'denied' };
    expect(readToolResultEnvelope(nearMiss)).toBeUndefined();
    const teaching = explainStatusOnlyNearMiss(nearMiss);
    expect(teaching).toContain('effects: []');
    expect(teaching).toContain('denied');
    // NOT near-misses — plain data shapes never draw the warning.
    expect(explainStatusOnlyNearMiss({ content: 'x', status: 'active' })).toBeUndefined();
    expect(explainStatusOnlyNearMiss({ content: 'x' })).toBeUndefined();
    expect(explainStatusOnlyNearMiss({ content: 'x', status: 'denied', rows: 3 })).toBeUndefined();
    expect(
      explainStatusOnlyNearMiss({ content: 'x', effects: [], status: 'denied' }),
    ).toBeUndefined();
    expect(explainStatusOnlyNearMiss('denied')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — propose-transition under the graph's own law
// ─────────────────────────────────────────────────────────────────────────

describe('functional: propose-transition', () => {
  it('an accepted proposal moves the cursor on the next evaluation — by "tool-proposal", body active, model reads the content', async () => {
    const { agent, effects, evaluated } = buildAgent({
      replies: [call('diagnose', 't1'), final('done')],
      tools: [effectTool('diagnose', { content: 'crc high', effects: [propose('billing')] })],
      graph: hopGraph(),
    });
    await agent.run({ message: 'help' });
    expect(effects).toEqual([
      expect.objectContaining({
        kind: 'propose-transition',
        outcome: 'accepted',
        toolName: 'diagnose',
        targetSkillId: 'billing',
        reason: 'the data says so',
      }),
    ]);
    const hop = cursorMoveOf(evaluated[1]!);
    expect(hop).toMatchObject({ by: 'tool-proposal', to: 'billing' });
    expect(evaluated[1]!.activeIds).toContain('billing');
    // The model read the CONTENT, not the envelope.
    const toolMsg = historyOf(agent).find((m) => m.role === 'tool' && m.toolName === 'diagnose');
    expect(toolMsg?.content).toBe('crc high');
  });

  it('the same pin holds in the dynamic-grouped chart', async () => {
    const { agent, evaluated } = buildAgent({
      replies: [call('diagnose', 't1'), final('done')],
      tools: [effectTool('diagnose', { content: 'crc high', effects: [propose('billing')] })],
      graph: hopGraph(),
      reactMode: 'dynamic-grouped',
    });
    await agent.run({ message: 'help' });
    expect(cursorMoveOf(evaluated[1]!)).toMatchObject({ by: 'tool-proposal', to: 'billing' });
  });

  it('an UNREACHABLE target is a teaching refusal: recorded, model-visible, cursor unmoved', async () => {
    const { agent, effects, evaluated } = buildAgent({
      replies: [call('diagnose', 't1'), final('done')],
      tools: [effectTool('diagnose', { content: 'hm', effects: [propose('vault')] })],
      // vault is registered + wired FROM billing — not reachable from triage.
      graph: (() => {
        const triage = skill('triage');
        const billing = skill('billing');
        return skillGraph()
          .entry(triage)
          .route(billing, skill('vault'))
          .route(triage, billing)
          .build();
      })(),
    });
    await agent.run({ message: 'help' });
    expect(effects[0]).toMatchObject({
      kind: 'propose-transition',
      outcome: 'refused',
      targetSkillId: 'vault',
    });
    expect(String(effects[0]!.refusalReason)).toContain('not reachable');
    const toolMsg = historyOf(agent).find((m) => m.role === 'tool' && m.toolName === 'diagnose');
    expect(toolMsg?.content).toContain('[tool effect refused:');
    expect(cursorMoveOf(evaluated[1]!)?.by).toBe('stay');
  });

  it('a same-batch DECLARED edge still wins — reroute_superseded { source: "tool-proposal" }', async () => {
    const triage = skill('triage');
    const graph = skillGraph()
      .entry(triage)
      .route(triage, skill('shipping'), { onToolReturn: 'diagnose' })
      .route(triage, skill('billing'))
      .build();
    const { agent, effects, superseded, evaluated } = buildAgent({
      replies: [call('diagnose', 't1'), final('done')],
      tools: [effectTool('diagnose', { content: 'hm', effects: [propose('billing')] })],
      graph,
    });
    await agent.run({ message: 'help' });
    // Accepted at the gate…
    expect(effects[0]).toMatchObject({ outcome: 'accepted', targetSkillId: 'billing' });
    // …and outrun by the author's edge, on the record.
    expect(cursorMoveOf(evaluated[1]!)).toMatchObject({ by: 'route', to: 'shipping' });
    expect(superseded).toEqual([
      expect.objectContaining({
        volunteeredId: 'billing',
        wonId: 'shipping',
        source: 'tool-proposal',
      }),
    ]);
  });

  it('conflicting same-batch proposals: first accepted wins, the rest suppressed + one route_conflict aggregate', async () => {
    const triage = skill('triage');
    const graph = skillGraph()
      .entry(triage)
      .route(triage, skill('billing'))
      .route(triage, skill('shipping'))
      .build();
    const { agent, effects, conflicts, evaluated } = buildAgent({
      replies: [
        batch([
          { name: 'toolA', id: 'a' },
          { name: 'toolB', id: 'b' },
        ]),
        final('done'),
      ],
      tools: [
        effectTool('toolA', { content: 'a', effects: [propose('billing', 'A says')] }),
        effectTool('toolB', { content: 'b', effects: [propose('shipping', 'B says')] }),
      ],
      graph,
    });
    await agent.run({ message: 'help' });
    expect(effects).toEqual([
      expect.objectContaining({ outcome: 'accepted', targetSkillId: 'billing' }),
      expect.objectContaining({
        outcome: 'superseded',
        targetSkillId: 'shipping',
        supersededBy: 'earlier-proposal',
      }),
    ]);
    expect(conflicts).toEqual([
      expect.objectContaining({
        source: 'tool-proposal',
        winner: expect.objectContaining({ toolName: 'toolA', target: 'billing' }),
        losers: [expect.objectContaining({ toolName: 'toolB', target: 'shipping' })],
      }),
    ]);
    expect(cursorMoveOf(evaluated[1]!)).toMatchObject({ by: 'tool-proposal', to: 'billing' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Security — posture independence, and the ONE law that does bind a proposal
// ─────────────────────────────────────────────────────────────────────────

describe('security: posture independence', () => {
  // A posture governs the MODEL's routing door only. A proposal is the tool
  // author's own deterministic code, so the graph checks it for reachability
  // and nothing else — under every posture, `rails` included. These pin that
  // as a DECISION: reversing it (teaching `applyToolEffects` to read
  // `skillStrictness`) turns them red rather than passing quietly.
  for (const strictness of ['guard', 'rails'] as const) {
    it(`${strictness} admits an accepted proposal — a tool is framework-tier evidence, not a model pick`, async () => {
      const { agent, evaluated, effects, rejections } = buildAgent({
        replies: [call('diagnose', 't1'), final('done')],
        tools: [effectTool('diagnose', { content: 'x', effects: [propose('billing')] })],
        graph: hopGraph(),
        options: { strictness },
      });
      await agent.run({ message: 'help' });
      expect(cursorMoveOf(evaluated[1]!)).toMatchObject({ by: 'tool-proposal', to: 'billing' });
      expect(effects).toEqual([
        expect.objectContaining({ outcome: 'accepted', targetSkillId: 'billing' }),
      ]);
      // No posture refusal anywhere: the gate that owns `skillStrictness`
      // was never on this path.
      expect(rejections).toEqual([]);
    });
  }

  it('the reachability law still binds under rails — an unreachable proposal is refused', async () => {
    // The exemption is from the POSTURE, not from the graph. Without this,
    // "postures don't apply" could be read as "nothing applies".
    const { agent, effects, evaluated } = buildAgent({
      replies: [call('diagnose', 't1'), final('done')],
      tools: [effectTool('diagnose', { content: 'x', effects: [propose('warehouse')] })],
      graph: hopGraph(),
      options: { strictness: 'rails' },
    });
    await agent.run({ message: 'help' });
    expect(effects[0]).toMatchObject({ outcome: 'refused', targetSkillId: 'warehouse' });
    expect(String(effects[0]!.refusalReason)).toContain('is not reachable from');
    expect(cursorMoveOf(evaluated[1]!)?.by).not.toBe('tool-proposal');
  });

  it('STATED: the tool exemption is documented where the posture is declared', async () => {
    // The exemption is deliberate, but an author meets `strictness` at its
    // own definition site and nowhere else. If the door is left open, the
    // docstring there has to say so — a reader who mounts `'rails'` expecting
    // "nothing but my declared selection routes" is otherwise wrong on the
    // strength of what we wrote. This is the doc half of the decision, and it
    // is load-bearing enough to fail the suite when it goes missing.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../src/core/agent/AgentBuilder.ts', import.meta.url),
      'utf8',
    );
    expect(src).toContain('A `propose-transition` tool effect. A proposal comes from a TOOL');
    expect(src).toContain('admitted under `assist`, `guard` AND');
  });

  it('no graph mounted → teaching refusal, recorded', async () => {
    const { agent, effects } = buildAgent({
      replies: [call('diagnose', 't1'), final('done')],
      tools: [effectTool('diagnose', { content: 'x', effects: [propose('anywhere')] })],
    });
    await agent.run({ message: 'help' });
    expect(effects[0]).toMatchObject({ kind: 'propose-transition', outcome: 'refused' });
    expect(String(effects[0]!.refusalReason)).toContain('needs a mounted skill graph');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — require-instruction leases
// ─────────────────────────────────────────────────────────────────────────

const pushEffect = (instructionId: string, deliveryLease: 'next-call' | 'until-skill-exit') => ({
  kind: 'require-instruction' as const,
  instructionId,
  deliveryLease,
});

describe('integration: require-instruction leases', () => {
  const wireFormat = () =>
    defineInstruction({
      id: 'wire-format',
      prompt: 'ALWAYS answer as JSON.',
      activeWhen: () => false, // never active on its own — only the push serves it
    });

  it("'next-call' delivers the instruction into exactly the NEXT call, then expires", async () => {
    const { agent, effects, evaluated } = buildAgent({
      replies: [call('fetch', 't1'), call('calc', 't2'), final('done')],
      tools: [
        effectTool('fetch', { content: 'ok', effects: [pushEffect('wire-format', 'next-call')] }),
        effectTool('calc', 'calc ran'),
      ],
      injections: [wireFormat()],
    });
    await agent.run({ message: 'help' });
    expect(effects[0]).toMatchObject({
      kind: 'require-instruction',
      outcome: 'accepted',
      instructionId: 'wire-format',
      deliveryLease: 'next-call',
    });
    expect(evaluated[0]!.activeIds).not.toContain('wire-format'); // before the grant
    expect(evaluated[1]!.activeIds).toContain('wire-format'); // the leased call
    expect(evaluated[2]!.activeIds).not.toContain('wire-format'); // expired
  });

  it("'until-skill-exit' holds while the granting tenure does, and dies on the cursor move", async () => {
    const triage = skill('triage');
    const graph = skillGraph()
      .entry(triage)
      .route(triage, skill('billing'), { onToolReturn: 'go' })
      .build();
    const { agent, evaluated } = buildAgent({
      replies: [call('fetch', 't1'), call('calc', 't2'), call('go', 't3'), final('done')],
      tools: [
        effectTool('fetch', {
          content: 'ok',
          effects: [pushEffect('wire-format', 'until-skill-exit')],
        }),
        effectTool('calc', 'calc ran'),
        effectTool('go', 'went'),
      ],
      injections: [wireFormat()],
      graph,
    });
    await agent.run({ message: 'help' });
    expect(evaluated[1]!.activeIds).toContain('wire-format'); // tenure: triage
    expect(evaluated[2]!.activeIds).toContain('wire-format'); // still triage
    // The 'go' batch routed to billing — the granting tenure ended.
    expect(cursorMoveOf(evaluated[3]!)).toMatchObject({ by: 'route', to: 'billing' });
    expect(evaluated[3]!.activeIds).not.toContain('wire-format');
  });

  it("'until-skill-exit' death is PERMANENT — re-entering the granting skill on a cyclic graph resurrects nothing", async () => {
    // The trap: validity is `lease.skillId === tenant`, and on a cycle the
    // tenant comes BACK. Without the Evaluate tenure sweep the dead lease
    // would match again under a tenure that never granted it.
    const triage = skill('triage');
    const billing = skill('billing');
    const graph = skillGraph()
      .entry(triage)
      .route(triage, billing, { onToolReturn: 'go' })
      .route(billing, triage, { onToolReturn: 'back' })
      .build();
    const { agent, evaluated } = buildAgent({
      replies: [
        call('fetch', 't1'),
        call('go', 't2'),
        call('back', 't3'),
        call('calc', 't4'),
        final('done'),
      ],
      tools: [
        effectTool('fetch', {
          content: 'ok',
          effects: [pushEffect('wire-format', 'until-skill-exit')],
        }),
        effectTool('go', 'went'),
        effectTool('back', 'returned'),
        effectTool('calc', 'calc ran'),
      ],
      injections: [wireFormat()],
      graph,
    });
    await agent.run({ message: 'help' });
    expect(evaluated[1]!.activeIds).toContain('wire-format'); // tenure: triage
    // The 'go' batch routed to billing — the granting tenure ended...
    expect(cursorMoveOf(evaluated[2]!)).toMatchObject({ by: 'route', to: 'billing' });
    expect(evaluated[2]!.activeIds).not.toContain('wire-format');
    // ...and the 'back' batch re-entered triage: a NEW tenure of the same
    // skill, which never granted anything. Dead stays dead.
    expect(cursorMoveOf(evaluated[3]!)).toMatchObject({ by: 'route', to: 'triage' });
    expect(evaluated[3]!.activeIds).not.toContain('wire-format');
    expect(evaluated[4]!.activeIds).not.toContain('wire-format');
    // The sweep removed the record itself the pass the tenure ended.
    const state = agent.getLastSnapshot()?.sharedState as {
      instructionLeases?: readonly unknown[];
    };
    expect(state.instructionLeases).toEqual([]);
  });

  it('an UNKNOWN instruction id is refused teachingly — the push door serves the declared catalog only', async () => {
    const { agent, effects } = buildAgent({
      replies: [call('fetch', 't1'), final('done')],
      tools: [effectTool('fetch', { content: 'ok', effects: [pushEffect('ghost', 'next-call')] })],
      injections: [wireFormat()],
    });
    await agent.run({ message: 'help' });
    expect(effects[0]).toMatchObject({
      kind: 'require-instruction',
      outcome: 'refused',
      instructionId: 'ghost',
    });
    expect(String(effects[0]!.refusalReason)).toContain('no registered injection');
    const toolMsg = historyOf(agent).find((m) => m.role === 'tool' && m.toolName === 'fetch');
    expect(toolMsg?.content).toContain('[tool effect refused:');
  });

  it("a 'tool-only' skill body cannot be pushed — its declared channel is the pull door", async () => {
    const { agent, effects } = buildAgent({
      replies: [call('fetch', 't1'), final('done')],
      tools: [
        effectTool('fetch', { content: 'ok', effects: [pushEffect('secretive', 'next-call')] }),
      ],
      injections: [skill('secretive', { surfaceMode: 'tool-only' })],
    });
    await agent.run({ message: 'help' });
    expect(effects[0]).toMatchObject({ outcome: 'refused', instructionId: 'secretive' });
    expect(String(effects[0]!.refusalReason)).toContain("surfaceMode 'tool-only'");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — outcome-status routing (onToolStatus)
// ─────────────────────────────────────────────────────────────────────────

describe('integration: onToolStatus routing', () => {
  const statusGraph = () => {
    const support = skill('support');
    return skillGraph()
      .entry(support)
      .route(support, skill('escalation'), { onToolReturn: 'refund', onToolStatus: 'denied' })
      .build();
  };

  const refundTool = (status?: string) =>
    effectTool(
      'refund',
      status === undefined
        ? 'refund attempted'
        : { content: 'refund attempted', effects: [], status },
    );

  it("a 'denied' result routes on MEANING — the edge fires, tool_end carries the status", async () => {
    const { agent, evaluated, toolEnds } = buildAgent({
      replies: [call('refund', 't1'), final('done')],
      tools: [refundTool('denied')],
      graph: statusGraph(),
    });
    await agent.run({ message: 'refund' });
    expect(cursorMoveOf(evaluated[1]!)).toMatchObject({ by: 'route', to: 'escalation' });
    expect(evaluated[1]!.activeIds).toContain('escalation');
    expect(toolEnds[0]).toMatchObject({ status: 'denied' });
  });

  it("a 'success' result must NOT route like a denial — and a result with NO status never matches a status edge", async () => {
    for (const variant of ['success', undefined] as const) {
      const { agent, evaluated } = buildAgent({
        replies: [call('refund', 't1'), final('done')],
        tools: [refundTool(variant)],
        graph: statusGraph(),
      });
      await agent.run({ message: 'refund' });
      expect(cursorMoveOf(evaluated[1]!)?.by).toBe('stay');
      expect(evaluated[1]!.activeIds).not.toContain('escalation');
    }
  });

  it('onToolStatus composes with onToolReturn: another tool with the same status does not fire the edge', async () => {
    const { agent, evaluated } = buildAgent({
      replies: [call('lookup', 't1'), final('done')],
      tools: [effectTool('lookup', { content: 'no', effects: [], status: 'denied' })],
      graph: statusGraph(),
    });
    await agent.run({ message: 'refund' });
    expect(cursorMoveOf(evaluated[1]!)?.by).toBe('stay');
  });

  it('a status-only edge (no tool name) fires on any tool declaring that status', async () => {
    const support = skill('support');
    const graph = skillGraph()
      .entry(support)
      .route(support, skill('retry-desk'), { onToolStatus: ['failure', 'partial'] })
      .build();
    const { agent, evaluated } = buildAgent({
      replies: [call('lookup', 't1'), final('done')],
      tools: [effectTool('lookup', { content: 'meh', effects: [], status: 'partial' })],
      graph,
    });
    await agent.run({ message: 'x' });
    expect(cursorMoveOf(evaluated[1]!)).toMatchObject({ by: 'route', to: 'retry-desk' });
  });

  it("route refusals: 'when' + 'onToolStatus' is a contradiction; an empty status set is dead wiring", () => {
    const a = skill('a');
    const b = skill('b');
    expect(() =>
      skillGraph()
        .entry(a)
        .route(a, b, { when: () => true, onToolStatus: 'denied' } as never)
        .build(),
    ).toThrow(/sets both 'when' and 'onToolStatus'/);
    const a2 = skill('a2');
    const b2 = skill('b2');
    expect(() =>
      skillGraph()
        .entry(a2)
        .route(a2, b2, { onToolStatus: [] as never })
        .build(),
    ).toThrow(/onToolStatus: \[\]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — zero-delta for every tool that never opted in
// ─────────────────────────────────────────────────────────────────────────

describe('regression: zero-delta', () => {
  it('plain tools: no effect events, no status anywhere, no new state keys — and {content} alone stays JSON', async () => {
    const { agent, effects, toolEnds } = buildAgent({
      replies: [
        batch([
          { name: 'plain', id: 'p1' },
          { name: 'shaped', id: 'p2' },
        ]),
        final('done'),
      ],
      tools: [
        effectTool('plain', 'just text'),
        // {content} alone is DATA — it must stringify exactly as before.
        effectTool('shaped', { content: 'x' }),
      ],
      graph: hopGraph(),
    });
    await agent.run({ message: 'help' });
    expect(effects).toHaveLength(0);
    expect(toolEnds.every((t) => !('status' in t))).toBe(true);
    const state = agent.getLastSnapshot()?.sharedState as Record<string, unknown>;
    expect('pendingToolTransition' in state).toBe(false);
    expect('instructionLeases' in state).toBe(false);
    const batchEntries = state.toolResults as Array<Record<string, unknown>>;
    expect(batchEntries.every((r) => !('status' in r))).toBe(true);
    const shaped = historyOf(agent).find((m) => m.toolName === 'shaped');
    expect(shaped?.content).toBe(JSON.stringify({ content: 'x' }));
  });

  it('a status-only result MISSING its effects marker stays data — and dev mode names the dropped `effects: []`', async () => {
    // The trap: an author writes { content, status } (no effects) expecting
    // the status to route. It must NOT half-work — data path, no status,
    // no effect events — and it must NOT fail silently: dev mode teaches.
    enableDevMode();
    const warnings: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      warnings.push(a.map(String).join(' '));
    });
    try {
      const { agent, effects, toolEnds } = buildAgent({
        replies: [call('refund', 't1'), final('done')],
        tools: [effectTool('refund', { content: 'refund blocked', status: 'denied' })],
      });
      await agent.run({ message: 'help' });
      // Data path, byte-for-byte: the whole object stringifies into the result.
      const msg = historyOf(agent).find((m) => m.role === 'tool' && m.toolName === 'refund');
      expect(msg?.content).toBe(JSON.stringify({ content: 'refund blocked', status: 'denied' }));
      // The status never became evidence — no events, nothing on tool_end.
      expect(effects).toHaveLength(0);
      expect(toolEnds.every((t) => !('status' in t))).toBe(true);
      // ...but the miss was NAMED, with the fix in the sentence.
      const warned = warnings.join('\n');
      expect(warned).toContain("tool 'refund'");
      expect(warned).toContain('effects: []');
    } finally {
      spy.mockRestore();
      disableDevMode();
    }
  });
});
