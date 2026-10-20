/** Public SDK injection must never fall through to the credential-bearing loader. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bedrock, BedrockProvider } from '../../../src/adapters/llm/BedrockProvider.js';
import type { LLMRequest } from '../../../src/provider-contract/types.js';

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../../src/lib/lazyRequire.js', () => ({ lazyRequire: load }));
const request: LLMRequest = { model: 'bedrock', messages: [{ role: 'user', content: 'fixture' }] };
const response = {
  output: { message: { content: [{ text: 'local' }] } },
  usage: { inputTokens: 1, outputTokens: 1 },
};
class ConverseCommand {
  constructor(readonly input: unknown) {}
}
class ConverseStreamCommand {
  constructor(readonly input: unknown) {}
}
function fixture() {
  const send = vi.fn(async (command: unknown) =>
    command instanceof ConverseStreamCommand
      ? {
          stream: (async function* () {
            yield { contentBlockDelta: { delta: { text: 'local' } } };
            yield { metadata: { usage: { inputTokens: 1, outputTokens: 1 } } };
          })(),
        }
      : response,
  );
  const constructed = vi.fn();
  const sdk = {
    ConverseCommand,
    ConverseStreamCommand,
    BedrockRuntimeClient: class {
      constructor(config: { region?: string }) {
        constructed(config);
      }
      send = send;
    },
  };
  return { sdk, send, constructed, client: { send } };
}
beforeEach(() => {
  load.mockReset();
  load.mockImplementation(() => {
    throw new Error('default SDK loader must not run');
  });
});
describe('Bedrock public sdk and client', () => {
  it('omitting injection keeps the default SDK construction path', async () => {
    const f = fixture();
    load.mockReturnValue(f.sdk);
    await bedrock({ region: 'fixture-region' }).complete(request);
    expect(load.mock.calls).toEqual([['@aws-sdk/client-bedrock-runtime']]);
    expect(f.constructed.mock.calls).toEqual([[{ region: 'fixture-region' }]]);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('refuses a removed option without reading its value or credentials', () => {
    const read = vi.fn(() => {
      throw new Error('SYNTHETIC-NOT-A-CREDENTIAL');
    });
    const options = Object.defineProperty({}, '_sdk', { get: read });
    expect(() => bedrock(options)).toThrow('_sdk');
    expect(read).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
  it.each(['factory', 'class'] as const)(
    '%s uses the injected module for both commands without a default SDK load',
    async (form) => {
      const f = fixture();
      const options = { sdk: f.sdk, region: 'fixture-region' };
      const p = form === 'factory' ? bedrock(options) : new BedrockProvider(options);
      expect((await p.complete(request)).content).toBe('local');
      const chunks = [];
      for await (const c of p.stream!(request)) chunks.push(c);
      expect(chunks.at(-1)?.response?.content).toBe('local');
      expect(f.constructed.mock.calls).toEqual([[{ region: 'fixture-region' }]]);
      expect(f.send.mock.calls[0]?.[0]).toBeInstanceOf(ConverseCommand);
      expect(f.send.mock.calls[1]?.[0]).toBeInstanceOf(ConverseStreamCommand);
      expect(load).not.toHaveBeenCalled();
    },
  );
  it('client owns credentials/configuration and never touches the SDK client constructor', async () => {
    const f = fixture();
    const sdk = {
      ConverseCommand,
      ConverseStreamCommand,
      get BedrockRuntimeClient() {
        throw new Error('must not construct or inspect an unused client');
      },
    };
    await bedrock({ sdk, client: f.client, region: 'ignored' }).complete(request);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
  });
  it('client without sdk uses the normal installed module only for commands', async () => {
    const f = fixture();
    load.mockReturnValue(f.sdk);
    await bedrock({ client: f.client }).complete(request);
    expect(load.mock.calls).toEqual([['@aws-sdk/client-bedrock-runtime']]);
    expect(f.constructed).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each(['ConverseCommand', 'ConverseStreamCommand'] as const)(
    'refuses a module missing %s before constructing any client',
    (name) => {
      const f = fixture();
      const sdk = { ...f.sdk, [name]: undefined };
      expect(() => bedrock({ sdk })).toThrow(name);
      expect(load).not.toHaveBeenCalled();
      expect(f.constructed).not.toHaveBeenCalled();
    },
  );
  it('requires the client constructor only when client is absent', () => {
    expect(() => bedrock({ sdk: { ConverseCommand, ConverseStreamCommand } })).toThrow(
      'BedrockRuntimeClient',
    );
    expect(load).not.toHaveBeenCalled();
  });
  it.each(['_sdk', '_client', '_commands'])(
    'refuses removed %s by name before any loader, without echoing values',
    (name) => {
      const f = fixture();
      try {
        bedrock({ sdk: f.sdk, client: f.client, [name]: 'SYNTHETIC-NOT-A-CREDENTIAL' });
        throw new Error('expected refusal');
      } catch (e) {
        expect((e as Error).message).toContain(name);
        expect((e as Error).message).not.toContain('SYNTHETIC-NOT-A-CREDENTIAL');
      }
      expect(load).not.toHaveBeenCalled();
      expect(f.constructed).not.toHaveBeenCalled();
      expect(f.send).not.toHaveBeenCalled();
    },
  );
  it('missing-peer advice names the public options', () => {
    expect(() => bedrock()).toThrow('sdk');
    expect(() => bedrock()).not.toThrow('_client');
  });
});
