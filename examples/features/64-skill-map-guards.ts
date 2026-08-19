/**
 * 64 — SkillMap & SkillWalker: guards-as-data on route edges (9.51.0).
 *
 * The official vocabulary, in one sentence: **you declare the SkillMap; the
 * agent is the SkillWalker; the recording carries both.**
 *
 *   DECLARE — `defineSkillMap` (a permanent alias of `skillGraph` — same
 *             function, both names forever): skills, edges, entry matchers,
 *             and — new in 9.51.0 — `guard:` conditions on route edges,
 *             declared as DATA instead of an opaque `when` predicate.
 *   ATTACH  — `.skillGraph(map)`. There is no SkillWalker class to build:
 *             the agent IS the walker, moving the cursor over your map.
 *   WATCH   — every recording carries the map (`skill.graph_declared`,
 *             guards included) and the walk (`cursorMove` on every
 *             iteration, with per-condition guard evidence when a guard
 *             decided a hop — taken OR refused).
 *
 * The walker moves by exactly three movers:
 *
 *   | mover  | who decides            | on the record                        |
 *   |--------|------------------------|--------------------------------------|
 *   | llm    | the model picks (gated)| by: 'model-pick'; refusals typed     |
 *   | guard  | YOUR DATA decides      | by: 'route' + cursorMove.guard       |
 *   | linear | no choice, every time  | by: 'route' (a bare tool hand-off)   |
 *
 * A guard is `{ key: { eq|ne|gt|gte|lt|lte|in|notIn: value } }`, every
 * condition ANDed (the grammar deliberately mirrors footprintjs's
 * WhereFilter). Six hop keys read the hop itself (toolName, result, status,
 * iteration, userMessage, currentSkillId); any other key reads the tool
 * result's top-level JSON field. Being data buys: the check-up PROVES
 * contradictions (`guard-unsatisfiable`), `toMermaid()` captions the edge,
 * the declared map carries the conditions, and every deciding evaluation
 * leaves evidence.
 *
 * Run:  npm run example examples/features/64-skill-map-guards.ts
 */

