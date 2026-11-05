import { expect, it } from 'vitest';
import type { Injection } from '../../../injection-engine/types.js';
import { assertInjectionDelivery } from './injectionDelivery.js';
import { scripted, answer } from '../../../../test/core/agent/arguments/askReviewHarness.js';

const injection = (role: string, content: unknown) =>
  ({
    id: 'declared-context',
    flavor: 'fact',
    trigger: { kind: 'always' },
    inject: { messages: [{ role, content }] },
  } as Injection);

it('refuses a declared role when any actual run provider cannot deliver it', () => {
  const provider = scripted([answer('done')]).provider;
  expect(() =>
    assertInjectionDelivery(
      [injection('system', 'context')],
      [
        { ...provider, carriesInMessages: ['system', 'user', 'assistant'] },
        { ...provider, name: 'narrow', carriesInMessages: ['user', 'assistant'] },
      ],
    ),
  ).toThrow(/narrow/);
  expect(() => assertInjectionDelivery([injection('user', 'context')], [provider])).not.toThrow();
});

it.each([undefined, null, 7, '', '  '])('refuses contentless injected messages (%s)', (value) => {
  const provider = scripted([answer('done')]).provider;
  expect(() => assertInjectionDelivery([injection('user', value)], [provider])).toThrow();
});

it('does not require a messages contribution from a prompt-only injection', () => {
  const provider = scripted([answer('done')]).provider;
  const value = injection('user', 'context');
  expect(() =>
    assertInjectionDelivery([{ ...value, inject: { systemPrompt: 'context' } }], [provider]),
  ).not.toThrow();
});
