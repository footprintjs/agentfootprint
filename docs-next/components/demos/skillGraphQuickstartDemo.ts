// #region demo
/** Where a turn enters: first matching rule wins, top to bottom. */
export function buildQuickstartSkillGraph({ defineTool, defineSkill, skillGraph }: {
  defineTool: typeof import('agentfootprint').defineTool;
  defineSkill: typeof import('agentfootprint/context').defineSkill;
  skillGraph: typeof import('agentfootprint/context').skillGraph;
}) {
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

  return skillGraph({
    skills: [refunds, billing, triage],
    start: {
      rules: [
        { match: /refund|money back/i, use: 'refunds' },
        { match: { keywords: ['charge', 'invoice'] }, use: 'billing' },
        { when: () => true, use: 'triage' }, // catch-all — code works beside data
      ],
    },
    scopeTools: true, // tools follow the graph's position
  });
}
// #endregion demo
