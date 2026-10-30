/**
 * `size.ts` — README law 8's one authority, unit by unit: an account within
 * the bound is handed back as it is; one over it has its LISTINGS fitted (the
 * rows' lines and the three fact lists) by max-min fair shares, each listing
 * keeping a prefix of itself and counting the rest — a row in one
 * `row.sizeBound` line, a fact list in its omitted count — while every part
 * that is not a listing (the judgements) is kept as it is; and an account
 * whose unlisted part alone is over the bound is told as too large.
 *
 * Built from a real account (fixture A), its listings multiplied with
 * byte-heavy copies: the authority reads only the account's own shape.
 */

import { describe, expect, it } from 'vitest';

import { buildAccount } from '../../src/answer-account/account.js';
import { ACCOUNT_BYTES, fairShares, fitAccount } from '../../src/answer-account/size.js';
import { jsonBytes } from '../../src/lib/boundedJson.js';
import type { AnswerAccount, Sentence } from '../../src/answer-account/types.js';
import { fixtureA, FLAGSHIP_RUN_ID, HOST_APP_DECLARATIONS } from './helpers.js';

const real = (): AnswerAccount =>
  buildAccount(fixtureA(), HOST_APP_DECLARATIONS, { runId: FLAGSHIP_RUN_ID });

/** `line` with its text made heavy: `units` copies of `unit` (a character JSON may write wide). */
const heavy = (line: Sentence, unit: string, units: number): Sentence => ({
  ...line,
  text: `${line.text} ${unit.repeat(units)}`,
});

/** `account` with row `r` holding `count` heavy copies of its first line. */
function withLines(
  account: AnswerAccount,
  r: number,
  count: number,
  unit = '\u0001',
): AnswerAccount {
  const rows = account.rows.map((row, i) =>
    i === r
      ? { ...row, lines: Array.from({ length: count }, () => heavy(row.lines[0]!, unit, 300)) }
      : row,
  );
  return { ...account, rows };
}

const TOO_LARGE = { told: 'too-large' } as unknown as AnswerAccount;
const tooLarge = () => TOO_LARGE;

/** The parts of an account that are not listings — the judgements. */
const unlisted = (account: AnswerAccount) => ({
  ...account,
  rows: account.rows.map((row) => ({ ...row, lines: [] })),
  facts: {
    ...account.facts,
    calls: [],
    beforePause: [],
    inView: [],
    callsOmitted: undefined,
    beforePauseOmitted: undefined,
    inViewOmitted: undefined,
  },
});

/** Per row, the lines listed plus what its size fold counts. */
const saidOrCounted = (account: AnswerAccount) =>
  account.rows.map((row) =>
    row.lines.reduce(
      (sum, line) =>
        sum + (line.template.id === 'row.sizeBound' ? (line.vars.n!.value as number) : 1),
      0,
    ),
  );

describe('fitAccount — within the bound, the same account', () => {
  it('an ordinary account is handed back as the same object', () => {
    const account = real();
    expect(jsonBytes(account)).toBeLessThanOrEqual(ACCOUNT_BYTES);
    expect(fitAccount(account, tooLarge)).toBe(account);
  });
});

