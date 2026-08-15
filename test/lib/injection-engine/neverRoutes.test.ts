/**
 * Negative routing rows — `neverRoutes`, the phrasings a graph must claim
 * NOWHERE.
 *
 * THE DEFECT. `examples` pins the cheap half: this rule claims this phrase. The
 * expensive failure is the opposite one — a rule claiming a turn it has no
 * business in, so the wrong body and the wrong tools shape the whole answer —
 * and the library had no way to state it. Field use worked around it with a
 * private harness.
 *
 * WHAT THESE TESTS PIN. That the row FIRES as an error naming the rule that
 * claimed the phrase; that it does NOT fire on the near-miss beside it; that a
 * default entry is reported as the mount-dependent WARNING rather than an error
 * the router could disagree with; that a phrase asserted both ways is refused
 * as the contradiction it is; and that a graph declaring no rows reports
 * byte-identically to one that never heard of the feature.
 *
 * Test types (Convention 3): unit · functional (refusals) · integration ·
 * contract · property · security · performance/load.
 */

import { describe, expect, it } from 'vitest';

import {
  NEVER_ROUTES_BOUNDARY,
  checkNeverRoutes,
  neverRouteKey,
  validateNeverRoutes,
} from '../../../src/lib/injection-engine/skillNeverRoutes.js';
import { formatCheckup } from '../../../src/lib/injection-engine/skillGraphCheckup.js';
import { skillGraph, defineSkill, keywordScorer } from '../../../src/injection-engine.js';
import type { SkillGraph } from '../../../src/injection-engine.js';

const skill = (id: string) => defineSkill({ id, description: `use ${id}`, body: `${id} body` });

const codes = (graph: SkillGraph): string[] => graph.checkup().problems.map((p) => p.code);

// ── 1. unit — the declaration-time refusals ──────────────────────────────────

describe('unit: validateNeverRoutes — teaching refusals', () => {
  const none: ReadonlySet<string> = new Set();

  it('accepts ONE string as a one-row list (the commonest call)', () => {
    expect(validateNeverRoutes('what is the weather', '.neverRoutes(...)', none)).toEqual([
      'what is the weather',
    ]);
  });

  it('refuses an EMPTY list, saying why silence would mislead', () => {
    expect(() => validateNeverRoutes([], '.neverRoutes(...)', none)).toThrow(
      /empty list asserts nothing/,
    );
  });

  it('refuses a non-array, naming the shape that works', () => {
    expect(() => validateNeverRoutes(42, '.neverRoutes(...)', none)).toThrow(
      /non-empty array of non-empty strings/,
    );
  });

  it('refuses a blank / non-string row, naming the index', () => {
    expect(() => validateNeverRoutes(['ok', '   '], '.neverRoutes(...)', none)).toThrow(
      /`neverRoutes\[1\]`/,
    );
    expect(() => validateNeverRoutes([7], '.neverRoutes(...)', none)).toThrow(
      /`neverRoutes\[0\]` = 7/,
    );
  });

  it('refuses a DUPLICATE row — trimmed and case-folded, like the row key', () => {
    expect(() => validateNeverRoutes(['a phrase', 'A PHRASE '], '.neverRoutes(...)', none)).toThrow(
      /twice \(compared trimmed and case-folded\)/,
    );
    expect(() =>
      validateNeverRoutes(['a phrase'], '.neverRoutes(...)', new Set([neverRouteKey('A Phrase')])),
    ).toThrow(/twice/);
  });

  it('returns a FROZEN copy, so the stored rows cannot drift', () => {
    const rows = validateNeverRoutes(['x'], '.neverRoutes(...)', none);
    expect(Object.isFrozen(rows)).toBe(true);
  });
});

// ── 2. functional — the three properties, each with its near-miss ────────────

