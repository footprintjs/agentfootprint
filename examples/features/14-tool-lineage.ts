/**
 * 14 — Tool lineage: auto-derive the tool→tool DATA-FLOW graph.
 *
 * In a ReAct agent a tool's output goes back to the LLM as text, and the LLM
 * decides the NEXT tool's arguments — so the data dependency between tools never
 * touches footprintjs's shared scope, and `causalChain` can't reconstruct it.
 * Attach `toolLineageRecorder()` and it rebuilds the graph by VALUE PROVENANCE:
 * a distinctive value an earlier tool's RESULT produced that reappears in a
 * later tool's ARGS becomes an edge (producer → consumer).
 *
 * Run:  npx tsx examples/features/14-tool-lineage.ts
 */

import { Agent, defineTool, type LLMProvider } from '../../src/index.js'
import { mock } from '../../src/llm-providers.js';
import { toolLineageRecorder } from '../../src/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/14-tool-lineage',
  title: 'Tool lineage — auto-derive the tool→tool data-flow graph',
  group: 'features',
  description:
    "Attach toolLineageRecorder() to reconstruct which tool RESULT fed which later tool CALL, by value provenance — the data-flow graph causalChain can't see in a ReAct loop.",
  defaultInput: 'profile the initiator on fc1/3',
  providerSlots: ['default'],
  tags: ['feature', 'observability', 'lineage', 'tools'],
};

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  // Two CHAINED tools: get_flogi_database → (its FCID) → get_io_profile.
  const flogi = defineTool({
    name: 'get_flogi_database',
    description: 'Fabric login DB — returns the FCID logged into a port.',
    inputSchema: { type: 'object', properties: { port: { type: 'string' } }, required: ['port'] },
    execute: async () => ({ port: 'fc1/3', fcid: '0x650300', wwpn: '21:00:00:24:ff:4a:12:03' }),
  });
  const ioProfile = defineTool({
    name: 'get_io_profile',
    description: 'IO workload profile for an initiator FCID.',
    inputSchema: {
      type: 'object',
      properties: { initiator_id: { type: 'string' } },
      required: ['initiator_id'],
    },
    execute: async () => 'IOPS peaks 09:00-11:00; read-heavy',
  });

  // Scripted: turn 1 reads FLOGI; turn 2 profiles using the FCID it returned.
  let i = 0;
  const scripted =
    provider ??
    mock({
      respond: () => {
        i++;
        if (i === 1)
          return {
            content: 'Looking up the login.',
            toolCalls: [{ id: 'c1', name: 'get_flogi_database', args: { port: 'fc1/3' } }],
            stopReason: 'tool_use',
          };
        if (i === 2)
          return {
            content: 'Profiling that initiator.',
            toolCalls: [{ id: 'c2', name: 'get_io_profile', args: { initiator_id: '0x650300' } }],
            stopReason: 'tool_use',
          };
        return { content: 'Done — see the profile above.', toolCalls: [], stopReason: 'stop' };
      },
    });

  const lineage = toolLineageRecorder();
  const agent = Agent.create({ provider: scripted, model: 'mock', maxIterations: 5 })
    .system('You are a SAN triage assistant.')
    .tool(flogi)
    .tool(ioProfile)
    .recorder(lineage)
    .build();

  const answer = await agent.run({ message: input });

  // The derived data-flow graph — note the FCID edge causalChain could not see.
  const { nodes, edges } = lineage.getLineage();
  return {
    answer,
    tools: nodes.map((n) => n.toolName),
    lineage: edges.map((e) => `${e.from.toolName} --(${e.value})--> ${e.to.toolName}`),
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
