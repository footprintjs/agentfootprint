/**
 * skillGraphQuickstartDemo — the SINGLE SOURCE for the 5-minute skill-graph page.
 *
 * `buildQuickstartSkillGraph()` returns a real `skillGraph({...})` — the object
 * form taught as the canonical spelling. The quickstart shows this exact file
 * (via <CodeFile region="demo">) AND draws the graph it returns with
 * <SkillGraphTryIt demo="quickstart">. The picture IS the compiled routing
 * graph, not a hand-drawn diagram — and the mermaid block on the page is this
 * graph's own `toMermaid()` output, pasted from a real run.
 *
 * Imports the `agentfootprint` PACKAGE (one copy), so the code here is the same
 * API a reader uses in their own app.
 */

// #region demo
import { defineTool } from 'agentfootprint';
import { defineSkill, skillGraph } from 'agentfootprint/context';

const refunds = defineSkill({
  id: 'refunds',
  description: 'Refunds and money-back requests. Unlocks process_refund.',
  body: 'Confirm the order id first, then call process_refund(orderId).',
  tools: [
    defineTool({
      name: 'process_refund',
      description: 'Issue a refund. Args: { orderId: string }.',
      execute: ({ orderId }: { orderId: string }) => `Refund for ${orderId} issued.`,
    }),
  ],
});

const billing = defineSkill({
  id: 'billing',
  description: 'Charges, invoices and billing statements.',
  body: 'Explain the charge line by line before offering anything else.',
});

const triage = defineSkill({
  id: 'triage',
  description: 'Front desk for everything else.',
  body: 'Ask one clarifying question, then pick the right skill.',
});

/** Where a turn enters: first matching rule wins, top to bottom. */
export function buildQuickstartSkillGraph() {
  return skillGraph({
    skills: [refunds, billing, triage],
    start: {
      rules: [
        { match: /refund|money back/i, use: 'refunds' },
        { match: { keywords: ['charge', 'invoice'] }, use: 'billing' },
        { when: () => true, use: 'triage' }, // catch-all — code works beside data
      ],
    },
    scopeTools: true, // tools follow the graph's position (default false until 10.0.0)
  });
}
// #endregion demo
