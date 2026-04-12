/**
 * Sample 05: Message Strategies
 *
 * slidingWindow, charBudget — manage conversation context size.
 * These are MessageStrategy objects that plug into agentLoop / builder.
 */
import { userMessage, assistantMessage } from 'agentfootprint';
import { slidingWindow, charBudget } from 'agentfootprint/providers';

export async function run(_input: string) {
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

  const windowed = windowStrategy.prepare(messages);
  const truncated = budgetStrategy.prepare(messages);

  return {
    original: messages.length + ' messages',
    windowed: windowed.value.length + ' messages (' + windowed.rationale + ')',
    truncated: truncated.value.length + ' messages (' + truncated.rationale + ')',
  };
}

if (process.argv[1] === import.meta.filename) {
  run('').then(console.log);
}
