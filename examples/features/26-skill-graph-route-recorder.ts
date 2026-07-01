/**
 * 26 — Skill graph: routeRecorder + grey-area governors.
 *
 * WHY THIS EXISTS:
 * A run walked a path through the graph — which skill, then which, and WHY each hop.
 * `routeRecorder()` reconstructs that path by COMPOSING already-shipped events
 * (`context.evaluated` + `skill.rejected`) — a passive observer, no engine change. It
 * also folds in the grey-area GOVERNORS: `getTrips()` flags a spinning run (an
 * oscillation A→B→A→B, or a run of rejected `read_skill` jumps). This is the data the
 * lens, the "Why this skill?" panel, and paper route-figures read.
 *
 * Run:  npx tsx examples/features/26-skill-graph-route-recorder.ts
 */

import { Agent, defineTool, type LLMProvider } from '../../src/index.js'
import { defineSkill, skillGraph } from '../../src/injection-engine.js'
import { mock } from '../../src/llm-providers.js';
import { routeRecorder } from '../../src/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/26-skill-graph-route-recorder',
  title: 'Skill graph — routeRecorder + governors',
  group: 'features',
  description:
    'routeRecorder() records the skill path a run took (getPath/getHops) + rejected read_skill jumps (getRejections) + governor trips (getTrips: oscillation / rejected-cap), by composing the shipped context.evaluated + skill.rejected events. No engine change.',
  defaultInput: 'find the volume behind this vm',
  providerSlots: ['default'],
  tags: ['feature', 'skills', 'graph', 'observability', 'recorder'],
};

const sk = (id: string, body = `${id} body`) => defineSkill({ id, description: `use ${id}`, body });

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const probe = defineTool({
    name: 'get_vm_storage',
    description: 'storage backing a vm (returns a WWN)',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ array_wwn: 'naa.6000097' }),
  });
  // esxi-inventory unlocks the storage tool (it's available while that skill is active).
  const esxi = defineSkill({ id: 'esxi-inventory', description: 'use esxi-inventory', body: 'esxi', tools: [probe] });
  const volume = sk('volume-lookup', 'VOLUME');

  // esxi-inventory → volume-lookup when the storage tool returns a WWN.
  const graph = skillGraph()
    .entry(esxi)
    .route(esxi, volume, { when: (r) => r.toolName === 'get_vm_storage' && /wwn/i.test(r.result) })
    .build();

  // Part A — record the path a REAL run takes. The mock calls the storage tool
  // (→ routes into volume-lookup), then answers.
  let i = 0;
  const scripted =
    provider ??
    mock({
      respond: () => {
        i++;
        return i === 1
          ? { content: 'checking storage', toolCalls: [{ id: 't1', name: 'get_vm_storage', args: {} }], stopReason: 'tool_use' }
          : { content: 'the volume is LUN-42', toolCalls: [], stopReason: 'stop' };
      },
    });

  const routes = routeRecorder();
  const agent = Agent.create({ provider: scripted, model: 'mock', maxIterations: 5 })
    .system('You are a read-only SAN assistant.')
    .skillGraph(graph)
    .recorder(routes)
    .build();
  await agent.run({ message: input });

  // Part B — the governors. An oscillation is hard to script through a mock, so feed
  // the recorder the events a ping-ponging run WOULD emit (the same API the live run
  // uses) and show the trip it raises.
  const osc = routeRecorder({ pingPongWindow: 4 });
  const ev = (rt: string, it: number, routing: object[]) =>
    ({ name: 'agentfootprint.context.evaluated', runtimeStageId: rt, payload: { iteration: it, routing } }) as never;
  osc.onEmit(ev('s#1', 1, [{ injectionId: 'a', via: 'entry' }]));
  osc.onEmit(ev('s#2', 2, [{ injectionId: 'b', via: 'route', from: 'a' }]));
  osc.onEmit(ev('s#3', 3, [{ injectionId: 'a', via: 'route', from: 'b' }]));
  osc.onEmit(ev('s#4', 4, [{ injectionId: 'b', via: 'route', from: 'a' }])); // A→B→A→B → trip

  return {
    path: routes.getPath(), // ['esxi-inventory', 'volume-lookup']
    hops: routes.getHops().map((h) => `${h.outcome}: ${h.why}`),
    rejections: routes.getRejections().length, // 0 here (no out-of-reach jumps)
    governorTrips: osc.getTrips().map((t) => `${t.kind} — ${t.detail}`),
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
