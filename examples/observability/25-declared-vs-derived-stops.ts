/**
 * 25 — Declared vs derived stops: the tag is the fact, the write set is the fallback.
 *
 * Since 9.90.0 every milestone the agent's charts know — iteration, LLM turn,
 * tool call, decision — is DECLARED on the stage at build time and stamped by
 * footprintjs 9.21 on the stage's first commit bundle (`CommitBundle.tags`):
 *
 *   'milestone:llm-turn'          the kind — what a reader filters on
 *   'milestone-label:LLM turn'    the human word — what a reader shows
 *
 * So a stored recording carries its own milestones, and a reader needs NO id
 * conventions to find them: footprintjs's own `tagStops([...])` — a strategy
 * that has never heard of an agent — scrubs the run by `milestone:llm-turn`.
 * Before 9.90.0 the same axis came from `milestoneFor(runtimeStageId)`, a
 * switch that parses `#` and `/`; it is still there, as the FALLBACK for a
 * recording made before the charts declared anything.
 *
 * The other kind of mark is DERIVED: the reader computes it at read time from
 * what the log says happened, and never stores it. "The stops where
 * `currentSkillId` was written" is one — a keep rule over each stop's own
 * write set (`log[i].trace`), the same `filterStops` composition, no new API.
 * This example scrubs ONE real run both ways, prints both axes, and prints
 * the measured cost of each — plus the cost of the derivation everyone
 * reaches for first (a full `stateAt` fold per candidate stop), which is why
 * the declaration is the fact and the derivation is the fallback.
 *
 * The Map advertises the vocabulary too: `buildTimeStructure` lists the tags a
 * chart CAN produce before it has ever run, so a lens draws its legend first.
 *
 * Offline + deterministic: mock provider, no API key, no network.
 *
 * Run:  npx tsx examples/observability/25-declared-vs-derived-stops.ts
 */

import { commitStops, filterStops, tagStops, timeTravel } from 'footprintjs/trace';
import type { Stop, TimeTravelStrategy } from 'footprintjs/trace';
import type { CommitBundle, StageSnapshot } from 'footprintjs/advanced';
import {
  Agent,
  MILESTONE_TAG_PREFIX,
  defineTool,
  milestoneStopsStrategy,
  milestoneTag,
  type LLMResponse,
} from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/25-declared-vs-derived-stops',
  title: 'Declared vs derived stops — the tag is the fact',
  group: 'observability',
  description:
    "The agent's charts declare their milestones as footprintjs tags ('milestone:llm-turn'), so " +
    "footprintjs's own tagStops scrubs a recording with no id conventions; the same run scrubbed " +
    'by a DERIVED mark (a write-set predicate: stops where currentSkillId was written), with the ' +
    'measured cost of each — and of the fold-per-stop derivation that makes the declaration the fact.',
  defaultInput: 'go',
  providerSlots: [],
  tags: [
    'observability',
    'time-travel',
    'milestones',
    'declared-tags',
    'footprintjs',
    'skill-graph',
  ],
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

/** One real run: two turns, one tool call, the skill hop alpha → beta in between. */
async function record() {
  const script: LLMResponse[] = [
    {
      content: '',
      toolCalls: [{ id: 'c1', name: 'alpha_tool', args: {} }],
      usage: { input: 1, output: 1 },
      stopReason: 'tool_use',
    },
    { content: 'done', toolCalls: [], usage: { input: 1, output: 1 }, stopReason: 'end_turn' },
  ];
  let i = 0;
  const agent = Agent.create({
    provider: mock({ chunkDelayMs: 0, respond: () => script[i++] ?? script[1]! }),
    model: 'mock',
    maxIterations: 6,
    reactMode: 'dynamic',
  })
    .system('You are a careful assistant.')
    .tool(alphaTool)
    .skillGraph(graph())
    .build();

  await agent.run({ message: 'go' });
  return { agent, snapshot: agent.getSnapshot()! };
}

// ── the Map: what the chart CAN produce, before any run ──────────────

interface SpecNode {
  readonly id: string;
  readonly tags?: readonly string[];
  readonly children?: readonly SpecNode[];
  readonly next?: SpecNode;
  readonly subflowStructure?: SpecNode;
  readonly isLoopReference?: boolean;
}

function declaredTags(node: SpecNode | undefined, out = new Map<string, readonly string[]>()) {
  if (!node) return out;
  if (!node.isLoopReference && node.tags?.some((t) => t.startsWith(MILESTONE_TAG_PREFIX)))
    out.set(node.id, node.tags);
  for (const child of node.children ?? []) declaredTags(child, out);
  declaredTags(node.subflowStructure, out);
  declaredTags(node.next, out);
  return out;
}

// ── the derived axis: a keep rule over each stop's own write set ─────

/** The keys a stop's own commits wrote — the bundle(s) between commitIdx and lastCommitIdx on the per-stage axis. */
function writesOf(log: readonly CommitBundle[], stop: Stop<unknown>): readonly string[] {
  const paths = new Set<string>();
  for (let i = Math.max(stop.commitIdx, 0); i <= stop.lastCommitIdx; i++)
    for (const entry of log[i]?.trace ?? []) paths.add(entry.path);
  return [...paths];
}

/** A stop wherever `currentSkillId` was written — derived at read time, never stored. */
const skillWrittenStops: TimeTravelStrategy<readonly string[]> = {
  stopsFor: (log, tree) =>
    filterStops<readonly string[]>(commitStops(log, tree), (stop) => {
      const wrote = writesOf(log, stop).filter((p) => p === 'currentSkillId');
      return wrote.length > 0 ? { meta: wrote } : null;
    }),
};

