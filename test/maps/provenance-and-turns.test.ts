/**
 * PROVENANCE IS IMMUTABLE; ELIGIBILITY IS RECOMPUTED — and turn boundaries.
 *
 * Two rulings, pinned here because half of each defect was that NOTHING
 * pinned either behaviour.
 *
 * ── R1: three distinct facts, not one standing ─────────────────────────
 * A single `by` used to answer three different questions at once:
 *   1. why is this MAP participating at all?      (engagement provenance)
 *   2. why is the cursor on THIS member?          (position evidence)
 *   3. why is THIS contribution served right now? (contribution eligibility)
 * Conflating them meant a declared edge out of an explicitly-requested skill
 * handed the NEXT skill a user request it never received — and `explicit`
 * never decays, so the map rode every remaining call of the turn on a warrant
 * that member never had. Worse, the founding cause was overwritten in place,
 * so the record could no longer answer the question an incident review
 * actually asks: was this founded on a guess?
 *
 * The law: a founding cause is written ONCE and keeps its witness forever.
 * Eligibility is recomputed each pass, and may weaken only when the SUBJECT
 * changes (a different member holds the cursor) — never because time passed.
 *
 * ── R3: cursor continuity and engagement continuity have independent
 *       lifetimes ────────────────────────────────────────────────────────
 * The conversation carrier persists `currentSkillId` (the CURSOR) across
 * turns and carries no engagement state at all, so engagement is re-evaluated
 * at turn start from that turn's evidence. That architecture was already
 * right; what was wrong was the classification. On turn two the carried
 * cursor arrives with no clause explaining it, and an absent clause used to
 * be written down as `structural` — the strongest, NON-DECAYING category. So
 * turn one's mistaken regex was laundered into a permanent warrant on turn
 * two and every turn after. It now founds `assumed`, which is tentative and
 * parks honestly.
 *
 * Test types: unit (the record's three facts) / functional (the route-
 * provenance timeline; the two-turn laundering timeline) / regression
 * (immutability across park and recovery).
 */

import { describe, expect, it } from 'vitest';
import {
  advanceEngagement,
  isTentative,
  type EngagementPass,
  type EngagementPlan,
  type MapEngagement,
} from '../../src/doors/maps.js';

const MAP = {
  id: 'skill-map',
  memberIds: ['audit', 'billing', 'refunds'],
  toolNames: ['get_zone_info'],
};
const plan: EngagementPlan = { maps: [MAP], renewalGrace: 3 };
const pass = (over: Partial<EngagementPass>): EngagementPass => ({
  iteration: 1,
  toolResults: [],
  acceptedSkillPicks: [],
  servedLastPass: MAP.memberIds,
  ...over,
});

describe('R1 unit: the record answers three separate questions', () => {
  it('founding writes all three, and position is recorded beside engagement', () => {
    const { next } = advanceEngagement(
      plan,
      undefined,
      pass({ iteration: 3, currentNode: 'audit', moveBy: 'model-pick' }),
    );
    const r = next[0]!;
    // 1. engagement provenance
    expect(r.foundedBy).toBe('explicit');
    expect(r.foundedAt).toBe(3);
    expect(r.foundedOn).toBe('audit');
    // 2. position evidence
    expect(r.at).toBe('audit');
    expect(r.atBy).toBe('explicit');
    expect(r.atSince).toBe(3);
    // 3. contribution eligibility
    expect(r.by).toBe('explicit');
  });

  it('a member that holds the cursor keeps its ARRIVAL iteration across passes', () => {
    let state: MapEngagement | undefined;
    ({ next: state } = advanceEngagement(
      plan,
      state,
      pass({ iteration: 1, currentNode: 'audit', moveBy: 'model-pick' }),
    ));
    ({ next: state } = advanceEngagement(
      plan,
      state,
      pass({ iteration: 2, currentNode: 'audit', moveBy: 'stay' }),
    ));
    ({ next: state } = advanceEngagement(
      plan,
      state,
      pass({ iteration: 3, currentNode: 'audit', moveBy: 'stay' }),
    ));
    // Restating position every pass would reset atSince and erase how long
    // this member has actually held the cursor.
    expect(state[0]!.atSince).toBe(1);
    expect(state[0]!.at).toBe('audit');
  });
});

