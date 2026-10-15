/** Public Agent regressions: capabilities belong to reachable transports, not unused defaults. */
import { describe, expect, it, vi } from 'vitest';
import { flowChart } from 'footprintjs';
import { Agent } from '../../src/core/Agent.js';
import { defineFact, defineSkill, skillGraph } from '../../src/injection-engine.js';
import type { LLMProvider, LLMRequest, WireRole } from '../../src/provider-contract/types.js';
import type { MemoryDefinition, ReadonlyMemoryFlowChart } from '../../src/memory/define.types.js';
import { UnsupportedThinkingError } from '../../src/thinking/errors.js';

const modes = ['classic', 'dynamic', 'dynamic-grouped'] as const;
function provider(name: string, thinking = true, roles?: readonly WireRole[]) {
  return {
    name,
    thinkingMode: () => (thinking ? 'budget' : 'none') as 'budget' | 'none',
    ...(roles !== undefined && { carriesInMessages: roles }),
    complete: vi.fn(async (_request: LLMRequest) => ({
      content: 'done',
      toolCalls: [],
      usage: { input: 1, output: 1 },
      stopReason: 'stop',
    })),
  } satisfies LLMProvider;
}
const target = (p: LLMProvider) => ({ name: p.name, provider: p, model: `${p.name}-model` });
const fact = () =>
  defineFact({ id: 'note', data: 'Declared note', slot: 'messages', role: 'system' });

/** Hand-built memory is the supported advanced door for non-system recall.
 * Only the nominal factory brand is asserted; the executable is a real chart. */
function recall(): MemoryDefinition {
  const read = flowChart<{ formatted: { role: 'assistant'; content: string }[] }>(
    'Recall',
    (scope) => {
      scope.formatted = [{ role: 'assistant', content: 'Runtime recall' }];
    },
    'recall',
  ).build();
  return {
    id: 'runtime',
    type: 'episodic',
    timing: 'turn-start',
    read: read as unknown as ReadonlyMemoryFlowChart<unknown>,
  };
}

describe.each(modes)('reachable provider capabilities (%s)', (reactMode) => {
  it('thinking ignores an unused unsupported default and calls the supported selected provider', async () => {
    const unused = provider('unused', false);
    const selected = provider('selected');
    const agent = Agent.create({ provider: unused, model: 'unused-model', reactMode })
      .reliability({ providers: [target(selected)] })
      .thinking({ budget: 1024 })
      .build();
    expect(await agent.run({ message: 'hello' })).toBe('done');
    expect(unused.complete).not.toHaveBeenCalled();
    expect(selected.complete.mock.calls[0]?.[0]).toMatchObject({
      model: 'selected-model',
      thinking: { budget: 1024 },
    });
  });

  it.each(['first', 'alternate'] as const)(
    'thinking refuses an unsupported %s before transport',
    (position) => {
      const base = provider('base');
      const unsupported = provider('unsupported', false);
      const targets =
        position === 'first' ? [target(unsupported)] : [target(base), target(unsupported)];
      expect(() =>
        Agent.create({ provider: base, model: 'base-model', reactMode })
          .reliability({ providers: targets })
          .thinking({ budget: 1024 })
          .build(),
      ).toThrow(UnsupportedThinkingError);
      expect(unsupported.complete).not.toHaveBeenCalled();
      expect(base.complete).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, []] as const)(
    'no provider list keeps the original thinking refusal (%s)',
    (providers) => {
      const base = provider('base', false);
      expect(() =>
        Agent.create({ provider: base, model: 'base-model', reactMode })
          .reliability({ ...(providers !== undefined && { providers }) })
          .thinking({ budget: 1024 })
          .build(),
      ).toThrow(UnsupportedThinkingError);
    },
  );

  it('delivers an injection on the selected wire despite an unused default that lacks its role', async () => {
    const unused = provider('unused');
    const selected = provider('selected', true, ['system', 'user', 'assistant']);
    const agent = Agent.create({ provider: unused, model: 'unused-model', reactMode })
      .reliability({ providers: [target(selected)] })
      .fact(fact())
      .build();
    expect(await agent.run({ message: 'hello' })).toBe('done');
    expect(unused.complete).not.toHaveBeenCalled();
    expect(selected.complete.mock.calls[0]?.[0].messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'system', content: 'Declared note' },
    ]);
  });

  it.each(['first', 'alternate'] as const)(
    'refuses a declared role unsupported by the %s before any transport',
    async (position) => {
      const base = provider('base', true, ['system', 'user', 'assistant']);
      const unsupported = provider('unsupported');
      const targets =
        position === 'first' ? [target(unsupported)] : [target(base), target(unsupported)];
      const agent = Agent.create({ provider: base, model: 'base-model', reactMode })
        .reliability({ providers: targets })
        .fact(fact())
        .build();
      await expect(agent.run({ message: 'hello' })).rejects.toThrow(/'unsupported' provider/);
      expect(base.complete).not.toHaveBeenCalled();
      expect(unsupported.complete).not.toHaveBeenCalled();
    },
  );

  it('runtime-only recall uses the selected role declaration, not the unused default', async () => {
    const unused = provider('unused', true, ['user']);
    const selected = provider('selected');
    const agent = Agent.create({ provider: unused, model: 'unused-model', reactMode })
      .reliability({ providers: [target(selected)] })
      .memory(recall())
      .build();
    expect(await agent.run({ message: 'hello' })).toBe('done');
    expect(selected.complete.mock.calls[0]?.[0].messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Runtime recall' },
    ]);
    expect(unused.complete).not.toHaveBeenCalled();
  });

  it('runtime-only recall refuses an incompatible alternate before dispatch', async () => {
    const base = provider('base');
    const unsupported = provider('unsupported', true, ['user']);
    const agent = Agent.create({ provider: base, model: 'base-model', reactMode })
      .reliability({ providers: [target(base), target(unsupported)] })
      .memory(recall())
      .build();
    await expect(agent.run({ message: 'hello' })).rejects.toThrow(/'unsupported' provider/);
    expect(base.complete).not.toHaveBeenCalled();
    expect(unsupported.complete).not.toHaveBeenCalled();
  });
});

it('reliability selection does not remove the existing skill-brain thinking check', () => {
  const base = provider('base');
  const unsupported = provider('skill-wire', false);
  const skill = defineSkill({
    id: 'skill',
    description: 'a skill',
    body: 'body',
    provider: unsupported,
    model: 'skill-model',
  });
  const graph = skillGraph().entry(skill).build();
  expect(() =>
    Agent.create({ provider: base, model: 'base-model' })
      .skillGraph(graph)
      .reliability({ providers: [target(base)] })
      .thinking({ budget: 1024 })
      .build(),
  ).toThrow(/for skill 'skill'/);
});
