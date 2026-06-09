/**
 * azureOpenai() — Azure OpenAI provider.
 *
 * Azure routes by DEPLOYMENT name (Azure's "model") and uses the SDK's
 * AzureOpenAI client; this provider reuses openai()'s completion/streaming logic
 * via an injected `_client`. Tests use a fake client that records the params, so
 * we assert deployment routing + response mapping without the real SDK/network.
 */

import { describe, expect, it, vi } from 'vitest';
import { azureOpenai } from '../../../src/adapters/llm/OpenAIProvider.js';
import type { LLMRequest } from '../../../src/adapters/types.js';

function fakeClient(recorder: { params: Array<{ model: string; stream?: boolean }> }) {
  return {
    chat: {
      completions: {
        create: vi.fn((params: { model: string; stream?: boolean }) => {
          recorder.params.push(params);
          if (params.stream) {
            return (async function* () {
              yield {
                id: 'az1',
                model: params.model,
                choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
              };
              yield {
                id: 'az1',
                model: params.model,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 5, completion_tokens: 1 },
              };
            })();
          }
          return Promise.resolve({
            id: 'az1',
            model: params.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'hi from azure' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 1 },
          });
        }),
      },
    },
  };
}

const req = (model: string): LLMRequest => ({
  model,
  messages: [{ role: 'user', content: 'q' }],
});

describe('azureOpenai()', () => {
  it('names itself azure-openai', () => {
    const p = azureOpenai({ _client: fakeClient({ params: [] }), deployment: 'gpt-4o-128k' });
    expect(p.name).toBe('azure-openai');
  });

  it("routes the shorthand model 'azure' to the configured deployment", async () => {
    const rec = { params: [] as Array<{ model: string }> };
    const p = azureOpenai({ _client: fakeClient(rec), deployment: 'gpt-4o-128k' });
    const res = await p.complete(req('azure'));
    expect(rec.params[0]!.model).toBe('gpt-4o-128k'); // deployment, not 'azure'
    expect(res.content).toBe('hi from azure');
    expect(res.usage).toEqual({ input: 5, output: 1 });
  });

  it("also maps 'azure-openai' and 'openai' shorthands to the deployment", async () => {
    for (const shorthand of ['azure-openai', 'openai']) {
      const rec = { params: [] as Array<{ model: string }> };
      const p = azureOpenai({ _client: fakeClient(rec), deployment: 'dep-x' });
      await p.complete(req(shorthand));
      expect(rec.params[0]!.model).toBe('dep-x');
    }
  });

  it('passes a concrete deployment id through (target multiple deployments)', async () => {
    const rec = { params: [] as Array<{ model: string }> };
    const p = azureOpenai({ _client: fakeClient(rec), deployment: 'default-dep' });
    await p.complete(req('another-deployment'));
    expect(rec.params[0]!.model).toBe('another-deployment');
  });

  it('streams (delegates to the openai streaming path) and routes the deployment', async () => {
    const rec = { params: [] as Array<{ model: string; stream?: boolean }> };
    const p = azureOpenai({ _client: fakeClient(rec), deployment: 'gpt-4o-128k' });
    let final: { content: string } | undefined;
    for await (const chunk of p.stream!(req('azure'))) {
      if (chunk.done) final = chunk.response;
    }
    expect(rec.params[0]).toMatchObject({ model: 'gpt-4o-128k', stream: true });
    expect(final?.content).toBe('hi');
  });

  it('requires a deployment (errors when none given and no env)', () => {
    const prevDep = process.env.AZURE_OPENAI_DEPLOYMENT;
    const prevModel = process.env.MODEL_NAME;
    delete process.env.AZURE_OPENAI_DEPLOYMENT;
    delete process.env.MODEL_NAME;
    try {
      expect(() => azureOpenai({ _client: fakeClient({ params: [] }) })).toThrow(/deployment/i);
    } finally {
      if (prevDep !== undefined) process.env.AZURE_OPENAI_DEPLOYMENT = prevDep;
      if (prevModel !== undefined) process.env.MODEL_NAME = prevModel;
    }
  });
});
