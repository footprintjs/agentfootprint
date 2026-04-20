/**
 * Parallel — fan-out, then merge. Run N runners concurrently, then
 * combine their outputs either via an LLM merge call or a pure function.
 *
 * Use case: multi-perspective review — ethics + cost + technical
 * reviewers all look at the same proposal in parallel, then a merge
 * step synthesizes their outputs into a single recommendation.
 */

import { Parallel, LLMCall, mock } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'concepts/05-parallel',
  title: 'Parallel — fan-out and merge',
  group: 'concepts',
  description: 'Run N runners concurrently, merge their results (LLM or pure function).',
  defaultInput: 'Build an internal LLM proxy with rate-limiting.',
  providerSlots: ['default'],
  tags: ['Parallel', 'composition', 'fan-out'],
};

const defaultMock = (): LLMProvider =>
  mock([
    { content: 'Ethics: minimal PII risk if rate-limiting logs are redacted.' },
    { content: 'Cost: ~$200/month in egress + compute at projected 10k req/day.' },
    { content: 'Technical: build on existing API gateway; 2-week estimate.' },
    {
      content:
        'Recommendation: proceed. All three dimensions are acceptable; redact PII in rate-limit logs per ethics review.',
    },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const obs = agentObservability();
  const p = provider ?? defaultMock();

  const ethicsReviewer = LLMCall.create({ provider: p })
    .system('Review the proposal from an ethics perspective. One sentence.')
    .build();

  const costReviewer = LLMCall.create({ provider: p })
    .system('Estimate the cost of the proposal. One sentence.')
    .build();

  const techReviewer = LLMCall.create({ provider: p })
    .system('Review the proposal from a technical feasibility perspective. One sentence.')
    .build();

  const review = Parallel.create({ provider: p, name: 'panel-review' })
    .agent('ethics', ethicsReviewer, 'Ethics review')
    .agent('cost', costReviewer, 'Cost review')
    .agent('tech', techReviewer, 'Technical review')
    .mergeWithLLM('Synthesize the three reviews into a single recommendation.')
    .recorder(obs)
    .build();

  const result = await review.run(input);
  return {
    content: result.content,
    branches: result.branches,
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
