/**
 * 16 — LLM providers: one agent, swappable backend (incl. Azure OpenAI).
 *
 * Every backend implements the same `LLMProvider`, so the agent code never
 * changes. This picks a provider from the environment — Azure OpenAI, Anthropic,
 * OpenAI, or (default, $0, offline) the mock — and runs the same agent.
 *
 * Connecting a COMPANY endpoint falls into three buckets:
 *   1. OpenAI-compatible (Together/Groq/OpenRouter/vLLM/LiteLLM): openai({ baseURL, apiKey })
 *   2. Azure OpenAI (*.openai.azure.com): azureOpenai({ endpoint, apiKey, apiVersion, deployment })
 *   3. anything else: implement the LLMProvider interface yourself.
 *
 * Run:  npx tsx examples/features/16-providers.ts
 *   (set AZURE_OPENAI_API_KEY + OPENAI_BASE_URL + MODEL_NAME + AZURE_OPENAI_API_VERSION
 *    to drive a real Azure deployment; otherwise it runs on the mock.)
 */

import { Agent, mock, type LLMProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/16-providers',
  title: 'LLM providers — pick by env (Azure OpenAI / Anthropic / OpenAI / mock)',
  group: 'features',
  description:
    'One agent, swappable provider. Azure OpenAI via azureOpenai(); OpenAI-compatible company endpoints via openai({ baseURL }); mock for $0 offline runs. Same LLMProvider interface.',
  defaultInput: 'ping',
  providerSlots: ['default'],
  tags: ['feature', 'providers', 'azure', 'adapters'],
};

/** Choose a provider from the environment; fall back to the mock so this always
 *  runs (CI, no keys). The mapping for Azure is the whole point of the example. */
async function pickProvider(): Promise<{ provider: LLMProvider; model: string; chosen: string }> {
  const azureEndpoint = process.env.OPENAI_BASE_URL ?? process.env.AZURE_OPENAI_ENDPOINT;
  if (process.env.AZURE_OPENAI_API_KEY && azureEndpoint) {
    const { azureOpenai } = await import('../../src/providers.js');
    return {
      provider: azureOpenai({
        endpoint: azureEndpoint, // https://my-co.openai.azure.com
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        apiVersion: process.env.AZURE_OPENAI_API_VERSION, // 2024-12-01-preview
        deployment: process.env.MODEL_NAME, // gpt-4o-128k (the deployment)
      }),
      model: 'azure', // shorthand → the configured deployment
      chosen: 'azure-openai',
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const { anthropic } = await import('../../src/providers.js');
    return { provider: anthropic(), model: 'claude-sonnet-4-6', chosen: 'anthropic' };
  }
  if (process.env.OPENAI_API_KEY) {
    const { openai } = await import('../../src/providers.js');
    return { provider: openai(), model: 'gpt-4o-mini', chosen: 'openai' };
  }
  return { provider: mock({ reply: 'pong (mock)' }), model: 'mock', chosen: 'mock' };
}

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const picked = provider ? { provider, model: 'mock', chosen: 'supplied' } : await pickProvider();

  const agent = Agent.create({ provider: picked.provider, model: picked.model, maxIterations: 2 })
    .system('You are a terse echo bot. Reply in one short line.')
    .build();

  const answer = await agent.run({ message: input });

  return {
    providerChosen: picked.chosen, // which bucket the env selected
    model: picked.model,
    answer,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
