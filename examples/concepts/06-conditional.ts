/**
 * Conditional — if/else routing between runners. Predicates evaluated
 * in `.when()` order, first match wins; falls through to `.otherwise()`.
 *
 * Use case: triage — route refunds to a refund specialist, everything
 * else to general support. Deterministic routing, no LLM in the decision.
 */

import { Agent, Conditional, mock } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'concepts/06-conditional',
  title: 'Conditional — deterministic triage',
  group: 'concepts',
  description: 'Route input between runners based on predicates. No LLM in the decision.',
  defaultInput: 'I want a refund for order #42',
  providerSlots: ['default'],
  tags: ['Conditional', 'routing', 'composition'],
};

const defaultMock = (): LLMProvider =>
  mock([
    { content: 'Refund initiated. Confirmation #R-00123.' },
    { content: 'General support reply.' },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const obs = agentObservability();
  const p = provider ?? defaultMock();

  const refundAgent = Agent.create({ provider: p })
    .system('You are the refund specialist.')
    .build();

  const supportAgent = Agent.create({ provider: p })
    .system('You are general support.')
    .build();

  const triage = Conditional.create({ name: 'triage' })
    .when((i) => /refund|money back|chargeback/i.test(i), refundAgent, {
      id: 'refund',
      name: 'Refund Specialist',
    })
    .otherwise(supportAgent, { name: 'General Support' })
    .recorder(obs)
    .build();

  const result = await triage.run(input);
  return {
    content: result.content,
    tokens: obs.tokens(),
    tools: obs.tools(),
    cost: obs.cost(),
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