describe('functional: checkNeverRoutes — fires, and does not over-fire', () => {
  const rule = (id: string, source: RegExp) => ({
    id,
    when: (ctx: { userMessage?: string }) => source.test(ctx.userMessage ?? ''),
    match: { kind: 'regex' as const, source: source.source, flags: source.flags },
  });

  it('ERRORS and names the rule that claimed the phrase', () => {
    const result = checkNeverRoutes({
      entries: [rule('billing', /refund|charge/i)],
      phrases: ['charge my card twice'],
    });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.kind).toBe('error');
    expect(result.problems[0]?.code).toBe('never-routes-claimed');
    expect(result.problems[0]?.skill).toBe('billing');
    expect(result.problems[0]?.example).toBe('charge my card twice');
    expect(result.problems[0]?.message).toMatch(/STARTS on "billing"/);
  });

  it('is SILENT on the near-miss — a rule that declines the phrase', () => {
    const result = checkNeverRoutes({
      entries: [rule('billing', /refund|charge/i)],
      phrases: ['what is the weather in berlin'],
    });
    expect(result.problems).toEqual([]);
    // …and still states its own reach, because a clean report is the one most
    // likely to be read as proof.
    expect(result.notes).toEqual([NEVER_ROUTES_BOUNDARY]);
  });

  it('WARNS (never errors) when only an UNCONDITIONAL entry claims it, naming both laws', () => {
    const result = checkNeverRoutes({
      entries: [{ id: 'triage' }, rule('billing', /refund/i)],
      phrases: ['what is the weather'],
    });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.kind).toBe('warning');
    expect(result.problems[0]?.code).toBe('never-routes-by-default');
    expect(result.problems[0]?.message).toMatch(/continuity: 'turn'/);
    expect(result.problems[0]?.message).toMatch(/cascade's tier 1 reads the CONDITIONAL rules/);
  });

  it('ERRORS on the contradiction: one phrase declared BOTH ways', () => {
    const result = checkNeverRoutes({
      entries: [{ ...rule('billing', /refund/i), examples: ['Refund me'] }],
      phrases: ['refund me'],
    });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.code).toBe('never-routes-contradicts-example');
    expect(result.problems[0]?.message).toMatch(/contradict each other/);
  });

  it('treats a THROWING predicate as a no-match — routing does, so this does', () => {
    const result = checkNeverRoutes({
      entries: [
        {
          id: 'broken',
          when: () => {
            throw new Error('boom');
          },
        },
      ],
      phrases: ['anything at all'],
    });
    expect(result.problems).toEqual([]);
  });

  it('never judges an INTENT rule — a classifier decides those at run time', () => {
    const result = checkNeverRoutes({
      entries: [{ id: 'billing', match: { kind: 'intent', intent: 'billing', examples: ['x'] } }],
      phrases: ['refund me'],
    });
    expect(result.problems).toEqual([]);
  });
});

// ── 3. integration — through the real builder and the real check-up ──────────

describe('integration: .neverRoutes(...) on a built graph', () => {
  const billing = skill('billing');
  const weather = skill('weather');

  it('fails the DEFAULT build loudly, naming the skill that claimed the phrase', () => {
    expect(() =>
      skillGraph()
        .entry(billing, { match: { keywords: ['refund', 'charge', 'card'] } })
        .entry(weather, { match: /forecast/i })
        .neverRoutes(["what's my card balance"])
        .build(),
    ).toThrow(/never-routes-claimed[\s\S]*"billing"/);
  });

  it('builds clean when no rule claims the row', () => {
    const graph = skillGraph()
      .entry(billing, { match: { keywords: ['refund', 'charge'] } })
      .neverRoutes(['what is the weather in berlin', 'book me a flight'])
      .build();
    expect(codes(graph)).not.toContain('never-routes-claimed');
    expect(graph.checkup().ok).toBe(true);
  });

  it('accumulates rows across calls, and refuses a duplicate across them', () => {
    const graph = skillGraph()
      .entry(billing, { match: { keywords: ['refund'] } })
      .neverRoutes('what is the weather')
      .neverRoutes(['book me a flight'])
      .build({ check: 'off' });
    expect(graph.checkup().notes).toContain(NEVER_ROUTES_BOUNDARY);

    expect(() =>
      skillGraph()
        .entry(billing, { match: { keywords: ['refund'] } })
        .neverRoutes('what is the weather')
        .neverRoutes(' WHAT IS THE WEATHER ')
        .build(),
    ).toThrow(/twice/);
  });

  it('reads the same from the OBJECT form', () => {
    expect(() =>
      skillGraph({
        skills: [billing],
        start: { rules: [{ use: 'billing', match: { keywords: ['refund', 'charge'] } }] },
        neverRoutes: ['please charge it to the room'],
      }),
    ).toThrow(/never-routes-claimed/);
  });

  it('refuses the rows on a .tree(), where there are no start rules to judge', () => {
    expect(() => skillGraph().tree(billing).neverRoutes(['what is the weather']).build()).toThrow(
      /no start rules for a phrase to be judged against/,
    );
  });

  it('stays meaningful under a classifier (tier 1 is still read first)', () => {
    expect(() =>
      skillGraph()
        .entry(billing, { match: { keywords: ['refund', 'charge'] } })
        .entry(weather, { match: { intent: 'weather', examples: ['is it raining'] } })
        .classify(keywordScorer())
        .neverRoutes(['refund the charge'])
        .build(),
    ).toThrow(/never-routes-claimed/);
  });
});

