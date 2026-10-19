import { afterEach, describe, expect, it, vi } from 'vitest';
import { disableDevMode, enableDevMode } from 'footprintjs';
import { Agent } from '../../src/index.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import { defineSteering } from '../../src/injection-engine.js';

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
        cache: { requested: true, strategy: 'none', status: 'not-applicable' },
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
    expect(metadata[0]).toMatchObject({ cache: { requested: true } });
  });
});
