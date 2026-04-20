/**
 * MessageStrategy — control which messages are sent to the LLM each
 * turn. Critical for managing context window limits.
 *
 * slidingWindow / charBudget / summaryStrategy / persistentHistory all
 * share the `prepare(history, context)` shape — swap them without
 * rewriting the agent.
 */

import { userMessage, assistantMessage } from 'agentfootprint';
import { slidingWindow, charBudget } from 'agentfootprint/providers';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'providers/02-message',
  title: 'MessageStrategy — context window management',
  group: 'providers',
  description: 'slidingWindow and charBudget — trim history to fit the context window.',
  defaultInput: '',
  providerSlots: [],
  tags: ['MessageStrategy', 'providers', 'context-window'],
};

export async function run(_input: string, _provider?: LLMProvider) {
  const messages = [
    userMessage('First question'),
    assistantMessage('First answer'),
    userMessage('Second question'),
    assistantMessage('Second answer'),
    userMessage('Third question'),
    assistantMessage('Third answer'),
    userMessage('Fourth question'),
  ];

  const windowStrategy = slidingWindow({ maxMessages: 4 });
  const budgetStrategy = charBudget({ maxChars: 100 });

  const dummyContext = { message: '', turnNumber: 1, loopIteration: 0 };
  const windowed = await windowStrategy.prepare(messages, dummyContext);
  const truncated = await budgetStrategy.prepare(messages, dummyContext);

  return {
    original: `${messages.length} messages`,
    windowed: `${windowed.value.length} messages (${windowed.rationale})`,
    truncated: `${truncated.value.length} messages (${truncated.rationale})`,
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
