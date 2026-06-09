/**
 * 15 — Skill graph: declarative, visualizable, token-efficient skill routing.
 *
 * Instead of stuffing every skill + tool into the system prompt each turn,
 * declare a `skillGraph()`: an ENTRY skill plus routing EDGES. Each edge compiles
 * to the target skill's injection TRIGGER (proposal 002) — so a skill (its body +
 * tools) loads JUST-IN-TIME, only when its edge fires. Cheaper tokens, sharper
 * reasoning, and `graph.toMermaid()` draws the topology (declared === drawn).
 *
 * Here: `triage` is the entry; `sfp-diagnostics` activates ONLY after
 * `get_interface_counters` returns CRC > 0 — a deterministic, drawable edge.
 *
 * v3 also shows a `tree(...)` of `decide(...)` PREDICATE nodes that route by
 * intent to skill leaves — compiled to per-leaf path-conjunction triggers (still
 * zero engine change) and drawn as diamonds → boxes.
 *
 * Run:  npx tsx examples/features/15-skill-graph.ts
 */

import {
  Agent,
  defineTool,
  defineSkill,
  decide,
  mock,
  skillGraph,
  type CombinedRecorder,
  type LLMProvider,
} from '../../src/index.js';
import { evaluateInjections } from '../../src/lib/injection-engine/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/15-skill-graph',
  title: 'Skill graph — declarative, token-efficient skill routing',
  group: 'features',
  description:
    'Declare an entry skill + routing edges; each edge compiles to an injection trigger so skills load just-in-time. Deterministic, drawable (toMermaid), zero engine change.',
  defaultInput: 'fc1/3 is flapping on lva1-mds01',
  providerSlots: ['default'],
  tags: ['feature', 'skills', 'routing', 'graph'],
};

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const counters = defineTool({
    name: 'get_interface_counters',
    description: 'CRC / link-failure counters for an interface.',
    inputSchema: {
      type: 'object',
      properties: { interface: { type: 'string' } },
      required: ['interface'],
    },
    execute: async () => ({ interface: 'fc1/3', crc: 892, link_failures: 47 }),
  });
  const showTech = defineTool({
    name: 'load_show_tech',
    description: 'SFP Rx/Tx diagnostics from show-tech (the deep dive).',
    inputSchema: {
      type: 'object',
      properties: { interface: { type: 'string' } },
      required: ['interface'],
    },
    execute: async () => ({ interface: 'fc1/3', rx_power_dbm: -14.8, verdict: 'degraded SFP' }),
  });

  const triage = defineSkill({
    id: 'mds-interface-issues',
    description: 'Triage a flapping / errored FC interface.',
    body: 'Pull the interface counters first; if CRC > 0 it is a physical-layer fault.',
    tools: [counters],
  });
  const sfp = defineSkill({
    id: 'sfp-diagnostics',
    description: 'Deep SFP / optics diagnosis.',
    body: 'Read show-tech SFP Rx power; Rx near threshold = degraded SFP. Recommend replacement.',
    tools: [showTech],
  });

  // The graph: triage is the entry; sfp loads ONLY after counters report CRC > 0.
  const graph = skillGraph()
    .entry(triage)
    .route(triage, sfp, {
      when: (r) => r.toolName === 'get_interface_counters' && Number(JSON.parse(r.result).crc) > 0,
      label: 'CRC > 0',
    })
    .build();

  // Token-efficiency made visible: who is loaded at the start vs after CRC > 0.
  const base = { iteration: 1, userMessage: input, history: [], activatedInjectionIds: [] };
  const atStart = evaluateInjections(graph.skills, base);
  const afterCrc = evaluateInjections(graph.skills, {
    ...base,
    iteration: 2,
    lastToolResult: { toolName: 'get_interface_counters', result: '{"crc":892}' },
  });

  // A scripted run over the entry skill's tool (sfp would unlock on the CRC turn).
  let i = 0;
  const scripted =
    provider ??
    mock({
      respond: () => {
        i++;
        if (i === 1)
          return {
            content: 'Checking the interface counters.',
            toolCalls: [{ id: 'c1', name: 'get_interface_counters', args: { interface: 'fc1/3' } }],
            stopReason: 'tool_use',
          };
        return {
          content: 'CRC 892 + link failures → degraded SFP on fc1/3.',
          toolCalls: [],
          stopReason: 'stop',
        };
      },
    });

  // Capture the routing PROVENANCE the engine emits each turn. Every iteration's
  // `context.evaluated` carries `routing` — which skill-graph injection activated
  // and why (the edge / decision path) — the structured payload behind the
  // `context.routed` commentary line. A consumer (the lens) reads this off emit.
  const runtimeRouting: unknown[] = [];
  const captureRouting: CombinedRecorder = {
    id: 'capture-routing',
    onEmit: (e) => {
      if (e.name === 'agentfootprint.context.evaluated') {
        const p = e.payload as { routing?: unknown };
        if (p.routing) runtimeRouting.push(p.routing);
      }
    },
  };

  const agent = Agent.create({ provider: scripted, model: 'mock', maxIterations: 5 })
    .system('You are a read-only SAN triage assistant.')
    .skillGraph(graph)
    .recorder(captureRouting)
    .build();
  const answer = await agent.run({ message: input });

  // ── v3: a DECISION TREE that routes by intent to one skill leaf ──────────────
  // io? → io-profile : (sfp? → sfp-diagnostics : triage). Each leaf compiles to
  // the conjunction of predicates on its root→leaf path — exactly one fires.
  const ioProfile = defineSkill({
    id: 'io-profile',
    description: 'IO profile',
    body: 'Profile the IO/IOPS pattern.',
  });
  const intentTree = skillGraph()
    .tree(
      decide(
        (c) => /io|iops/.test(c.userMessage),
        ioProfile,
        decide((c) => /sfp|optic/.test(c.userMessage), sfp, triage, 'sfp intent?'),
        'io intent?',
      ),
    )
    .build();
  const routeOf = (msg: string) =>
    evaluateInjections(intentTree.skills, { ...base, userMessage: msg }).active.map((s) => s.id);

  return {
    answer,
    mermaid: graph.toMermaid(),
    loadedAtStart: atStart.active.map((s) => s.id), // ['mds-interface-issues'] — sfp NOT loaded yet
    loadedAfterCrc: afterCrc.active.map((s) => s.id), // adds 'sfp-diagnostics' — just-in-time
    treeMermaid: intentTree.toMermaid(), // diamonds (predicates) → boxes (skills)
    treeRoutes: {
      'iops spike': routeOf('iops spike'), // ['io-profile']
      'check sfp optic': routeOf('check sfp optic'), // ['sfp-diagnostics']
      'port flapping': routeOf('port flapping'), // ['mds-interface-issues'] (default leaf)
    },
    // v3 default: a tree routes to ONE leaf per turn, so each leaf is tool-scoped
    // (`autoActivate: 'currentSkill'`) — its tools reach the LLM only when routed,
    // not in every call's static tool list. Opt out with `.tree(root, { scopeTools: false })`.
    treeToolScoping: Object.fromEntries(
      intentTree.skills.map((s) => [s.id, s.metadata?.autoActivate ?? '(none)']),
    ), // every leaf → 'currentSkill'
    // Structured routing PROVENANCE captured off the live run's emit stream —
    // per turn, which skill-graph injection activated + why (edge / decision path
    // + tools). This is what the lens renders; the `context.routed` commentary is
    // the prose layer on top.
    runtimeRouting,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
