import { describe, expect, it, vi } from 'vitest';
import { bedrock } from '../../../src/adapters/llm/BedrockProvider.js';
import { bedrockCacheFacts } from '../../../src/adapters/llm/bedrockModels.js';
import type { LLMRequest } from '../../../src/provider-contract/types.js';

const foundation = 'anthropic.claude-sonnet-4-5-20250929-v1:0';
const profile = 'us.' + foundation;
const arn = 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/' + profile;
const opaque = 'test-cache-profile-42';
const applicationArn =
  'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/' + opaque;

const request = (model: string): LLMRequest => ({
  model,
  systemPrompt: 'cacheable system',
  messages: [{ role: 'user', content: 'user' }],
  cacheMarkers: [{ field: 'system', boundaryIndex: 0, ttl: 'short', reason: 'fixture' }],
});

function adapter(inferenceProfileModels?: Record<string, string>) {
  class Converse {
    constructor(readonly input: unknown) {}
  }
  class ConverseStream {
    constructor(readonly input: unknown) {}
  }
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof ConverseStream)
      return {
        stream: (async function* () {
          yield { contentBlockDelta: { delta: { text: 'reply' } } };
          yield { messageStop: { stopReason: 'end_turn' } };
        })(),
      };
    return { output: { message: { content: [{ text: 'reply' }] } }, stopReason: 'end_turn' };
  });
  const provider = bedrock({
    _client: { send },
    _commands: { Converse, ConverseStream },
    ...(inferenceProfileModels && { inferenceProfileModels }),
  });
  return { provider, send };
}

describe('Bedrock profile cache identity', () => {
  it('keeps the submitted system profile ARN while using its verified cache facts in both transports', async () => {
    expect(bedrockCacheFacts(arn)).toBe(bedrockCacheFacts(profile));
    const { provider, send } = adapter();
    const caching = provider.promptCaching;
    if (typeof caching !== 'function') throw new Error('expected per-model caching facts');
    expect(caching(arn)).toEqual(caching(profile));
    await provider.complete(request(profile));
    await provider.complete(request(arn));
    for await (const _chunk of provider.stream!(request(arn))) {
      /* exercise the SDK stream */
    }
    const inputs = send.mock.calls.map(([command]) => (command as { input: object }).input);
    expect(inputs[0]).toMatchObject({
      modelId: profile,
      system: [{ text: 'cacheable system' }, { cachePoint: { type: 'default' } }],
    });
    expect(inputs[1]).toEqual({ ...inputs[0], modelId: arn });
    expect(inputs[2]).toEqual(inputs[1]);
  });

  it('uses an exact copied application-profile declaration and refuses undeclared spellings', async () => {
    const declaration = { [opaque]: foundation, [applicationArn]: profile };
    const { provider, send } = adapter(declaration);
    declaration[opaque] = 'unsupported';
    for (const model of [opaque, applicationArn, opaque + '-another'])
      await provider.complete(request(model));
    const inputs = send.mock.calls.map(([command]) => (command as { input: object }).input);
    expect(inputs[0]).toMatchObject({
      modelId: opaque,
      system: [{ text: 'cacheable system' }, { cachePoint: { type: 'default' } }],
    });
    expect(inputs[1]).toEqual({ ...inputs[0], modelId: applicationArn });
    expect(inputs[2]).toMatchObject({
      modelId: opaque + '-another',
      system: [{ text: 'cacheable system' }],
    });
  });
});
