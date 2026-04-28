/**
 * 06 — Flowchart with boundary payloads.
 *
 * Demonstrates the additive BoundaryRecorder integration: every `subflow`
 * StepNode now carries `entryPayload` (inputMapper result) and
 * `exitPayload` (subflow shared state at exit) — sourced from
 * footprintjs's `BoundaryRecorder` and bound by `runtimeStageId`.
 *
 * Why this matters: Lens's right-pane node-detail panel renders these
 * directly — the developer sees what context flowed IN at each subflow
 * boundary and what came OUT, without any post-walk on the consumer
 * side.
 *
 * Run:  npx tsx examples/features/06-flowchart-boundary-payloads.ts
 */

import { Agent, type LLMProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'v2/features/06-flowchart-boundary-payloads',
  title: 'Flowchart — subflow boundary payloads (entry/exit)',
  group: 'v2-features',
  description:
    'Every subflow StepNode carries entryPayload + exitPayload sourced from footprintjs BoundaryRecorder. Bound by runtimeStageId.',
  defaultInput: 'analyze the report',
  providerSlots: ['default'],
  tags: ['v2', 'feature', 'flowchart', 'observability', 'boundary'],
};

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  // 'feature' kind: smart mock auto-runs "tool call → final answer".
  const agent = Agent.create({
    provider: provider ?? exampleProvider('feature'),
    model: 'mock',
  })
    .system('You analyze reports.')
    .tool({
      schema: { name: 'analyze', description: '', inputSchema: { type: 'object' } },
      execute: () => 'q3 revenue up 12%',
    })
    .build();

  const handle = agent.enable.flowchart({});

  let answer: unknown;
  try {
    answer = await agent.run({ input });
  } finally {
    handle.unsubscribe();
  }

  const graph = handle.getSnapshot();

  console.log('\n── Subflow StepNodes (boundary-enriched) ──');
  const subflows = graph.nodes.filter((n) => n.kind === 'subflow');
  for (const n of subflows) {
    console.log(`\n${n.label.padEnd(20)} (${n.primitiveKind ?? '—'}) runtime=${n.runtimeStageId ?? '—'}`);
    if (n.entryPayload) {
      const keys = Object.keys(n.entryPayload);
      console.log(`  entryPayload keys: [${keys.join(', ')}]`);
    } else {
      console.log('  entryPayload: (none — no inputMapper or empty)');
    }
    if (n.exitPayload) {
      const keys = Object.keys(n.exitPayload);
      console.log(`  exitPayload  keys: [${keys.join(', ')}]`);
    } else {
      console.log('  exitPayload:  (none — subflow may be in-progress / paused)');
    }
  }

  console.log('\n── Cross-view binding ──');
  console.log('Each subflow node carries runtimeStageId — the same key Trace uses.');
  console.log('Lens hover/click: snap to the same stage in Trace, no separate id space.');

  return answer;
}

if (isCliEntry(import.meta.url)) {
  run('analyze the Q3 report')
    .then((r) => printResult(meta, r))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
