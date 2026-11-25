import { describe, expect, it, vi } from 'vitest';
import {
  bedrock,
  BedrockProvider,
  type BedrockProviderOptions,
} from '../../../src/adapters/llm/BedrockProvider.js';
import {
  assessment,
  eventsFor,
  fixture,
  guardrail,
  modes,
  pii,
  publicText,
  read,
  request,
  response,
  trace,
} from './bedrockGuardrailFixtures.js';

describe('Bedrock guardrail configuration', () => {
  for (const classDoor of [false, true]) {
    for (const mode of modes) {
      for (const selectedTrace of [undefined, 'disabled', 'enabled', 'enabled_full'] as const) {
        it(`${classDoor ? 'class' : 'factory'}/${mode}: maps trace ${
          selectedTrace ?? 'default'
        } once`, async () => {
          const fx = fixture({
            classDoor,
            guardrail: { id: guardrail.id, version: 'DRAFT', trace: selectedTrace },
            complete: response(undefined, 'end_turn'),
            events: eventsFor(undefined, 'end_turn'),
          });
          await read(fx.provider, mode);
          const command = fx.send.mock.calls[0]?.[0] as { input: Record<string, unknown> };
          expect(command.input.guardrailConfig).toEqual({
            guardrailIdentifier: guardrail.id,
            guardrailVersion: 'DRAFT',
            trace: selectedTrace ?? 'disabled',
            ...(mode === 'stream' ? { streamProcessingMode: 'sync' } : {}),
          });
          expect(command.input).not.toHaveProperty('guardrail');
          expect(fx.send).toHaveBeenCalledTimes(1);
        });
      }
    }
  }

  const invalid: readonly [string, unknown][] = [
    ['null configuration', null],
    ['empty id', { id: '', version: '1' }],
    ['whitespace id', { id: ' ', version: '1' }],
    ['hyphenated non-ARN id', { id: 'guardrail-id', version: '1' }],
    ['missing id', { version: '1' }],
    ['empty version', { id: guardrail.id, version: '' }],
    ['whitespace version', { id: guardrail.id, version: ' ' }],
    ['numeric version', { id: guardrail.id, version: 1 }],
    ['unknown trace', { ...guardrail, trace: 'ENABLED' }],
    ['zero buffer', { ...guardrail, maxBufferedBytes: 0 }],
    ['fraction buffer', { ...guardrail, maxBufferedBytes: 0.5 }],
    ['infinite buffer', { ...guardrail, maxBufferedBytes: Infinity }],
    ['unsafe buffer', { ...guardrail, maxBufferedBytes: Number.MAX_SAFE_INTEGER + 1 }],
  ];
  for (const classDoor of [false, true]) {
    for (const mode of modes) {
      it.each(invalid)(
        `${classDoor ? 'class' : 'factory'}/${mode}: refuses %s before send`,
        async (_name, config) => {
          class Command {
            constructor(readonly input: unknown) {}
          }
          const send = vi.fn(async () => response());
          const options = {
            guardrail: config,
            _client: { send },
            _commands: { Converse: Command, ConverseStream: Command },
          } as BedrockProviderOptions;
          const operation = async () => {
            const provider = classDoor ? new BedrockProvider(options) : bedrock(options);
            await read(provider, mode);
          };
          await expect(operation()).rejects.toBeInstanceOf(Error);
          expect(send).not.toHaveBeenCalled();
        },
      );
    }
  }

  it('captures valid constructor data once instead of following later option mutations', async () => {
    const config = { ...guardrail };
    const fx = fixture({
      guardrail: config,
      complete: response(undefined, 'end_turn'),
    });
    config.id = 'different';
    config.version = '2';
    config.trace = 'disabled';
    await fx.provider.complete(request);
    const command = fx.send.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input.guardrailConfig).toMatchObject({
      guardrailIdentifier: guardrail.id,
      guardrailVersion: '1',
      trace: 'enabled',
    });
  });

  it.each(['aws', 'aws-cn', 'aws-us-gov'])(
    'accepts the documented %s guardrail ARN instead of treating it as a short id',
    async (partition) => {
      const id = `arn:${partition}:bedrock:us-east-1:123456789012:guardrail/abc123`;
      const fx = fixture({
        guardrail: { ...guardrail, id },
        complete: response(undefined, 'end_turn'),
      });
      await fx.provider.complete(request);
      const command = fx.send.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(command.input.guardrailConfig).toMatchObject({ guardrailIdentifier: id });
      expect(fx.send).toHaveBeenCalledTimes(1);
    },
  );
});