// ── 4. contract — the report's shape and its stated reach ────────────────────

describe('contract: the report says what it does and does not prove', () => {
  it('carries the boundary on `notes`, and renders it as a [note]', () => {
    const graph = skillGraph()
      .entry(skill('billing'), { match: { keywords: ['refund'] } })
      .neverRoutes(['what is the weather'])
      .build();
    expect(graph.checkup().notes).toEqual([NEVER_ROUTES_BOUNDARY]);
    expect(formatCheckup(graph.checkup())).toMatch(/\[note\] A `neverRoutes` row proves/);
  });

  it('carries BOTH boundaries when a graph declares examples AND rows', () => {
    const graph = skillGraph()
      .entry(skill('billing'), { match: { keywords: ['refund'] }, examples: ['refund me'] })
      .neverRoutes(['what is the weather'])
      .build();
    expect(graph.checkup().notes).toHaveLength(2);
    expect(graph.checkup().notes).toContain(NEVER_ROUTES_BOUNDARY);
  });

  it('ZERO DELTA: a graph with no rows reports exactly what it always did', () => {
    const build = () =>
      skillGraph()
        .entry(skill('billing'), { match: { keywords: ['refund'] } })
        .build();
    expect(build().checkup().notes).toBeUndefined();
    expect(
      build()
        .checkup()
        .problems.map((p) => p.code),
    ).not.toContain('never-routes-claimed');
  });
});

// ── 5. property · 6. security · 7. performance ───────────────────────────────

describe('property / security / performance', () => {
  it('property: a row is claimed iff SOME rule claims it (n rules, both answers)', () => {
    for (let n = 1; n <= 20; n++) {
      const entries = Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        // `token_<i>_end` rather than `k<i>`: with a bare index, "k1" is a
        // SUBSTRING of "k10" and the property would test the fixture's naming
        // instead of the check.
        when: (ctx: { userMessage?: string }) => (ctx.userMessage ?? '').includes(`token_${i}_end`),
        match: { kind: 'keywords' as const, keywords: [`token_${i}_end`] },
      }));
      // A phrase carrying the LAST rule's keyword is claimed, exactly once.
      const hit = checkNeverRoutes({ entries, phrases: [`please token_${n - 1}_end now`] });
      expect(hit.problems.map((p) => p.code)).toEqual(['never-routes-claimed']);
      expect(hit.problems[0]?.skill).toBe(`s${n - 1}`);
      // A phrase carrying none of them is claimed by nobody, at any n.
      expect(checkNeverRoutes({ entries, phrases: ['nothing here matches'] }).problems).toEqual([]);
    }
  });

  it('security: a row is inert data — it never reaches routing', () => {
    const billing = skill('billing');
    const withRows = skillGraph()
      .entry(billing, { match: { keywords: ['refund'] } })
      .neverRoutes(['what is the weather'])
      .build();
    const without = skillGraph()
      .entry(billing, { match: { keywords: ['refund'] } })
      .build();
    const ctx = {
      iteration: 1,
      userMessage: 'what is the weather',
      history: [],
      activatedInjectionIds: [],
    };
    // Same routing, same drawing — the row is read at build time and fed to
    // nothing. (A negative row that changed routing would be a matcher.)
    expect(withRows.nextSkill(ctx)).toBe(without.nextSkill(ctx));
    expect(withRows.toMermaid()).toBe(without.toMermaid());
  });

  it('performance/load: 200 rows against 50 rules is a build-time blink', () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({
      id: `s${i}`,
      when: (ctx: { userMessage?: string }) => (ctx.userMessage ?? '').includes(`token${i}`),
      match: { kind: 'keywords' as const, keywords: [`token${i}`] },
    }));
    const phrases = Array.from({ length: 200 }, (_, i) => `phrase number ${i} claims nothing`);
    const started = Date.now();
    expect(checkNeverRoutes({ entries, phrases }).problems).toEqual([]);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
