/**
 * 44 — Skill graph: `read_skill` offers what the gate will actually grant.
 *
 * A skill graph bounds `read_skill` to the skills reachable from where the cursor
 * stands, so the model cannot wander out of the graph. But the TOOL enumerated every
 * registered skill — in its enum and in the catalog inside its own description —
 * while the GATE admitted only `reachableSkills(cursor) ∪ open`.
 *
 * So the model was handed a menu the library already knew it would reject: a route
 * target three hops away was advertised on every single iteration and refused on
 * every single call. Nothing was broken, exactly; it just cost tokens and could burn
 * a whole run on re-asking, because nothing ever told the model where it stood.
 *
 * Now the description is rebuilt each iteration from the SAME two functions the gate
 * itself calls, so the menu and the verdict cannot disagree:
 *
 *     Reachable from here:
 *       - volume-lookup: Resolve a volume by WWN
 *       - escalation: How to page the on-call engineer   ← open, reachable anywhere
 *
 *     Not reachable from here (read_skill for these will be refused):
 *       - capacity-report: Report free capacity per volume
 *
 * The ENUM stays the full catalog, deliberately. Tool-argument validation runs BEFORE
 * the gate and rejects an off-enum id with a generic schema error — which would
 * silently retire the gate's teaching refusal, the `skill.rejected` event,
 * routeRecorder's rejection hops and the rejected-cap governor's only input. Four
 * honesty mechanisms for one. So the enum stays whole and the OFFER narrows.
 *
 * Run:  npx tsx examples/features/44-skill-graph-read-skill-offer.ts
 */

import { Agent, defineTool, type LLMProvider } from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/44-skill-graph-read-skill-offer',
  title: 'Skill graph — read_skill offers only what the gate will grant',
  group: 'features',
  description:
    "read_skill's menu is rebuilt each iteration from the same reachability the gate enforces, so the model is never offered a skill it will be refused. The enum stays the full catalog on purpose — narrowing it would route out-of-reach picks into a schema error and silently retire the gate's teaching refusal.",
  defaultInput: 'why is db-01 slow',
  providerSlots: ['default'],
  tags: ['feature', 'skills', 'routing', 'graph', 'read_skill'],
};

const getCounters = defineTool({
  name: 'get_counters',
  description: 'Read the storage counters for a host.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => JSON.stringify({ wwn: '50:06:01', latencyMs: 42 }),
});

const resolveVolume = defineTool({
  name: 'resolve_volume',
  description: 'Resolve a volume by WWN.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => JSON.stringify({ volume: 'vol-7', pool: 'gold' }),
});

const triage = defineSkill({
  id: 'triage',
  description: 'Start here: read the counters for the host in question.',
  body: 'Call get_counters() and note the WWN.',
  tools: [getCounters],
});

const volumeLookup = defineSkill({
  id: 'volume-lookup',
  description: 'Resolve a volume by WWN.',
  body: 'Call resolve_volume() with the WWN from the counters.',
  tools: [resolveVolume],
});

const capacityReport = defineSkill({
  id: 'capacity-report',
  description: 'Report free capacity per volume.',
  body: 'Summarise free space for the resolved volume.',
});

/** Registered BESIDE the graph — no declared edge points at it, so it is OPEN. */
const escalation = defineSkill({
  id: 'escalation',
  description: 'How to page the on-call storage engineer.',
  body: 'Page the on-call engineer with the counters you collected.',
});

const graph = skillGraph({
  skills: [triage, volumeLookup, capacityReport],
  start: 'triage',
  steps: [
    { from: 'triage', to: 'volume-lookup', onToolReturn: 'get_counters' },
    { from: 'volume-lookup', to: 'capacity-report', onToolReturn: 'resolve_volume' },
  ],
  check: 'throw',
});

/** The scripted model, which also records the `read_skill` menu it was shown. */
function scriptedModel(
  onMenu: (tools: ReadonlyArray<{ name: string; description: string }>) => void,
): LLMProvider {
  let i = 0;
  return mock({
    respond: (req: { tools?: ReadonlyArray<{ name: string; description: string }> }) => {
      onMenu(req.tools ?? []);
      i++;
      if (i === 1)
        return {
          content: '',
          toolCalls: [{ id: 't1', name: 'get_counters', args: {} }],
          stopReason: 'tool_use' as const,
        };
      if (i === 2)
        return {
          content: '',
          toolCalls: [{ id: 't2', name: 'resolve_volume', args: {} }],
          stopReason: 'tool_use' as const,
        };
      return { content: 'vol-7 on the gold pool, 42ms latency.', toolCalls: [], stopReason: 'stop' as const };
    },
  });
}

/** Just the two catalog sections, for readable output. */
function summariseMenu(description: string): { reachable: string[]; refusable: string[] } {
  const ids = (block: string) =>
    [...block.matchAll(/^ {2}- ([^:]+):/gm)].map((m) => m[1]!.trim());
  const [head, tail] = description.split('Not reachable from here');
  return { reachable: ids(head ?? ''), refusable: ids(tail ?? '') };
}

export async function run(message: string) {
  const menus: Array<{ iteration: number; reachable: string[]; refusable: string[] }> = [];
  let iteration = 0;

  const provider = scriptedModel((tools) => {
    iteration++;
    const readSkill = tools.find((t) => t.name === 'read_skill');
    if (readSkill) menus.push({ iteration, ...summariseMenu(readSkill.description) });
  });

  const agent = Agent.create({ provider, model: 'mock', maxIterations: 5 })
    .system('You are a storage support agent.')
    .skillGraph(graph)
    .skill(escalation)
    .build();

  const answer = await agent.run({ message });

  return {
    mermaid: graph.toMermaid(),
    // The menu the model READ, per iteration — it tracks the cursor:
    //   iter 1 (cursor: triage)          reachable [volume-lookup, escalation]
    //   iter 2 (cursor: volume-lookup)   reachable [triage, capacity-report, escalation]
    //   iter 3 (cursor: capacity-report) reachable [triage, escalation]
    // Three things move independently, and the menu shows all three honestly:
    //   • the cursor's successors come and go as the graph advances;
    //   • `triage` is an ENTRY, so it is always reachable (you may restart a turn)
    //     — except from triage itself, where it appears in NEITHER column: a move
    //     to where you already are is not a move, and since 9.84.0 the current
    //     skill is named ("You are in 'triage'.") instead of being listed as
    //     unreachable, which is what the model was reading as "unavailable";
    //   • `escalation` is OPEN (no declared edge points at it), so it is reachable
    //     from everywhere — it activates by read_skill and never moves the cursor.
    menusPerIteration: menus,
    // What the GATE would grant at each of those cursors — the same answer, from the
    // other side. The menu is built from these, so they cannot drift.
    gateFromTriage: graph.reachableSkills('triage'),
    gateFromVolumeLookup: graph.reachableSkills('volume-lookup'),
    answer,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