import { Agent, defineTool, type LLMProvider } from '../../src/index.js';
import { defineSkill, defineSkillMap, skillGraph, type SkillMap } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/64-skill-map-guards',
  title: 'SkillMap & SkillWalker — route-edge guards as data, evidence on every hop',
  group: 'features',
  description:
    'Declare the SkillMap with defineSkillMap — including a guard: edge judged as data — ' +
    'attach it (the agent is the SkillWalker), and watch the recording carry the map with ' +
    'its guard conditions and the walk with per-condition evidence, taken or refused.',
  defaultInput: 'Check the account and escalate if it looks risky.',
  providerSlots: ['default'],
  tags: ['features', 'skill-graph', 'skill-map', 'guards', 'routing', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

/** DECLARE — the SkillMap: three skills, three movers. */
function buildMap(): SkillMap {
  const triage = defineSkill({
    id: 'triage',
    description: 'first look at any request',
    body: 'Assess the account with assess_risk before doing anything else.',
  });
  const escalation = defineSkill({
    id: 'escalation',
    description: 'high-risk handling',
    body: 'Treat this as high risk. Confirm before any irreversible step.',
  });
  const wrapup = defineSkill({
    id: 'wrapup',
    description: 'close the case',
    body: 'Summarize what was found and close out.',
  });

  return defineSkillMap()
    .entry(triage, { match: { keywords: ['check', 'account'] } }) // entry matcher: data
    // The GUARD mover — your data decides. assess_risk returns JSON; the edge
    // fires only when that result's own fields say so. Comparable, drawable,
    // recorded — and judged with per-condition evidence.
    .route(triage, escalation, {
      onToolReturn: 'assess_risk',
      guard: { riskLevel: { in: ['high', 'critical'] }, score: { gte: 0.7 } },
    })
    // The LINEAR mover — no choice: whenever close_case returns, wrap up.
    .route(escalation, wrapup, { onToolReturn: 'close_case' })
    .build();
}

const assessRisk = (payload: string) =>
  defineTool({
    name: 'assess_risk',
    description: 'Assess the account risk; returns { riskLevel, score } as JSON.',
    execute: () => payload,
  });

/** A scripted mock walker: call assess_risk once, then answer. */
const script = (): LLMProvider => {
  let i = 0;
  return mock({
    respond: () =>
      ++i === 1
        ? {
            content: 'assessing risk',
            toolCalls: [{ id: 't1', name: 'assess_risk', args: {} }],
            stopReason: 'tool_use' as const,
          }
        : { content: 'Case handled.', toolCalls: [], stopReason: 'stop' as const },
  });
};

type MoveRecord = {
  to?: string;
  by?: string;
  guard?: { verdict: boolean; conditions: Array<Record<string, unknown>> };
  guardsClosed?: Array<{ to: string; verdict: boolean; conditions: Array<Record<string, unknown>> }>;
};

/** ATTACH + run once; capture the declared map and every cursor move. */
async function walk(toolPayload: string, provider?: LLMProvider) {
  const moves: MoveRecord[] = [];
  let declaredEdges: Array<Record<string, unknown>> = [];
  const agent = Agent.create({ provider: provider ?? script(), model: 'small-model', maxIterations: 4 })
    .system('You are the risk desk.')
    .tool(assessRisk(toolPayload))
    .skillGraph(buildMap()) // the agent is the SkillWalker
    .build();
  agent.on('agentfootprint.skill.graph_declared', (e) => {
    declaredEdges = (e.payload as unknown as { edges: Array<Record<string, unknown>> }).edges;
  });
  agent.on('agentfootprint.context.evaluated', (e) => {
    const m = (e.payload as { cursorMove?: MoveRecord }).cursorMove;
    if (m !== undefined) moves.push(m);
  });
  const answer = await agent.run({ message: meta.defaultInput ?? 'go' });
  if (typeof answer !== 'string') throw new Error('Agent paused unexpectedly.');
  return { answer, moves, declaredEdges };
}

export async function run(_input: string, provider?: LLMProvider): Promise<string> {
  const map = buildMap();

  // The map draws itself — the guarded edge captions its conditions.
  console.log('The SkillMap, drawn (toMermaid):');
  console.log(map.toMermaid().split('\n').map((l) => `   ${l}`).join('\n'));

  // The check-up PROVES a contradictory guard before any run exists.
  const t = defineSkill({ id: 't', description: 't', body: 't' });
  const u = defineSkill({ id: 'u', description: 'u', body: 'u' });
  try {
    skillGraph() // same function as defineSkillMap — both names, forever
      .entry(t)
      .route(t, u, { guard: { score: { gt: 5, lt: 3 } } })
      .build();
    throw new Error('the contradictory guard should have been refused');
  } catch (err) {
    const line = (err as Error).message.split('\n').find((l) => l.includes('guard-unsatisfiable'));
    console.log('\nA contradictory guard is refused at build (guard-unsatisfiable):');
    console.log(`   ${line?.trim() ?? ''}`);
    check(line !== undefined, 'the build refusal to name guard-unsatisfiable');
  }

  // ── Walk 1: the guard PASSES — the hop is taken, evidence on the move. ──
  const hot = await walk('{"riskLevel":"high","score":0.92}', provider);
  const taken = hot.moves.find((m) => m.by === 'route' && m.guard !== undefined);
  check(taken !== undefined, 'a guarded hop with evidence');
  check(taken!.to === 'escalation', 'the guard routed to escalation');
  console.log('\nWalk 1 — the guard PASSED (riskLevel high, score 0.92). cursorMove.guard:');
  for (const c of taken!.guard!.conditions) {
    console.log(
      `   ${String(c.key)} ${String(c.op)} ${JSON.stringify(c.value)} — saw ` +
        `"${String(c.actualSummary)}" → ${c.passed ? 'passed' : 'failed'}`,
    );
  }

  // The recording's SkillMap shows its guard conditions (skill.graph_declared).
  const guardedEdge = hot.declaredEdges.find((e) => e.to === 'escalation')!;
  check(guardedEdge.guard !== undefined, 'guard data on the declared map');
  console.log('\nThe declared map carries the guard (skill.graph_declared):');
  console.log(`   triage → escalation guard: ${JSON.stringify(guardedEdge.guard)}`);

  // ── Walk 2: the guard REFUSES — the refusal is on the record, cursor stays. ──
  const mild = await walk('{"riskLevel":"low","score":0.2}');
  const refused = mild.moves.find((m) => m.guardsClosed !== undefined);
  check(refused !== undefined, 'a recorded guard refusal');
  check(refused!.by === 'stay', 'the cursor stayed when the guard refused');
  check(mild.moves.every((m) => m.to !== 'escalation'), 'no hop to escalation on the mild run');
  console.log('\nWalk 2 — the guard REFUSED (riskLevel low, score 0.2). cursorMove.guardsClosed:');
  for (const c of refused!.guardsClosed![0]!.conditions) {
    console.log(
      `   ${String(c.key)} ${String(c.op)} ${JSON.stringify(c.value)} — saw ` +
        `"${String(c.actualSummary)}" → ${c.passed ? 'passed' : 'failed'}`,
    );
  }
  console.log(
    '\nSame map, same walker, two runs — and both records explain themselves:\n' +
      'the taken hop carries the evidence that opened it, the stay carries the\n' +
      'conditions that closed it. You declared the SkillMap; the agent walked it;\n' +
      'the recording carries both.',
  );

  return hot.answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
