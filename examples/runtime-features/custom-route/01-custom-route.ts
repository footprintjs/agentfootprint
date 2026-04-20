/**
 * .route({ branches }) — inject user-defined routing branches ahead of
 * the default `tool-calls | final` routing. First match wins; the
 * branch's runner takes over without another LLM call.
 *
 * Middle ground between a plain Agent (too rigid) and a full Swarm
 * (adds an orchestrator LLM). Use when the trigger is a keyword / regex
 * in the agent's output, not another LLM decision.
 */

import { Agent, mock } from 'agentfootprint';
import type { RunnerLike, LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../../helpers/cli';

export const meta: ExampleMeta = {
  id: 'runtime-features/custom-route/01-custom-route',
  title: 'Agent.route() — custom routing branches',
  group: 'runtime-features',
  description: 'Inject branches into the agent decider — escalation without another LLM call.',
  defaultInput: "I've been waiting 2 weeks with no response, this is unacceptable!",
  providerSlots: ['default'],
  tags: ['custom-route', 'routing', 'runtime'],
};

const humanReviewAgent: RunnerLike = {
  async run(input: string) {
    return {
      content: `[ROUTED TO HUMAN REVIEW] Ticket queued: "${input}"`,
      messages: [],
    };
  },
};

const redactionAgent: RunnerLike = {
  async run(_input: string) {
    return {
      content: '[REDACTED] We removed sensitive data and will follow up separately.',
      messages: [],
    };
  },
};

const defaultMock = (): LLMProvider =>
  mock([{ content: '[ESCALATE] This user is frustrated, routing to human.' }]);

export async function run(input: string, provider?: LLMProvider) {
  const agent = Agent.create({ provider: provider ?? defaultMock() })
    .system('You are a support agent. Use [ESCALATE] if the user needs human help.')
    .route({
      branches: [
        {
          id: 'escalate',
          when: (s) =>
            typeof s.parsedResponse?.content === 'string' &&
            s.parsedResponse.content.includes('[ESCALATE]'),
          runner: humanReviewAgent,
        },
        {
          id: 'pii-leak',
          when: (s) =>
            typeof s.parsedResponse?.content === 'string' &&
            /\b\d{3}-\d{2}-\d{4}\b/.test(s.parsedResponse.content),
          runner: redactionAgent,
        },
      ],
    })
    .build();

  const result = await agent.run(input);
  return { content: result.content };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