describe('R1 functional: a declared route does not forge a user request', () => {
  it('B entered by a declared edge rests on structural, not on A’s explicit', () => {
    // Iteration 1: the user explicitly asked for `audit`.
    let state: MapEngagement | undefined;
    ({ next: state } = advanceEngagement(
      plan,
      state,
      pass({ iteration: 1, currentNode: 'audit', moveBy: 'model-pick' }),
    ));
    expect(state[0]!.by).toBe('explicit');

    // Iteration 2: a DECLARED EDGE moves the cursor to `billing`. Nobody asked
    // for billing.
    const adv = advanceEngagement(
      plan,
      state,
      pass({ iteration: 2, currentNode: 'billing', moveBy: 'route' }),
    );
    const r = adv.next[0]!;

    // POSITION: billing entered by a route — its own witness, its own iteration.
    expect(r.at).toBe('billing');
    expect(r.atBy).toBe('structural');
    expect(r.atSince).toBe(2);

    // ELIGIBILITY: re-derived from THIS member's evidence. Not `explicit`.
    expect(r.by).toBe('structural');

    // PROVENANCE: untouched. The engagement still began explicitly, on audit,
    // at iteration 1 — and that stays true forever.
    expect(r.foundedBy).toBe('explicit');
    expect(r.foundedAt).toBe(1);
    expect(r.foundedOn).toBe('audit');

    // And the kernel SAYS it changed eligibility, and why.
    expect(adv.changes[0]).toMatchObject({
      kind: 'engaged',
      tenantChanged: true,
      at: 'billing',
      by: 'structural',
      foundedBy: 'explicit',
    });
  });

  it('a WEAK entry into a new member can park, where an inherited explicit never could', () => {
    // The defect in one timeline: explicit on `audit`, then a lexical guess
    // walks the cursor to `refunds`. Under the old model refunds inherited
    // `explicit` and rode the whole turn. Now it is tentative and parks.
    let state: MapEngagement | undefined;
    ({ next: state } = advanceEngagement(
      plan,
      state,
      pass({ iteration: 1, currentNode: 'audit', moveBy: 'model-pick' }),
    ));
    ({ next: state } = advanceEngagement(
      plan,
      state,
      pass({ iteration: 2, currentNode: 'refunds', moveBy: 'entry', witness: 'refund' }),
    ));
    expect(state[0]!.by).toBe('lexical');
    expect(isTentative(state[0]!.by)).toBe(true);

    let adv;
    for (const i of [3, 4, 5]) {
      adv = advanceEngagement(
        plan,
        state,
        pass({
          iteration: i,
          currentNode: 'refunds',
          moveBy: 'stay',
          toolResults: [{ toolName: 'screen_open' }],
        }),
      );
      state = adv.next;
    }
    expect(state[0]!.standing).toBe('parked');
    // Even parked, the founding cause still tells the truth about the start.
    expect(state[0]!.foundedBy).toBe('explicit');
    expect(state[0]!.foundedOn).toBe('audit');
  });
});

