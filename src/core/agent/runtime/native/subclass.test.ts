import { expect, it, vi } from 'vitest';
import { Agent } from '../../../Agent.js';
import { RunnerBase } from '../../../RunnerBase.js';
import { getAgentRuntime } from './host.js';
import { mock } from '../../../../adapters/llm/MockProvider.js';

const voice = { appName: 'application', commentaryTemplates: {}, thinkingTemplates: {} };
const options = () => ({ provider: mock({ reply: 'ok' }), model: 'mock' });

class RuntimeApplication extends Agent {
  runtime(): string {
    return 'application status';
  }
}

class ContextApplication extends Agent {
  readonly agentContext = 'application context';
}

it('preserves an existing application runtime method while executing a native turn', async () => {
  const agent: Agent = new RuntimeApplication(options(), '', [], voice);
  try {
    expect((agent as RuntimeApplication).runtime()).toBe('application status');
    await expect(agent.run('hello')).resolves.toBe('ok');
    expect(agent.getLastSnapshot()).toBeDefined();
    expect((agent as RuntimeApplication).runtime()).toBe('application status');
  } finally {
    await agent.shutdown({ stop: true });
  }
});

it('preserves an existing application context field without using it as private runner state', async () => {
  const agent: Agent = new ContextApplication(options(), '', [], voice);
  try {
    expect((agent as ContextApplication).agentContext).toBe('application context');
    await expect(agent.run('hello')).resolves.toBe('ok');
    expect(agent.getLastSnapshot()).toBeDefined();
    expect((agent as ContextApplication).agentContext).toBe('application context');
  } finally {
    await agent.shutdown({ stop: true });
  }
});

it('runs through a transparent Proxy and retains the original native run view', async () => {
  const agent = Agent.create(options()).build();
  const proxy = new Proxy(agent, {});
  try {
    await expect(proxy.run('hello')).resolves.toBe('ok');
    expect(proxy.getLastSnapshot()).toEqual(agent.getLastSnapshot());
    expect(proxy.getLastNarrativeEntries()).toEqual(agent.getLastNarrativeEntries());
    // checkpoint() stamps the instant of EACH request. Compare equal-time
    // requests, then prove a later request changes only that instant.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      const direct = agent.checkpoint();
      if (direct === undefined) throw new Error('Expected a checkpoint after the completed turn.');
      expect(proxy.checkpoint()).toEqual(direct);
      expect(direct.checkpointedAt).toBe(1_800_000_000_000);
      clock.mockReturnValue(1_800_000_000_001);
      expect(proxy.checkpoint()).toEqual({ ...direct, checkpointedAt: 1_800_000_000_001 });
    } finally {
      clock.mockRestore();
    }
    await expect(proxy.followUp('again')).resolves.toBe('ok');
    expect(proxy.getLastSnapshot()).toEqual(agent.getLastSnapshot());
  } finally {
    await agent.shutdown({ stop: true });
  }
});

it('keeps Agent directly derived from the public RunnerBase', () => {
  expect(Object.getPrototypeOf(Agent.prototype)).toBe(RunnerBase.prototype);
});

it('keeps per-agent context behind one non-enumerable module Symbol', async () => {
  const agent = new ContextApplication(options(), '', [], voice);
  try {
    const context = getAgentRuntime(agent);
    const key = Object.getOwnPropertySymbols(agent).find(
      (symbol) => Object.getOwnPropertyDescriptor(agent, symbol)?.value === context,
    );
    expect(key).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(agent, key!)).toEqual({
      value: context,
      enumerable: false,
      writable: false,
      configurable: true,
    });
    expect(getAgentRuntime(new Proxy(agent, {}))).toBe(context);
    expect((agent as ContextApplication).agentContext).toBe('application context');
    expect(Object.values({ ...agent })).not.toContain(context);
  } finally {
    await agent.shutdown({ stop: true });
  }
});

it('keeps receiver-free outcome branches independent of Agent configuration', () => {
  const receiver = {};
  for (const value of ['answer', 0, null, undefined, true]) {
    expect(Reflect.apply(Agent.prototype.outcomeOf, receiver, [value])).toEqual({ answer: value });
  }
  expect(
    Reflect.apply(Agent.prototype.outcomeOf, receiver, [
      { finalContent: 'validated answer', answerValidationCommitted: true },
    ]),
  ).toEqual({ answer: 'validated answer' });
});
