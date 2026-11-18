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

// The flow, proved by the tools' own results, in order:
//   read_skill('billing') → redact_pii (→ [EMAIL]) → process_refund (→ $42).
// Each step fails with its own message: the skill did not load (so the refund
// tool was never unlocked), redaction let the raw email through, or the refund
// failed.
const seen = ended.map((t) => `${t.name}${t.error ? ' [error]' : ''} → ${String(t.result)}`).join('\n  ');
const expectStep = (index: number, name: string, ok: (r: string) => boolean, what: string) => {
  const step = ended[index];
  if (!step || step.name !== name || step.error || !ok(String(step.result))) {
    fail(`${what}.\n  tool calls that ended, in order:\n  ${seen || '(none)'}`);
  }
};
if (ended.length !== 3) fail(`expected exactly 3 tool calls, got ${ended.length}:\n  ${seen || '(none)'}`);
expectStep(0, 'read_skill', (r) => r.includes("Skill 'billing' activated"), 'the billing skill did not load');
expectStep(
  1,
  'redact_pii',
  (r) => r.includes('[EMAIL]') && !r.includes('alice@example.com'),
  'redact_pii did not redact the email',
);
expectStep(2, 'process_refund', (r) => r === 'Refund of $42 issued.', 'process_refund did not issue the refund');

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
