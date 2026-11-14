import { describe, expect, it } from 'vitest';
import type { Injection } from '../../../../injection-engine/types.js';
import { advanceEngagement } from '../../../../maps/engagement/lease.js';
import type { EngagementPass } from '../../../../maps/engagement/evidence.js';
import { configureMaps, resolveMapsPlan, type MapsPlanPort } from './configure.js';

const contribution = (id: string, names: readonly string[]): Injection => ({
  id,
  flavor: 'skill',
  trigger: { kind: 'always' },
  inject: {
    tools: names.map((name) => ({
      schema: { name, description: name, inputSchema: { type: 'object' } },
      execute: () => 'done',
    })),
  },
});

const pass = (iteration: number): EngagementPass => ({
  iteration,
  currentNode: 'member',
  moveBy: iteration === 1 ? 'entry' : 'stay',
  toolResults: iteration === 1 ? [] : [{ toolName: 'elsewhere' }],
  acceptedSkillPicks: [],
  servedLastPass: ['member'],
});

describe('the builder map kernel declaration', () => {
  it('feeds the lease with only mounted members and their deduplicated tool names', () => {
    const receiver: MapsPlanPort = {
      skillGraphNextSkill: () => 'member',
      skillGraphNodeIds: new Set(['member']),
      skillGraphExplainNextSkill: () => ({ to: 'member', by: 'entry' }),
    };
    configureMaps(receiver, { renewalGrace: 1 }, receiver);
    const plan = resolveMapsPlan(receiver, [
      contribution('member', ['owned', 'owned']),
      contribution('foreign', ['foreign-tool']),
    ]);
    if (plan === undefined) throw new Error('the mounted kernel must have a plan');
    expect(plan.maps).toEqual([{ id: 'skill-map', memberIds: ['member'], toolNames: ['owned'] }]);
    const founded = advanceEngagement(plan, undefined, pass(1));
    const parked = advanceEngagement(plan, founded.next, pass(2));
    expect(parked.parkedInjectionIds).toEqual(['member']);
    expect(parked.parkedToolNames).toEqual(['owned']);
  });

  it('passes a mandatory mount through without preventing idle measurement', () => {
    const receiver: MapsPlanPort = {
      skillGraphNextSkill: () => 'member',
      skillGraphNodeIds: new Set(['member']),
      skillGraphExplainNextSkill: () => ({ to: 'member', by: 'entry' }),
    };
    configureMaps(receiver, { renewalGrace: 1, nonParkable: true }, receiver);
    const plan = resolveMapsPlan(receiver, [contribution('member', ['owned'])]);
    if (plan === undefined) throw new Error('the mounted kernel must have a plan');
    const founded = advanceEngagement(plan, undefined, pass(1));
    const idle = advanceEngagement(plan, founded.next, pass(2));
    expect(idle.next[0]).toMatchObject({ standing: 'engaged', idle: 1 });
    expect(idle.parkedInjectionIds).toEqual([]);
  });

  it('refuses a map without explanatory routing and rejects fractional grace', () => {
    const receiver: MapsPlanPort = {
      skillGraphNextSkill: () => 'member',
      skillGraphNodeIds: new Set(['member']),
    };
    expect(() => configureMaps(receiver, { renewalGrace: 1.5 }, receiver)).toThrow(/integer >= 1/);
    expect(resolveMapsPlan(receiver, [])).toBeUndefined();
    configureMaps(receiver, {}, receiver);
    expect(() => resolveMapsPlan(receiver, [])).toThrow(/cannot explain its cursor moves/);
  });
});
