/**
 * The refusing result ceiling through the REAL Agent loop (9.20.0):
 * `defineTool({ resultCeiling })` REFUSES an oversized result teachingly
 * instead of truncating it — the model reads how to narrow and that NO data
 * came back, the oversized payload never enters context, history or any
 * event, and the RECORD keeps the true size (`tools.result_refused`) with
 * status `'invalid'` for `onToolStatus` routing.
 *
 * Sections follow Convention 3: Unit (definition-time refusals) · Functional
 * (the refusal shape + record truth) · Integration (status routing, effects
 * interplay, steps, resume) · Regression (zero-delta pins).
 */

import { describe, it, expect } from 'vitest';
import {
  Agent,
  defineTool,
  assertResultCeiling,
  checkInApproved,
  isPaused,
  type RunnerPauseOutcome,
} from '../../../src/index.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';

// ── Toolkit (the tool-effects harness, ceiling-flavored) ─────────────────

const skill = (id: string, over: Partial<Parameters<typeof defineSkill>[0]> = {}) =>
  defineSkill({ id, description: `use ${id}`, body: `${id} body`, ...over });

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

/** A payload comfortably over every ceiling in this file, with a marker
 *  substring no channel may ever carry once the ceiling refuses. */
const BIG = `SECRET_ROWS ${'x'.repeat(500)}`;

type Ev = Record<string, unknown>;
const capture = () => {
  const refused: Ev[] = [];
  const toolEnds: Ev[] = [];
  const effects: Ev[] = [];
  const evaluated: Ev[] = [];
  const advanced: Ev[] = [];
  const all: Array<{ name: string; payload: Ev }> = [];
  const recorder = {
    id: 'capture-ceiling',
    onEmit: (e: { name: string; payload?: Ev }) => {
      all.push({ name: e.name, payload: e.payload ?? {} });
      if (e.name === 'agentfootprint.tools.result_refused') refused.push(e.payload ?? {});
      if (e.name === 'agentfootprint.stream.tool_end') toolEnds.push(e.payload ?? {});
      if (e.name === 'agentfootprint.tools.effect') effects.push(e.payload ?? {});
      if (e.name === 'agentfootprint.context.evaluated') evaluated.push(e.payload ?? {});
      if (e.name === 'agentfootprint.skill.step_advanced') advanced.push(e.payload ?? {});
    },
  };
  return { refused, toolEnds, effects, evaluated, advanced, all, recorder };
};

