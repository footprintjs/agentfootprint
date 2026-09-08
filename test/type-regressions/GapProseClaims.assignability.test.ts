/**
 * Compile-level regression test — a gap-prose exemption cannot be silent
 * (9.88.0).
 *
 * `test/helpers/gapProseClaims.ts` is the reader-facing sibling of
 * `modelFacingClaims.ts`, and it inherits that file's hardest-won shape: an
 * exemption and its ARGUMENT are one field, not two optional ones. The reason
 * is the same reason, and it is the whole subject of the release this file
 * ships in — a rule that stands down on a surface while saying nothing about
 * why is how a false sentence gets waved through, and five review rounds of
 * this feature each waved one through.
 *
 * A union is only a claim until somebody proves the compiler rejects the other
 * shapes, and the root `tsconfig.json` EXCLUDES `test/`, so an assertion of
 * this kind is inert in an ordinary suite. This directory
 * (`npm run test:types`) is the only place in the tree where a type-level
 * guarantee is actually checked. Hence the file.
 *
 *   1. both fields together — the exemption WITH its argument — compiles;
 *   2. neither field — a shape banned on every surface — compiles;
 *   3. `provableWhen` alone is rejected;
 *   4. `exemptBecause` alone is rejected too, so a stray argument cannot sit
 *      beside a rule that exempts nothing and read as though it did.
 *
 * The runtime half — that both arms are actually POPULATED, so neither is
 * theoretical — is below, because a union cannot see an empty list.
 */
import { describe, expect, it } from 'vitest';

import { BANNED_GAP_CLAUSES, type BannedGapClause } from '../helpers/gapProseClaims';

// ─── 1 + 2. The two shapes a rule may have ────────────────────────

const exemptedWithAnArgument: BannedGapClause = {
  re: /\bLLMCall\b/,
  why: 'a printed sentence that names a module is a claim about code it cannot see',
  provableWhen: ['prose-doc'],
  exemptBecause: 'a doc names the mechanism because that is what a doc is for',
};

const bannedEverywhere: BannedGapClause = {
  re: /\bTHREE causes\b/,
  why: 'the count is decided by code the sentence cannot see',
};

// ─── 3 + 4. The two shapes it may not ─────────────────────────────

const exemptionWithNoArgument: BannedGapClause = {
  re: /\bLLMCall\b/,
  why: 'a printed sentence that names a module is a claim about code it cannot see',
  // @ts-expect-error — `provableWhen` without `exemptBecause` is not a BannedGapClause
  provableWhen: ['prose-doc'],
};

// @ts-expect-error — `exemptBecause` without `provableWhen` exempts nothing, so
// the whole object fails to be a BannedGapClause (the error lands on the
// binding, not on the field, which is why this directive sits above it)
const argumentWithNoExemption: BannedGapClause = {
  re: /\bLLMCall\b/,
  why: 'a printed sentence that names a module is a claim about code it cannot see',
  exemptBecause: 'an argument with nothing to argue for',
};

// ─── The runtime half of the same law ─────────────────────────────

describe('the gap-prose rules are shaped so an exemption carries its argument', () => {
  it('accepts the two legal shapes and rejects the two illegal ones (compile-checked above)', () => {
    expect(exemptedWithAnArgument.exemptBecause.length).toBeGreaterThan(0);
    expect(bannedEverywhere.provableWhen).toBeUndefined();
    // The rejected shapes exist at runtime — the compiler is what refuses them,
    // and `npm run test:types` is where that refusal is read.
    expect(exemptionWithNoArgument.re.source).toBe(argumentWithNoExemption.re.source);
  });

  it('ships at least one rule of each shape, so neither arm is theoretical', () => {
    expect(BANNED_GAP_CLAUSES.some((row) => row.provableWhen !== undefined)).toBe(true);
    expect(BANNED_GAP_CLAUSES.some((row) => row.provableWhen === undefined)).toBe(true);
    // …and every exemption really carries prose, which the union cannot see.
    for (const row of BANNED_GAP_CLAUSES) {
      if (row.provableWhen === undefined) continue;
      expect(row.provableWhen.length, `${row.re.source} exempts nothing`).toBeGreaterThan(0);
      expect(row.exemptBecause.trim().length, `${row.re.source} argues nothing`).toBeGreaterThan(0);
    }
    // Every row teaches: a failure message with no reason is a failure a reader
    // has to reverse-engineer.
    for (const row of BANNED_GAP_CLAUSES) {
      expect(row.why.trim().length, `${row.re.source} has no \`why\``).toBeGreaterThan(0);
    }
  });
});
