/**
 * check:semantics — the overclaim rules: a refusal or an absence never
 * asserts more than was read.
 *
 * The registered study: a tool refused an unknown name with "No array matches
 * 'X'. Known arrays: … a wrong identifier, not missing data", and the models
 * told users "X is not in your estate". A refused call read nothing; an
 * absence read one list. Neither may say what does not exist, or that the
 * input is wrong.
 *
 * The owner's rulings: the rules are WARNINGS (no consumer's CI breaks on
 * upgrade); an app that uses none of the new fields (`among`, a catalog's
 * `refusals`) sees no new finding; `--strict` or `rules: ['overclaim']` makes
 * them errors, and `rules: ['overclaim']` judges every sample.
 *
 * Sections (Convention 3): Unit (the phrase packs) · Functional (the gate,
 * default / strict / opted in) · Integration (the CLI) · Edge.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { absent } from '../../src/index.js';
import {
  checkSemantics,
  coerceSemanticsCatalog,
  runCheckSemanticsCli,
  type SemanticsFinding,
} from '../../src/semantics/index.js';
import { nonExistencePhrase, wrongnessPhrase } from '../../src/semantics/overclaim.js';

/** The refusal the study recorded, names generalised. */
const C6_REFUSAL =
  "No array matches 'PS-ARRAY-99'. Known arrays: PS-ARRAY-01, PS-ARRAY-02. This is a wrong " +
  'identifier, not missing data.';

const AMONG = {
  argument: 'array_id',
  source: 'the PowerStore inventory export',
  measuredAt: '2026-10-22T09:14:00Z',
  count: 2,
  names: ['PS-ARRAY-01', 'PS-ARRAY-02'],
};

/** A refusal sample that names what was looked up — the argument and the value. */
const sample = (text: string, value = 'PS-ARRAY-99') => ({ text, argument: 'array_id', value });

const overclaims = (findings: readonly SemanticsFinding[]) =>
  findings.filter((f) =>
    ['refusal-asserts-absence', 'absence-asserts-wrongness', 'authoritative-names'].includes(
      f.code,
    ),
  );

// ── Unit — the packs ─────────────────────────────────────────────────────

describe('unit — the non-existence and wrongness packs', () => {
  it.each([
    'No array matches that name.',
    'There are no arrays called that.',
    'That array does not exist.',
    "That array doesn't exist.",
    'No such array.',
    'Array not found.',
    'The estate has no array by that name.',
    'It is not in the inventory.',
    'None of the arrays match.',
    'Nothing was found for that name.',
    'We found 0 arrays.',
  ])('non-existence: %s', (text) => {
    expect(nonExistencePhrase(text)).toBeDefined();
  });

  it.each([
    'This is a wrong identifier.',
    'That is not a valid array name.',
    'An invalid identifier was given.',
    'It is a wrong identifier, not missing data.',
    'Probably a typo.',
    'The name looks misspelled.',
  ])('wrongness: %s', (text) => {
    expect(wrongnessPhrase(text)).toBeDefined();
  });

  it.each([
    "Invalid arguments for tool 'array_detail' — the call was not executed.",
    "- 'array_id' is required but missing",
    'Result too large: array_detail returned 900 chars. No data was returned.',
    "Tool 'array_detail' is not available in this context.",
    'The search ran and matched nothing.',
  ])('neither, for a sentence that claims nothing about the world: %s', (text) => {
    expect(nonExistencePhrase(text)).toBeUndefined();
    expect(wrongnessPhrase(text)).toBeUndefined();
  });

  it('folds case, curly apostrophes and Unicode composition before matching', () => {
    expect(nonExistencePhrase('THAT ARRAY DOESN\u2019T EXIST')).toBeDefined();
    expect(wrongnessPhrase('WRONG IDENTIFIER')).toBeDefined();
  });
});

// ── Functional — the gate ────────────────────────────────────────────────

