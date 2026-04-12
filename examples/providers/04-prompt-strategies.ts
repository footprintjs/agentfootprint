/**
 * Sample 04: Prompt Strategies
 *
 * Different system prompts per runner — same input, different behavior.
 */
import { LLMCall, mock } from 'agentfootprint';

export async function run(input: string) {
  const summarizer = LLMCall
    .create({ provider: mock([{ content: 'This is a concise summary of the input.' }]) })
    .system('You are a summarizer. Be concise.')
    .build();

  const translator = LLMCall
    .create({ provider: mock([{ content: 'Ceci est une traduction en francais.' }]) })
    .system('You are a translator. Translate to French.')
    .build();

  const r1 = await summarizer.run(input);
  const r2 = await translator.run(input);

  return { summary: r1.content, translation: r2.content };
}

if (process.argv[1] === import.meta.filename) {
  run('AI is transforming the world.').then(console.log);
}
