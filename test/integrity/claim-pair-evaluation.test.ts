/**
 * Pure extraction preservation, not a new claim-support policy. The historical
 * oracle below is the exact ec32fad source closure, hash pinned and compiled only
 * in this test. It never imports the new evaluator. No Git, network or model is
 * needed to run the suite, and no historical code is part of the shipped build.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { Assertion } from '../../src/integrity/assertion/types.js';
import {
  unsupportedClaimsOf,
  type ClaimLedgerRow,
  type DeclaredClaim,
} from '../../src/integrity/unsupported-claim/check.js';
import { evaluateClaimPair } from '../../src/integrity/unsupported-claim/evaluate.js';
import { known, notApplicable, unknown } from '../../src/doors/maps.js';

const originalRequire = createRequire(__filename);
const historicalFiles = {
  types: [
    'assertion-types.ec32fad.ts.txt',
    'b2231651daa84b842e4c88057550d08f04386d78322e37ac14843343e59922b1',
  ],
  conflicts: [
    'assertion-conflicts.ec32fad.ts.txt',
    'd9d8091c74328128fa210f379401d82d6f526481bc164b617a10e9a9fb913b58',
  ],
  check: [
    'unsupported-claim.ec32fad.ts.txt',
    '41516011afa9aa9fb62a77aba838e88789a52e55e4c027740f060ebf8f4ca276',
  ],
} as const;

function historicalComparator(): typeof unsupportedClaimsOf {
  const packageJson: { version?: string } = JSON.parse(
    readFileSync(resolve(__dirname, '../../node_modules/contextfootprint/package.json'), 'utf8'),
  );
  expect(packageJson.version).toBe('0.1.1');
  const modules = new Map<string, Record<string, unknown>>();
  function load(name: keyof typeof historicalFiles): Record<string, unknown> {
    const [file, hash] = historicalFiles[name];
    const source = readFileSync(resolve(__dirname, 'reference', file), 'utf8');
    expect(createHash('sha256').update(source).digest('hex')).toBe(hash);
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      fileName: file.replace('.txt', ''),
      reportDiagnostics: true,
    });
    expect(compiled.diagnostics ?? []).toEqual([]);
    const module = { exports: {} as Record<string, unknown> };
    const requireHistorical = (specifier: string): unknown => {
      if (specifier === 'contextfootprint') return originalRequire(specifier);
      const imported =
        specifier === './types.js' || specifier === '../assertion/types.js'
          ? modules.get('types')
          : specifier === '../assertion/conflicts.js'
          ? modules.get('conflicts')
          : undefined;
      if (imported === undefined) throw new Error(`Unexpected historical import: ${specifier}`);
      return imported;
    };
    // Only the hash-checked, checked-in historical source above is executable.
    const execute = new Function('exports', 'require', 'module', compiled.outputText);
    execute(module.exports, requireHistorical, module);
    modules.set(name, module.exports);
    return module.exports;
  }
  load('types');
  load('conflicts');
  const exported = load('check').unsupportedClaimsOf;
  if (typeof exported !== 'function') throw new Error('Historical comparator export is absent.');
  return exported as typeof unsupportedClaimsOf;
}

const historical = historicalComparator();
const pair = (value: unknown, over: Partial<Assertion> = {}): Assertion => ({
  subject: { kind: 'entity', id: 'fixture' },
  predicate: 'value',
  epoch: 0,
  stratum: 'asserted',
  provenance: 'synthetic pair',
  value,
  ...over,
});

describe('unit: the extracted pair evaluator names its actual comparison path', () => {
  it.each([undefined, unknown('not read'), notApplicable('not measured')])(
    'evidence that does not participate is unavailable, not agreement',
    (value) => {
      expect(evaluateClaimPair(pair(value), pair(30))).toBe('evidence-unavailable');
    },
  );

  it.each([undefined, unknown('answer declines'), notApplicable('answer does not apply')])(
    'an answer that does not participate is distinct from an equal value',
    (value) => {
      expect(evaluateClaimPair(pair(30), pair(value))).toBe('claim-nonparticipating');
    },
  );

  it.each([null, 'unknown'])(
    'literal doubt %s is separate from both ordinary equality and contradiction',
    (value) => {
      expect(evaluateClaimPair(pair(30), pair(value))).toBe('doubt-against-value');
      expect(evaluateClaimPair(pair(known(null, 'explicit absence')), pair(value))).toBe(
        'both-doubt',
      );
      expect(evaluateClaimPair(pair('unknown'), pair(value))).toBe('both-doubt');
    },
  );

  it.each(['30', ' 30 ', '3e1', '+30', '0x1e'])(
    'preserves the existing Number-based one-way leniency for %s',
    (value) => {
      expect(evaluateClaimPair(pair(known(30, 'measured')), pair(value))).toBe('numeric-leniency');
      expect(evaluateClaimPair(pair(value), pair(30))).toBe('conflict');
    },
  );

  it('does not widen leniency to blank strings or unwrap the answer before choosing that path', () => {
    expect(evaluateClaimPair(pair(0), pair(' '))).toBe('conflict');
    expect(evaluateClaimPair(pair(30), pair(known('30', 'answer')))).toBe('conflict');
    expect(evaluateClaimPair(pair(30), pair(known(30, 'answer')))).toBe('no-conflict');
    expect(evaluateClaimPair(pair(30), pair(known(null, 'answer')))).toBe('conflict');
  });

  it('delegates structural equality and its exclusions without calling silence positive support', () => {
    expect(evaluateClaimPair(pair({ a: 1, b: [2, 3] }), pair({ b: [2, 3], a: 1 }))).toBe(
      'no-conflict',
    );
    expect(evaluateClaimPair(pair([2, 3]), pair([3, 2]))).toBe('conflict');
    expect(evaluateClaimPair(pair(30), pair(31, { stratum: 'quoted' }))).toBe('no-conflict');
    expect(evaluateClaimPair(pair(30), pair(31, { epoch: 1 }))).toBe('no-conflict');
    expect(
      evaluateClaimPair(pair(30), pair(31, { subject: { kind: 'entity', id: 'other' } })),
    ).toBe('no-conflict');
    const ownProto = JSON.parse('{"__proto__":{"count":1},"stable":true}');
    const reordered = JSON.parse('{"stable":true,"__proto__":{"count":1}}');
    expect(evaluateClaimPair(pair(ownProto), pair(reordered))).toBe('no-conflict');
    expect(evaluateClaimPair(pair(ownProto), pair({ stable: true }))).toBe('conflict');
    expect(Object.hasOwn(ownProto, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(ownProto)).toBe(Object.prototype);
  });

  it('does not hide an old serialization failure by classifying the answer first', () => {
    // Non-JSON values are outside future typed-claim admission, but this refactor
    // must not silently change what the existing comparator does with them.
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => evaluateClaimPair(pair(cycle), pair(unknown('answer declines')))).toThrow();
    expect(evaluateClaimPair(pair(unknown('not read')), pair(cycle))).toBe('evidence-unavailable');
  });
});

interface Input {
  declared: readonly DeclaredClaim[];
  ledger: readonly ClaimLedgerRow[];
  answer: unknown;
  epoch: number;
}

function row(value: unknown, over: Partial<ClaimLedgerRow> = {}): ClaimLedgerRow {
  return {
    entity: 'fixture',
    field: 'value',
    value,
    toolName: 'lookup',
    toolCallId: 'c1',
    iteration: 1,
    ...over,
  };
}
const declaration: DeclaredClaim = {
  answerField: 'answer.value',
  entity: 'fixture',
  field: 'value',
};

function frozen<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const item of Object.values(value)) frozen(item, seen);
    Object.freeze(value);
  }
  return value;
}

function outcome(compare: typeof unsupportedClaimsOf, input: Input) {
  try {
    return {
      kind: 'returned' as const,
      value: compare(input.declared, input.ledger, input.answer, input.epoch),
    };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { kind: 'threw' as const, name: error.name, message: error.message };
  }
}

function sameAsHistorical(input: Input) {
  frozen(input);
  const old = outcome(historical, input);
  const current = outcome(unsupportedClaimsOf, input);
  // Strict shape/undefined fields and written record bytes are separate checks.
  expect(current).toStrictEqual(old);
  expect(JSON.stringify(current)).toBe(JSON.stringify(old));
  return current;
}

describe('regression: the existing adapter equals its exact ec32fad comparator', () => {
  it('agrees across a deterministic value matrix and latest-row layouts', () => {
    const values: readonly unknown[] = [
      undefined,
      null,
      false,
      true,
      0,
      -0,
      30,
      31,
      '',
      ' ',
      '0',
      '30',
      ' 30 ',
      '3e1',
      '+30',
      '0x1e',
      'unknown',
      'other',
      [],
      [0],
      [0, false],
      [false, 0],
      {},
      { a: 1, b: 2 },
      { b: 2, a: 1 },
      { nested: { value: null } },
      JSON.parse('{"__proto__":{"x":1},"constructor":2,"prototype":3}'),
      known(30, 'source'),
      known('30', 'source'),
      known(undefined, 'source'),
      known(null, 'source'),
      unknown('source absent'),
      notApplicable('source does not apply'),
    ];
    let cases = 0;
    for (const evidence of values) {
      for (const claim of values) {
        const layouts: readonly (readonly ClaimLedgerRow[])[] = [
          [],
          [row(evidence)],
          [
            row(999, { toolCallId: 'older', measuredAt: '2026-02-02' }),
            row(claim, { entity: 'unrelated' }),
            row(evidence, { toolCallId: 'later', iteration: 4, measuredAt: 0 }),
          ],
          [row(evidence), row(999, { field: 'other' }), row(claim, { entity: 'other' })],
        ];
        for (const ledger of layouts) {
          sameAsHistorical({
            declared: [declaration],
            ledger,
            answer: { answer: { value: claim } },
            epoch: (cases % 3) - 1,
          });
          cases++;
        }
      }
    }
    expect(cases).toBe(4356); // 33 × 33 values × four deterministic layouts.
  });

  it('preserves omission/path boundaries, declaration order, exact prose and witness references', () => {
    for (const answer of [undefined, null, {}, { answer: null }, { answer: [] }, { answer: {} }]) {
      sameAsHistorical({ declared: [declaration], ledger: [row(30)], answer, epoch: 0 });
    }
    const older = row({ count: 1 }, { toolCallId: 'prior', measuredAt: '' });
    const latest = row({ count: 2 }, { toolCallId: 'latest', iteration: 3, measuredAt: 0 });
    const claimed = { count: 3 };
    const input: Input = {
      declared: [declaration, { ...declaration, answerField: 'answer.absent' }, declaration],
      ledger: [older, latest],
      answer: { answer: { value: claimed } },
      epoch: 0,
    };
    const result = sameAsHistorical(input);
    if (result.kind !== 'returned')
      throw new Error('The ordinary JSON fixture must be comparable.');
    expect(result.value.dispositions.map((entry) => entry.disposition)).toEqual([
      'checked-fail',
      'not-applicable',
      'checked-fail',
    ]);
    expect(result.value.findings).toHaveLength(2);
    for (const finding of result.value.findings) {
      expect(finding.witnesses[0]!.value).toBe(latest.value);
      expect(finding.witnesses[1]!.value).toBe(claimed);
      expect(finding.witnesses[2]!.value).toBe(older.value);
      expect(finding.witnesses.map((witness) => witness.stratum)).toEqual([
        'asserted',
        'asserted',
        'quoted',
      ]);
      expect(finding.message).toBe(
        'The answer\'s \'answer.value\' claims {"count":3} but the run\'s settled fact is value(fixture) = {"count":2} (lookup (call latest, iteration 3), measured_at 0). The record supports the fact, not the claim — nothing here rewrites the answer; it makes the disagreement attributable.',
      );
    }
  });

  it('retains legacy checked-pass for a nonparticipating answer, without confusing it with new support', () => {
    const result = sameAsHistorical({
      declared: [declaration],
      ledger: [row(30)],
      answer: { answer: { value: unknown('declined') } },
      epoch: 0,
    });
    if (result.kind !== 'returned') throw new Error('The tagged absence must remain readable.');
    expect(result.value).toEqual({
      findings: [],
      dispositions: [{ claim: 'answer.value', disposition: 'checked-pass' }],
    });
    expect(evaluateClaimPair(pair(30), pair(unknown('declined')))).toBe('claim-nonparticipating');
  });

  it('preserves thrown categories for non-JSON legacy inputs rather than normalizing them', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const evidence of [cycle, 1n]) {
      const result = sameAsHistorical({
        declared: [declaration],
        ledger: [row(evidence)],
        answer: { answer: { value: unknown('declined') } },
        epoch: 0,
      });
      expect(result.kind).toBe('threw');
    }
  });
});
