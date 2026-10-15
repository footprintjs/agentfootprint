/**
 * A composition member's skill visibility is decided by the run it serves —
 * never by the instance's last direct caller.
 */

import { describe, expect, it } from 'vitest';

import { Agent, Sequence } from '../../../src/index.js';
import { defineSkill, keywordScorer, skillGraph } from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';
import type { PermissionChecker } from '../../../src/provider-contract/types.js';

const ALICE = { tenant: 'acme', principal: 'alice', conversationId: 'c-alice' };
const BOB = { tenant: 'acme', principal: 'bob', conversationId: 'c-bob' };

const vipOnlyForAlice: PermissionChecker = {
  name: 'vip-for-alice',
  governs: ['skill_read'],
  check: (req) =>
    req.capability === 'skill_read' && req.target === 'skill:vip'
      ? { result: req.identity?.principal === 'alice' ? 'allow' : 'deny' }
      : { result: 'allow' },
};

const graph = () =>
  skillGraph()
    .entry(
      defineSkill({
        id: 'vip',
        description: 'vip desk',
        body: 'VIP-SECRET-PLAYBOOK: waive all fees',
      }),
      { match: { intent: 'vip desk help', examples: ['i am a vip customer'] } },
    )
    .entry(defineSkill({ id: 'other', description: 'everything else', body: 'other body' }), {
      match: { intent: 'anything else entirely', examples: ['completely different topic zone'] },
    })
    .classify(keywordScorer())
    .build();

function desk(seen: string[]) {
  return Agent.create({
    provider: mock({
      respond: (req) => {
        seen.push(JSON.stringify(req));
        return 'done';
      },
    }),
    model: 'mock',
    maxIterations: 3,
    permissionChecker: vipOnlyForAlice,
  })
    .system('support')
    .skillGraph(graph())
    .build();
}

describe('composition members — skill visibility follows the run', () => {
  it('after Alice ran the instance directly, Bob in a composition never gets her skill', async () => {
    const seen: string[] = [];
    const agent = desk(seen);
    await agent.run({ message: 'hello there', identity: ALICE });
    const flow = Sequence.create({ id: 'wrap' }).step('desk', agent).build();
    seen.length = 0;
    await flow.run({ message: 'I am a vip customer', identity: BOB });
    expect(seen.join('\n')).not.toContain('VIP-SECRET-PLAYBOOK');
  });

  it('…and Alice in a composition, after Bob ran it directly, is not refused her own skill', async () => {
    const seen: string[] = [];
    const agent = desk(seen);
    await agent.run({ message: 'hello there', identity: BOB });
    const flow = Sequence.create({ id: 'wrap' }).step('desk', agent).build();
    seen.length = 0;
    await flow.run({ message: 'I am a vip customer', identity: ALICE });
    expect(seen.join('\n')).toContain('VIP-SECRET-PLAYBOOK');
  });
});
