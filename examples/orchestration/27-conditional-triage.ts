/**
 * Conditional — triage input between runners without an LLM.
 *
 * Conditional is the DAG "branch" primitive: pick one runner based on a
 * synchronous predicate, run it, return the result. Distinct from
 * `Agent.route()` which branches INSIDE an agent's ReAct loop — this one
 * routes between entire runners at the top level.
 *
 * This example uses the `mock` adapter so it runs deterministically with no
 * network or API keys. Swap in `anthropic(...)` / `openai(...)` in production.
 *
 * Run: npx tsx examples/orchestration/27-conditional-triage.ts
 */

import { Agent, Conditional, mock } from 'agentfootprint';

async function main() {
  // Two backends — one for refunds, one for everything else.
  // In production each would have its own system prompt / tools / provider.
  const refundAgent = Agent.create({
    provider: mock([{ content: 'Refund initiated. Confirmation #R-00123.' }]),
  })
    .system('You are the refund specialist.')
    .build();

  const supportAgent = Agent.create({
    provider: mock([{ content: 'General support reply.' }]),
  })
    .system('You are general support.')
    .build();

  // Triage: if the message mentions "refund", go to the specialist.
  // Otherwise fall back to general support.
  const triage = Conditional.create({ name: 'triage' })
    .when((input) => /refund|money back|chargeback/i.test(input), refundAgent, {
      id: 'refund',
      name: 'Refund Specialist',
    })
    .otherwise(supportAgent, { name: 'General Support' })
    .build();

  const result1 = await triage.run('I want a refund for order #42');
  console.log('→ refund path :', result1.content);

  const result2 = await triage.run('How do I reset my password?');
  console.log('→ general path:', result2.content);

  // The narrative shows which branch was chosen and why — `decide()` captures
  // the matching rule as evidence on the FlowRecorder event.
  console.log('\nNarrative (second run):');
  for (const line of triage.getNarrative()) {
    console.log('  ' + line);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
