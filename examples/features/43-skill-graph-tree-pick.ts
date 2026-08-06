/**
 * 43 — Skill graph: a decision `tree()` cannot be jumped, and says so.
 *
 * A `tree()` routes by predicate on EVERY iteration. There is no cursor: the tree
 * re-decides from the context each turn, exactly one leaf fires, and that leaf's
 * tools are the only ones on the wire. That is the whole point of a tree.
 *
 * So what should `read_skill('some-other-leaf')` do?
 *
 * Until 8.5.0 it "worked": the gate accepted the pick (tree mode reported all the
 * leaves as reachable), `read_skill` answered "Skill 'x' activated for the next
 * iteration" — and then nothing happened. A leaf compiles to a `rule` trigger; a
 * `read_skill` call writes only `activatedInjectionIds`; no rule trigger reads that.
 * The leaf never activated, the tree re-decided by predicate, and the run emitted
 * `reroute_superseded` naming a winner that did not exist, because tree mode never
 * writes a cursor at all. Three sentences of the library, all false at once.
 *
 * Honouring the pick was the other option, and the tree's own rules refuse it:
 * exactly ONE leaf fires per iteration (the library ships a dev-mode monitor that
 * warns otherwise), each leaf's tools are scoped on that basis, and `toMermaid()`
 * draws only predicate branches — a model lever over that routing is not on the
 * drawing. So the gate refuses, and the refusal teaches the tree.
 *
 * `read_skill` is not dead under a tree. Anything registered BESIDE the graph — a
 * `.skill()`, a `.selfExplain()` debug skill — is OPEN and still reachable from
 * anywhere, because those really do activate by `read_skill`. This run shows both:
 * a refused leaf and an accepted open skill, in the same conversation.
 *
 * Run:  npx tsx examples/features/43-skill-graph-tree-pick.ts
 */

import { Agent, defineTool, type LLMProvider } from '../../src/index.js';
import { defineSkill, skillGraph, decideSkill } from '../../src/doors/context.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/43-skill-graph-tree-pick',
  title: 'Skill graph — a tree routes by predicate, and read_skill cannot jump it',
  group: 'features',
  description:
    "A decision tree() has no cursor, so read_skill has nothing to move: a leaf pick is refused with a message explaining the tree, instead of being accepted and silently dropped. Skills registered beside the tree stay reachable, because those really do activate by read_skill.",
  defaultInput: 'the database is slow',
  providerSlots: ['default'],
  tags: ['feature', 'skills', 'routing', 'graph', 'tree', 'read_skill'],
};

const readCounters = defineTool({
  name: 'read_counters',
  description: 'Read the storage performance counters.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => JSON.stringify({ latencyMs: 42, queueDepth: 3 }),
});

const capacityReport = defineTool({
  name: 'capacity_report',
  description: 'Report free capacity per volume.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => JSON.stringify({ freeGb: 120 }),
});

/** Leaf 1 — the tree routes here when the message sounds like a performance issue. */
const performance = defineSkill({
  id: 'performance',
  description: 'Diagnose slow storage: read counters, then explain the latency.',
  body: 'Call read_counters(), then explain the latency in one sentence.',
  tools: [readCounters],
});

/** Leaf 2 — everything else. */
const capacity = defineSkill({
  id: 'capacity',
  description: 'Answer capacity questions: how much room is left.',
  body: 'Call capacity_report(), then state the free space.',
  tools: [capacityReport],
});

/** Registered BESIDE the graph — no edge points at it, so it stays llm-activated. */
const escalation = defineSkill({
  id: 'escalation',
  description: 'How to escalate to the on-call storage engineer.',
  body: 'Page the on-call engineer with the counters you already collected.',
});

const graph = skillGraph({
  skills: [performance, capacity],
  tree: decideSkill(
    (ctx) => /slow|latency|performance/i.test(ctx.userMessage),
    performance,
    capacity,
    'performance question?',
  ),
  check: 'throw',
});