describe('R1 regression: a founding cause survives everything', () => {
  it('upgrade, park and recovery all leave foundedBy/foundedAt/foundedOn alone', () => {
    let state: MapEngagement | undefined;
    // Founded on a GUESS.
    ({ next: state } = advanceEngagement(
      plan,
      state,
      pass({ iteration: 1, currentNode: 'audit', moveBy: 'entry', witness: 'zone' }),
    ));
    expect(state[0]!.foundedBy).toBe('lexical');

    // UPGRADED by its own tool being called — `by` rises, provenance does not.
    const up = advanceEngagement(
      plan,
      state,
      pass({
        iteration: 2,
        currentNode: 'audit',
        moveBy: 'stay',
        toolResults: [{ toolName: 'get_zone_info' }],
      }),
    );
    state = up.next;
    expect(state[0]!.by).toBe('structural');
    expect(state[0]!.foundedBy).toBe('lexical');
    expect(state[0]!.foundedAt).toBe(1);
    // The upgrade is a CHANGE, so it reaches the record rather than silently
    // rewriting `by` and leaving a reviewer to believe it was always that strong.
    expect(up.changes[0]).toMatchObject({
      kind: 'engaged',
      upgraded: true,
      by: 'structural',
      foundedBy: 'lexical',
    });

    // Now drive it back down to a park via a weak tenant change, then recover.
    ({ next: state } = advanceEngagement(
      plan,
      state,
      pass({ iteration: 3, currentNode: 'billing', moveBy: 'entry', witness: 'bill' }),
    ));
    for (const i of [4, 5, 6]) {
      ({ next: state } = advanceEngagement(
        plan,
        state,
        pass({
          iteration: i,
          currentNode: 'billing',
          moveBy: 'stay',
          toolResults: [{ toolName: 'screen_open' }],
        }),
      ));
    }
    expect(state[0]!.standing).toBe('parked');

    const back = advanceEngagement(
      plan,
      state,
      pass({ iteration: 7, currentNode: 'billing', moveBy: 'model-pick', acceptedSkillPicks: ['billing'] }),
    );
    expect(back.next[0]!.standing).toBe('engaged');
    // Through a guess, an upgrade, a tenant change, a park and a recovery:
    // ONE answer to "was this founded on a guess?", and it never moved.
    expect(back.next[0]!.foundedBy).toBe('lexical');
    expect(back.next[0]!.foundedAt).toBe(1);
    expect(back.next[0]!.foundedOn).toBe('audit');
  });
});

describe('R3: cursor continuity and engagement continuity have independent lifetimes', () => {
  it('turn two does NOT inherit turn one’s explicit activation', () => {
    // TURN ONE: the model explicitly picked `audit`.
    const turnOne = advanceEngagement(
      plan,
      undefined,
      pass({ iteration: 1, currentNode: 'audit', moveBy: 'model-pick' }),
    );
    expect(turnOne.next[0]!.by).toBe('explicit');

    // TURN TWO. Engagement state is per-run and is NOT carried by the
    // conversation carrier (which persists `currentSkillId` only), so the
    // kernel starts from `undefined`. The CURSOR, however, is carried — it
    // arrives on `audit` with no clause explaining why it is there.
    const turnTwo = advanceEngagement(
      plan,
      undefined, // ← the independent lifetime, stated as an argument
      pass({ iteration: 1, currentNode: 'audit', moveBy: 'stay' }),
    );
    const r = turnTwo.next[0]!;

    // The laundering that used to happen: `stay` fell through to the default
    // and was written down as `structural` — the strongest, non-decaying
    // category — so turn one's guess became a permanent warrant.
    expect(r.by).not.toBe('structural');
    expect(r.by).not.toBe('explicit');
    expect(r.by).toBe('assumed');
    expect(isTentative(r.by)).toBe(true);
    expect(r.foundedAt).toBe(1); // founded THIS turn, on this turn's evidence
  });

  it('an unexplained carried cursor parks instead of riding the whole new turn', () => {
    let state: MapEngagement | undefined;
    let adv = advanceEngagement(
      plan,
      state,
      pass({ iteration: 1, currentNode: 'audit', moveBy: 'stay' }),
    );
    state = adv.next;
    for (const i of [2, 3, 4]) {
      adv = advanceEngagement(
        plan,
        state,
        pass({
          iteration: i,
          currentNode: 'audit',
          moveBy: 'stay',
          toolResults: [{ toolName: 'screen_open' }],
        }),
      );
      state = adv.next;
    }
    expect(state[0]!.standing).toBe('parked');
    expect(adv.changes[0]).toMatchObject({ kind: 'parked', by: 'assumed', idleCalls: 3 });
  });

  it('turn two with FRESH explicit evidence engages on that evidence, not on memory', () => {
    const turnTwo = advanceEngagement(
      plan,
      undefined,
      pass({
        iteration: 1,
        currentNode: 'refunds',
        moveBy: 'model-pick',
        acceptedSkillPicks: ['refunds'],
      }),
    );
    const r = turnTwo.next[0]!;
    expect(r.by).toBe('explicit');
    expect(r.foundedAt).toBe(1);
    expect(r.foundedOn).toBe('refunds');
  });
});
