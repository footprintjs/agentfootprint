import { disableDevMode, enableDevMode, flowChart, type TypedScope } from 'footprintjs';
import { describe, expect, it, vi } from 'vitest';
import { Agent, type ObserverDeliveryOptions } from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import {
  defineMemory,
  InMemoryStore,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
  type MemoryDefinition,
} from '../../../src/doors/memory.js';

function buildAgent(
  emit: (scope: TypedScope<{ formatted: string }>) => void,
  options?: ObserverDeliveryOptions,
) {
  const read = flowChart(
    'Application observation',
    (scope: TypedScope<{ formatted: string }>) => {
      emit(scope);
      scope.formatted = '';
    },
    'application-observation',
  ).build();
  const memory = defineMemory({
    id: 'app-observation',
    type: MEMORY_TYPES.EPISODIC,
    strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 2 },
    store: new InMemoryStore(),
    readOnly: true,
  });
  return Agent.create({
    provider: mock({ replies: ['Done.', 'Done.'], chunkDelayMs: 0 }),
    model: 'm',
    observerDelivery: 'deferred',
    observerDeliveryOptions: options,
  })
    .memory({ ...memory, read: read as unknown as MemoryDefinition['read'] })
    .build();
}

describe('deferred native emit loss', () => {
  it('counts each degraded application emit once and warns without disclosing its payload', async () => {
    const secret = 'fixture-private-observation';
    let emitOpaque = true;
    const agent = buildAgent((scope) => {
      if (!emitOpaque) return;
      scope.$emit('app.observation', { secret, callback: () => secret });
      scope.$emit('app.observation', { secret, callback: () => secret });
    });
    const terminal = vi.fn();
    agent.on('agentfootprint.agent.turn_end', terminal);
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enableDevMode();
    try {
      await expect(agent.run({ message: 'Go.' })).resolves.toBe('Done.');
      expect(agent.getLastSnapshot()?.observerStats).toMatchObject({
        summarizedEmits: 2,
        drops: 0,
      });
      const messages = warnings.mock.calls.map(([message]) => String(message));
      expect(
        messages.filter((message) => message.includes('observerStats.summarizedEmits')),
      ).toHaveLength(1);
      expect(messages.join('\n')).not.toContain(secret);
      expect(terminal).toHaveBeenCalledTimes(1);

      emitOpaque = false;
      await expect(agent.run({ message: 'Again.' })).resolves.toBe('Done.');
      expect(agent.getLastSnapshot()?.observerStats?.summarizedEmits).toBeUndefined();
      expect(terminal).toHaveBeenCalledTimes(2);
    } finally {
      disableDevMode();
      warnings.mockRestore();
      await agent.shutdown();
    }
  });

  it('reports intentional summary capture without an unexpected-loss warning', async () => {
    const agent = buildAgent((scope) => scope.$emit('app.observation', { complete: true }), {
      capture: 'summary',
    });
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enableDevMode();
    try {
      await expect(agent.run({ message: 'Go.' })).resolves.toBe('Done.');
      const stats = agent.getLastSnapshot()?.observerStats;
      expect(stats?.summarizedEmits).toBeGreaterThan(0);
      expect(stats?.drops).toBe(0);
      expect(
        warnings.mock.calls.some(([message]) =>
          String(message).includes('observerStats.summarizedEmits'),
        ),
      ).toBe(false);
    } finally {
      disableDevMode();
      warnings.mockRestore();
      await agent.shutdown();
    }
  });
});
