import { afterEach, describe, expect, it, vi } from 'vitest';
import { disableDevMode, enableDevMode } from 'footprintjs';
import { Agent } from '../../src/index.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import {
  defineFact,
  defineInstruction,
  defineSkill,
  defineSteering,
  skillGraph,
} from '../../src/injection-engine.js';
import { bedrock } from '../../src/adapters/llm/BedrockProvider.js';
import { ollama } from '../../src/adapters/llm/OllamaProvider.js';
import type { CachePolicy } from '../../src/cache/types.js';
import { NoOpCacheStrategy } from '../../src/cache/index.js';
import { buildBrainFor } from '../../src/core/agent/skillBrains.js';

const cacheWarnings = (warning: ReturnType<typeof vi.spyOn>) =>
  warning.mock.calls
    .map((call) => String(call[0]))
    .filter(
      (line) => line.includes('caching was requested') || line.includes('default cache policy'),
    );

afterEach(() => {
  disableDevMode();
  vi.restoreAllMocks();
});

describe('requested caching without a matching capability', () => {
  it('warns once at build and records fixed metadata on each run without prompt content', async () => {
    enableDevMode();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .system('PRIVATE-PROMPT', { cache: 'always' })
      .build();
    const metadata: unknown[] = [];
    agent.on('agentfootprint.agent.run_configured', (event) => metadata.push(event.payload));
    await agent.run({ message: 'PRIVATE-INPUT' });
    await agent.run({ message: 'second' });
    const cacheWarnings = warning.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('caching was requested'));
    expect(cacheWarnings).toHaveLength(1);
    expect(cacheWarnings[0]).toContain('mock');
    expect(cacheWarnings.join('')).not.toContain('PRIVATE');
    expect(metadata).toHaveLength(2);
    for (const row of metadata)
      expect(row).toMatchObject({
        cache: { requested: 'explicit', strategy: 'none', status: 'not-applicable' },
      });
    expect(JSON.stringify(metadata)).not.toContain('PRIVATE');
  });

  it('is silent when caching is off or every declared cache policy is never', () => {
    enableDevMode();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock', caching: 'off' })
      .system('s')
      .build();
    Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .system('s', { cache: 'never' })
      .build();
    expect(
      warning.mock.calls.filter((call) => String(call[0]).includes('caching was requested')),
    ).toHaveLength(0);
  });

  it('also sees an injection policy and remains silent outside development mode', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .steering(defineSteering({ id: 's', prompt: 'PRIVATE-INJECTION', cache: 'always' }))
      .build();
    const metadata: unknown[] = [];
    agent.on('agentfootprint.agent.run_configured', (event) => metadata.push(event.payload));
    await agent.run({ message: 'go' });
    expect(
      warning.mock.calls.filter((call) => String(call[0]).includes('caching was requested')),
    ).toHaveLength(0);
    expect(metadata[0]).toMatchObject({ cache: { requested: 'explicit' } });
  });

  it('default system policies on Mock and Ollama are silent and recorded as defaults', async () => {
    enableDevMode();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .system('s')
      .build();
    const metadata: unknown[] = [];
    agent.on('agentfootprint.agent.run_configured', (event) => metadata.push(event.payload));
    await agent.run({ message: 'go' });
    Agent.create({ provider: ollama('fixture-model'), model: 'fixture-model' })
      .system('s')
      .build();
    expect(cacheWarnings(warning)).toEqual([]);
    expect(metadata[0]).toMatchObject({ cache: { requested: 'default' } });
  });

  it('warns once when a model-aware provider cannot honor an active default policy', async () => {
    enableDevMode();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    class Command {
      constructor(readonly input: unknown) {}
    }
    const leaf = bedrock({
      sdk: { ConverseCommand: Command, ConverseStreamCommand: Command },
      client: {
        send: async () => ({
          output: { message: { content: [{ text: 'ok' }] } },
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      },
    });
    const agent = Agent.create({ provider: { ...leaf, stream: undefined }, model: 'unknown-model' })
      .system('s')
      .build();
    const metadata: unknown[] = [];
    agent.on('agentfootprint.agent.run_configured', (event) => metadata.push(event.payload));
    await agent.run({ message: 'one' });
    await agent.run({ message: 'two' });
    expect(cacheWarnings(warning)).toHaveLength(1);
    for (const row of metadata) expect(row).toMatchObject({ cache: { requested: 'default' } });
  });

  it('does not blame a supported model when the host deliberately overrides caching with none', () => {
    enableDevMode();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const declaration = vi.fn(() => {
      throw new Error('unused provider declaration');
    });
    Agent.create({
      provider: { ...mock({ reply: 'ok' }), promptCaching: declaration },
      model: 'supported',
      cacheStrategy: new NoOpCacheStrategy(),
    })
      .system('s')
      .build();
    expect(cacheWarnings(warning)).toEqual([]);
    expect(declaration).not.toHaveBeenCalled();
    const supported = vi.fn(() => ({
      mode: 'breakpoints' as const,
      maxBreakpoints: 4,
      reportsUsage: true,
    }));
    Agent.create({
      provider: { ...mock({ reply: 'ok' }), promptCaching: supported },
      model: 'supported',
      cacheStrategy: new NoOpCacheStrategy(),
    })
      .system('s')
      .build();
    expect(supported).not.toHaveBeenCalled();
    const getter = vi.fn(() => {
      throw new Error('unused capability getter');
    });
    const provider = mock({ reply: 'ok' });
    Object.defineProperty(provider, 'promptCaching', { get: getter });
    Agent.create({ provider, model: 'supported', cacheStrategy: new NoOpCacheStrategy() })
      .system('s')
      .build();
    expect(getter).not.toHaveBeenCalled();
    expect(cacheWarnings(warning)).toEqual([]);
  });

  it('omits cache diagnostics for no content, never policies, and the global off switch', async () => {
    enableDevMode();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const make of [
      () => Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' }).build(),
      () =>
        Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
          .system('s', { cache: 'never' })
          .build(),
      () =>
        Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock', caching: 'off' })
          .system('s', { cache: 'always' })
          .build(),
    ]) {
      const agent = make();
      const metadata: unknown[] = [];
      agent.on('agentfootprint.agent.run_configured', (event) => metadata.push(event.payload));
      await agent.run({ message: 'go' });
      expect(metadata[0]).not.toHaveProperty('cache');
    }
    expect(cacheWarnings(warning)).toEqual([]);
  });

  it.each(['model-only', 'same-instance', 'escalation'] as const)(
    'keeps a host cache override for %s skill brains without reading the unused provider getter',
    async (variant) => {
      const getter = vi.fn(() => {
        throw new Error('unused skill-brain capability getter');
      });
      const provider = mock({ reply: 'ok' });
      Object.defineProperty(provider, 'promptCaching', { get: getter });
      const graph = skillGraph({
        skills: [
          defineSkill({
            id: 's',
            description: 's',
            body: 's',
            ...(variant !== 'escalation' && { model: 'other-model' }),
            ...(variant === 'same-instance' && { provider }),
          }),
        ],
        start: 's',
      });
      const builder = Agent.create({
        provider,
        model: 'base-model',
        cacheStrategy: new NoOpCacheStrategy(),
      });
      const agent =
        variant === 'escalation'
          ? builder
              .skillGraph(graph, {
                escalation: { provider, model: 'other-model', afterRefusals: 1 },
              })
              .build()
          : builder.skillGraph(graph).build();
      expect(await agent.run({ message: 'go' })).toBe('ok');
      expect(getter).not.toHaveBeenCalled();
    },
  );

  it('a foreign-provider skill brain still resolves its own cache strategy under a host override', () => {
    const own = mock({ reply: 'ok' });
    const declaration = vi.fn(() => ({
      mode: 'breakpoints' as const,
      maxBreakpoints: 4,
      reportsUsage: true,
    }));
    const foreign = { ...mock({ reply: 'ok' }), promptCaching: declaration };
    expect(foreign.name).toBe(own.name);
    expect(foreign).not.toBe(own);
    const consult = buildBrainFor({
      brains: { bySkill: new Map([['s', { provider: foreign, model: 'foreign-model' }]]) },
      agentProvider: own,
      agentModel: 'base-model',
      agentCacheStrategy: new NoOpCacheStrategy(),
      agentCacheStrategyIsOverride: true,
    });
    expect(consult('s', false)?.cacheStrategy.name).toBe('breakpoints');
    expect(declaration).toHaveBeenCalledExactlyOnceWith('foreign-model');
  });

  it('custom authored cache metadata is explicit; factory metadata survives clones without evaluating policies', () => {
    enableDevMode();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const original = defineFact({ id: 'f', data: 's' });
    Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .injection({ ...original, metadata: { ...original.metadata } })
      .build();
    expect(cacheWarnings(warning)).toEqual([]);
    const until = vi.fn(() => true);
    Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .injection({ ...original, metadata: { cache: { until } } })
      .build();
    expect(cacheWarnings(warning)).toHaveLength(1);
    expect(until).not.toHaveBeenCalled();
  });

  const factories = [
    [
      'steering',
      (cache?: CachePolicy) =>
        defineSteering({ id: 's', prompt: 's', ...(cache !== undefined && { cache }) }),
    ],
    [
      'fact',
      (cache?: CachePolicy) =>
        defineFact({ id: 's', data: 's', ...(cache !== undefined && { cache }) }),
    ],
    [
      'skill',
      (cache?: CachePolicy) =>
        defineSkill({
          id: 's',
          description: 's',
          body: 's',
          ...(cache !== undefined && { cache }),
        }),
    ],
    [
      'instruction',
      (cache?: CachePolicy) =>
        defineInstruction({ id: 's', prompt: 's', ...(cache !== undefined && { cache }) }),
    ],
  ] as const;

  it.each(factories)(
    '%s defaults are silent; explicit policies warn once; never and off stay silent',
    async (_name, make) => {
      enableDevMode();
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
        .injection(make())
        .build();
      expect(cacheWarnings(warning)).toEqual([]);
      const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
        .injection(make('always'))
        .build();
      const metadata: unknown[] = [];
      agent.on('agentfootprint.agent.run_configured', (event) => metadata.push(event.payload));
      await agent.run({ message: 'go' });
      expect(cacheWarnings(warning)).toHaveLength(1);
      expect(metadata[0]).toMatchObject({ cache: { requested: 'explicit' } });
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
        .injection(make('never'))
        .build();
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock', caching: 'off' })
        .injection(make('always'))
        .build();
      expect(cacheWarnings(warning)).toHaveLength(1);
    },
  );
});
