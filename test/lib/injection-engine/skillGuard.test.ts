/**
 * skillGuard — the data-guard domain module (9.51.0).
 *
 * One compilation, three faces: the predicate that routes, the serializable
 * data that describes it, and the per-condition evidence the record quotes.
 * The operator grammar deliberately mirrors footprintjs's WhereFilter
 * (eq/ne/gt/gte/lt/lte/in/notIn, all ANDed) as a door-local twin — the
 * skill-graph door's no-footprintjs fence forbids the import.
 *
 * Sections follow Convention 3: Unit · Functional · Property · Security.
 */

import { describe, it, expect } from 'vitest';
import {
  compileGuard,
  guardUnsatisfiable,
  mermaidGuardCaption,
  plainGuardCaption,
  GUARD_HOP_KEYS,
  type GuardHopView,
  type SkillGuardData,
} from '../../../src/lib/injection-engine/skillGuard.js';

const view = (overrides: Partial<GuardHopView> = {}): GuardHopView => ({
  toolName: 'lookup_order',
  result: '{"riskLevel":"high","score":0.9,"open":true,"note":null}',
  iteration: 3,
  userMessage: 'refund order 4412',
  currentSkillId: 'triage',
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit — compilation refusals (every malformed shape refused by name)
// ─────────────────────────────────────────────────────────────────────────────

describe('compileGuard refusals', () => {
  it('refuses an EMPTY guard — it asserts nothing (the anti-vacuous-truth law)', () => {
    expect(() => compileGuard({}, 'route a→b')).toThrowError(/empty.*asserts nothing/is);
  });

  it('refuses an unknown operator by name, listing the valid set', () => {
    expect(() => compileGuard({ score: { gle: 3 } as never }, 'route a→b')).toThrowError(
      /unknown operator "gle".*eq, ne, gt, gte, lt, lte, in, notIn/s,
    );
  });

  it('refuses a key with no operator ({})', () => {
    expect(() => compileGuard({ score: {} }, 'route a→b')).toThrowError(/declares no operator/);
  });

  it('refuses an empty in/notIn list — nothing to check', () => {
    expect(() => compileGuard({ status: { in: [] } }, 'route a→b')).toThrowError(/NON-EMPTY/);
    expect(() => compileGuard({ status: { notIn: [] } }, 'route a→b')).toThrowError(/NON-EMPTY/);
  });

  it('refuses an in list past the footprintjs bound (1000)', () => {
    const big = Array.from({ length: 1001 }, (_, i) => i);
    expect(() => compileGuard({ score: { in: big } }, 'route a→b')).toThrowError(/max 1000/);
  });

  it('refuses non-data thresholds — a guard is data and must ride recordings', () => {
    expect(() => compileGuard({ score: { eq: new Date() as never } }, 'route a→b')).toThrowError(
      /non-data value/,
    );
    expect(() => compileGuard({ score: { in: [() => 1] as never } }, 'route a→b')).toThrowError(
      /non-data entry/,
    );
  });

  it('refuses a boolean/null threshold on an ordered operator', () => {
    expect(() => compileGuard({ open: { gt: true as never } }, 'route a→b')).toThrowError(
      /needs a number or a string/,
    );
  });

  it('names the route in every refusal, so the author knows WHICH edge', () => {
    expect(() => compileGuard({}, 'route triage→billing')).toThrowError(/route triage→billing/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Functional — evaluation semantics: hop keys, result-JSON keys, operators
// ─────────────────────────────────────────────────────────────────────────────

describe('guard evaluation', () => {
  it('the six hop keys read the hop directly', () => {
    expect(GUARD_HOP_KEYS).toEqual([
      'toolName',
      'result',
      'status',
      'iteration',
      'userMessage',
      'currentSkillId',
    ]);
    const g = compileGuard(
      {
        toolName: { eq: 'lookup_order' },
        status: { in: ['success'] },
        iteration: { gte: 3, lte: 5 },
        currentSkillId: { ne: 'billing' },
      },
      'route a→b',
    );
    expect(g.predicate(view({ status: 'success' }))).toBe(true);
    expect(g.predicate(view({ status: 'denied' }))).toBe(false);
    expect(g.predicate(view({ status: 'success', iteration: 6 }))).toBe(false);
  });

  it('any OTHER key reads the top-level field of the result parsed as JSON', () => {
    const g = compileGuard(
      { riskLevel: { in: ['high', 'critical'] }, score: { gte: 0.8 }, open: { eq: true } },
      'route a→b',
    );
    expect(g.predicate(view())).toBe(true);
    expect(g.predicate(view({ result: '{"riskLevel":"low","score":0.9,"open":true}' }))).toBe(
      false,
    );
  });

  it('a result that is not a JSON object yields undefined for such keys — condition fails, honestly', () => {
    const g = compileGuard({ riskLevel: { eq: 'high' } }, 'route a→b');
    expect(g.predicate(view({ result: 'plain prose result' }))).toBe(false);
    expect(g.predicate(view({ result: '[1,2,3]' }))).toBe(false);
    const ev = g.evaluate(view({ result: 'plain prose result' }));
    expect(ev.verdict).toBe(false);
    expect(ev.conditions[0]).toMatchObject({
      key: 'riskLevel',
      op: 'eq',
      value: 'high',
      actualSummary: 'undefined',
      passed: false,
    });
  });

  it('string ordering works lexicographically (riskLevel ≥ high)', () => {
    const g = compileGuard({ riskLevel: { gte: 'high' } }, 'route a→b');
    expect(g.predicate(view())).toBe(true); // 'high' >= 'high'
    expect(g.predicate(view({ result: '{"riskLevel":"low"}' }))).toBe(true); // 'low' > 'high'
    expect(g.predicate(view({ result: '{"riskLevel":"a"}' }))).toBe(false);
  });

  it('notIn is true for a value absent from the list (and for undefined)', () => {
    const g = compileGuard({ status: { notIn: ['denied', 'failure'] } }, 'route a→b');
    expect(g.predicate(view({ status: 'success' }))).toBe(true);
    expect(g.predicate(view())).toBe(true); // no declared status — not in the list
    expect(g.predicate(view({ status: 'denied' }))).toBe(false);
  });

  it('evaluate() records EVERY condition with a bounded actualSummary, and agrees with predicate()', () => {
    const g = compileGuard({ riskLevel: { eq: 'high' }, iteration: { gt: 5 } }, 'route a→b');
    const v = view();
    const ev = g.evaluate(v);
    expect(ev.verdict).toBe(g.predicate(v));
    expect(ev.verdict).toBe(false);
    expect(ev.conditions).toEqual([
      { key: 'riskLevel', op: 'eq', value: 'high', actualSummary: 'high', passed: true },
      { key: 'iteration', op: 'gt', value: 5, actualSummary: '3', passed: false },
    ]);
  });

  it('actualSummary is bounded to 80 chars — evidence, not a transcript', () => {
    const long = 'x'.repeat(500);
    const g = compileGuard({ result: { eq: 'never' } }, 'route a→b');
    const ev = g.evaluate(view({ result: long }));
    expect(ev.conditions[0]!.actualSummary.length).toBeLessThanOrEqual(80);
    expect(ev.conditions[0]!.actualSummary.endsWith('…')).toBe(true);
  });

  it('the data face describes exactly the conditions that run, in declaration order', () => {
    const g = compileGuard(
      { riskLevel: { gte: 'high' }, status: { in: ['success', 'partial'] } },
      'route a→b',
    );
    expect(g.data).toEqual({
      conditions: [
        { key: 'riskLevel', op: 'gte', value: 'high' },
        { key: 'status', op: 'in', value: ['success', 'partial'] },
      ],
    });
    // Data survives structuredClone — a guard IS data.
    expect(structuredClone(g.data)).toEqual(g.data);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Functional — captions (one grammar, drawn and quoted)
// ─────────────────────────────────────────────────────────────────────────────

describe('guard captions', () => {
  const data: SkillGuardData = {
    conditions: [
      { key: 'riskLevel', op: 'gte', value: 'high' },
      { key: 'status', op: 'in', value: ['success', 'partial'] },
      { key: 'iteration', op: 'ne', value: 3 },
    ],
  };

  it('plainGuardCaption renders operators as words a human reads', () => {
    expect(plainGuardCaption(data)).toBe(
      'riskLevel ≥ high AND status in [success, partial] AND iteration ≠ 3',
    );
  });

  it('mermaidGuardCaption leads with "when" and escapes mermaid label chars once', () => {
    const piped: SkillGuardData = { conditions: [{ key: 'a', op: 'eq', value: 'x|y' }] };
    expect(mermaidGuardCaption(piped)).toBe('when a = x#124;y');
    expect(mermaidGuardCaption(data)).toBe(
      'when riskLevel ≥ high AND status in [success, partial] AND iteration ≠ 3',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property — guardUnsatisfiable claims ONLY what the data proves
// ─────────────────────────────────────────────────────────────────────────────

const gd = (...conditions: SkillGuardData['conditions'][number][]): SkillGuardData => ({
  conditions,
});

describe('guardUnsatisfiable — provable contradictions', () => {
  it('eq vs ne on one key', () => {
    expect(
      guardUnsatisfiable(
        gd({ key: 'a', op: 'eq', value: 'x' }, { key: 'a', op: 'ne', value: 'x' }),
      ),
    ).toMatch(/no value satisfies both/);
  });

  it("eq outside the same key's in list / inside its notIn list", () => {
    expect(
      guardUnsatisfiable(
        gd({ key: 'a', op: 'eq', value: 'x' }, { key: 'a', op: 'in', value: ['y', 'z'] }),
      ),
    ).toMatch(/does not contain it/);
    expect(
      guardUnsatisfiable(
        gd({ key: 'a', op: 'eq', value: 'x' }, { key: 'a', op: 'notIn', value: ['x'] }),
      ),
    ).toMatch(/excludes it/);
  });

  it('crossed ordered bounds (same type only)', () => {
    expect(
      guardUnsatisfiable(gd({ key: 'n', op: 'gt', value: 5 }, { key: 'n', op: 'lt', value: 3 })),
    ).toMatch(/crossed/);
    expect(
      guardUnsatisfiable(gd({ key: 'n', op: 'gt', value: 5 }, { key: 'n', op: 'lte', value: 5 })),
    ).toMatch(/crossed/);
    // gte 5 lte 5 admits exactly 5 — satisfiable.
    expect(
      guardUnsatisfiable(gd({ key: 'n', op: 'gte', value: 5 }, { key: 'n', op: 'lte', value: 5 })),
    ).toBeUndefined();
  });

  it("eq violating the same key's bounds", () => {
    expect(
      guardUnsatisfiable(gd({ key: 'n', op: 'eq', value: 2 }, { key: 'n', op: 'gt', value: 5 })),
    ).toMatch(/violates/);
  });

  it('in exhausted by notIn', () => {
    expect(
      guardUnsatisfiable(
        gd(
          { key: 'a', op: 'in', value: ['x', 'y'] },
          { key: 'a', op: 'notIn', value: ['x', 'y', 'z'] },
        ),
      ),
    ).toMatch(/excludes every member/);
  });

  it('a status no tool can declare (the closed vocabulary)', () => {
    expect(guardUnsatisfiable(gd({ key: 'status', op: 'eq', value: 'sucess' }))).toMatch(
      /not a result status/,
    );
    expect(guardUnsatisfiable(gd({ key: 'status', op: 'in', value: ['nope', 'wrong'] }))).toMatch(
      /closed set/,
    );
    expect(guardUnsatisfiable(gd({ key: 'status', op: 'eq', value: 'denied' }))).toBeUndefined();
  });

  it("the guard vs the edge's own onToolStatus / exact onToolReturn", () => {
    expect(
      guardUnsatisfiable(gd({ key: 'status', op: 'eq', value: 'denied' }), {
        onToolStatuses: ['success'],
      }),
    ).toMatch(/can never both hold/);
    expect(
      guardUnsatisfiable(gd({ key: 'toolName', op: 'eq', value: 'other_tool' }), {
        onToolReturnExact: 'lookup_order',
      }),
    ).toMatch(/onToolReturn "lookup_order"/);
    // Consistent declarations stay silent.
    expect(
      guardUnsatisfiable(gd({ key: 'status', op: 'eq', value: 'denied' }), {
        onToolStatuses: ['denied', 'failure'],
      }),
    ).toBeUndefined();
  });

  it('says NOTHING it cannot prove: cross-key, mixed types, plain satisfiable guards', () => {
    expect(
      guardUnsatisfiable(
        gd({ key: 'a', op: 'eq', value: 'x' }, { key: 'b', op: 'ne', value: 'x' }),
      ),
    ).toBeUndefined();
    // Mixed-type bounds are NOT decided (JS coercion is not a proof).
    expect(
      guardUnsatisfiable(
        gd({ key: 'n', op: 'gt', value: 'zzz' }, { key: 'n', op: 'lt', value: 3 }),
      ),
    ).toBeUndefined();
    expect(guardUnsatisfiable(gd({ key: 'riskLevel', op: 'gte', value: 'high' }))).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security — prototype-pollution keys refused; parsed JSON read own-props only
// ─────────────────────────────────────────────────────────────────────────────

describe('guard security posture', () => {
  it('refuses the prototype-pollution key set at compile', () => {
    // JSON.parse creates a real OWN "__proto__" key (an object literal would
    // set the prototype instead) — exactly how a config-file guard arrives.
    const polluted = JSON.parse('{"__proto__": {"eq": 1}}') as never;
    expect(() => compileGuard(polluted, 'route a→b')).toThrowError(/reserved/);
    expect(() => compileGuard({ constructor: { eq: 1 } }, 'route a→b')).toThrowError(/reserved/);
    expect(() => compileGuard({ toString: { eq: 'x' } }, 'route a→b')).toThrowError(/reserved/);
  });

  it('a key not present in the parsed object evaluates as undefined, never as an inherited member', () => {
    const g = compileGuard({ hasOwnPropertyTwin: { ne: null } }, 'route a→b');
    const ev = g.evaluate(view({ result: '{}' }));
    expect(ev.conditions[0]!.actualSummary).toBe('undefined');
  });
});
