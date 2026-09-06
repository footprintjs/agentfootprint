/**
 * `classifySkillTarget` — the ONE owner of "what kind of target is this?" (9.86.0).
 *
 * THE DEFECT IT FIXES. `makeReachableSkills` filters the cursor out of its own
 * successor set, which is right for a MOVE (there is nowhere to move to) and
 * says nothing about a READ. Five consumers had to know that, and only three
 * did: the read_skill gate, the tool description and the offer builder each
 * wrote their own `requested === cursor` check, while the tool-effects
 * `propose-transition` judge and the `skill_read` permission gate never heard
 * about it — so a tool proposing "stay where you are" was refused as
 * unreachable, and a policy was asked to grant a capability the model already
 * held. One rule, five copies, two of them missing.
 *
 * The law this function owns, in one line: THE CURSOR IS A LEGITIMATE TARGET
 * OF A READ (a stay), NEVER OF A MOVE.
 *
 * Test types (Convention 3): unit · boundary · property. The scenario and
 * security halves are driven end to end by the consumers' own suites —
 * `test/skillGraphSelfCall.test.ts` (the gate), `test/core/agent/
 * tool-effects.test.ts` (the stay), `test/security/skill-visibility.test.ts`
 * (the permission gate) — which is the point of having one owner: each
 * consumer proves the behaviour, this file proves the rule.
 */

import { describe, expect, it } from 'vitest';
import { classifySkillTarget } from '../src/injection-engine.js';
import { atMountedCursor } from '../src/core/agent/stages/toolCalls.js';
import { classifySkillTarget as fromDoor } from '../src/doors/skill-graph.js';

describe('classifySkillTarget — the four classes', () => {
  it('the cursor itself is a STAY, whatever the sets say', () => {
    expect(classifySkillTarget({ cursor: 'billing', target: 'billing' })).toBe('self');
    // …and it stays a stay even when the graph happens to wire a self-edge,
    // which is the one input that could tempt a caller back into "it is a hop".
    expect(classifySkillTarget({ cursor: 'billing', target: 'billing', hops: ['billing'] })).toBe(
      'self',
    );
  });

  it('a declared successor is a HOP — the one class that moves the cursor', () => {
    expect(classifySkillTarget({ cursor: 'billing', target: 'refunds', hops: ['refunds'] })).toBe(
      'hop',
    );
  });

  it('a skill the graph wires no edge into is OPEN — it activates, it never moves', () => {
    expect(classifySkillTarget({ cursor: 'billing', target: 'debug', open: ['debug'] })).toBe(
      'open',
    );
  });

  it('everything else is UNREACHABLE', () => {
    expect(
      classifySkillTarget({
        cursor: 'billing',
        target: 'vault',
        hops: ['refunds'],
        open: ['debug'],
      }),
    ).toBe('unreachable');
  });
});

describe('classifySkillTarget — the boundaries', () => {
  it('no cursor (cold start) means nothing can be a stay', () => {
    // The turn has not entered a skill yet. `undefined === undefined` must not
    // be read as "the model asked for where it is".
    expect(classifySkillTarget({ target: 'billing', hops: ['billing'] })).toBe('hop');
    expect(classifySkillTarget({ target: 'billing' })).toBe('unreachable');
  });

  it('an id in BOTH sets is a HOP — the move is the stronger fact', () => {
    // A caller that reported it as merely open would lose the cursor move, and
    // the gate's `skillHop` flag is what writes `pendingSkillPick`.
    expect(
      classifySkillTarget({
        cursor: 'billing',
        target: 'refunds',
        hops: ['refunds'],
        open: ['refunds'],
      }),
    ).toBe('hop');
  });

  it('empty and absent sets answer the same way — no set is not an admission', () => {
    expect(classifySkillTarget({ cursor: 'a', target: 'b', hops: [], open: [] })).toBe(
      'unreachable',
    );
    expect(classifySkillTarget({ cursor: 'a', target: 'b' })).toBe('unreachable');
  });
});

