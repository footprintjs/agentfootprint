/**
 * The lease machine + its renewal feed, as pure functions.
 *
 * The law under test: a TENTATIVE engagement (lexical/semantic guess) is
 * renewed only by concrete evidence and parks after `renewalGrace`
 * corroboration-free passes; explicit/structural engagements stand; parking
 * never appears without all three idle clauses (served, unused, turn went
 * elsewhere); explicit or structural evidence re-engages a parked map.
 *
 * Test types (Convention 3): unit (feed classification, reducer arms) /
 * functional (the recorded keyword-trap timeline, pass by pass) /
 * regression (nonParkable, thinking-pass counts nothing).
 */

import { describe, expect, it } from 'vitest';
import {
  advanceEngagement,
  isTentative,
  renewalEvidenceOf,
  strengthOfMove,
  strongestOf,
  type EngagementPass,
  type EngagementPlan,
  type MapEngagement,
} from '../../src/doors/maps.js';

const MAP = {
  id: 'skill-map',
  memberIds: ['zone-audit', 'billing'],
  toolNames: ['get_zone_info'],
};
const plan = (over: Partial<EngagementPlan> = {}): EngagementPlan => ({
  maps: [MAP],
  renewalGrace: 3,
  ...over,
});
const pass = (over: Partial<EngagementPass>): EngagementPass => ({
  iteration: 1,
  toolResults: [],
  acceptedSkillPicks: [],
  // The idle test's SERVED clause (9.59.0). Default: the map's contribution
  // DID ride last pass, which is the situation every timeline below is about.
  // A test that wants the not-served case says so explicitly.
  servedLastPass: MAP.memberIds,
  ...over,
});

describe('unit: the renewal feed classifies evidence by what produced it', () => {
  it('maps cursor-move clauses onto the strength ladder', () => {
    expect(strengthOfMove('entry')).toBe('lexical');
    expect(strengthOfMove('intent')).toBe('semantic');
    expect(strengthOfMove('decider')).toBe('semantic');
    expect(strengthOfMove('route')).toBe('structural');
    expect(strengthOfMove('tool-proposal')).toBe('structural');
    expect(strengthOfMove('continuity')).toBe('structural');
    expect(strengthOfMove('model-pick')).toBe('explicit');
    // Unknown future clause reads as structural — the conservative arm:
    // wrongly strong delays a park; wrongly weak parks what the system routed to.
    expect(strengthOfMove('something-new')).toBe('structural');
    // But 'stay' and 'none' are NOT MOVES, and they are the recorded stuck
    // turn's own shape (29 of 30). They answer `assumed` — nobody said why —
    // which is TENTATIVE, so it decays. Reading them as system evidence is
    // exactly how that turn would have been renewed forever.
    expect(strengthOfMove('stay')).toBe('assumed');
    expect(strengthOfMove('none')).toBe('assumed');
    expect(isTentative('lexical')).toBe(true);
    expect(isTentative('assumed')).toBe(true);
    expect(isTentative('structural')).toBe(false);
  });

  it('joins owned tool calls, in-map moves, and picks — and a stay earns nothing', () => {
    const ev = renewalEvidenceOf(
      MAP,
      pass({
        currentNode: 'zone-audit',
        moveBy: 'stay',
        toolResults: [{ toolName: 'get_zone_info' }, { toolName: 'screen_open' }],
        pendingSkillPick: 'billing',
      }),
    );
    const kinds = ev.map((e) => e.kind).sort();
    expect(kinds).toEqual(['explicit-pick', 'owned-tool-called']);
    expect(strongestOf(ev)).toBe('explicit');
    // A bare stay with foreign tools only: no evidence at all.
    expect(
      renewalEvidenceOf(
        MAP,
        pass({ currentNode: 'zone-audit', moveBy: 'stay', toolResults: [{ toolName: 'x' }] }),
      ),
    ).toEqual([]);
  });
});

