import { describe, expect, it } from 'vitest';
import type { Injection } from '../../../../injection-engine/types.js';
import { assertReadSkillActivation } from './activation.js';

const injection = (trigger: Injection['trigger']): Injection => ({
  id: 'billing',
  flavor: 'skill',
  trigger,
  inject: { systemPrompt: 'Billing guidance' },
});

describe('the activation tool declaration', () => {
  it('accepts read_skill as the supported activation tool', () => {
    expect(() =>
      assertReadSkillActivation(injection({ kind: 'llm-activated', viaToolName: 'read_skill' })),
    ).not.toThrow();
  });

  it('refuses a custom activation tool and names the affected injection', () => {
    expect(() =>
      assertReadSkillActivation(injection({ kind: 'llm-activated', viaToolName: 'open_billing' })),
    ).toThrow(/Agent\.injection\('billing'\): viaToolName is 'open_billing'/);
  });

  it.each<Injection['trigger']>([
    { kind: 'always' },
    { kind: 'rule', activeWhen: () => false },
    { kind: 'on-tool-return', toolName: 'read' },
  ])('leaves the $kind activation door alone', (trigger) => {
    expect(() => assertReadSkillActivation(injection(trigger))).not.toThrow();
  });
});
