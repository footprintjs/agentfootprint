/**
 * Sample 01: Simple LLM Call
 *
 * LLMCall builder + agentObservability — the simplest concept.
 * Single LLM call, no tools, no loop.
 */
import { LLMCall, mock } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';

export async function run(input: string) {
  const obs = agentObservability();

  const runner = LLMCall
    .create({ provider: mock([{ content: 'This text discusses AI safety and alignment challenges.' }]) })
    .system('Summarize the following text concisely:')
    .recorder(obs)
    .build();

  const result = await runner.run(input);
  return { content: result.content, tokens: obs.tokens(), tools: obs.tools(), cost: obs.cost() };
}

if (process.argv[1] === import.meta.filename) {
  run('Explain AI safety in one sentence.').then(console.log);
}
