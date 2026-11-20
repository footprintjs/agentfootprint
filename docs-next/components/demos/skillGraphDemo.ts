// #region demo
/**
 * The support agent's routing graph. `triage` is where every turn starts; a tool
 * result that looks like a billing or tech case routes the cursor onward. Feed the
 * SAME object to an agent with `Agent.create()....skillGraph(graph)` — the steps
 * below ARE the agent's runtime cursor logic.
 */
export function buildSupportSkillGraph({ defineTool, defineSkill, skillGraph }: {
  defineTool: typeof import('agentfootprint').defineTool;
  defineSkill: typeof import('agentfootprint/context').defineSkill;
  skillGraph: typeof import('agentfootprint/context').skillGraph;
}) {
  // Each of the three skills defines a playbook and can declare tools.
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

  return skillGraph({
    skills: [triage, billing, tech],
    start: 'triage',
    steps: [
      { from: 'triage', to: 'billing', when: (r) => /refund|charge|bill/i.test(String(r.result)) },
      { from: 'triage', to: 'tech', when: (r) => /error|bug|crash/i.test(String(r.result)) },
    ],
  });
}
// #endregion demo
