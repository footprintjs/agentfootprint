/**
 * skillGraphDemo — the SINGLE SOURCE for the skill-graph embed.
 *
 * `buildSupportSkillGraph()` returns a real `skillGraph().build()` — the very
 * object an agent runs on via `Agent.create()....skillGraph(graph)`. The embed
 * shows this exact builder (via <CodeFile region="demo">) AND draws the graph it
 * returns with <SkillGraphFlow>. The picture IS the compiled routing graph — its
 * `nodes` / `edges` are a build product of the same `.entry()` / `.route()` calls,
 * not a hand-drawn diagram.
 *
 * Imports the `agentfootprint` PACKAGE (one copy), so the builder here is the same
 * API a reader uses in their own app.
 */

// #region demo
import { defineSkill, defineTool, skillGraph } from 'agentfootprint';

// Three skills the support agent can be "in". Each carries its own playbook
// (body) and unlocks its own tools only while it's the active skill.
const triage = defineSkill({
  id: 'triage',
  description: 'Front desk — decide whether this is a billing or a tech issue.',
  body: 'Classify the request. Read the billing skill for refunds/charges; read the tech skill for errors/bugs.',
});

const billing = defineSkill({
  id: 'billing',
  description: 'Refunds and charges. Unlocks process_refund.',
  body: 'Redact PII first, then issue the refund.',
  tools: [
    defineTool({
      name: 'process_refund',
      description: 'Issue a refund. Args: { amount: number }.',
      inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
      execute: ({ amount }: { amount: number }) => `Refund of $${amount} issued.`,
    }),
  ],
});

const tech = defineSkill({
  id: 'tech',
  description: 'Bugs and errors. Unlocks run_diagnostic.',
  body: 'Reproduce the issue, run a diagnostic, then summarize the fix.',
  tools: [
    defineTool({
      name: 'run_diagnostic',
      description: 'Run a system diagnostic. Args: { area: string }.',
      inputSchema: { type: 'object', properties: { area: { type: 'string' } } },
      execute: ({ area }: { area: string }) => `Diagnostic for ${area}: all systems green.`,
    }),
  ],
});

/**
 * The support agent's routing graph. `triage` is where every turn starts; a tool
 * result that looks like a billing or tech case routes the cursor onward. Feed the
 * SAME object to an agent with `Agent.create()....skillGraph(graph)` — the routes
 * below ARE the agent's runtime cursor logic.
 */
export function buildSupportSkillGraph() {
  return skillGraph()
    .entry(triage)
    .route(triage, billing, { when: (r) => /refund|charge|bill/i.test(String(r.result)) })
    .route(triage, tech, { when: (r) => /error|bug|crash/i.test(String(r.result)) })
    .build();
}
// #endregion demo
