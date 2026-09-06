/**
 * 23 — Time travel: scrub a finished run by MILESTONE, not by stage.
 *
 * A finished agent run is a commit log: one bundle per executed stage, in
 * order. footprintjs 9.17 opens a reader's cursor over it — `timeTravel` —
 * and takes a strategy that says where the cursor may rest. Its own strategy
 * stops on every stage, which is the truth and is unreadable: a two-turn run
 * commits forty of them, most named `context`, `sf-cache`, `sf-thinking`.
 *
 * agentfootprint knows which of those a person would scrub to, because
 * `milestoneFor` has classified stage ids into iteration / slot / llm-turn /
 * tool-call / decision for releases. `milestoneStopsStrategy` is that
 * classifier mapped onto the log, so the axis reads:
 *
 *   Run start → Iteration → System prompt → Messages → Tools → LLM turn →
 *   Route → Tool call → Iteration → … → Run end
 *
 * This example runs the SAME agent twice, one chart shape apart, and shows
 * where the turn lives in each:
 *
 *   reactMode: 'dynamic'          → the turn is a commit on the outer log, so
 *                                   the llm-turn stop is on the outer cursor
 *   reactMode: 'dynamic-grouped'  → the turn is a subflow with its own log, so
 *                                   the outer cursor stops on the ITERATION and
 *                                   `drill()` opens the turn's own cursor —
 *                                   read by the same strategy
 *
 * The agent carries a two-skill graph (alpha → beta, the hop taken when
 * `alpha_tool` returns), so the scrub has something to show: `stateAt` names
 * the skill the run was standing in at each turn, and `changedSince` names the
 * key that moved between them.
 *
 * Offline + deterministic: mock provider, no API key, no network.
 *
 * Run:  npx tsx examples/observability/23-time-travel-milestones.ts
 */

import { timeTravel } from 'footprintjs/trace';
import type { Stop, TimeTravel } from 'footprintjs/trace';
import {
  Agent,
  defineTool,
  milestoneOf,
  milestoneStops,
  milestoneStopsStrategy,
  type LLMResponse,
} from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/23-time-travel-milestones',
  title: 'Time travel — scrub a finished run by milestone',
  group: 'observability',
  description:
    "milestoneStopsStrategy turns agentfootprint's milestoneFor classifier into a footprintjs " +
    'TimeTravelStrategy, so `timeTravel(snapshot, { strategy })` stops on iteration / llm-turn / ' +
    'tool-call / decision instead of on all forty stages — on the outer log in dynamic mode, and ' +
    'one drill() down in dynamic-grouped.',
  defaultInput: 'go',
  providerSlots: [],
  tags: ['observability', 'time-travel', 'milestones', 'footprintjs', 'react-mode', 'skill-graph'],
};

const alphaTool = defineTool({
  name: 'alpha_tool',
  description: 'Look something up.',
  execute: () => 'alpha result',
});

const graph = () =>
  skillGraph({
    skills: [
      defineSkill({ id: 'alpha', description: 'opens the case', body: 'ALPHA_BODY' }),
      defineSkill({ id: 'beta', description: 'closes the case', body: 'BETA_BODY' }),
    ],
    start: 'alpha',
    steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
    check: 'off',
  });

/** One real run of the same agent at one chart shape. */
async function record(reactMode: 'dynamic' | 'dynamic-grouped') {
  const script: LLMResponse[] = [
    {
      content: '',
      toolCalls: [{ id: 'c1', name: 'alpha_tool', args: {} }],
      usage: { input: 1, output: 1 },
      stopReason: 'tool_use',
    },
    {
      content: 'done',
      toolCalls: [],
      usage: { input: 1, output: 1 },
      stopReason: 'end_turn',
    },
  ];
  let i = 0;
  const agent = Agent.create({
    provider: mock({ chunkDelayMs: 0, respond: () => script[i++] ?? script[1]! }),
    model: 'mock',
    maxIterations: 6,
    reactMode,
  })
    .system('You are a careful assistant.')
    .tool(alphaTool)
    .skillGraph(graph())
    .build();

  await agent.run({ message: 'go' });
  return agent.getSnapshot()!;
}

const skillAt = (cursor: TimeTravel, stop: Stop): string =>
  ((cursor.stateAt(stop).state as { currentSkillId?: string }).currentSkillId ?? '—');

/**
 * `changedSince` names keys by footprintjs's trace PATH, which joins nested
 * segments with U+001F (unit separator) — a real control character that a
 * terminal swallows, so `activeBy` + `slot` prints as one garbled word. Show
 * the path the way a person reads one.
 */
