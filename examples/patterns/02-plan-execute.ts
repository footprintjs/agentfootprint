/**
 * planExecute — Planner → Executor.
 *
 * Two runners chained sequentially: planner produces a plan from the
 * request; executor carries it out. The two providers can be different
 * (cheap planner + capable executor is a common cost-saving pattern).
 *
 * Background: related to Plan-and-Solve Prompting (Wang et al. 2023, ACL),
 * ReWOO (Xu et al. 2023), and the planner/executor split in HuggingGPT
 * (Shen et al. 2023). The shipped factory is the simplest two-stage form.
 */

import { Agent, mock } from 'agentfootprint';
import { planExecute } from 'agentfootprint/patterns';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'patterns/02-plan-execute',
  title: 'planExecute — planner → executor',
  group: 'patterns',
  description: 'Plan first, then execute. Cheap planner + capable executor.',
  defaultInput: 'Write a launch announcement for our new feature.',
  providerSlots: ['planner', 'executor'],
  tags: ['Patterns', 'planExecute', 'composition'],
};

const defaultPlannerMock = (): LLMProvider =>
  mock([{ content: '1. gather requirements\n2. draft\n3. review' }]);

const defaultExecutorMock = (): LLMProvider =>
  mock([{ content: 'Executed plan: launch announcement drafted with key points.' }]);

export async function run(
  input: string,
  providers?: { planner?: LLMProvider; executor?: LLMProvider },
) {
  const planner = Agent.create({ provider: providers?.planner ?? defaultPlannerMock() })
    .system('Produce a numbered plan. Do not execute.')
    .build();

  const executor = Agent.create({ provider: providers?.executor ?? defaultExecutorMock() })
    .system('Execute the given plan step by step.')
    .build();

  const pipeline = planExecute({ planner, executor });
  const result = await pipeline.run(input);
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