describe('classifySkillTarget — properties', () => {
  it('total: every input lands in exactly one of the four classes', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const cursors: Array<string | undefined> = [undefined, ...ids];
    const classes = new Set<string>();
    for (const cursor of cursors) {
      for (const target of ids) {
        const verdict = classifySkillTarget({
          ...(cursor !== undefined && { cursor }),
          target,
          hops: ['b'],
          open: ['c'],
        });
        expect(['self', 'hop', 'open', 'unreachable']).toContain(verdict);
        classes.add(verdict);
      }
    }
    // …and the fixture really does reach all four, so the assertion above is
    // not passing on three of them.
    expect([...classes].sort()).toEqual(['hop', 'open', 'self', 'unreachable']);
  });

  it('pure: the same inputs answer the same way, and the inputs are not mutated', () => {
    const hops = ['b'];
    const open = ['c'];
    const args = { cursor: 'a', target: 'b', hops, open };
    expect(classifySkillTarget(args)).toBe(classifySkillTarget(args));
    expect(hops).toEqual(['b']);
    expect(open).toEqual(['c']);
  });

  it('one function, both doors — a foreign host gates its picks by the same rule', () => {
    // `agentfootprint/skill-graph` is the no-framework door (obligation 2 is
    // "gate read_skill on the reachable set"). A host that had to re-derive the
    // stay rule would re-introduce the bug outside our tests.
    expect(fromDoor).toBe(classifySkillTarget);
  });
});

/**
 * `atMountedCursor` — position AND engagement, because the permission gate
 * needs both (9.86.0 fix pass).
 *
 * THE DEFECT IT FIXES. The `skill_read` permission gate skipped its policy
 * check whenever `classifySkillTarget` said `'self'`, on the argument that a
 * stay activates nothing. That argument holds for a MOUNTED cursor and fails
 * for a PARKED one: parking suppresses the map's contribution without moving
 * the cursor, so the dispatch gate reads the very same id as a RE-ENGAGEMENT
 * and serves the body and tools again on the next pass. The skip therefore let
 * a role whose checker hides that skill un-park and re-activate it — a call
 * 9.85.0 refused. `test/maps/agent-maps-integration.test.ts` drives that end to
 * end; this file proves the rule.
 *
 * Test types (Convention 3): unit · boundary · property.
 */
describe('atMountedCursor — a stay only counts as a no-op while the cursor is mounted', () => {
  it('the cursor own skill, nothing parked, is a no-op', () => {
    expect(atMountedCursor({ cursor: 'audit', target: 'audit' })).toBe(true);
    expect(atMountedCursor({ cursor: 'audit', target: 'audit', parked: new Set() })).toBe(true);
  });

  it('the SAME id at a PARKED cursor is not a no-op — it re-engages', () => {
    expect(atMountedCursor({ cursor: 'audit', target: 'audit', parked: new Set(['audit']) })).toBe(
      false,
    );
  });

  it('a move is never a no-op, parked or not', () => {
    expect(atMountedCursor({ cursor: 'audit', target: 'billing' })).toBe(false);
    expect(
      atMountedCursor({ cursor: 'audit', target: 'billing', parked: new Set(['billing']) }),
    ).toBe(false);
  });

  it('boundary: a cold start has no cursor, so nothing is a no-op', () => {
    expect(atMountedCursor({ target: 'audit' })).toBe(false);
    expect(atMountedCursor({ cursor: undefined, target: 'audit', parked: undefined })).toBe(false);
  });

  it('boundary: a park holding OTHER members leaves the stay a no-op', () => {
    expect(
      atMountedCursor({ cursor: 'audit', target: 'audit', parked: new Set(['billing']) }),
    ).toBe(true);
  });

  it('property: it never answers true where classifySkillTarget does not say self', () => {
    const ids = ['a', 'b', 'c'];
    const parkedSets = [undefined, new Set<string>(), new Set(['a']), new Set(['a', 'b'])];
    for (const cursor of [undefined, ...ids]) {
      for (const target of ids) {
        for (const parked of parkedSets) {
          const answer = atMountedCursor({ cursor, target, parked });
          const stay =
            classifySkillTarget({ ...(cursor !== undefined && { cursor }), target }) === 'self';
          if (answer) expect(stay).toBe(true);
          // …and it is exactly "a stay the park is not holding".
          expect(answer).toBe(stay && parked?.has(target) !== true);
        }
      }
    }
  });
});