/**
 * The derivation everyone reaches for first: keep the stop where the FOLD shows
 * a new skill. One full `stateAt` per candidate stop — the cost that makes a
 * declaration the fact and a derivation the fallback.
 */
function skillChangedByFold(snapshot: {
  commitLog: readonly CommitBundle[];
  executionTree?: StageSnapshot;
}): TimeTravelStrategy<string> {
  return {
    stopsFor: (log, tree) => {
      const perStage = timeTravel(snapshot, { strategy: { stopsFor: commitStops } });
      let last: string | undefined;
      return filterStops<string>(commitStops(log, tree), (stop) => {
        const at = perStage.stops.find((s) => s.commitIdx === stop.commitIdx);
        const skill = at
          ? (perStage.stateAt(at).state as { currentSkillId?: string }).currentSkillId
          : undefined;
        const changed = skill !== undefined && skill !== last;
        if (skill !== undefined) last = skill;
        return changed ? { meta: skill } : null;
      });
    },
  };
}

// ── measurement ──────────────────────────────────────────────────────

function measure(label: string, fn: () => unknown, rounds = 50): number {
  fn(); // warm
  const samples: number[] = [];
  for (let r = 0; r < rounds; r++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)]!;
  console.log(`  ${label.padEnd(58)} median ${median.toFixed(3)} ms  (${rounds} rounds)`);
  return median;
}

function printAxis(stops: readonly Stop<unknown>[], indent = '  '): void {
  for (const stop of stops) {
    const meta = stop.meta === undefined ? '' : JSON.stringify(stop.meta);
    console.log(
      `${indent}${String(stop.step).padStart(2)}  ${stop.label.padEnd(16)} ${stop.kind.padEnd(7)}` +
        `commits ${String(stop.commitIdx).padStart(2)}..${String(stop.lastCommitIdx).padEnd(
          3,
        )} ${meta}`,
    );
  }
}

async function run(): Promise<void> {
  const { agent, snapshot } = await record();
  const { commitLog: log, executionTree: tree } = snapshot;
  console.log(`\n=== one run, reactMode 'dynamic' — ${log.length} commits`);

  // ── 0. the Map advertises the vocabulary ───────────────────────────
  const legend = declaredTags(agent.getSpec().buildTimeStructure as unknown as SpecNode);
  console.log(`\n--- the Map: ${legend.size} stages declare a milestone (before any run)`);
  for (const [id, tags] of legend) console.log(`  ${id.padEnd(22)} ${tags.join(', ')}`);
  console.log('  (every milestone stage is declared — the selector-branch slot mounts included)');

  // ── 1. DECLARED: footprintjs's own tagStops, agentfootprint's vocabulary ──
  const turnTag = milestoneTag('llm-turn'); // 'milestone:llm-turn'
  const declared = timeTravel(snapshot, { strategy: tagStops([turnTag]) });
  console.log(`\n--- declared: tagStops(['${turnTag}']) — no agent id conventions in the reader`);
  printAxis(declared.stops);
  console.log(
    `  stop 1 carries the bundle's whole tag array as meta; 'start' says prologue: ${
      declared.stops[0]!.prologue
    }`,
  );

  // ── 2. DERIVED: a write-set predicate over each stop's own trace ───
  const derived = timeTravel(snapshot, { strategy: skillWrittenStops });
  console.log(`\n--- derived: stops where 'currentSkillId' was written (log[i].trace)`);
  printAxis(derived.stops);
  for (const stop of derived.stops.filter((s) => s.kind !== 'start' && s.kind !== 'end'))
    console.log(
      `    ${stop.runtimeStageId.padEnd(26)} → currentSkillId = ${
        (derived.stateAt(stop).state as { currentSkillId?: string }).currentSkillId ?? '—'
      }`,
    );

  // ── 3. the cost of each, measured on this run ──────────────────────
  console.log('\n--- cost, measured (strategy.stopsFor over this log)');
  const a = measure(`declared   tagStops(['${turnTag}'])`, () =>
    tagStops([turnTag]).stopsFor(log, tree),
  );
  const b = measure(`derived    write-set predicate on currentSkillId`, () =>
    skillWrittenStops.stopsFor(log, tree),
  );
  const c = measure(
    `derived    fold per candidate stop (stateAt)`,
    () => skillChangedByFold(snapshot).stopsFor(log, tree),
    10,
  );
  const m = measure(`agent      milestoneStopsStrategy (tag first, id fallback)`, () =>
    milestoneStopsStrategy.stopsFor(log, tree),
  );
  console.log(
    `  ratio: fold-per-stop / declared ≈ ${(c / Math.max(a, 0.001)).toFixed(0)}×;` +
      ` write-set / declared ≈ ${(b / Math.max(a, 0.001)).toFixed(1)}×;` +
      ` milestoneStops / declared ≈ ${(m / Math.max(a, 0.001)).toFixed(1)}×`,
  );

  console.log(
    '\nTakeaway: the declared axis stops where the AUTHOR said a turn is, and the recording\n' +
      'carries that fact — any reader, any library, `tagStops`. The derived axis stops where the\n' +
      'DATA moved, computed at read time and never stored; both are cheap over the write set, and\n' +
      'only the fold-per-stop derivation pays a full stateAt per candidate. That cost is why the\n' +
      'tag is the fact and the derivation is the fallback.\n',
  );
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
