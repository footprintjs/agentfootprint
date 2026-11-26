/**
 * The skill-context decision and its call gate, as units.
 *
 * Test type: unit / boundary.
 */
import { describe, expect, it } from 'vitest';
import { anthropic } from '../../../adapters/llm/AnthropicProvider.js';
import { mock } from '../../../adapters/llm/MockProvider.js';
import { defineSkill } from '../../../injection-engine/factories/defineSkill.js';
import type { Injection } from '../../../injection-engine/types.js';
import { decideSkillContext } from './decide.js';
import { listedInjections } from './apply.js';
import { notLoadedFor, notLoadedRefusal } from './gate.js';
import { readSkillOfferFor } from '../runtime/skills/owner.js';

const skill = defineSkill({ id: 'billing', description: 'Billing.', body: 'Confirm identity.' });
const claude = anthropic({ _client: {} as never });

describe('decideSkillContext', () => {
  it('reads the strictest binding over the agent and its skill brains', () => {
    const decision = decideSkillContext({
      provider: mock({ replies: ['x'] }),
      model: 'mock',
      brains: { bySkill: new Map([['billing', { provider: claude, model: 'claude-opus-5-5' }]]) },
      injections: [skill],
    });
    expect(decision?.strategy).toBe('listed');
    expect(decision?.record.binding).toEqual({
      binding: 'bound',
      by: 'provider',
      provider: 'anthropic',
      model: 'claude-opus-5-5',
    });
  });

  it('is undefined with no skill, and records nothing for the default declared', () => {
    expect(
      decideSkillContext({ provider: claude, model: 'claude-haiku-5-5', injections: [] }),
    ).toBeUndefined();
    const plain = decideSkillContext({
      provider: mock({ replies: ['x'] }),
      model: 'mock',
      injections: [skill],
    });
    expect(plain?.strategy).toBe('declared');
    expect(plain?.recorded).toBe(false);
    expect(plain?.record.tools.by).toBe('default');
  });
});

describe('listedInjections', () => {
  it('serves a read-activated body through the read_skill result and leaves the rest alone', () => {
    const graphSkill = { ...skill, id: 'routed', trigger: { kind: 'always' } } as Injection;
    const [read, routed] = listedInjections([skill, graphSkill]);
    expect((read!.metadata as { surfaceMode?: string }).surfaceMode).toBe('tool-only');
    expect((routed!.metadata as { surfaceMode?: string }).surfaceMode).toBe(
      (graphSkill.metadata as { surfaceMode?: string }).surfaceMode,
    );
    expect(routed!.metadata?.skillContext).toBe('listed');
  });
});

describe('notLoadedFor', () => {
  const listed = new Map([['refund', ['billing', 'support']]]);
  const active = (id: string) => [{ id, flavor: 'skill' }] as never;
  const skillParty = { channel: 'skill' as const, id: 'billing' };

  it('refuses until a declaring skill loads, naming a visible one', () => {
    expect(notLoadedFor(listed, 'refund', skillParty, [], ['billing'])).toBe(
      notLoadedRefusal('refund', 'support'),
    );
  });

  it('names no skill when every declaring skill is hidden', () => {
    expect(notLoadedFor(listed, 'refund', skillParty, [], ['billing', 'support'])).toBe(
      "Tool 'refund' did not run: the skill it belongs to was not loaded on that call.",
    );
  });

  it('lets the call run once a declaring skill loads, or when another party serves the name', () => {
    expect(notLoadedFor(listed, 'refund', skillParty, active('support'), [])).toBeUndefined();
    expect(notLoadedFor(listed, 'refund', { channel: 'provider' }, [], [])).toBeUndefined();
    expect(notLoadedFor(listed, 'lookup', skillParty, [], [])).toBeUndefined();
    expect(notLoadedFor(undefined, 'refund', skillParty, [], [])).toBeUndefined();
  });
});

describe('the read_skill description under listed', () => {
  const skills = ['alpha', 'beta', 'gamma'].map((id) =>
    defineSkill({ id, description: `${id} does things`, body: `${id} body` }),
  );
  const offerUnder = (strategy: 'listed' | 'declared') =>
    readSkillOfferFor.call({
      configuration: {
        injections: skills,
        skillGraphReachable: (cursor?: string) => (cursor === 'alpha' ? ['beta'] : ['gamma']),
        reactMode: 'dynamic',
        skillGraphIsTree: false,
        skillContext: { strategy } as never,
      } as never,
      governsSkillVisibility: () => false,
      openSkillIds: () => [],
    })!;

  it('does not follow the cursor or the menu (frozen); declared still does', () => {
    const listed = offerUnder('listed');
    const menu = { candidates: [{ id: 'beta' }] };
    expect(listed({ currentSkillId: 'alpha' })?.description).toBe(
      listed({ currentSkillId: 'beta', menu })?.description,
    );
    const declared = offerUnder('declared');
    expect(declared({ currentSkillId: 'alpha' })?.description).not.toBe(
      declared({ currentSkillId: 'beta' })?.description,
    );
  });
});