describe('fitAccount — over the bound, the listings fitted and counted', () => {
  it('a row too long: a prefix of its lines, then ONE line that counts the rest; the judgements unchanged', () => {
    const over = withLines(real(), 5, 400);
    expect(jsonBytes(over)).toBeGreaterThan(ACCOUNT_BYTES);
    const fitted = fitAccount(over, tooLarge);
    expect(jsonBytes(fitted)).toBeLessThanOrEqual(ACCOUNT_BYTES);
    const lines = fitted.rows[5]!.lines;
    const fold = lines[lines.length - 1]!;
    expect(fold.template.id).toBe('row.sizeBound');
    expect(fold.text).toBe(
      `…and ${
        400 - (lines.length - 1)
      } more lines, not listed here: the account reached its size limit.`,
    );
    expect(lines.slice(0, -1)).toEqual(over.rows[5]!.lines.slice(0, lines.length - 1));
    expect(saidOrCounted(fitted)).toEqual(saidOrCounted(over));
    expect(unlisted(fitted)).toEqual(unlisted(over));
  });

  it('max-min fair: a short row keeps every line while a long one is folded', () => {
    const base = withLines(real(), 5, 400);
    const over = withLines(base, 1, 3);
    const fitted = fitAccount(over, tooLarge);
    expect(fitted.rows[1]!.lines).toEqual(over.rows[1]!.lines);
    expect(fitted.rows[5]!.lines.at(-1)!.template.id).toBe('row.sizeBound');
  });

  it.each([
    ['calls', 'callsOmitted'],
    ['beforePause', 'beforePauseOmitted'],
    ['inView', 'inViewOmitted'],
  ] as const)('%s preserves its prefix and adds every dropped entry to %s', (list, omitted) => {
    const account = real();
    // The fitting authority does not interpret facts; their producer has already judged them.
    const entry = account.facts.calls[0]!;
    const many = Array.from({ length: 50 }, () => ({
      ...entry,
      toolName: '\u0001'.repeat(2000),
    }));
    const over: AnswerAccount = {
      ...account,
      facts: { ...account.facts, [list]: many, [omitted]: 7 },
    };
    expect(jsonBytes(over)).toBeGreaterThan(ACCOUNT_BYTES);
    const fitted = fitAccount(over, tooLarge);
    expect(jsonBytes(fitted)).toBeLessThanOrEqual(ACCOUNT_BYTES);
    const kept = fitted.facts[list].length;
    expect(kept).toBeLessThan(50);
    expect(fitted.facts[list]).toEqual(many.slice(0, kept));
    expect(fitted.facts[omitted]).toBe(7 + 50 - kept);
    expect(unlisted(fitted)).toEqual(unlisted(over));
  });

  it('when the unlisted part alone is over the bound: told as too large, never a cut account', () => {
    const account = real();
    const over: AnswerAccount = {
      ...account,
      answer: { ...account.answer, value: '\u0001'.repeat(ACCOUNT_BYTES / 4) },
    };
    expect(fitAccount(over, tooLarge)).toBe(TOO_LARGE);
  });

  it('property — any mix of heavy rows and lists: within the bound, every line said or counted', () => {
    let seed = 11;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    const units = ['\u0001', '￿', '\u{10FFFF}', 'x', '\ud800'];
    for (let round = 0; round < 40; round++) {
      let account = real();
      for (let r = 0; r < account.rows.length; r++) {
        if (next() % 2 === 0)
          account = withLines(account, r, next() % 120, units[next() % units.length]);
      }
      const fitted = fitAccount(account, tooLarge);
      if (fitted === TOO_LARGE) continue;
      expect(jsonBytes(fitted)).toBeLessThanOrEqual(ACCOUNT_BYTES);
      expect(saidOrCounted(fitted)).toEqual(saidOrCounted(account));
      expect(unlisted(fitted)).toEqual(unlisted(account));
    }
  });
});

describe('fairShares — max-min fair', () => {
  it('within what is available, never more than a need, and a short listing never starves another', () => {
    expect(fairShares([10, 10, 10], 30)).toEqual([10, 10, 10]);
    expect(fairShares([10, 100, 100], 70)).toEqual([10, 30, 30]);
    expect(fairShares([5, 1000], 100)).toEqual([5, 95]);
    expect(fairShares([1, 2], -5)).toEqual([0, 0]);
    let seed = 3;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let round = 0; round < 200; round++) {
      const needs = Array.from({ length: 1 + (next() % 10) }, () => next() % 1000);
      const available = next() % 4000;
      const shares = fairShares(needs, available);
      expect(shares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(available);
      shares.forEach((share, i) => expect(share).toBeLessThanOrEqual(needs[i]!));
      // Max-min: a listing short of its need has a share no smaller than any other's.
      shares.forEach((share, i) => {
        if (share < needs[i]!)
          for (const other of shares) expect(other).toBeLessThanOrEqual(share + 1);
      });
    }
  });
});