const readablePath = (key: string): string => key.split('\u001f').join('.');

function printAxis(cursor: TimeTravel, indent = '  '): void {
  for (const stop of cursor.stops) {
    const kind = milestoneOf(stop)?.kind ?? stop.kind;
    console.log(
      `${indent}${String(stop.step).padStart(2)}  ${stop.label.padEnd(14)} ${kind.padEnd(10)}` +
        `commits ${stop.commitIdx}..${stop.lastCommitIdx}`,
    );
  }
}

async function run(): Promise<void> {
  // ── 1. dynamic: the turn is a commit on the outer log ────────────────
  const flat = await record('dynamic');
  const outer = timeTravel(flat, { strategy: milestoneStopsStrategy });

  console.log(`\n=== reactMode: 'dynamic' — ${flat.commitLog.length} commits, ${outer.stops.length} stops`);
  printAxis(outer);

  const turns = outer.stops.filter((s) => milestoneOf(s)?.kind === 'llm-turn');
  console.log('\n  the skill the run was standing in, turn by turn:');
  for (const [n, turn] of turns.entries())
    console.log(`    turn ${n + 1} (${turn.runtimeStageId}) → ${skillAt(outer, turn)}`);

  outer.jumpTo(turns[1]!.step);
  console.log(
    `  changedSince(turn 1): ${outer.changedSince(turns[0]!).map(readablePath).join(', ')}`,
  );

  // A mark is the READER's note. It lives in the cursor, never in the log.
  outer.mark('the turn that called the tool', turns[0]!);
  outer.last();
  outer.jumpToMark('the turn that called the tool');
  console.log(`  jumped back to the mark: ${outer.at()!.runtimeStageId}`);

  // A miss never moves. `seed#0` really ran and really committed — it is just
  // not a milestone, so it is not a place this axis can stop.
  const missed = outer.jumpTo('seed#0');
  console.log(
    `  jumpTo('seed#0') → moved: ${missed.moved}` +
      (missed.moved ? '' : ` (${missed.reason}; still at ${outer.at()!.runtimeStageId})`),
  );

  // The strategy is one function with a name. When what you hold is a LOG
  // rather than a cursor — a recording read back from disk, a subflow's own
  // `history` — call `milestoneStops` directly and get the same axis; the
  // strategy is only that function handed to `timeTravel`, which is why the
  // two agree by construction rather than by luck.
  const direct = milestoneStops(flat.commitLog, flat.executionTree);
  const sameAxis = direct.every((s, i) => s.runtimeStageId === outer.stops[i]?.runtimeStageId);
  console.log(
    `\n  milestoneStops(commitLog, executionTree) called directly: ${direct.length} stops,` +
      ` same axis as the cursor: ${sameAxis}`,
  );

  // ── 2. dynamic-grouped: the turn is one drill down ───────────────────
  const grouped = await record('dynamic-grouped');
  const cursor = timeTravel(grouped, { strategy: milestoneStopsStrategy });

  console.log(
    `\n=== reactMode: 'dynamic-grouped' — ${grouped.commitLog.length} commits, ${cursor.stops.length} stops`,
  );
  printAxis(cursor);
  console.log(
    `\n  llm-turn stops on the OUTER axis: ${cursor.stops.filter((s) => milestoneOf(s)?.kind === 'llm-turn').length}` +
      ' — the turn committed to its own log, one drill down.',
  );

  for (const mount of cursor.stops.filter((s) => milestoneOf(s)?.kind === 'iteration')) {
    const inner = cursor.drill(mount.runtimeStageId)!;
    const turn = inner.stops.find((s) => milestoneOf(s)?.kind === 'llm-turn')!;
    const state = inner.stateAt(turn).state as {
      currentSkillId?: string;
      nextSkillCursor?: string;
    };
    console.log(`\n  drill ${mount.runtimeStageId} → ${inner.stops.length} stops of its own`);
    printAxis(inner, '    ');
    console.log(
      `    entered on ${state.currentSkillId ?? '—'}, settled on ${state.nextSkillCursor ?? '—'}` +
        ` (the outer axis reads ${skillAt(cursor, mount)} at this iteration)`,
    );
  }

  console.log(
    '\nTakeaway: one strategy, two chart shapes. The stops are DERIVED from the log — a\n' +
      'milestone that never committed gets no stop — and the settled skill cursor is on the\n' +
      "outer axis in both shapes, while the turn's own move is inside the drill.\n",
  );
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
