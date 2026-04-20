/**
 * treeOfThoughts — N parallel thinkers → one judge picks the best.
 *
 * Fan out N parallel attempts (typically the same prompt + temperature
 * variance), concatenate them as labeled candidates, hand to a judge
 * runner that picks or synthesizes the best answer.
 *
 * Background: Tree of Thoughts (Yao et al. 2023, NeurIPS).
 * HONESTY BOX: the shipped factory is N-parallel-then-judge — closer to
 * Self-Consistency (Wang et al. 2022) than full ToT. Real ToT does tree
 * search over thought states (BFS/DFS with backtracking). To approximate,
 * wrap this in a `Conditional` loop that prunes and re-expands.
 */

import { Agent, LLMCall, mock } from 'agentfootprint';
import { treeOfThoughts } from 'agentfootprint/patterns';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'patterns/04-tree-of-thoughts',
  title: 'treeOfThoughts — N thinkers → judge',
  group: 'patterns',
  description: 'Fan out N parallel attempts, judge picks the best.',
  defaultInput: 'How should we evaluate this design?',
  providerSlots: ['thinker', 'judge'],
  tags: ['Patterns', 'treeOfThoughts', 'self-consistency', 'composition'],
};

export async function run(
  input: string,
  providers?: { thinker?: LLMProvider; judge?: LLMProvider },
) {
  // Default mock — gives each thinker a different scripted response so the
  // judge sees real candidate variation.
  const thinkerProvider = providers?.thinker;
  const judgeProvider = providers?.judge ??
    mock([{ content: 'Best: candidate 2 — most specific and actionable.' }]);

  // Top-level provider just used for the Parallel merge wiring; actual
  // thinkers each get their own provider in the factory.
  const wireProvider = providers?.thinker ?? mock([{ content: 'wire-only' }]);

  const tot = treeOfThoughts({
    provider: wireProvider,
    branches: 3,
    thinker: (i) =>
      LLMCall.create({
        provider: thinkerProvider ?? mock([{ content: `candidate answer ${i + 1}` }]),
      })
        .system(`Thinker ${i + 1}: propose a solution.`)
        .build(),
    judge: Agent.create({ provider: judgeProvider }).system('Pick the best answer and justify.').build(),
  });

  const result = await tot.run(input);
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
