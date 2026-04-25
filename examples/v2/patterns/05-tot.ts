/**
 * Pattern 05 — Tree of Thoughts (Yao et al., 2023).
 *
 * Beam-search reasoning: at each depth level, generate K candidate
 * thoughts in parallel, score each, keep the top `beamWidth` survivors,
 * and expand again. Final output is the best thought at the deepest level.
 * https://arxiv.org/abs/2305.10601
 *
 * Run:  npx tsx examples/v2/patterns/05-tot.ts
 */

import { tot, MockProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'v2/patterns/05-tot',
  title: 'Tree of Thoughts (Yao et al., 2023)',
  group: 'v2-patterns',
  description: 'BFS reasoning: Loop(Parallel(K thoughts)) with scoring + beam-width pruning each level. Paper: https://arxiv.org/abs/2305.10601',
  defaultInput: 'Solve: find path.',
  providerSlots: ['default'],
  tags: ['v2', 'pattern', 'ToT', 'beam-search'],
};


export async function run(input: string, _provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  // Mock thought generator — produces distinct thoughts of varying length.
  // The scorer (below) prefers longer thoughts, so the best survivors
  // converge on the longest phrasings.
  const candidates = [
    'idea A: try left',
    'longer idea B: try the unexplored right path carefully',
    'C: maybe skip',
    'D: longer still — work bottom up with memoization',
    'E: top-down recursion',
    'F: dynamic programming table',
  ];
  let i = 0;

  const runner = tot({
    provider: new MockProvider({
      respond: () => candidates[i++ % candidates.length]!,
    }),
    model: 'mock',
    thoughtPrompt: 'Propose one next step toward solving the problem.',
    depth: 2,
    branchingFactor: 3,
    beamWidth: 1, // greedy — keep only the single best thought per level
    score: (thought) => thought.length, // arbitrary demo scorer
    temperature: 0.7,
  });

  const best = await runner.run({ message: 'Solve: find path.' });
  console.log('Best thought after 2 levels, 3 branches each:');
  console.log('→', best);
  return best;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
