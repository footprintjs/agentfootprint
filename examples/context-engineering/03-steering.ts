/**
 * 03 — Steering: always-on system-prompt rule.
 *
 * `defineSteering` produces an Injection with `trigger: { kind: 'always' }`.
 * Use for invariants — output format, persona, safety policies.
 * Every iteration, the steering text is part of the system prompt
 * (tagged `source: 'steering'`).
 */

import { Agent, defineSteering, mock, type LLMProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/03-steering',
  title: 'Steering — always-on system-prompt rule',
  group: 'context-engineering',
  description:
    'Always-on guidance. Use for output format, persona, safety. Every ' +
    'iteration includes it; predicates not needed.',
  defaultInput: 'What is the weather in Tokyo?',
  providerSlots: ['default'],
  tags: ['context-engineering', 'steering', 'always-on'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const jsonOnly = defineSteering({
    id: 'json-only',
    description: 'Force JSON output every turn.',
    prompt: 'Always respond with valid JSON. No prose. No markdown fences.',
  });

  const persona = defineSteering({
    id: 'persona',
    prompt: 'You are Atlas, a concise weather analyst. Use metric units only.',
  });

  const safety = defineSteering({
    id: 'safety',
    prompt: 'Never speculate about events you cannot verify with the data given.',
  });

  const agent = Agent.create({
    provider: provider ?? mock({ reply: '{"city":"Tokyo","temp_c":18,"conditions":"clear"}' }),
    model: 'mock',
    maxIterations: 1,
  })
    .steering(jsonOnly)
    .steering(persona)
    .steering(safety)
    .build();

  const result = await agent.run({ message: input });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
