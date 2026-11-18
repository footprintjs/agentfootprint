import { describe, expect, it } from 'vitest';
import { eventShapes } from '../../auditShapes.js';

// Exercise the assembled facade: a missing or overwritten event group must fail here.
describe('event groups retain their audit boundaries', () => {
  const shapes = eventShapes(() => false);
  it.each([
    [
      'agentfootprint.tools.absent',
      { toolName: 'tool', lookedFor: 'private' },
      { toolName: 'tool', lookedFor: '[7 chars]' },
    ],
    ['agentfootprint.map.parked', { unknown: 'private' }, { unknown: '[7 chars]' }],
    ['agentfootprint.composition.enter', { unknown: 'private' }, { unknown: '[7 chars]' }],
    [
      'agentfootprint.stream.token',
      { iteration: 1, tokenIndex: 2, content: 'private' },
      { iteration: 1, tokenIndex: 2, content: '[7 chars]' },
    ],
    ['agentfootprint.memory.strategy_applied', { unknown: 'private' }, { unknown: '[7 chars]' }],
    [
      'agentfootprint.skill.activated',
      { skillId: 'skill', reason: 'manual', injectedTools: ['tool'] },
      { skillId: 'skill', reason: 'manual', injectedTools: ['tool'] },
    ],
    ['agentfootprint.cost.tick', { unknown: 'private' }, { unknown: '[7 chars]' }],
  ] as const)('%s bounds unknown and content values', (event, payload, expected) => {
    expect(shapes[event](payload)).toEqual(expected);
  });

  it('retains the human approval and later policy verdict as separate bounded facts', () => {
    const order = { toolCallId: 'sample-1', iteration: 2 };
    const middleware = shapes['agentfootprint.middleware.decision'];
    const permission = shapes['agentfootprint.permission.check'];
    expect(
      middleware({ ...order, outcome: 'allow', personApproved: true, why: 'details' }),
    ).toEqual({ ...order, outcome: 'allow', personApproved: true, why: '[7 chars]' });
    expect(middleware({ ...order, outcome: 'refused', phase: 'resume', why: 'details' })).toEqual({
      ...order,
      outcome: 'refused',
      phase: 'resume',
      why: '[7 chars]',
    });
    expect(permission({ ...order, result: 'deny', phase: 'resume', rationale: 'details' })).toEqual(
      {
        ...order,
        result: 'deny',
        phase: 'resume',
        rationale: '[7 chars]',
      },
    );
  });
});
