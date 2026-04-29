/**
 * 01 — Instruction: rule-based system-prompt injection.
 *
 * `defineInstruction` evaluates `activeWhen(ctx)` once per iteration.
 * If the predicate matches, the instruction's `prompt` text appends
 * to that iteration's system prompt (tagged `source: 'instructions'`).
 *
 * This is the most flexible Instruction-style flavor — predicates can
 * inspect iteration, userMessage, history, lastToolResult, and the set
 * of activated Skills.
 */

import {
  Agent,
  defineInstruction,
  mock,
  type LLMProvider,
} from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/01-instruction',
  title: 'Instruction — rule-based system-prompt guidance',
  group: 'context-engineering',
  description:
    'Predicate-driven instruction. Active when ctx matches; prompt text ' +
    'appended to that iteration\'s system slot with source=instructions.',
  defaultInput: "I'm really frustrated about my refund",
  providerSlots: ['default'],
  tags: ['context-engineering', 'instruction', 'rule-based'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // #region define
  const calmTone = defineInstruction({
    id: 'calm-tone',
    description: 'Calm, empathetic tone with frustrated users.',
    activeWhen: (ctx) => /upset|angry|frustrated/i.test(ctx.userMessage),
    prompt: 'The user sounds upset. Acknowledge feelings before facts. Avoid corporate jargon.',
  });

  const concise = defineInstruction({
    id: 'concise',
    activeWhen: (ctx) => ctx.iteration === 1, // first iteration only
    prompt: 'Keep your first response under 3 sentences.',
  });
  // #endregion define

  // #region attach
  const agent = Agent.create({
    provider: provider ?? mock({ reply: 'I hear you. Let me help.' }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You are a customer support assistant.')
    .instruction(calmTone)
    .instruction(concise)
    .build();
  // #endregion attach

  const result = await agent.run({ message: input });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
