/**
 * Compile-level regression test — an exemption cannot be silent (9.86.0).
 *
 * `BannedClause.exemptBecause` was documented as required beside
 * `provableWhen` and enforced by nothing: two independent optional fields, so
 * a rule could stand down on a whole lifetime while saying nothing about why.
 * That is the shape of every waved-through sentence in this family's history —
 * the argument is the product, and an argument nobody had to write is an
 * argument nobody wrote.
 *
 * The type is a discriminated union now, and a union is only a claim until
 * somebody proves the compiler rejects the other shapes. `tsconfig.json`
 * EXCLUDES `test/`, so an assertion of this kind is inert in an ordinary
 * suite: this directory (`npm run test:types`) is the only place in the tree
 * where a type-level guarantee is actually checked. Hence the file.
 *
 *   1. both fields together — the exemption WITH its argument — compiles;
 *   2. neither field — a rule banned at every lifetime — compiles;
 *   3. `provableWhen` alone is rejected (the defect this closes);
 *   4. `exemptBecause` alone is rejected too, so a stray argument cannot sit
 *      beside a rule that exempts nothing and read as though it did.
 *
 * The runtime half — non-empty strings, non-empty lifetime lists — lives in
 * `test/modelFacingSurfaces.test.ts`, because a union cannot see `''`.
 */
import { describe, expect, it } from 'vitest';

import { BANNED_CLAUSES, type BannedClause } from '../helpers/modelFacingClaims';

// ─── 1 + 2. The two shapes a rule may have ────────────────────────

const exemptedWithAnArgument: BannedClause = {
  re: /\bis reachable\b/,
  why: 'a reachability census goes stale between calls',
  provableWhen: ['request-ephemeral'],
  exemptBecause: 'a string recomposed for the request being answered cannot be re-read',
};

const bannedEverywhere: BannedClause = {
  re: /\bmoves you\b/,
  why: 'the posture can refuse the hop this predicts',
};

// ─── 3 + 4. The two shapes it may not ─────────────────────────────

const exemptionWithNoArgument: BannedClause = {
  re: /\bis reachable\b/,
  why: 'a reachability census goes stale between calls',
  // @ts-expect-error — `provableWhen` without `exemptBecause` is not a BannedClause
  provableWhen: ['request-ephemeral'],
};

// @ts-expect-error — `exemptBecause` without `provableWhen` exempts nothing, so
// the whole object fails to be a BannedClause (the error lands on the binding,
// not on the field, which is why this directive sits above the declaration)
const argumentWithNoExemption: BannedClause = {
  re: /\bis reachable\b/,
  why: 'a reachability census goes stale between calls',
  exemptBecause: 'an argument with nothing to argue for',
};

// ─── The runtime half of the same law ─────────────────────────────

describe('the checker rules are shaped so an exemption carries its argument', () => {
  it('accepts the two legal shapes and rejects the two illegal ones (compile-checked above)', () => {
    expect(exemptedWithAnArgument.exemptBecause.length).toBeGreaterThan(0);
    expect(bannedEverywhere.provableWhen).toBeUndefined();
    // The rejected shapes exist at runtime — the compiler is what refuses
    // them, and `npm run test:types` is where that refusal is read.
    expect(exemptionWithNoArgument.re.source).toBe(argumentWithNoExemption.re.source);
  });

  it('ships at least one rule of each shape, so neither arm is theoretical', () => {
    expect(BANNED_CLAUSES.some((row) => row.provableWhen !== undefined)).toBe(true);
    expect(BANNED_CLAUSES.some((row) => row.provableWhen === undefined)).toBe(true);
  });
});
