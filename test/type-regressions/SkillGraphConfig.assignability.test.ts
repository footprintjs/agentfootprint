/**
 * Compile-level regression test — 8.4.0 made `SkillGraphConfig` a UNION.
 *
 * `tree` and `start`/`steps` are two ways to declare the same routing and only
 * one of them compiles: the tree branch never reads the flat wiring, so before
 * 8.4.0 a config carrying both silently dropped the entries, the steps, and every
 * skill that was not a tree leaf. There is a runtime refusal for that (JavaScript
 * callers, and configs assembled through `any`), but where TypeScript can see the
 * exclusivity it should say so at the keystroke, not at the call.
 *
 * The lock, in both directions:
 *   1. valid TREE-only and valid FLAT-only configs still typecheck — including
 *      every `start` shape and an omitted `steps`/`start`;
 *   2. the invalid combinations do NOT (`@ts-expect-error` fails the build if the
 *      line ever starts compiling, so a future widening of the type can't quietly
 *      re-open the hole).
 *
 * Lives under ./tsconfig.json (`npm run test:types`); the runtime half of the
 * same refusal is pinned in test/skillGraphRefusals.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { defineSkill, decideSkill, skillGraph } from '../../src/injection-engine';
import type {
  SkillGraphConfig,
  SkillGraphFlatConfig,
  SkillGraphTreeConfig,
} from '../../src/injection-engine';
import { mockEmbedder } from '../../src/memory/index';

const a = defineSkill({ id: 'a', description: 'a', body: 'A' });
const b = defineSkill({ id: 'b', description: 'b', body: 'B' });

// ─── 1. Valid shapes still typecheck ──────────────────────────────

const _treeOnly: SkillGraphConfig = { skills: [a, b], tree: decideSkill(() => true, a, b) };
const _startString: SkillGraphConfig = { skills: [a], start: 'a' };
const _startUse: SkillGraphConfig = { skills: [a], start: { use: 'a' } };
const _startRules: SkillGraphConfig = {
  skills: [a, b],
  start: { rules: [{ when: (c) => c.iteration === 1, use: 'a' }] },
};
/** Rules may be declared as DATA — a RegExp or a keyword list (SG-A). */
const _startRuleMatchers: SkillGraphConfig = {
  skills: [a, b],
  start: {
    rules: [
      { match: /refund/i, use: 'a' },
      { match: { keywords: ['charge', 'billing'] }, use: 'b' },
    ],
  },
};
/** The flat arm's `scopeTools` is a boolean now (it was `never` before SG-A). */
const _flatScopeTools: SkillGraphConfig = {
  skills: [a, b],
  start: 'a',
  steps: [{ from: 'a', to: 'b', onToolReturn: 'probe' }],
  scopeTools: true,
};
const _startEntries: SkillGraphConfig = {
  skills: [a, b],
  start: { entries: ['a', 'b'], byRelevance: mockEmbedder() },
};
const _flatWithSteps: SkillGraphConfig = {
  skills: [a, b],
  start: 'a',
  steps: [{ from: 'a', to: 'b', onToolReturn: 'probe' }],
  check: 'throw',
};
const _stepsOnly: SkillGraphConfig = { skills: [a, b], steps: [{ from: 'a', to: 'b' }] };
const _skillsOnly: SkillGraphConfig = { skills: [a] };

/** Each arm is nameable on its own, for consumers that build configs in parts. */
const _flatArm: SkillGraphFlatConfig = { skills: [a, b], start: 'a' };
const _treeArm: SkillGraphTreeConfig = { skills: [a, b], tree: decideSkill(() => true, a, b) };
const _armsAreConfigs: SkillGraphConfig[] = [_flatArm, _treeArm];

// ─── 2. The contradictions do not ─────────────────────────────────

// @ts-expect-error `tree` and `start` are two declarations of the same routing
const _treePlusStart: SkillGraphConfig = {
  skills: [a, b],
  tree: decideSkill(() => true, a, b),
  start: 'a',
};
// @ts-expect-error `tree` and `steps` are two declarations of the same routing
const _treePlusSteps: SkillGraphConfig = {
  skills: [a, b],
  tree: decideSkill(() => true, a, b),
  steps: [{ from: 'a', to: 'b' }],
};
const _bothMatchAndWhen: SkillGraphConfig = {
  skills: [a],
  start: {
    // @ts-expect-error a rule takes exactly ONE of `match`/`when` — both is refused
    rules: [{ match: /x/, when: () => true, use: 'a' }],
  },
};
const _neitherMatchNorWhen: SkillGraphConfig = {
  skills: [a],
  start: {
    // @ts-expect-error a rule exists to be conditional — for unconditional use `start: 'a'`
    rules: [{ use: 'a' }],
  },
};
// ...and the pair of them, at the call site rather than through a variable.
const _atTheCall = () =>
  // @ts-expect-error `start` and `steps` are the routing `tree` already owns
  skillGraph({
    skills: [a, b],
    tree: decideSkill(() => true, a, b),
    start: 'a',
    steps: [],
  });

describe('SkillGraphConfig — the type refuses what the build refuses', () => {
  it('compiles the valid shapes and rejects the contradictions (see the assertions above)', () => {
    expect(_treeOnly.skills).toHaveLength(2);
    expect(_flatWithSteps.steps).toHaveLength(1);
    expect(_armsAreConfigs).toHaveLength(2);
    // The runtime half agrees with the type, for callers the compiler never sees.
    expect(() => _atTheCall()).toThrow(/declare the routing that `tree` already owns/);
    void [
      _startString,
      _startUse,
      _startRules,
      _startRuleMatchers,
      _flatScopeTools,
      _startEntries,
      _stepsOnly,
      _skillsOnly,
      _treePlusStart,
      _treePlusSteps,
      _bothMatchAndWhen,
      _neitherMatchNorWhen,
    ];
  });
});
