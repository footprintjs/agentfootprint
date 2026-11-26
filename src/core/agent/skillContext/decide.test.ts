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
import { activeSkillBodyCallIds } from './bodies.js';
import { servedSurfaceMode } from '../../../injection-engine/skillContext.js';
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

describe('listedInjections and the served surface mode', () => {
  it('stamps every skill listed and leaves its own declarations as they were', () => {
    const graphSkill = { ...skill, id: 'routed', trigger: { kind: 'always' } } as Injection;
    const [read, routed] = listedInjections([skill, graphSkill]);
    for (const [after, before] of [
      [read!, skill],
      [routed!, graphSkill],
    ] as const) {
      expect(after.metadata?.skillContext).toBe('listed');
      expect((after.metadata as { surfaceMode?: string }).surfaceMode).toBe(
        (before.metadata as { surfaceMode?: string }).surfaceMode,
      );
    }
  });

  it('is tool-only exactly while the read_skill result is the body; otherwise the declaration', () => {
    const listed = { surfaceMode: 'auto', skillContext: 'listed' };
    const result = { role: 'tool', content: 'Confirm identity.', toolName: 'read_skill' };
    expect(servedSurfaceMode(listed, 'Confirm identity.', [result])).toBe('tool-only');
    expect(servedSurfaceMode(listed, 'Confirm identity.', [])).toBe('auto');
    expect(
      servedSurfaceMode(listed, 'Confirm identity.', [{ ...result, toolName: 'lookup' }]),
    ).toBe('auto');
    expect(servedSurfaceMode(listed, 'Confirm identity.', [{ ...result, content: 'other' }])).toBe(
      'auto',
    );
    expect(servedSurfaceMode({ surfaceMode: 'auto' }, 'Confirm identity.', [result])).toBe('auto');
  });
});

describe('notLoadedFor', () => {
  const listed = new Map([['refund', ['billing', 'support']]]);
  const active = (id: string) => [{ id, flavor: 'skill' }] as never;
  const skillParty = { channel: 'skill' as const, id: 'billing' };

  it('refuses until a declaring skill loads, naming a visible one', () => {
    expect(notLoadedFor(listed, undefined, 'refund', skillParty, [], ['billing'])).toBe(
      notLoadedRefusal('refund', 'support'),
    );
  });

  it('names no skill when every declaring skill is hidden', () => {
    expect(notLoadedFor(listed, undefined, 'refund', skillParty, [], ['billing', 'support'])).toBe(
      "Tool 'refund' did not run: the skill it belongs to was not loaded on that call.",
    );
  });

  it('lets the call run once a declaring skill loads, or when another party serves the name', () => {
    expect(
      notLoadedFor(listed, undefined, 'refund', skillParty, active('support'), []),
    ).toBeUndefined();
    expect(
      notLoadedFor(listed, undefined, 'refund', { channel: 'provider' }, [], []),
    ).toBeUndefined();
    expect(notLoadedFor(listed, undefined, 'lookup', skillParty, [], [])).toBeUndefined();
    expect(notLoadedFor(undefined, undefined, 'refund', skillParty, [], [])).toBeUndefined();
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

describe('activeSkillBodyCallIds (the window pin)', () => {
  it('a restored 40-turn history with a body result per turn pins only the newest', () => {
    const body = 'Confirm identity.';
    const history = Array.from({ length: 40 }, (_, i) => [
      { role: 'user', content: `question ${i}` },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: `c${i}`, name: 'read_skill', args: { id: 'billing' } }],
      },
      { role: 'tool', content: body, toolCallId: `c${i}`, toolName: 'read_skill' },
      { role: 'assistant', content: `answer ${i}` },
    ]).flat();
    const bodies = new Map([['billing', body]]);
    expect([...activeSkillBodyCallIds(history as never, bodies, ['billing'])]).toEqual(['c39']);
    // An inactive skill's results are ordinary history: nothing is pinned.
    expect(activeSkillBodyCallIds(history as never, bodies, []).size).toBe(0);
  });
});