/** The model tries to jump the tree first, then asks for the open skill. */
function scriptedModel(): LLMProvider {
  let i = 0;
  return mock({
    respond: () => {
      i++;
      if (i === 1) {
        // Refused: `capacity` is a leaf, and a tree has no cursor to move.
        return {
          content: '',
          toolCalls: [{ id: 't1', name: 'read_skill', args: { id: 'capacity' } }],
          stopReason: 'tool_use' as const,
        };
      }
      if (i === 2) {
        // Accepted: `escalation` is OPEN — read_skill is what activates it.
        return {
          content: '',
          toolCalls: [{ id: 't2', name: 'read_skill', args: { id: 'escalation' } }],
          stopReason: 'tool_use' as const,
        };
      }
      return { content: 'Latency is 42ms; paging the on-call engineer.', toolCalls: [], stopReason: 'stop' as const };
    },
  });
}

export async function run(message: string) {
  const perIteration: Array<{ iteration: number; active: readonly string[] }> = [];
  const refusals: unknown[] = [];
  const supersededEvents: unknown[] = [];
  const toolResults: string[] = [];

  const agent = Agent.create({ provider: scriptedModel(), model: 'mock', maxIterations: 5 })
    .system('You are a storage support agent.')
    .skillGraph(graph)
    .skill(escalation)
    .watch({
      id: 'watch',
      onEmit: (e) => {
        if (e.name === 'agentfootprint.context.evaluated') {
          const p = e.payload as { iteration: number; activeIds: readonly string[] };
          perIteration.push({ iteration: p.iteration, active: p.activeIds });
        }
        if (e.name === 'agentfootprint.skill.rejected') refusals.push(e.payload);
        if (e.name === 'agentfootprint.skill.reroute_superseded') supersededEvents.push(e.payload);
        if (e.name === 'agentfootprint.stream.tool_end') {
          const p = e.payload as { result: string };
          toolResults.push(p.result);
        }
      },
    })
    .build();

  const answer = await agent.run({ message });

  // The SAME refused pick, on a tree with nothing registered beside it. With an open
  // skill present the gate names it (more useful — there IS somewhere to go); with
  // none, there is nowhere at all, and the refusal explains the tree instead of
  // saying "not reachable from here", which would invite the model to try again.
  const bare: string[] = [];
  const bareAgent = Agent.create({
    provider: mock({
      respond: () => ({
        content: '',
        toolCalls: [{ id: 'b1', name: 'read_skill', args: { id: 'capacity' } }],
        stopReason: 'tool_use' as const,
      }),
    }),
    model: 'mock',
    maxIterations: 2,
  })
    .system('You are a storage support agent.')
    .skillGraph(graph)
    .watch({
      id: 'bare',
      onEmit: (e) => {
        if (e.name === 'agentfootprint.stream.tool_end') bare.push((e.payload as { result: string }).result);
      },
    })
    .build();
  await bareAgent.run({ message });

  return {
    mermaid: graph.toMermaid(),
    // A tree draws predicate branches only — no dashed model edge, because there is
    // no model edge. The empty reachable set is what makes that drawing true.
    reachableFromAnywhere: graph.reachableSkills(),
    // iter 1: ['performance'] — the tree's predicate matched the message.
    // iter 2: ['performance'] — the refused pick changed nothing.
    // iter 3: ['performance', 'escalation'] — the OPEN skill activated.
    perIteration,
    // What the model actually read back here. An OPEN skill exists, so the gate
    // points at it: "Reachable skills: escalation. Pick one of these, or finish."
    refusalWithAnOpenSkill: toolResults.find((r) => r.includes('not reachable from here')),
    // The same pick on a BARE tree — the message that teaches the tree itself,
    // instead of "nothing is reachable from here", which would invite a retry.
    refusalOnABareTree: bare.find((r) => r.includes('cannot move a decision tree')),
    // { requestedId: 'capacity', allowed: ['escalation'], … }
    refusals,
    // EMPTY. The pick is refused at the gate now, so the winnerless
    // reroute_superseded that used to fire here cannot happen.
    supersededEvents,
    answer,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
