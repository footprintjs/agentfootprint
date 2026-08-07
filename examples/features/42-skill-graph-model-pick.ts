/**
 * 42 — Skill graph: the model's `read_skill` pick is HONOURED.
 *
 * A rules-form graph routes known phrasings to a skill with a regex. Real users
 * ask things no regex anticipated. When no rule matches, the agent is offered
 * `read_skill` and picks a skill by reading the menu — the documented fallback.
 *
 * Before 8.3.0 that fallback dead-ended: `read_skill` answered "Skill 'x'
 * activated for the next iteration", but a rule-triggered skill's trigger only
 * ever consulted its rule, so the skill never loaded — no body, no tools, on any
 * iteration, forever. The agent had been told a thing had happened that hadn't.
 *
 * Now an accepted pick moves the graph's cursor exactly like a declared edge
 * does, which means three things happen in this one run:
 *   1. no rule matches → nothing is active and only `read_skill` is offered;
 *   2. the model picks `esxi-inventory` → next iteration its body AND its tools
 *      are on the wire;
 *   3. the cursor is really ON that skill, so the graph's own declared `step`
 *      out of it fires when the tool returns a WWN — the fallback drops the run
 *      back onto the declared rails instead of stranding it.
 *
 * The author's determinism is still protected: a declared edge that fires on the
 * same turn OUTRANKS a same-turn pick, and the run emits
 * `agentfootprint.skill.reroute_superseded` rather than dropping it silently.
 *
 * Run:  npx tsx examples/features/42-skill-graph-model-pick.ts
 */