describe('Bedrock guardrail trace privacy and owned projection', () => {
  for (const mode of modes) {
    it(`${mode}: raw trace fields and private labels are neither read nor serialized`, async () => {
      let privateReads = 0;
      const forbidden = () => {
        privateReads++;
        throw new Error('PRIVATE_TRACE_GETTER');
      };
      const entity = { type: 'EMAIL', action: 'ANONYMIZED' };
      Object.defineProperty(entity, 'match', { get: forbidden, enumerable: true });
      const regex = { action: 'ANONYMIZED' };
      for (const key of ['name', 'match', 'regex']) {
        Object.defineProperty(regex, key, { get: forbidden, enumerable: true });
      }
      const value = {
        sensitiveInformationPolicy: { piiEntities: [entity], regexes: [regex] },
      };
      const evidence = trace(value);
      Object.defineProperty((evidence as { guardrail: object }).guardrail, 'modelOutput', {
        get: forbidden,
        enumerable: true,
      });
      const fx = fixture({ complete: response(evidence), events: eventsFor(evidence) });
      const { result } = await read(fx.provider, mode);
      expect(result.intervention?.outcome).toBe('masked');
      expect(result.content).toBe(publicText);
      expect(privateReads).toBe(0);
      const publicBytes = JSON.stringify(result);
      expect(publicBytes).not.toContain('PRIVATE_TRACE_GETTER');
      expect(publicBytes).not.toContain('modelOutput');
      expect(publicBytes).not.toContain('regexes');
      expect(publicBytes).not.toContain('guardrail-id');
    });

    it(`${mode}: hidden-only trace differences produce identical public response bytes`, async () => {
      const publicBytes: string[] = [];
      for (const hidden of ['short-private-value', 'long-private-value'.repeat(25)]) {
        const evidence = trace({
          sensitiveInformationPolicy: {
            piiEntities: [pii('ANONYMIZED', { match: hidden })],
            regexes: [{ name: hidden, match: hidden, regex: hidden, action: 'ANONYMIZED' }],
          },
        });
        (evidence as { guardrail: Record<string, unknown> }).guardrail.modelOutput = [hidden];
        const fx = fixture({ complete: response(evidence), events: eventsFor(evidence) });
        publicBytes.push(JSON.stringify((await read(fx.provider, mode)).result));
      }
      expect(publicBytes[0]).toBe(publicBytes[1]);
    });

    it(`${mode}: action is read once into owned data, never through a getter`, async () => {
      let getterReads = 0;
      const accessor = Object.defineProperty({ type: 'EMAIL' }, 'action', {
        enumerable: true,
        get: () => {
          getterReads++;
          return 'ANONYMIZED';
        },
      });
      const evidence = trace(assessment(pii('ANONYMIZED'), accessor));
      const fx = fixture({ complete: response(evidence), events: eventsFor(evidence) });
      const { result } = await read(fx.provider, mode);
      expect(result.intervention?.outcome).toBe('unknown');
      expect(getterReads).toBe(0);
      expect(fx.send).toHaveBeenCalledTimes(1);
    });

    it(`${mode}: reflection failure marks unknown but does not hide a valid sibling block`, async () => {
      const foreign = new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error('PRIVATE_PROXY_FAILURE');
          },
        },
      );
      const evidence = trace(assessment(foreign, pii('BLOCKED')));
      const fx = fixture({ complete: response(evidence), events: eventsFor(evidence) });
      const { result } = await read(fx.provider, mode);
      expect(result.intervention?.outcome).toBe('blocked');
      expect(JSON.stringify(result)).not.toContain('PRIVATE_PROXY_FAILURE');
    });

    it(`${mode}: later SDK mutation cannot replace the returned owned outcome`, async () => {
      const entity = { type: 'EMAIL', action: 'ANONYMIZED' };
      const evidence = trace(assessment(entity));
      const fx = fixture({ complete: response(evidence), events: eventsFor(evidence) });
      const { result } = await read(fx.provider, mode);
      const before = JSON.stringify(result.intervention);
      entity.action = 'BLOCKED';
      entity.type = 'PRIVATE_CHANGED_LABEL';
      expect(result.intervention?.outcome).toBe('masked');
      expect(JSON.stringify(result.intervention)).toBe(before);
      for (const filter of result.intervention?.filters ?? []) {
        if (filter.type !== undefined) expect([...filter.type].length).toBeLessThanOrEqual(128);
      }
    });

    it(`${mode}: disabled trace with intervention does not invent masking-only evidence`, async () => {
      const fx = fixture({
        guardrail: { ...guardrail, trace: 'disabled' },
        complete: response(),
        events: eventsFor(),
      });
      const { result } = await read(fx.provider, mode);
      expect(result.intervention?.outcome).toBe('unknown');
      expect(result.intervention?.filters).toEqual([]);
      expect(result.content).toBe('');
    });
  }

  for (const action of ['BLOCKED', undefined] as const) {
    it(`complete/${
      action ?? 'unknown'
    }: classifies before touching unusable tool output`, async () => {
      let toolReads = 0;
      const unusable = Object.defineProperty({}, 'toolUse', {
        enumerable: true,
        get: () => {
          toolReads++;
          throw new Error('PRIVATE_TOOL_OUTPUT');
        },
      });
      const evidence = action ? trace(assessment(pii(action))) : undefined;
      const fx = fixture({ complete: response(evidence, 'guardrail_intervened', [unusable]) });
      const { result } = await read(fx.provider, 'complete');
      expect(result.intervention?.outcome).toBe(action ? 'blocked' : 'unknown');
      expect(result.toolCalls).toEqual([]);
      expect(result.content).toBe('');
      expect(toolReads).toBe(0);
      expect(fx.send).toHaveBeenCalledTimes(1);
    });
  }
});
