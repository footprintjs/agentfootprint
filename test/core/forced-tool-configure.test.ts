/** The forced-output contract follows the effective run model, never the constructor default. */
import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import { UnsupportedToolChoiceError } from '../../src/providers.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/provider-contract/types.js';
import { NoOpCacheStrategy } from '../../src/cache/index.js';

const ALLOWED = 'allowed-model';
const BLOCKED = 'blocked-model';
const parser = { parse: (value: unknown) => value };
const forced = { strategy: 'tool-forced' as const, jsonSchema: { type: 'object' } };

/** A custom port declares its capabilities but deliberately does not police requests itself. */
function fixture(path: 'complete' | 'stream', carriesForcedToolChoice: boolean | undefined = true) {
  const requests: LLMRequest[] = [];
  const supportsForcedToolChoice = vi.fn((model: string) => model !== BLOCKED);
  const reply = (request: LLMRequest): LLMResponse => ({
    content: request.toolChoice ? '' : '{"ok":true}',
    toolCalls: request.toolChoice
      ? [{ id: 'answer', name: request.toolChoice.name, args: { ok: true } }]
      : [],
    usage: { input: 1, output: 1 },
    stopReason: request.toolChoice ? 'tool_use' : 'stop',
  });
  const complete = vi.fn(async (request: LLMRequest) => {
    requests.push(request);
    return reply(request);
  });
  const provider: LLMProvider = {
    name: 'custom-configured-wire',
    ...(carriesForcedToolChoice !== undefined && { carriesForcedToolChoice }),
    supportsForcedToolChoice,
    complete,
    ...(path === 'stream' && {
      async *stream(request: LLMRequest) {
        requests.push(request);
        yield { content: '', done: true, response: reply(request) };
      },
    }),
  };
  return { provider, requests, supportsForcedToolChoice, complete };
}

for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
  for (const path of ['complete', 'stream'] as const) {
    describe(`effective forced model (${reactMode}, ${path})`, () => {
      it('allows a blocked default overridden by an allowed configured model', async () => {
        const f = fixture(path);
        const configure = vi.fn(() => ({ model: ALLOWED }));
        const agent = Agent.create({ provider: f.provider, model: BLOCKED, reactMode })
          .configure(configure)
          .outputSchema(parser, forced)
          .build();
        await expect(agent.run('answer')).resolves.toBe('{"ok":true}');
        expect(configure).toHaveBeenCalledTimes(1);
        expect(f.requests).toHaveLength(1);
        expect(f.requests[0]).toMatchObject({ model: ALLOWED, toolChoice: { type: 'tool' } });
        expect(f.supportsForcedToolChoice).toHaveBeenCalledWith(ALLOWED);
        expect(f.supportsForcedToolChoice).not.toHaveBeenCalledWith(BLOCKED);
      });

      it('refuses an allowed default overridden by a blocked configured model before I/O', async () => {
        const f = fixture(path);
        const configure = vi.fn(() => ({ model: BLOCKED }));
        const agent = Agent.create({ provider: f.provider, model: ALLOWED, reactMode })
          .configure(configure)
          .outputSchema(parser, forced)
          .build();
        await expect(agent.run('answer')).rejects.toMatchObject({
          name: 'UnsupportedToolChoiceError',
          provider: f.provider.name,
          model: BLOCKED,
          retryable: false,
        });
        expect(configure).toHaveBeenCalledTimes(1);
        expect(f.requests).toEqual([]);
        expect(f.complete).not.toHaveBeenCalled();
        expect(f.supportsForcedToolChoice).toHaveBeenCalledWith(BLOCKED);
      });

      it('still refuses the blocked default when configure does not replace it', async () => {
        const f = fixture(path);
        const configure = vi.fn(() => ({}));
        const agent = Agent.create({ provider: f.provider, model: BLOCKED, reactMode })
          .configure(configure)
          .outputSchema(parser, forced)
          .build();
        await expect(agent.run('answer')).rejects.toBeInstanceOf(UnsupportedToolChoiceError);
        expect(configure).toHaveBeenCalledTimes(1);
        expect(f.requests).toEqual([]);
      });

      it('retains early rejection of a static blocked default without configure', async () => {
        const f = fixture(path);
        const agent = Agent.create({ provider: f.provider, model: BLOCKED, reactMode })
          .outputSchema(parser, forced)
          .build();
        await expect(agent.run('answer')).rejects.toBeInstanceOf(UnsupportedToolChoiceError);
        expect(f.requests).toEqual([]);
      });

      it('does not check forced capability for a normal configured request', async () => {
        const f = fixture(path);
        const agent = Agent.create({ provider: f.provider, model: ALLOWED, reactMode })
          .configure(() => ({ model: BLOCKED }))
          .build();
        await expect(agent.run('answer')).resolves.toBe('{"ok":true}');
        expect(f.requests[0]?.model).toBe(BLOCKED);
        expect(f.requests[0]?.toolChoice).toBeUndefined();
        expect(f.supportsForcedToolChoice).not.toHaveBeenCalled();
      });
    });
  }
}