describe('functional — default: warnings, and only for samples that use the new fields', () => {
  it('a refusal sample that asserts absence warns: refusal-asserts-absence', () => {
    const report = checkSemantics([{ name: 'array_detail', results: [], refusals: [C6_REFUSAL] }]);
    const [finding] = overclaims(report.findings);
    expect(finding).toMatchObject({
      tool: 'array_detail',
      code: 'refusal-asserts-absence',
      severity: 'warning',
      field: 'refusals[0]',
    });
    expect(finding?.message).toContain('array_detail');
    expect(report.ok).toBe(true);
  });

  it('a refusal that carries an absence warns, whatever its words', () => {
    const report = checkSemantics([
      {
        name: 'array_detail',
        results: [],
        refusals: [
          absent({ what: 'x', checked: ['y'] }),
          JSON.stringify(absent({ what: 'x', checked: ['y'] })),
        ],
      },
    ]);
    expect(overclaims(report.findings).map((f) => [f.code, f.field])).toEqual([
      ['refusal-asserts-absence', 'refusals[0]'],
      ['refusal-asserts-absence', 'refusals[1]'],
    ]);
  });

  it('an among absence that calls the input wrong warns: absence-asserts-wrongness', () => {
    const sample = absent({
      what: 'PS-ARRAY-99',
      among: AMONG,
      tryInstead: 'PS-ARRAY-99 is a wrong identifier — check the spelling.',
    });
    const report = checkSemantics([{ name: 'array_detail', results: [sample] }]);
    expect(overclaims(report.findings)).toEqual([
      expect.objectContaining({
        code: 'absence-asserts-wrongness',
        severity: 'warning',
        field: 'try_instead',
        resultIndex: 0,
      }),
    ]);
  });

  it('every authoritative use is listed for review: authoritative-names', () => {
    const sample = absent({
      what: 'PS-ARRAY-99',
      among: { ...AMONG, authoritative: { why: 'the export is the system of record' } },
    });
    const report = checkSemantics([{ name: 'array_detail', results: [sample] }]);
    const [finding] = overclaims(report.findings);
    expect(finding).toMatchObject({
      code: 'authoritative-names',
      severity: 'warning',
      field: 'checked[0].authoritative',
    });
    expect(finding?.message).toContain('the export is the system of record');
  });

  it('a well-worded among absence and a plain refusal sample warn about nothing', () => {
    const report = checkSemantics([
      {
        name: 'array_detail',
        results: [absent({ what: 'PS-ARRAY-99', among: AMONG })],
        refusals: ["array_id must start with 'PS-' — the call was not run."],
      },
    ]);
    expect(overclaims(report.findings)).toEqual([]);
  });

  it('an app using none of the new fields sees no new finding — even with an overclaim', () => {
    const report = checkSemantics([
      {
        name: 'array_detail',
        results: [
          absent({ what: 'PS-ARRAY-99', checked: ['the inventory'], tryInstead: 'A typo?' }),
          { content: C6_REFUSAL, effects: [], status: 'invalid' },
        ],
      },
    ]);
    expect(overclaims(report.findings)).toEqual([]);
  });
});

describe('functional — the rules fire only on a sentence about what was looked up', () => {
  const NOT_ABOUT_THE_LOOKUP = [
    'start_date is not a valid ISO-8601 date',
    'invalid value for severity',
    'You have no permission to read arrays in this tenant.',
    'The caller has no access to this inventory.',
    'API key not found — set INVENTORY_KEY.',
    'Upstream returned 404 Not Found',
    'window is not in the allowed range',
  ];

  it.each(NOT_ABOUT_THE_LOOKUP)('does not fire: %s', (text) => {
    for (const refusal of [text, sample(text)]) {
      const report = checkSemantics([{ name: 'array_detail', results: [], refusals: [refusal] }], {
        rules: ['overclaim'],
      });
      expect(overclaims(report.findings)).toEqual([]);
    }
  });

  it('a format, range or permission message is exempt even when it names the lookup', () => {
    const report = checkSemantics(
      [
        {
          name: 'array_detail',
          results: [],
          refusals: [
            sample("array_id 'PS-ARRAY-99' is not a valid identifier format"),
            sample('PS-ARRAY-99 is out of the allowed range'),
            sample('You have no permission to read PS-ARRAY-99.'),
          ],
        },
      ],
      { rules: ['overclaim'] },
    );
    expect(overclaims(report.findings)).toEqual([]);
  });

  it('fires: "array X is the wrong identifier, not missing data"', () => {
    const report = checkSemantics([
      {
        name: 'array_detail',
        results: [],
        refusals: [sample('array X is the wrong identifier, not missing data', 'X')],
      },
    ]);
    expect(overclaims(report.findings).map((f) => f.code)).toEqual(['refusal-asserts-absence']);
  });

  it('fires on a bare refusal that quotes the value it looked up', () => {
    const report = checkSemantics([{ name: 'array_detail', results: [], refusals: [C6_REFUSAL] }]);
    expect(overclaims(report.findings).map((f) => f.code)).toEqual(['refusal-asserts-absence']);
  });

  it('an absence that calls the input wrong without naming it does not fire', () => {
    const quiet = absent({
      what: 'PS-ARRAY-99',
      among: AMONG,
      tryInstead: 'Check the spelling: a typo is the usual cause.',
    });
    expect(
      overclaims(checkSemantics([{ name: 'array_detail', results: [quiet] }]).findings),
    ).toEqual([]);
  });
});

