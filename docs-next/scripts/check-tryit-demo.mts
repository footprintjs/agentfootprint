/**
 * check:tryit — runs the REAL "Try it live" demo end-to-end.
 *
 * `buildDynamicReactAgent` here is the SAME function the Dynamic ReAct embed shows
 * (via <CodeFile region="demo">) AND executes when a reader hits Run. This check
 * runs it in Node and asserts the full 4-iteration Dynamic ReAct flow completes, so
 * a broken demo fails the docs build — not the reader's browser.
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
const result = await agent.run({ message: MESSAGE });

if (typeof result !== 'string') fail('agent paused unexpectedly (expected a final answer)');

// The exact final answer proves the WHOLE flow ran in order:
//   read_skill('billing') → redact_pii (→ [EMAIL]) → process_refund (→ $42) → final.
// If any iteration broke (skill didn't load, redaction skipped, refund missed), this
// string would differ.
if (result !== EXPECTED) {
  fail(`final answer drifted.\n  expected: ${EXPECTED}\n  got:      ${result}`);
}
if (!result.includes('[EMAIL]')) fail('PII was not redacted — redact_pii did not run');
if (!result.includes('$42')) fail('refund did not process — process_refund did not run');

console.log('[check:tryit] OK — the demo ran the full 4-iteration Dynamic ReAct flow');
console.log(`[check:tryit] answer: ${result}`);

// ── Skill-graph demo: the builder draws the routing graph the embed shows. It is
//    static (no run), so the guardrail asserts the compiled graph SHAPE matches
//    the declared .entry()/.route() calls — declared === drawn.
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
