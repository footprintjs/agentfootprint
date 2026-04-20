/**
 * reflexion — Solve → Critique → Improve (single-pass).
 *
 * Three runners chained: a solver drafts an answer, a critic lists
 * weaknesses, an improver integrates the critique. A single self-review
 * pass catches a surprising number of reasoning / code / plan errors.
 *
 * Background: named after Reflexion (Shinn et al. 2023, NeurIPS).
 * HONESTY BOX: the shipped factory is one critique pass — closer to
 * Self-Refine (Madaan et al. 2023) than full Reflexion. Real Reflexion
 * has long-term reflection memory and a quality-gated loop. To
 * approximate the loop, wrap with `Conditional`.
 */

import { Agent, mock } from 'agentfootprint';
import { reflexion } from 'agentfootprint/patterns';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'patterns/03-reflexion',
  title: 'reflexion — solve → critique → improve',
  group: 'patterns',
  description: 'Self-review pass: draft, find weaknesses, integrate the critique.',
  defaultInput: 'Explain monads in plain English.',
  providerSlots: ['solver', 'critic', 'improver'],
  tags: ['Patterns', 'reflexion', 'self-refine', 'composition'],
};

const defaultMock = (): LLMProvider => mock([{ content: 'placeholder — see specific slots below' }]);

export async function run(
  input: string,
  providers?: { solver?: LLMProvider; critic?: LLMProvider; improver?: LLMProvider },
) {
  const solver = Agent.create({
    provider: providers?.solver ?? mock([{ content: 'Initial draft.' }]),
  })
    .system('Draft an answer.')
    .build();

  const critic = Agent.create({
    provider: providers?.critic ?? mock([{ content: 'Missing concrete examples.' }]),
  })
    .system('List weaknesses.')
    .build();

  const improver = Agent.create({
    provider: providers?.improver ?? mock([{ content: 'Improved draft with examples added.' }]),
  })
    .system('Apply the critique.')
    .build();

  // Suppress unused-var warning when no providers passed
  void defaultMock;

  const reviewer = reflexion({ solver, critic, improver });
  const result = await reviewer.run(input);
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