describe('functional — strict and the opt-in rule set make them errors', () => {
  const catalog = () => [
    {
      name: 'array_detail',
      results: [
        absent({
          what: 'PS-ARRAY-99',
          among: AMONG,
          tryInstead: 'PS-ARRAY-99 is probably a typo.',
        }),
        absent({
          what: 'PS-ARRAY-98',
          checked: ['the inventory'],
          tryInstead: 'PS-ARRAY-98 looks like a typo.',
        }),
        { content: C6_REFUSAL, effects: [], status: 'invalid' },
      ],
      refusals: [C6_REFUSAL],
    },
  ];

  it('strict: the same findings, as errors — the scope does not widen', () => {
    const report = checkSemantics(catalog(), { strict: true });
    expect(overclaims(report.findings).map((f) => [f.code, f.severity, f.resultIndex])).toEqual([
      ['refusal-asserts-absence', 'error', undefined],
      ['absence-asserts-wrongness', 'error', 0],
    ]);
    expect(report.ok).toBe(false);
  });

  it("rules: ['overclaim'] — errors, and every sample is judged", () => {
    const report = checkSemantics(catalog(), { rules: ['overclaim'] });
    expect(overclaims(report.findings).map((f) => [f.code, f.severity, f.resultIndex])).toEqual([
      ['refusal-asserts-absence', 'error', undefined],
      ['absence-asserts-wrongness', 'error', 0],
      ['absence-asserts-wrongness', 'error', 1],
      ['refusal-asserts-absence', 'error', 2],
    ]);
    expect(report.ok).toBe(false);
  });

  it('authoritative-names stays a review warning under both', () => {
    const sample = absent({
      what: 'PS-ARRAY-99',
      among: { ...AMONG, authoritative: { why: 'the export is the system of record' } },
    });
    for (const options of [{ strict: true }, { rules: ['overclaim'] as const }]) {
      const report = checkSemantics([{ name: 'array_detail', results: [sample] }], options);
      expect(overclaims(report.findings).map((f) => f.severity)).toEqual(['warning']);
    }
  });

  it('refuses a rule set it does not have', () => {
    expect(() =>
      checkSemantics([{ name: 'x', results: [] }], { rules: ['bogus' as 'overclaim'] }),
    ).toThrow(/overclaim/);
  });
});

// ── Integration — the CLI ────────────────────────────────────────────────

const runCli = async (catalog: unknown, flags: string[] = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'afp-overclaim-'));
  try {
    const file = join(dir, 'catalog.json');
    writeFileSync(file, JSON.stringify(catalog));
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCheckSemanticsCli([file, ...flags], {
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('integration — the CLI', () => {
  const catalog = [{ name: 'array_detail', results: [], refusals: [C6_REFUSAL] }];

  it('default: exit 0, the warning printed', async () => {
    const { code, out } = await runCli(catalog);
    expect(code).toBe(0);
    expect(out).toContain('refusal-asserts-absence');
  });

  it('--strict: exit 1, printed as an error', async () => {
    const { code, out } = await runCli(catalog, ['--strict']);
    expect(code).toBe(1);
    expect(out).toContain('✗ array_detail');
  });

  it('--rules=overclaim: exit 1', async () => {
    expect((await runCli(catalog, ['--rules=overclaim'])).code).toBe(1);
  });

  it('--rules with a set it does not have: exit 2', async () => {
    expect((await runCli(catalog, ['--rules=bogus'])).code).toBe(2);
  });

  it('the catalog carries refusals through coercion', () => {
    expect(
      coerceSemanticsCatalog([
        { name: 'x', result: 1, refusals: ['r', { text: 'r', value: 'v' }] },
      ]),
    ).toEqual([{ name: 'x', results: [1], refusals: ['r', { text: 'r', value: 'v' }] }]);
  });
});