describe('functional: the recorded keyword-trap timeline, pass by pass', () => {
  it('founds a LEXICAL engagement on an entry match, with its witness', () => {
    const { next, changes } = advanceEngagement(plan(), undefined, {
      ...pass({ iteration: 1, currentNode: 'zone-audit', moveBy: 'entry', witness: 'zone' }),
    });
    expect(next).toEqual([
      {
        mapId: 'skill-map',
        standing: 'engaged',
        by: 'lexical',
        since: 1,
        // FACT 1 — engagement provenance, written once and never rewritten.
        foundedBy: 'lexical',
        foundedAt: 1,
        foundedOn: 'zone-audit',
        // FACT 2 — position evidence, recorded separately from the start.
        at: 'zone-audit',
        atBy: 'lexical',
        atSince: 1,
        idle: 0,
        witness: 'zone',
      },
    ]);
    expect(changes).toEqual([
      { kind: 'engaged', mapId: 'skill-map', iteration: 1, by: 'lexical', witness: 'zone' },
    ]);
  });

  it('counts idle only when the turn went ELSEWHERE, and parks at grace with the witness', () => {
    let state: MapEngagement | undefined;
    ({ next: state } = advanceEngagement(
      plan(),
      state,
      pass({ iteration: 1, currentNode: 'zone-audit', moveBy: 'entry', witness: 'zone' }),
    ));
    // Pass 2: model THOUGHT (no tool calls) — counts nothing.
    let adv = advanceEngagement(
      plan(),
      state,
      pass({ iteration: 2, currentNode: 'zone-audit', moveBy: 'stay' }),
    );
    expect(adv.next[0]!.idle).toBe(0);
    state = adv.next;
    // Passes 3–5: foreign tools each pass — idle 1, 2, 3 → parked on the third.
    for (const i of [3, 4]) {
      adv = advanceEngagement(
        plan(),
        state,
        pass({
          iteration: i,
          currentNode: 'zone-audit',
          moveBy: 'stay',
          toolResults: [{ toolName: 'screen_open' }],
        }),
      );
      state = adv.next;
      expect(adv.changes).toEqual([]);
    }
    adv = advanceEngagement(
      plan(),
      state,
      pass({
        iteration: 5,
        currentNode: 'zone-audit',
        moveBy: 'stay',
        toolResults: [{ toolName: 'screen_open' }],
      }),
    );
    expect(adv.next[0]!.standing).toBe('parked');
    expect(adv.parkedInjectionIds).toEqual(['zone-audit', 'billing']);
    expect(adv.changes).toEqual([
      {
        kind: 'parked',
        mapId: 'skill-map',
        iteration: 5,
        by: 'lexical',
        idleCalls: 3,
        witness: 'zone',
      },
    ]);
  });

  it('its own tool called = renewal; the idle counter resets', () => {
    let state: MapEngagement | undefined;
    ({ next: state } = advanceEngagement(
      plan(),
      state,
      pass({ iteration: 1, currentNode: 'zone-audit', moveBy: 'entry', witness: 'zone' }),
    ));
    ({ next: state } = advanceEngagement(
      plan(),
      state,
      pass({
        iteration: 2,
        currentNode: 'zone-audit',
        moveBy: 'stay',
        toolResults: [{ toolName: 'screen_open' }],
      }),
    ));
    expect(state[0]!.idle).toBe(1);
    const adv = advanceEngagement(
      plan(),
      state,
      pass({
        iteration: 3,
        currentNode: 'zone-audit',
        moveBy: 'stay',
        toolResults: [{ toolName: 'get_zone_info' }],
      }),
    );
    expect(adv.next[0]!.idle).toBe(0);
    // owned-tool evidence is structural — the guess is upgraded and stops decaying
    expect(adv.next[0]!.by).toBe('structural');
  });

  it('explicit evidence re-engages a parked map; tentative evidence does not', () => {
    const parked: MapEngagement = [
      {
        mapId: 'skill-map',
        standing: 'parked',
        by: 'lexical',
        since: 4,
        foundedBy: 'lexical',
        foundedAt: 1,
        foundedOn: 'zone-audit',
        at: 'zone-audit',
        atBy: 'lexical',
        atSince: 1,
        idle: 3,
        witness: 'zone',
      },
    ];
    // Same lexical noise again: stays parked.
    const still = advanceEngagement(
      plan(),
      parked,
      pass({
        iteration: 5,
        currentNode: 'zone-audit',
        moveBy: 'stay',
        toolResults: [{ toolName: 'x' }],
      }),
    );
    expect(still.next[0]!.standing).toBe('parked');
    expect(still.parkedInjectionIds).toEqual(['zone-audit', 'billing']);
    // The model asks by name: re-engaged, recorded as a recovery.
    const back = advanceEngagement(
      plan(),
      parked,
      pass({
        iteration: 6,
        currentNode: 'billing',
        moveBy: 'model-pick',
        pendingSkillPick: 'billing',
      }),
    );
    expect(back.next[0]).toMatchObject({ standing: 'engaged', by: 'explicit', idle: 0 });
    expect(back.parkedInjectionIds).toEqual([]);
    expect(back.changes[0]).toMatchObject({ kind: 'engaged', reengaged: true, by: 'explicit' });
  });
});

describe('regression: standings that must never park', () => {
  it('a nonParkable map counts idle but never parks', () => {
    const p = plan({ maps: [{ ...MAP, nonParkable: true }] });
    let state: MapEngagement | undefined;
    ({ next: state } = advanceEngagement(
      p,
      state,
      pass({ iteration: 1, currentNode: 'zone-audit', moveBy: 'entry' }),
    ));
    for (const i of [2, 3, 4, 5, 6]) {
      ({ next: state } = advanceEngagement(
        p,
        state,
        pass({
          iteration: i,
          currentNode: 'zone-audit',
          moveBy: 'stay',
          toolResults: [{ toolName: 'x' }],
        }),
      ));
    }
    expect(state[0]!.standing).toBe('engaged');
    expect(state[0]!.idle).toBe(5);
  });

  it('an explicit engagement never decays, however long the model works elsewhere', () => {
    let state: MapEngagement | undefined;
    ({ next: state } = advanceEngagement(
      plan(),
      state,
      pass({ iteration: 1, currentNode: 'billing', moveBy: 'model-pick' }),
    ));
    for (const i of [2, 3, 4, 5, 6, 7]) {
      ({ next: state } = advanceEngagement(
        plan(),
        state,
        pass({
          iteration: i,
          currentNode: 'billing',
          moveBy: 'stay',
          toolResults: [{ toolName: 'x' }],
        }),
      ));
    }
    expect(state[0]!.standing).toBe('engaged');
    expect(state[0]!.by).toBe('explicit');
  });

  it('a map with no cursor and no member activity earns no record at all', () => {
    const adv = advanceEngagement(plan(), undefined, pass({ iteration: 1 }));
    expect(adv.next).toEqual([]);
    expect(adv.parkedInjectionIds).toEqual([]);
    expect(adv.changes).toEqual([]);
  });
});