describe('forced configuration boundaries', () => {
  it('keeps a same-run refusal typed after a real output correction records history', async () => {
    const f = fixture('complete');
    const complete = vi.fn(
      async (request: LLMRequest): Promise<LLMResponse> => ({
        content: '',
        toolCalls: [
          { id: 'invalid-answer', name: request.toolChoice?.name ?? '', args: { ok: 'wrong' } },
        ],
        usage: { input: 1, output: 1 },
        stopReason: 'tool_use',
      }),
    );
    const cacheStrategy = new NoOpCacheStrategy();
    const prepare = vi
      .spyOn(cacheStrategy, 'prepareRequest')
      .mockImplementation(async (request, _markers, ctx) => ({
        request: ctx.iteration > 1 ? { ...request, model: BLOCKED } : request,
        markersApplied: [],
      }));
    const strictParser = {
      parse(value: unknown) {
        if (
          typeof value !== 'object' ||
          value === null ||
          !('ok' in value) ||
          typeof value.ok !== 'boolean'
        ) {
          throw new Error('Expected a boolean ok field');
        }
        return value;
      },
    };
    const agent = Agent.create({
      provider: { ...f.provider, complete },
      model: ALLOWED,
      cacheStrategy,
    })
      .outputSchema(strictParser, { ...forced, retries: 1 })
      .build();
    await expect(agent.run('answer')).rejects.toMatchObject({
      name: 'UnsupportedToolChoiceError',
      model: BLOCKED,
      retryable: false,
    });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0].model).toBe(ALLOWED);
  });

  it('keeps a typed refusal when a continued conversation configures a blocked model', async () => {
    const f = fixture('complete');
    const agent = Agent.create({ provider: f.provider, model: ALLOWED })
      .configure(({ message }) => ({ model: message === 'first answer' ? ALLOWED : BLOCKED }))
      .outputSchema(parser, forced)
      .build();
    await expect(agent.run('first answer')).resolves.toBe('{"ok":true}');
    const conversation = agent.checkpoint();
    expect(conversation?.history.length).toBeGreaterThan(0);
    if (conversation === undefined) throw new Error('Expected completed conversation history');
    await expect(
      agent.run({ message: 'continue answer', continueFrom: conversation }),
    ).rejects.toMatchObject({
      name: 'UnsupportedToolChoiceError',
      provider: f.provider.name,
      model: BLOCKED,
      retryable: false,
    });
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.model).toBe(ALLOWED);
  });

  it('refuses the configured model before an async cache strategy can do I/O', async () => {
    const f = fixture('complete');
    const cacheStrategy = new NoOpCacheStrategy();
    const prepare = vi.spyOn(cacheStrategy, 'prepareRequest');
    const agent = Agent.create({ provider: f.provider, model: ALLOWED, cacheStrategy })
      .configure(() => ({ model: BLOCKED }))
      .outputSchema(parser, forced)
      .build();
    await expect(agent.run('answer')).rejects.toBeInstanceOf(UnsupportedToolChoiceError);
    expect(prepare).not.toHaveBeenCalled();
    expect(f.requests).toEqual([]);
  });

  it('also checks the actual model returned by a custom request-preparing strategy', async () => {
    const f = fixture('stream');
    const cacheStrategy = new NoOpCacheStrategy();
    const prepare = vi
      .spyOn(cacheStrategy, 'prepareRequest')
      .mockImplementation(async (request) => ({
        request: { ...request, model: BLOCKED },
        markersApplied: [],
      }));
    const agent = Agent.create({ provider: f.provider, model: ALLOWED, cacheStrategy })
      .outputSchema(parser, forced)
      .build();
    await expect(agent.run('answer')).rejects.toMatchObject({
      name: 'UnsupportedToolChoiceError',
      model: BLOCKED,
      retryable: false,
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]?.[0].model).toBe(ALLOWED);
    expect(f.supportsForcedToolChoice).toHaveBeenCalledWith(BLOCKED);
    expect(f.requests).toEqual([]);
  });

  it.each([false, undefined])(
    'keeps early wire-capability refusal when the flag is %s',
    async (flag) => {
      const f = fixture('complete');
      const { carriesForcedToolChoice: _removed, ...withoutFlag } = f.provider;
      void _removed;
      const provider = {
        ...withoutFlag,
        ...(flag !== undefined && { carriesForcedToolChoice: flag }),
      };
      const configure = vi.fn(() => ({ model: ALLOWED }));
      const agent = Agent.create({ provider, model: ALLOWED })
        .configure(configure)
        .outputSchema(parser, forced)
        .build();
      await expect(agent.run('answer')).rejects.toThrow(/does not declare one/);
      expect(configure).not.toHaveBeenCalled();
      expect(f.requests).toEqual([]);
    },
  );

  it('preserves the existing refusal of skill tools combined with forced schema output', () => {
    const f = fixture('complete');
    const skill = defineSkill({
      id: 'billing',
      description: 'billing',
      body: 'billing',
      model: BLOCKED,
    });
    expect(() =>
      Agent.create({ provider: f.provider, model: ALLOWED })
        .skillGraph(skillGraph().entry(skill).build())
        .outputSchema(parser, forced)
        .build(),
    ).toThrow(/skill\(s\).*tools/);
    expect(f.requests).toEqual([]);
  });

  it.each(['dynamic', 'dynamic-grouped'] as const)(
    'leaves normal per-skill model/provider switching unchanged (%s)',
    async (reactMode) => {
      const initial = fixture('complete');
      const selected = fixture('stream');
      const skill = defineSkill({
        id: 'billing',
        description: 'billing',
        body: 'billing',
        provider: selected.provider,
        model: BLOCKED,
      });
      const agent = Agent.create({ provider: initial.provider, model: ALLOWED, reactMode })
        .skillGraph(skillGraph().entry(skill).build())
        .build();
      await expect(agent.run('answer')).resolves.toBe('{"ok":true}');
      expect(initial.requests).toEqual([]);
      expect(selected.requests[0]?.model).toBe(BLOCKED);
      expect(selected.requests[0]?.toolChoice).toBeUndefined();
      expect(selected.supportsForcedToolChoice).not.toHaveBeenCalled();
    },
  );
});
