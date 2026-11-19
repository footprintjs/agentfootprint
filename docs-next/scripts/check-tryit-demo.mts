/**
 * check:tryit — runs the REAL "Try it live" demo end-to-end.
 *
 * The Dynamic ReAct guide shows the same builder the published app runs. This
 * check injects the current library and verifies tool and context evidence in Node.
 *
 *   Run:  npm run check:tryit   (from docs-next/; needs the library dist built)
 */
import { deepStrictEqual, ok } from 'node:assert/strict';
import { Agent, defineTool } from 'agentfootprint';
import { defineFact, defineInstruction, defineSkill, defineSteering, skillGraph } from 'agentfootprint/context';
import { redactContent, routeRecorder } from 'agentfootprint/observe';
import { mock } from 'agentfootprint/providers';
import { stringifySnapshot, type StructureRecorder } from 'footprintjs';
import { buildWeatherAgent } from '../../docs-demo/scripts/quick-start-weather.mjs';
import { buildDynamicReactAgent } from '../../docs-demo/shared/dynamicReactDemo';
import { recordDynamicReactRun } from '../../docs-demo/shared/recordDynamicReactRun.mjs';
import { recordOfflineReplay } from '../../docs-demo/shared/recordOfflineReplay.mjs';
import { buildSupportSkillGraph } from '../components/demos/skillGraphDemo';
import { buildQuickstartSkillGraph } from '../components/demos/skillGraphQuickstartDemo';
import { recordSkillGraphRuns } from '../components/demos/skillGraphRuns.mjs';

function fail(msg: string): never {
  console.error(`[check:tryit] FAIL — ${msg}`);
  process.exit(1);
}

const dynamicReact = buildDynamicReactAgent(
  { Agent, defineTool, defineFact, defineInstruction, defineSkill, defineSteering, mock },
  { thinkingMs: 0 },
);
const { result } = await recordDynamicReactRun(dynamicReact);
console.log('[check:tryit] OK — Dynamic ReAct ran the three tools in order and put post-pii in the system prompt on iteration 3');
console.log(`[check:tryit] answer: ${result}`);

// The guide and the demo use the same declarations. Keep these structural
// assertions against the current library alongside the mock runtime checks.
const graphApi = { defineTool, defineSkill, skillGraph };
const graph = buildSupportSkillGraph(graphApi);
const skillIds = graph.nodes
  .filter((n) => n.kind === 'skill')
  .map((n) => n.id)
  .sort();
if (JSON.stringify(skillIds) !== JSON.stringify(['billing', 'tech', 'triage'])) {
  fail(`skill graph: expected skills billing/tech/triage, got ${skillIds.join(', ')}`);
}
if (!graph.edges.some((e) => e.from === null && e.to === 'triage')) {
  fail('skill graph: missing entry edge START → triage');
}
const routes = graph.edges.filter((e) => e.from === 'triage').map((e) => e.to);
if (!routes.includes('billing') || !routes.includes('tech')) {
  fail(`skill graph: triage should route to billing + tech, got ${routes.join(', ')}`);
}

console.log('[check:tryit] OK — the skill graph compiled triage → {billing, tech}');

// ── Quickstart demo (skill-graph-quickstart page): rules as data + scopeTools.
//    Asserts what the page claims: the matchers route real messages, every wired
//    skill is tool-scoped, and the entry edges carry the serializable match data
//    the page's mermaid block captions with.
const qs = buildQuickstartSkillGraph(graphApi);
const qsCtx = (userMessage: string) => ({
  iteration: 1,
  userMessage,
  history: [],
  activatedInjectionIds: [],
});
if (qs.nextSkill(qsCtx('I want my money back')) !== 'refunds') {
  fail('quickstart: "I want my money back" should route to refunds');
}
if (qs.nextSkill(qsCtx('why is there a CHARGE on my card')) !== 'billing') {
  fail('quickstart: keyword "charge" (case-insensitive) should route to billing');
}
if (qs.nextSkill(qsCtx('my charger broke')) !== 'triage') {
  fail('quickstart: whole-word matching — "charger" must NOT match "charge"');
}
const unscoped = qs.skills.filter(
  (s) => (s.metadata as { autoActivate?: string } | undefined)?.autoActivate !== 'currentSkill',
);
if (unscoped.length > 0) {
  fail(`quickstart: scopeTools should stamp every wired skill; unscoped: ${unscoped.map((s) => s.id).join(', ')}`);
}
const matchEdges = qs.edges.filter((e) => e.from === null && e.match !== undefined);
if (matchEdges.length !== 2) {
  fail(`quickstart: expected 2 entry edges carrying match data, got ${matchEdges.length}`);
}
if (!qs.toMermaid().includes('charge, invoice')) {
  fail('quickstart: toMermaid should caption the keywords entry edge');
}

console.log('[check:tryit] OK — the quickstart graph routes by data, scopes tools, and captions its edges');

await recordSkillGraphRuns({ Agent, defineTool, mock, routeRecorder }, { quickstart: qs, support: graph });
console.log('[check:tryit] OK — real mock runs recorded three start rules and both declared triage routes');

// The guide and published demo share the weather fixture. Exercise it against
// the current library and its native structure events, with no Explainable UI.
const mounted = new Set<string>();
const loops: Array<[string, string]> = [];
const recorder: StructureRecorder = {
  id: 'quick-start-weather',
  onSubflowMounted: ({ subflowId }) => mounted.add(subflowId),
  onLoopEdgeAdded: ({ from, to }) => { loops.push([from, to]); },
};
const weather: ReturnType<ReturnType<typeof Agent.create>['build']> =
  buildWeatherAgent({ Agent, mock }, [recorder]);
const weatherTools: Array<[string, unknown, boolean]> = [];
weather.on('agentfootprint.stream.tool_end', ({ payload }) => {
  weatherTools.push([payload.toolCallId, payload.result, payload.error === true]);
});
await recordOfflineReplay(weather, { redactContent, stringifySnapshot });
deepStrictEqual(weatherTools, [['call-weather-1', 'San Francisco: sunny, 72°F', false]]);
ok(weather.getLastSnapshot()?.executionTree, 'the weather run keeps its execution tree');
ok(weather.getLastNarrativeEntries().length, 'the weather run keeps narrative entries');
for (const mount of ['sf-llm-call', 'sf-system-prompt', 'sf-messages', 'sf-tools']) {
  ok(mounted.has(mount), `the weather run exposes ${mount}`);
}
ok(loops.some(([from, to]) => from === 'tool-calls' && to === 'sf-llm-call'));
console.log('[check:tryit] OK — the weather agent ran its tool and exposed the grouped LLM flow');
console.log('[check:tryit] OK — its redacted Trace survives serialization with the chart, tool and run boundaries');
