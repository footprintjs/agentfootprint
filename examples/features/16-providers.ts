/**
 * 16 — LLM providers: one agent, swappable backend (incl. Azure OpenAI).
 *
 * Every backend implements the same `LLMProvider`, so the agent code never
 * changes. `providerFromEnv()` reads your `.env` and configures the right
 * provider with NO branching in your code — Azure OpenAI, Anthropic, OpenAI, or
 * (with `{ fallbackToMock }`, $0/offline) the mock.
 *
 * Connecting a COMPANY endpoint falls into three buckets:
 *   1. OpenAI-compatible (Together/Groq/OpenRouter/vLLM/LiteLLM): openai({ baseURL, apiKey })
 *   2. Azure OpenAI (*.openai.azure.com): azureOpenai({ endpoint, apiKey, apiVersion, deployment })
 *   3. anything else: implement the LLMProvider interface yourself.
 * `providerFromEnv()` handles buckets 1–2 (and Anthropic) straight from env vars.
 *
 * Run:  npx tsx examples/features/16-providers.ts
 *   (set AZURE_OPENAI_API_KEY + OPENAI_BASE_URL + MODEL_NAME + AZURE_OPENAI_API_VERSION
 *    to drive a real Azure deployment; otherwise it runs on the mock.)
 */

import { Agent, providerFromEnv, type LLMProvider } from '../../src/index.js';
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

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  // One call reads the env and configures the right provider. `fallbackToMock`
  // keeps this runnable in CI / with no keys. (A supplied provider — e.g. the
  // example runner's mock slot — wins so the suite never hits a real network.)
  const picked = provider
    ? { provider, model: 'mock', kind: 'supplied' as const }
    : providerFromEnv({ fallbackToMock: true });

  const agent = Agent.create({ provider: picked.provider, model: picked.model, maxIterations: 2 })
    .system('You are a terse echo bot. Reply in one short line.')
    .build();

  const answer = await agent.run({ message: input });

  return {
    providerChosen: picked.kind, // which bucket the env selected
    model: picked.model,
    answer,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