import { Agent, defineTool, type CombinedRecorder, type LLMProvider } from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/42-skill-graph-model-pick',
  title: 'Skill graph — the model picks, and the pick takes effect',
  group: 'features',
  description:
    "When no entry rule matches, the model picks a skill from the read_skill menu and the pick moves the graph's cursor — the skill's body and tools load on the next iteration, and the graph's declared steps run from there. A declared edge still outranks a same-turn pick.",
  defaultInput: 'why is my storage slow today',
  providerSlots: ['default'],
  tags: ['feature', 'skills', 'routing', 'graph', 'read_skill'],
};

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const getVmStorage = defineTool({
    name: 'get_vm_storage',
    description: 'Storage backing a VM, including the backing array WWN',
    inputSchema: { type: 'object', properties: { vm: { type: 'string' } } },
    execute: async () => JSON.stringify({ vm: 'db-01', array_wwn: 'naa.6000abc' }),
  });
  const resolveVolume = defineTool({
    name: 'resolve_volume',
    description: 'Resolve a volume by WWN',
    inputSchema: { type: 'object', properties: { wwn: { type: 'string' } } },
    execute: async () => JSON.stringify({ lun: 'LUN-42', busy: '81%' }),
  });

  const esxi = defineSkill({
    id: 'esxi-inventory',
    description: 'ESXi / vCenter inventory — hosts, VMs, datastores.',
    body: 'Answer inventory questions with a tool call; never guess.',
    tools: [getVmStorage],
    autoActivate: 'currentSkill', // only the active skill's tools reach the LLM
  });
  const volume = defineSkill({
    id: 'volume-lookup',
    description: 'Resolve a storage volume by WWN and report its load.',
    body: 'Resolve the WWN, then report the LUN.',
    tools: [resolveVolume],
    autoActivate: 'currentSkill',
  });

  // Deterministic entry rules own the phrasings we anticipated; the step carries
  // the cross-domain hop. Note `volume-lookup` is BOTH a rule entry and the step's
  // target — the case where the cursor and the active set used to disagree.
  const graph = skillGraph({
    skills: [esxi, volume],
    start: {
      rules: [
        { when: (c) => /\b(vm|vms|esxi|datastore)\b/i.test(c.userMessage ?? ''), use: 'esxi-inventory' },
        { when: (c) => /\bnaa\.|wwn\b/i.test(c.userMessage ?? ''), use: 'volume-lookup' },
      ],
    },
    steps: [
      {
        from: 'esxi-inventory',
        to: 'volume-lookup',
        when: (r) => r.toolName === 'get_vm_storage' && /array_wwn/.test(r.result),
        label: 'array WWN → resolve volume',
      },
    ],
    check: 'throw',
  });

  // "why is my storage slow today" matches NEITHER rule — this is the fallback path.
  const perIteration: Array<{ iteration: number; active: string[]; offered: string[] }> = [];
  const superseded: unknown[] = [];
  const recorder: CombinedRecorder = {
    id: 'capture',
    onEmit: (e) => {
      if (e.name === 'agentfootprint.context.evaluated') {
        const p = e.payload as { iteration: number; activeIds: string[] };
        perIteration.push({ iteration: p.iteration, active: [...p.activeIds], offered: [] });
      }
      if (e.name === 'agentfootprint.stream.llm_start') {
        const p = e.payload as { iteration: number; tools?: Array<{ name: string }> };
        const row = perIteration.find((r) => r.iteration === p.iteration);
        if (row) row.offered = (p.tools ?? []).map((t) => t.name);
      }
      if (e.name === 'agentfootprint.skill.reroute_superseded') superseded.push(e.payload);
    },
  };

  let i = 0;
  const scripted =
    provider ??
    mock({
      respond: () => {
        i++;
        // iter 1 — no skill is active (no rule matched). The model reads the menu.
        if (i === 1)
          return {
            content: 'No rule covered this. Let me load the inventory skill.',
            toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'esxi-inventory' } }],
            stopReason: 'tool_use' as const,
          };
        // iter 2 — the pick took effect: the skill's tool is now on the wire.
        if (i === 2)
          return {
            content: 'Checking the VM storage.',
            toolCalls: [{ id: 'c2', name: 'get_vm_storage', args: { vm: 'db-01' } }],
            stopReason: 'tool_use' as const,
          };
        // iter 3 — the WWN fired the declared step; we are in volume-lookup now.
        if (i === 3)
          return {
            content: 'Resolving the volume.',
            toolCalls: [{ id: 'c3', name: 'resolve_volume', args: { wwn: 'naa.6000abc' } }],
            stopReason: 'tool_use' as const,
          };
        return { content: 'db-01 sits on LUN-42, which is 81% busy.', toolCalls: [], stopReason: 'stop' as const };
      },
    });

  const agent = Agent.create({ provider: scripted, model: 'mock', maxIterations: 8 })
    .system('You are a storage triage assistant.')
    .skillGraph(graph)
    .watch(recorder)
    .build();

  const answer = await agent.run({ message: input });

  // ── The contested hop: a declared edge and a pick want the cursor at once ──
  // One assistant message carrying BOTH `read_skill('volume-lookup')` and a tool
  // whose result fires the declared step. The author's edge wins; the pick is
  // reported as superseded rather than dropped in silence. (Here the edge and the
  // model happen to agree on the destination, so we point the pick elsewhere.)
  const contested: unknown[] = [];
  const parked = defineSkill({
    id: 'capacity-report',
    description: 'Capacity trend report.',
    body: 'Report capacity.',
    tools: [defineTool({ name: 'get_capacity', description: 'capacity', execute: async () => '{}' })],
    autoActivate: 'currentSkill',
  });
  const contestedGraph = skillGraph({
    skills: [esxi, volume, parked],
    // An entry's `when` says where a turn STARTS — it does not keep the skill on the
    // wire (8.15.0). A conditional entry is active exactly while the cursor is on it,
    // so when the step below fires, `esxi-inventory` hands off cleanly instead of
    // staying loaded beside `volume-lookup`. Write a real predicate, not `() => true`:
    // "always on" is what an entry with NO `when` means (`always`), and the two are no
    // longer the same thing.
    start: {
      rules: [{ when: (c) => /storage|db-/i.test(c.userMessage ?? ''), use: 'esxi-inventory' }],
    },
    steps: [
      { from: 'esxi-inventory', to: 'volume-lookup', onToolReturn: 'get_vm_storage', label: 'WWN' },
      { from: 'esxi-inventory', to: 'capacity-report', when: (r) => r.toolName === 'never' },
    ],
    check: 'throw',
  });
  let j = 0;
  const contestedAgent = Agent.create({
    provider: mock({
      respond: () => {
        j++;
        if (j === 1)
          return {
            content: 'Jumping to capacity while I check storage.',
            toolCalls: [
              { id: 'd1', name: 'read_skill', args: { id: 'capacity-report' } },
              { id: 'd2', name: 'get_vm_storage', args: { vm: 'db-01' } },
            ],
            stopReason: 'tool_use' as const,
          };
        return { content: 'Resolved via the declared route.', toolCalls: [], stopReason: 'stop' as const };
      },
    }),
    model: 'mock',
    maxIterations: 4,
  })
    .skillGraph(contestedGraph)
    .watch({
      id: 'contested',
      onEmit: (e) => {
        if (e.name === 'agentfootprint.skill.reroute_superseded') contested.push(e.payload);
      },
    })
    .build();
  await contestedAgent.run({ message: 'check db-01 storage' });

  return {
    mermaid: graph.toMermaid(),
    // iter 1: active [] + only read_skill offered   — no rule matched
    // iter 2: active ['esxi-inventory'] + get_vm_storage offered — the pick took effect
    // iter 3: active ['volume-lookup'] + resolve_volume offered  — the declared step ran
    perIteration,
    // Empty: nothing contested the hop in the run above.
    superseded,
    // The contested run: the declared edge won the cursor and the dropped pick is
    // on the record — { volunteeredId: 'capacity-report', wonId: 'volume-lookup', … }.
    contested,
    answer,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