const buildAgent = (args: {
  replies: readonly unknown[];
  tools?: readonly unknown[];
  graph?: unknown;
}) => {
  const caps = capture();
  let builder = Agent.create({
    provider: mock({ replies: args.replies as never }),
    model: 'mock',
    maxIterations: 6,
  }).system('s');
  for (const t of args.tools ?? []) builder = builder.tool(t as never);
  if (args.graph) builder = builder.skillGraph(args.graph as never);
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

// ─────────────────────────────────────────────────────────────────────────
// Unit — a ceiling that cannot cap is refused at definition, naming the fix
// ─────────────────────────────────────────────────────────────────────────

describe('unit: defineTool({ resultCeiling }) refusals', () => {
  const base = {
    name: 'export_orders',
    description: 'x',
    execute: () => 'ok',
  };

  it('maxChars must be a positive whole number — zero/negative/fractional/NaN are refused, naming the omission rule', () => {
    for (const bad of [0, -5, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => defineTool({ ...base, resultCeiling: { maxChars: bad } })).toThrow(
        /export_orders[\s\S]*positive whole number[\s\S]*omit `resultCeiling`/,
      );
    }
  });

  it('an empty narrowBy names nothing — refused, with "omit the field" as the honest spelling', () => {
    expect(() => defineTool({ ...base, resultCeiling: { maxChars: 100, narrowBy: [] } })).toThrow(
      /narrowBy[\s\S]*at least one parameter name[\s\S]*drop the field/,
    );
    expect(() =>
      defineTool({ ...base, resultCeiling: { maxChars: 100, narrowBy: ['  '] } }),
    ).toThrow(/narrowBy/);
  });

  it('assertResultCeiling is exported for hand-built Tool objects; a valid ceiling passes and rides the built tool', () => {
    expect(() => assertResultCeiling('t', { maxChars: 10, narrowBy: ['limit'] })).not.toThrow();
    expect(() => assertResultCeiling('t', undefined)).not.toThrow();
    const tool = defineTool({ ...base, resultCeiling: { maxChars: 64, narrowBy: ['limit'] } });
    expect(tool.resultCeiling).toEqual({ maxChars: 64, narrowBy: ['limit'] });
    // No ceiling declared → no key invented (absence is the fact).
    expect('resultCeiling' in defineTool(base)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — the refusal shape + the record's truth
// ─────────────────────────────────────────────────────────────────────────

describe('functional: the refusal replaces the payload; the record keeps the size', () => {
  const cappedTool = (result: unknown = BIG) =>
    defineTool<Record<string, never>, unknown>({
      name: 'export_orders',
      description: 'exports orders',
      inputSchema: { type: 'object', properties: {} },
      resultCeiling: { maxChars: 100, narrowBy: ['limit', 'fields'] },
      execute: () => result,
    });

  it('over the ceiling: the model reads the teaching refusal — size, ceiling, narrowBy, and "No data was returned"', async () => {
    const { agent, refused, toolEnds } = buildAgent({
      replies: [call('export_orders', 't1'), final('done')],
      tools: [cappedTool()],
    });
    await agent.run({ message: 'export' });
    const msg = historyOf(agent).find((m) => m.role === 'tool' && m.toolName === 'export_orders');
    expect(msg?.content).toContain('Result too large');
    expect(msg?.content).toContain(`${BIG.length} chars`);
    expect(msg?.content).toContain('100-char ceiling');
    expect(msg?.content).toContain("'limit', 'fields'");
    expect(msg?.content).toContain('No data was returned.');
    // The payload is in NO channel: not history, not tool_end, not any event.
    expect(msg?.content).not.toContain('SECRET_ROWS');
    expect(JSON.stringify(historyOf(agent))).not.toContain('SECRET_ROWS');
    expect(JSON.stringify(toolEnds)).not.toContain('SECRET_ROWS');
    // The record keeps the truth: the typed event carries the true size.
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      toolName: 'export_orders',
      toolCallId: 't1',
      sizeChars: BIG.length,
      maxChars: 100,
      narrowBy: ['limit', 'fields'],
    });
    // tool_end reports the refusal as the result, with the routing status.
    expect(toolEnds[0]).toMatchObject({ status: 'invalid' });
    expect(String((toolEnds[0] as { result?: unknown }).result)).toContain('Result too large');
    // Not an error: the tool ran fine — delivery was refused.
    expect('error' in toolEnds[0]!).toBe(false);
  });

  it('no channel anywhere carries the payload — the full event stream is clean', async () => {
    const { agent, all } = buildAgent({
      replies: [call('export_orders', 't1'), final('done')],
      tools: [cappedTool()],
    });
    await agent.run({ message: 'export' });
    expect(JSON.stringify(all)).not.toContain('SECRET_ROWS');
  });

  it('under the ceiling: byte-identical delivery, no event, no status', async () => {
    const { agent, refused, toolEnds } = buildAgent({
      replies: [call('export_orders', 't1'), final('done')],
      tools: [cappedTool('12 rows')],
    });
    await agent.run({ message: 'export' });
    const msg = historyOf(agent).find((m) => m.role === 'tool' && m.toolName === 'export_orders');
    expect(msg?.content).toBe('12 rows');
    expect(refused).toHaveLength(0);
    expect('status' in toolEnds[0]!).toBe(false);
  });

  it('without narrowBy the refusal still teaches the retry — just without parameter names', async () => {
    const bare = defineTool({
      name: 'dump',
      description: 'dumps',
      resultCeiling: { maxChars: 10 },
      execute: () => 'a'.repeat(50),
    });
    const { agent } = buildAgent({
      replies: [call('dump', 't1'), final('done')],
      tools: [bare],
    });
    await agent.run({ message: 'x' });
    const msg = historyOf(agent).find((m) => m.toolName === 'dump');
    expect(msg?.content).toContain('Narrow the request and call again.');
    expect(msg?.content).not.toContain('pass');
  });

  it('a non-string result is measured as the JSON the model would have read', async () => {
    const rows = { rows: Array.from({ length: 40 }, (_, i) => `row-${i}`) };
    const size = JSON.stringify(rows).length;
    const objTool = defineTool({
      name: 'rows',
      description: 'rows',
      resultCeiling: { maxChars: 50 },
      execute: () => rows,
    });
    const { agent, refused } = buildAgent({
      replies: [call('rows', 't1'), final('done')],
      tools: [objTool],
    });
    await agent.run({ message: 'x' });
    expect(refused[0]).toMatchObject({ sizeChars: size, maxChars: 50 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — status routing, effects interplay, steps, resume
// ─────────────────────────────────────────────────────────────────────────

describe('integration: the refusal routes, composes with effects, holds a step', () => {
  it("an onToolStatus: 'invalid' edge routes the overflow — the refusal is evidence, not just prose", async () => {
    const support = skill('support');
    const graph = skillGraph()
      .entry(support)
      .route(support, skill('narrow-desk'), { onToolStatus: 'invalid' })
      .build();
    const capped = defineTool({
      name: 'export_orders',
      description: 'x',
      resultCeiling: { maxChars: 20 },
      execute: () => BIG,
    });
    const { agent, evaluated } = buildAgent({
      replies: [call('export_orders', 't1'), final('done')],
      tools: [capped],
      graph,
    });
    await agent.run({ message: 'export' });
    expect(cursorMoveOf(evaluated[1]!)).toMatchObject({ by: 'route', to: 'narrow-desk' });
  });

  it('an envelope whose CONTENT overflows keeps its declared effects: the transition is judged, the payload is refused', async () => {
    const triage = skill('triage');
    const graph = skillGraph().entry(triage).route(triage, skill('billing')).build();
    const enveloped = defineTool({
      name: 'fetch',
      description: 'x',
      resultCeiling: { maxChars: 50 },
      execute: () => ({
        content: BIG,
        effects: [
          { kind: 'propose-transition' as const, targetSkillId: 'billing', reason: 'data says' },
        ],
        status: 'success' as const,
      }),
    });
    const { agent, refused, effects, evaluated, toolEnds } = buildAgent({
      replies: [call('fetch', 't1'), final('done')],
      tools: [enveloped],
      graph,
    });
    await agent.run({ message: 'go' });
    // The effect survived the overflow: accepted, and the cursor moved on it.
    expect(effects[0]).toMatchObject({
      kind: 'propose-transition',
      outcome: 'accepted',
      targetSkillId: 'billing',
    });
    expect(cursorMoveOf(evaluated[1]!)).toMatchObject({ by: 'tool-proposal', to: 'billing' });
    // The content did not: refusal in history, true size + declared status on
    // the record, delivered status 'invalid' (the model never received the
    // result the declared 'success' described).
    const msg = historyOf(agent).find((m) => m.toolName === 'fetch');
    expect(msg?.content).toContain('No data was returned.');
    expect(msg?.content).not.toContain('SECRET_ROWS');
    expect(refused[0]).toMatchObject({ sizeChars: BIG.length, declaredStatus: 'success' });
    expect(toolEnds[0]).toMatchObject({ status: 'invalid' });
  });

  it('a ceiling refusal does NOT advance a procedure step — the model was told to call again', async () => {
    const stepped = defineSkill({
      id: 'refund',
      description: 'refunds',
      body: 'Handle refunds.',
      tools: [
        defineTool({
          name: 'lookup',
          description: 'x',
          resultCeiling: { maxChars: 10 },
          execute: () => BIG,
        }),
        defineTool({ name: 'charge', description: 'x', execute: () => 'charged' }),
      ] as never,
      steps: [
        { tool: 'lookup', note: 'find the order' },
        { tool: 'charge', note: 'refund it' },
      ],
    });
    const graph = skillGraph().entry(stepped).build();
    const { agent, advanced } = buildAgent({
      // Steps remain unrun, so the turn's one teaching nudge re-asks once —
      // the pointer holding is exactly what this test asserts.
      replies: [call('lookup', 't1'), final('done'), final('done')],
      tools: [],
      graph,
    });
    await agent.run({ message: 'refund' });
    expect(advanced).toHaveLength(0); // the pointer held — no data, no step
    const msg = historyOf(agent).find((m) => m.toolName === 'lookup');
    expect(msg?.content).toContain('No data was returned.');
  });

  it('the resumed dispatch refuses exactly as an inline one — a check-in approval cannot smuggle an oversized result', async () => {
    const consequential = defineTool({
      name: 'export_all',
      description: 'x',
      checkIn: 'always',
      resultCeiling: { maxChars: 30, narrowBy: ['limit'] },
      execute: () => BIG,
    });
    const build = (replies: readonly unknown[]) => {
      const caps = capture();
      const agent = Agent.create({
        provider: mock({ replies: replies as never }),
        model: 'mock',
        maxIterations: 4,
      })
        .system('s')
        .tool(consequential)
        .watch(caps.recorder)
        .build();
      return { agent, ...caps };
    };
    const first = build([call('export_all', 't1'), final('done')]);
    const out = (await first.agent.run({ message: 'export' })) as RunnerPauseOutcome;
    expect(isPaused(out)).toBe(true);
    // The resumed side runs the APPROVED tool inline, then the loop asks the
    // LLM once more — its script is just the wrap-up.
    const second = build([final('done')]);
    await second.agent.resume(out.checkpoint, checkInApproved({ by: 'ops' }));
    // The approved tool RAN on the resume side — and its result was refused
    // there, with the same record truth and routing status.
    expect(second.refused).toHaveLength(1);
    expect(second.refused[0]).toMatchObject({
      toolName: 'export_all',
      sizeChars: BIG.length,
      maxChars: 30,
      narrowBy: ['limit'],
    });
    const msg = historyOf(second.agent).find((m) => m.toolName === 'export_all');
    expect(msg?.content).toContain('No data was returned.');
    expect(msg?.content).not.toContain('SECRET_ROWS');
    const end = second.toolEnds.find((t) => (t as { toolCallId?: string }).toolCallId === 't1');
    expect(end).toMatchObject({ status: 'invalid' });
    expect(JSON.stringify(second.all)).not.toContain('SECRET_ROWS');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — zero-delta pins
// ─────────────────────────────────────────────────────────────────────────

describe('regression: zero-delta without resultCeiling', () => {
  it('a tool with NO ceiling ships the huge result untouched — no event, no status, bytes as before', async () => {
    const free = defineTool({ name: 'export_orders', description: 'x', execute: () => BIG });
    const { agent, refused, toolEnds } = buildAgent({
      replies: [call('export_orders', 't1'), final('done')],
      tools: [free],
    });
    await agent.run({ message: 'export' });
    const msg = historyOf(agent).find((m) => m.toolName === 'export_orders');
    expect(msg?.content).toBe(BIG); // today's law, byte for byte
    expect(refused).toHaveLength(0);
    expect(toolEnds.every((t) => !('status' in t))).toBe(true);
  });

  it('an envelope tool with NO ceiling keeps 9.19 semantics untouched — declared status rides, content ships whole', async () => {
    const enveloped = defineTool({
      name: 'fetch',
      description: 'x',
      execute: () => ({ content: BIG, effects: [], status: 'success' as const }),
    });
    const { agent, refused, toolEnds } = buildAgent({
      replies: [call('fetch', 't1'), final('done')],
      tools: [enveloped],
    });
    await agent.run({ message: 'go' });
    expect(historyOf(agent).find((m) => m.toolName === 'fetch')?.content).toBe(BIG);
    expect(refused).toHaveLength(0);
    expect(toolEnds[0]).toMatchObject({ status: 'success' });
  });
});
