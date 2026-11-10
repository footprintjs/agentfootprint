import { describe, expect, it } from 'vitest';
import { Agent } from '../../../Agent.js';
import type { AgentOptions } from '../../types.js';
import { mock } from '../../../../adapters/llm/MockProvider.js';

const voice = { appName: 'declared actor', commentaryTemplates: {}, thinkingTemplates: {} };
const options = (): AgentOptions => ({ provider: mock({ reply: 'ok' }), model: 'mock' });

describe('resolved Agent construction', () => {
  it('keeps public identity and voice as own data on the original runner', () => {
    const agent = new Agent(
      { ...options(), name: 'Declared', id: 'declared-id' },
      'system',
      [],
      voice,
    );
    for (const [key, value] of Object.entries({ name: 'Declared', id: 'declared-id', ...voice })) {
      const descriptor = Object.getOwnPropertyDescriptor(agent, key);
      expect(descriptor?.value).toBe(value);
      expect(descriptor?.get).toBeUndefined();
    }
  });

  it('refuses a cost dial without pricing before reading the later time declaration', () => {
    let timeReads = 0;
    const opts: AgentOptions = {
      ...options(),
      costBudget: 1,
      get time() {
        timeReads++;
        return true as const;
      },
    };
    expect(() => new Agent(opts, 'system', [], voice)).toThrow(/pricingTable/);
    expect(timeReads).toBe(0);
  });

  it('refuses observer dials before reading the later credential declaration', () => {
    let credentialReads = 0;
    const opts: AgentOptions = {
      ...options(),
      observerDeliveryOptions: {},
      get credentials() {
        credentialReads++;
        return undefined;
      },
    };
    expect(() => new Agent(opts, 'system', [], voice)).toThrow(/requires observerDelivery/);
    expect(credentialReads).toBe(0);
  });

  it('keeps the default prompt-cache policy and leaves recordings unarmed', async () => {
    const agent = new Agent(options(), 'system', [], voice);
    expect(agent.getSystemPromptCachePolicy()).toBe('always');
    expect(agent.getArtifactStore()).toBeUndefined();
    await expect(agent.run('hello')).resolves.toBe('ok');
  });

  it('uses the original runner identity in native run metadata', async () => {
    const agent = new Agent({ ...options(), id: 'declared-id' }, 'system', [], voice);
    let configured: unknown;
    agent.on('agentfootprint.agent.run_configured', (event) => {
      configured = event;
    });
    await expect(agent.run('hello')).resolves.toBe('ok');
    expect(configured).toMatchObject({
      meta: { compositionPath: ['Agent:declared-id'] },
    });
  });
});
