/**
 * 04 — Fact: developer-supplied data injection.
 *
 * `defineFact` is the Context-style flavor: it injects DATA the LLM
 * should know, not behavior rules. Use for user profile, env info,
 * computed summaries, current time, cached config.
 *
 * Targets system-prompt by default (most common — facts the model
 * should always have in mind). Pass `slot: 'messages'` for facts that
 * should appear inline with conversation history.
 */

import { Agent, defineFact, mock, type LLMProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'context-engineering/04-fact',
  title: 'Fact — developer-supplied data injection',
  group: 'context-engineering',
  description:
    'Inject data (user profile, env info, current time) the LLM should ' +
    'see in addition to user messages and tool results.',
  defaultInput: 'When did I sign up?',
  providerSlots: ['default'],
  tags: ['context-engineering', 'fact', 'data-injection'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const userProfile = defineFact({
    id: 'user-profile',
    description: 'Current user identity + plan',
    data: 'User: Alice Chen. Plan: Pro. Joined: 2024-01-15. Locale: en-US.',
  });

  const turnTime = defineFact({
    id: 'turn-time',
    data: `Current time: ${new Date().toISOString()}. Server timezone: UTC.`,
  });

  // Conditional fact — only after the user has been chatting for a few
  // turns. (For demo, predicate trivially returns true; predicates can
  // inspect history to gate facts.)
  const sessionContext = defineFact({
    id: 'session',
    data: 'Session started via support chat widget. User is on the pricing page.',
    activeWhen: (ctx) => ctx.iteration >= 1,
  });

  const agent = Agent.create({
    provider: provider ?? mock({ reply: 'You signed up on 2024-01-15.' }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You are a helpful assistant. Use facts you know about the user.')
    .fact(userProfile)
    .fact(turnTime)
    .fact(sessionContext)
    .build();

  const result = await agent.run({ message: input });
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
