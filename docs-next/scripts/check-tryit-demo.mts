/**
 * check:tryit — runs the REAL "Try it live" demo end-to-end.
 *
 * `buildDynamicReactAgent` here is the SAME function the Dynamic ReAct embed shows
 * (via <CodeFile region="demo">) AND executes when a reader hits Run. This check
 * runs it in Node and asserts what the run DID — each tool's own result, read off
 * the `stream.tool_start` / `stream.tool_end` events — so a broken demo fails the
 * docs build, not the reader's browser.
 *
 * Why not the final answer alone: the demo's mock LLM SCRIPTS that text, so it
 * comes back word for word even when the skill never loaded, redaction returned
 * the raw email, or the refund threw. Only the tool results can tell.
 *
 *   Run:  npm run check:tryit   (from docs-next/; needs the library dist built)
 */
import { deepStrictEqual, ok } from 'node:assert/strict';
import { Agent } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';
import type { StructureRecorder } from 'footprintjs';
import {
  buildWeatherAgent,
  weatherAnswer,
  weatherInput,
} from '../../docs-demo/scripts/quick-start-weather.mjs';
import { buildDynamicReactAgent } from '../components/demos/dynamicReactDemo';
import { buildSupportSkillGraph } from '../components/demos/skillGraphDemo';

const MESSAGE = 'My account is alice@example.com — please refund $42';
const EXPECTED = 'Done. Refund of $42 issued for [EMAIL]. You should see it in 3-5 business days.';

function fail(msg: string): never {
  console.error(`[check:tryit] FAIL — ${msg}`);
  process.exit(1);
}

const agent = buildDynamicReactAgent();

// What each tool call actually returned, in the order the calls ended.
const toolNames = new Map<string, string>();
const ended: { name: string; result: unknown; error: boolean }[] = [];
agent.on('agentfootprint.stream.tool_start', (e) => {
  toolNames.set(e.payload.toolCallId, e.payload.toolName);
});
agent.on('agentfootprint.stream.tool_end', (e) => {
  ended.push({
    name: toolNames.get(e.payload.toolCallId) ?? '(unknown call)',
    result: e.payload.result,
    error: e.payload.error === true,
  });
});

const result = await agent.run({ message: MESSAGE });

if (typeof result !== 'string') fail('agent paused unexpectedly (expected a final answer)');

// The final response is scripted. Check the results independently, in call order.
const expectedCalls = [
  ['read_skill', "Skill 'billing' activated for the next iteration."],
  ['redact_pii', '[EMAIL] refund $42'],
  ['process_refund', 'Refund of $42 issued.'],
] as const;
if (ended.length !== expectedCalls.length) {
  fail(`expected ${expectedCalls.length} tool results, received ${ended.length}`);
}
for (const [index, [name, expected]] of expectedCalls.entries()) {
  const call = ended[index];
  if (call.name !== name || call.error || call.result !== expected) {
    fail(`tool call ${index + 1} (${name}) did not return its expected result`);
  }
}

// The final answer only proves the run COMPLETED (no throw, no pause, a 4th LLM
// call): its text is scripted by the mock, so it says nothing about the tools.
if (result !== EXPECTED) {
  fail(`final answer drifted.\n  expected: ${EXPECTED}\n  got:      ${result}`);
}

console.log('[check:tryit] OK — read_skill, redact_pii and process_refund each returned what the flow needs, in order, and the run finished');
console.log(`[check:tryit] answer: ${result}`);

// ── Skill-graph demo: the builder draws the routing graph the embed shows. It is
//    static (no run), so the guardrail asserts the compiled graph SHAPE matches
//    the declared start/steps wiring — declared === drawn.
const graph = buildSupportSkillGraph();
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
const { buildQuickstartSkillGraph } = await import('../components/demos/skillGraphQuickstartDemo');
const qs = buildQuickstartSkillGraph();
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
deepStrictEqual(await weather.run({ message: weatherInput }), weatherAnswer);
deepStrictEqual(weatherTools, [['call-weather-1', 'San Francisco: sunny, 72°F', false]]);
ok(weather.getLastSnapshot()?.executionTree, 'the weather run keeps its execution tree');
ok(weather.getLastNarrativeEntries().length, 'the weather run keeps narrative entries');
for (const mount of ['sf-llm-call', 'sf-system-prompt', 'sf-messages', 'sf-tools']) {
  ok(mounted.has(mount), `the weather run exposes ${mount}`);
}
ok(loops.some(([from, to]) => from === 'tool-calls' && to === 'sf-llm-call'));
console.log('[check:tryit] OK — the weather agent ran its tool and exposed the grouped LLM flow');
