/**
 * 23 — Skill graph: scoped `read_skill` (stay on the trail).
 *
 * A skill graph is a state machine. `read_skill` is the model's escape hatch to
 * jump to another skill — but unbounded, it can jump ANYWHERE, defeating the graph.
 * This example shows the GATE: a `read_skill('id')` whose target is NOT reachable
 * from the current skill is REJECTED — the model gets a re-prompt naming the skills
 * it CAN reach, and the cursor stays put so it re-picks. Agents with no skillGraph
 * are unaffected.
 *
 * The graph (storage triage):
 *   triage ──on get_volume_by_wwn──▶ volume-lookup   (deterministic, cursor-gated)
 *   triage ┄┄(model edge)┄┄▶ inventory                (read_skill-reachable from triage)
 *   volume-lookup ──on get_audit──▶ audit-log         (reachable ONLY from volume-lookup)
 *
 * From `triage`, the reachable set is {volume-lookup, inventory}. So:
 *   • read_skill('audit-log')  → REJECTED (only reachable from volume-lookup)
 *   • read_skill('inventory')  → ALLOWED  (a model edge from triage) and activates
 *
 * Run:  npx tsx examples/features/16-skill-graph-scoped-read-skill.ts
 */

import { Agent, defineTool, type CombinedRecorder, type LLMProvider } from '../../src/index.js'
import { defineSkill, skillGraph } from '../../src/injection-engine.js'
import { mock } from '../../src/llm-providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/23-skill-graph-scoped-read-skill',
  title: 'Skill graph — scoped read_skill (stay on the trail)',
  group: 'features',
  description:
    'The read_skill gate bounds the model to skills reachable from the current cursor; an out-of-graph jump is rejected with a re-prompt naming the allowed skills. Plain read_skill agents are unaffected.',
  defaultInput: 'look up the volume behind wwn 50:06',
  providerSlots: ['default'],
  tags: ['feature', 'skills', 'routing', 'graph', 'read_skill'],
};

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const probe = defineTool({
    name: 'get_volume_by_wwn',
    description: 'Resolve a storage volume by WWN',
    inputSchema: { type: 'object', properties: { wwn: { type: 'string' } } },
    execute: async () => ({ lun: 'LUN-42', wwn: '50:06' }),
  });

  const triage = defineSkill({ id: 'triage', description: 'Start: triage the request', body: 'Triage it.' });
  const volumeLookup = defineSkill({
    id: 'volume-lookup',
    description: 'Resolve a volume by WWN',
    body: 'Use get_volume_by_wwn.',
    tools: [probe],
  });
  const inventory = defineSkill({ id: 'inventory', description: 'List hosts / VMs', body: 'Inventory it.' });
  const auditLog = defineSkill({ id: 'audit-log', description: 'Read the audit log', body: 'Read the audit.' });

  const graph = skillGraph()
    .entry(triage)
    .route(triage, volumeLookup, { onToolReturn: 'get_volume_by_wwn' }) // deterministic
    .route(triage, inventory) //                                           bare model edge
    .route(volumeLookup, auditLog, { onToolReturn: 'get_audit' }) //       reachable only from volume-lookup
    .build();

  // The static reachable sets (what read_skill is bounded to from each spot).
  const reachable = {
    coldStart: [...graph.reachableSkills(undefined)], // ['triage'] (entries)
    fromTriage: [...graph.reachableSkills('triage')], // ['volume-lookup', 'inventory']
    fromVolumeLookup: [...graph.reachableSkills('volume-lookup')], // ['audit-log', 'triage']
  };

  // Capture the rejection + what activated, off the live emit stream.
  const rejections: unknown[] = [];
  const activated = new Set<string>();
  const recorder: CombinedRecorder = {
    id: 'capture',
    onEmit: (e) => {
      if (e.name === 'agentfootprint.skill.rejected') rejections.push(e.payload);
      if (e.name === 'agentfootprint.context.evaluated') {
        for (const id of (e.payload as { activeIds?: string[] }).activeIds ?? []) activated.add(id);
      }
    },
  };

  // The model first tries to jump straight to audit-log (out of reach from triage),
  // then to inventory (a model edge from triage), then answers.
  let i = 0;
  const scripted =
    provider ??
    mock({
      respond: () => {
        i++;
        if (i === 1)
          return {
            content: 'Jumping to the audit log.',
            toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'audit-log' } }],
            stopReason: 'tool_use',
          };
        if (i === 2)
          return {
            content: 'OK, let me check inventory first.',
            toolCalls: [{ id: 'c2', name: 'read_skill', args: { id: 'inventory' } }],
            stopReason: 'tool_use',
          };
        return { content: 'Inventory loaded; here is the summary.', toolCalls: [], stopReason: 'stop' };
      },
    });

  const agent = Agent.create({ provider: scripted, model: 'mock', maxIterations: 6 })
    .system('You are a read-only SAN triage assistant.')
    .skillGraph(graph)
    .recorder(recorder)
    .build();

  const answer = await agent.run({ message: input });

  return {
    mermaid: graph.toMermaid(),
    reachable,
    // The rejected jump — requestedId, the cursor it was at, and the allowed set
    // echoed back to the model (so it re-picks instead of leaving the graph).
    rejectedJumps: rejections, // [{ requestedId: 'audit-log', currentSkillId: 'triage', allowed: [...] }]
    // 'audit-log' never activated (rejected); 'inventory' did (the in-reach jump).
    activatedSkills: [...activated].sort(),
    answer,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
