/**
 * The finding table and the fold step that reads it.
 *
 * Test types (Convention 3):
 *   - CONTRACT — every registered finding kind has a row, every kind a check can
 *     file is registered, every row's reason is in the reason table;
 *   - UNIT — each kind's row, on a record, does exactly what its row says;
 *   - PROPERTY — a saved recording is untrusted: seeded malformed ledgers never
 *     throw and never raise the standing (a fixed seed keeps each case
 *     reproducible by its index);
 *   - BOUNDARY — the row carries no value, and the checkpoint door knows its shape.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ContextError } from '../../../integrity/finding/types.js';
import { integrityFindingRowOf } from '../../../integrity/finding/row.js';
import { validateCheckpoint } from '../../runCheckpoint.js';
import { assessAnswer } from './assess.js';
import { INTEGRITY_FINDINGS, isIntegrityFindingKind } from './integrityReasons.js';
import { REASONS, reasonEntry } from './reasons.js';
import type { AnswerAssessment } from './types.js';
import { witnessRowIsWellFormed } from './witness.js';

const INTEGRITY_DIR = resolve(__dirname, '../../../integrity');

/** The union as written in its one source file — independent of the table it pins. */
function declaredKinds(): string[] {
  const source = readFileSync(join(INTEGRITY_DIR, 'finding/types.ts'), 'utf8');
  const union = /export type ContextErrorKind =([^;]+);/.exec(source)?.[1] ?? '';
  return [...union.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!);
}

/** Every `kind:` a check under `src/integrity` writes beside a `seam:`. */
function filedKinds(dir = INTEGRITY_DIR): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filedKinds(path);
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) return [];
    const source = readFileSync(path, 'utf8');
    return [...source.matchAll(/kind: '([a-z-]+)',\s+seam:/g)].map((m) => m[1]!);
  });
}

/** The owner's per-kind decision, written out apart from the table. */
const DECIDED: Readonly<Record<string, string>> = {
  'invariant-violation': 'invariant-violation',
  'unsupported-argument': 'unsupported-argument',
  'column-type-mismatch': 'column-type-mismatch',
  'missing-column': 'missing-column',
  'unsupported-claim': 'unsupported-claim',
  'dangling-reference': 'note',
  'empty-lookup': 'note',
  'prior-turn-evidence': 'note',
  'duplicate-execution': 'note',
};

const row = (finding: unknown, extra: Record<string, unknown> = {}) => ({
  kind: 'integrity-finding',
  turn: 1,
  iteration: 1,
  finding,
  seam: 'write',
  ...extra,
});

/** A record on which one check ran and fired nothing: the "consistent" baseline. */
const consistent = (ledger: readonly unknown[]): Record<string, unknown> => ({
  history: [
    { role: 'user', content: 'q' },
    { role: 'tool', toolCallId: 'c1', toolName: 'lookup', content: '[{"a":1}]' },
  ],
  turnNumber: 1,
  findingsLedger: ledger,
});

const fold = (state: Record<string, unknown>): AnswerAssessment =>
  assessAnswer({ snapshot: { sharedState: state } });

describe('CONTRACT — the table', () => {
  it('every kind the finding type registers has a row, and no row is extra', () => {
    expect(Object.keys(INTEGRITY_FINDINGS).sort()).toEqual(declaredKinds().sort());
  });

  it('every kind a check files is registered', () => {
    const filed = new Set(filedKinds());
    expect(filed.size).toBeGreaterThanOrEqual(8);
    for (const kind of filed) expect(declaredKinds()).toContain(kind);
  });

  it.each(declaredKinds())('%s: the decided effect, with what it reads and who decides', (kind) => {
    const entry = INTEGRITY_FINDINGS[kind as keyof typeof INTEGRITY_FINDINGS];
    expect(entry.effect).toBe(DECIDED[kind]);
    expect(['code', 'your-rule', 'model-then-code']).toContain(entry.decidedBy);
    for (const read of entry.reads) {
      expect(['tool-declaration', 'record', 'model-declaration']).toContain(read);
    }
    if (entry.noCheck !== true) expect(entry.reads.length).toBeGreaterThan(0);
    if (entry.effect !== 'note') expect(reasonEntry(entry.effect).class).toBe('not-sure');
  });

  it('a kind no check ships for says so', () => {
    const unfiled = declaredKinds().filter((k) => !new Set(filedKinds()).has(k));
    expect(unfiled).toEqual(['duplicate-execution']);
    expect(INTEGRITY_FINDINGS['duplicate-execution'].noCheck).toBe(true);
  });

  it('inherited keys are not kinds', () => {
    for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty', '', 7, null]) {
      expect(isIntegrityFindingKind(k)).toBe(false);
    }
  });
});

describe('UNIT — each kind through the fold', () => {
  it('the baseline with no findings reads consistent, with no notes key', () => {
    const a = fold(consistent([]));
    expect(a.standing).toBe('consistent');
    expect('notes' in a).toBe(false);
  });

  it.each(Object.entries(DECIDED).filter(([, effect]) => effect !== 'note'))(
    '%s lowers the standing to not sure, with its witness',
    (kind, reason) => {
      const a = fold(consistent([row(kind)]));
      expect(a.standing).toBe('not-sure');
      expect(a.reasons.map((r) => r.reason)).toEqual([reason]);
      expect(a.reasons[0]!.witness).toEqual([
        { kind: 'state', key: 'findingsLedger', path: '/0/finding' },
      ]);
      expect('notes' in a).toBe(false);
    },
  );

  it.each(Object.entries(DECIDED).filter(([, effect]) => effect === 'note'))(
    '%s is a note: the standing does not move',
    (kind) => {
      const a = fold(consistent([row(kind), row(kind)]));
      expect(a.standing).toBe('consistent');
      expect(a.reasons).toEqual([]);
      expect(a.notes).toEqual([
        {
          finding: kind,
          witness: [
            { kind: 'state', key: 'findingsLedger', path: '/0/finding' },
            { kind: 'state', key: 'findingsLedger', path: '/1/finding' },
          ],
        },
      ]);
    },
  );

  it('a note never counts as a check that ran', () => {
    const state = { turnNumber: 1, findingsLedger: [row('empty-lookup')] };
    const a = fold(state);
    expect(a.standing).toBe('not-assessed');
    expect(a.checked).toEqual([]);
    expect(a.notes?.map((n) => n.finding)).toEqual(['empty-lookup']);
  });

  it('a claim no tool settled lowers the standing with its own reason', () => {
    const a = fold(
      consistent([{ kind: 'claim-unsettled', turn: 1, iteration: 1, field: 'nav_count' }]),
    );
    expect(a.standing).toBe('not-sure');
    expect(a.reasons.map((r) => [r.reason, r.source])).toEqual([
      ['claim-unsettled', { kind: 'answer' }],
    ]);
    expect(a.reasons[0]!.witness[0]).toMatchObject({ path: '/0/field' });
  });

  it('a row of another turn says nothing about this answer', () => {
    const earlier = consistent([
      row('missing-column', { turn: 1 }),
      row('empty-lookup', { turn: 1 }),
      { kind: 'claim-unsettled', turn: 1, iteration: 1, field: 'x' },
    ]);
    const a = fold({ ...earlier, turnNumber: 2 });
    expect(a.standing).toBe('consistent');
    expect('notes' in a).toBe(false);
  });

  it('a record with no turn number reads every row: it may over-report, it never hides', () => {
    const { turnNumber: _unused, ...state } = consistent([row('missing-column', { turn: 9 })]);
    void _unused;
    expect(fold(state).standing).toBe('not-sure');
  });

  it("a calls reason names every call of the row's tool this turn", () => {
    const a = fold(consistent([row('missing-column', { tools: ['lookup'] })]));
    expect(a.reasons[0]!.source).toEqual({
      kind: 'calls',
      calls: [{ toolCallId: 'c1', toolName: 'lookup' }],
    });
  });

  it('a calls reason whose tool ran no call this turn counts it, never drops it', () => {
    const a = fold(consistent([row('unsupported-argument', { tools: ['gone'] })]));
    expect(a.reasons[0]!.source).toEqual({ kind: 'calls', calls: [], unnamed: 1 });
  });

  it('every new reason declares its layer and source once, in the table', () => {
    expect(reasonEntry('invariant-violation')).toMatchObject({ layer: 1, source: 'run' });
    expect(reasonEntry('unsupported-argument')).toMatchObject({ layer: 2, source: 'calls' });
    expect(reasonEntry('column-type-mismatch')).toMatchObject({ layer: 3, source: 'calls' });
    expect(reasonEntry('missing-column')).toMatchObject({ layer: 3, source: 'calls' });
    expect(reasonEntry('unsupported-claim')).toMatchObject({ layer: 4, source: 'answer' });
    expect(reasonEntry('claim-unsettled')).toMatchObject({ layer: 4, source: 'answer' });
    expect(REASONS.map((r) => r.reason)).toHaveLength(new Set(REASONS.map((r) => r.reason)).size);
  });

  it('a reason outranks a passed enforcing report: "known" never stands over a finding', () => {
    const report = { status: 'passed', mode: 'enforce', candidateDigest: 'd', checks: [] };
    expect(fold({ ...consistent([]), answerValidation: report }).standing).toBe('known');
    const a = fold({ ...consistent([row('unsupported-claim')]), answerValidation: report });
    expect(a.standing).toBe('not-sure');
    expect('support' in a).toBe(false);
    // A note leaves the report's "known" standing.
    expect(fold({ ...consistent([row('empty-lookup')]), answerValidation: report }).standing).toBe(
      'known',
    );
  });
});

// ─── a saved recording is untrusted ─────────────────────────────────

/** mulberry32: small and seeded, so a failing case is reproducible by its index. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const JUNK: readonly unknown[] = [
  null,
  undefined,
  0,
  -1,
  1.5,
  '',
  'x',
  'constructor',
  '__proto__',
  'not-a-kind',
  true,
  [],
  [1, null, {}],
  {},
  { finding: 'missing-column' },
  { toolCallId: 7 },
];

/** A row that is NOT a row the writer could have filed: a bad kind, or an unknown finding. */
function malformedRow(next: () => number): unknown {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  switch (Math.floor(next() * 5)) {
    case 0:
      return pick(JUNK);
    case 1:
      return { kind: pick(JUNK), finding: pick(JUNK), turn: pick(JUNK), tools: pick(JUNK) };
    case 2:
      return {
        kind: 'integrity-finding',
        turn: 1,
        iteration: pick(JUNK),
        seam: pick(JUNK),
        tools: pick(JUNK),
        finding: pick(['not-a-kind', 'constructor', '__proto__', '', 7, null, [], {}]),
      };
    case 3:
      // A well-kinded row of ANOTHER turn, or with a turn that is not a number.
      return row('missing-column', { turn: pick([0, 2, '1', null, [], {}]) });
    default:
      return { kind: 'integrity-finding', turn: 1 };
  }
}

const RANK: Readonly<Record<AnswerAssessment['standing'], number>> = {
  ask: 0,
  'not-sure': 1,
  'not-assessed': 2,
  consistent: 3,
  known: 4,
};

describe('PROPERTY — malformed rows never throw and never raise the standing', () => {
  it('300 seeded ledgers, over each baseline standing', () => {
    const report = { status: 'passed', mode: 'enforce', candidateDigest: 'd', checks: [] };
    const baselines: Record<string, unknown>[] = [
      { turnNumber: 1 },
      consistent([]),
      { ...consistent([]), answerValidation: report },
      { ...consistent([]), pausedToolCallId: 'c1' },
    ];
    for (let seed = 0; seed < 300; seed++) {
      const next = prng(seed);
      const base = baselines[seed % baselines.length]!;
      const ledger = Array.from({ length: 1 + Math.floor(next() * 6) }, () => malformedRow(next));
      const before = fold({ ...base, findingsLedger: [] });
      const after = fold({ ...base, findingsLedger: ledger });
      expect(RANK[after.standing], `seed ${seed}`).toBeLessThanOrEqual(RANK[before.standing]);
      expect(
        after.reasons.map((r) => r.reason),
        `seed ${seed}`,
      ).toEqual(before.reasons.map((r) => r.reason));
      expect(after.notes, `seed ${seed}`).toBeUndefined();
    }
  });

  it('a ledger that is not a list, and a list of nothing readable, read as no rows', () => {
    for (const ledger of [null, 'rows', 7, {}, { length: 1, 0: row('missing-column') }, [null]]) {
      expect(fold(consistent(ledger as never)).standing).toBe('consistent');
    }
  });

  it('a tools list that is not a plain list cannot throw or name a call', () => {
    for (const tools of [null, 'lookup', 7, {}, [null, 7, {}], { length: 1, 0: 'lookup' }]) {
      const a = fold(consistent([row('missing-column', { tools })]));
      expect(a.standing).toBe('not-sure');
      const source = a.reasons[0]!.source;
      expect(source.kind === 'calls' && source.calls).toEqual([]);
    }
  });

  it('the saved form reads as the live form', () => {
    const state = consistent([row('missing-column', { tools: ['lookup'] }), row('empty-lookup')]);
    const saved = JSON.parse(JSON.stringify({ snapshot: { sharedState: state } }));
    expect(assessAnswer(saved)).toEqual(fold(state));
  });
});

describe('BOUNDARY — the row holds no value', () => {
  const SECRET = 'SECRET-4417';
  const finding: ContextError = {
    kind: 'unsupported-argument',
    seam: 'choice',
    subjects: [
      { kind: 'tool', id: 'backup_status' },
      { kind: 'entity', id: SECRET },
    ],
    predicate: SECRET,
    witnesses: [
      {
        subject: { kind: 'tool', id: 'backup_status' },
        predicate: SECRET,
        value: SECRET,
        stratum: 'asserted',
        provenance: SECRET,
      },
    ],
    epoch: 3,
    advisory: true,
    message: `called with machine = "${SECRET}"`,
  };

  it('only names: the kind, the seam, the iteration, the class, the tools', () => {
    const built = integrityFindingRowOf(finding, 3);
    expect(built).toEqual({
      kind: 'integrity-finding',
      iteration: 3,
      finding: 'unsupported-argument',
      seam: 'choice',
      tools: ['backup_status'],
      advisory: true,
    });
    expect(JSON.stringify(built)).not.toContain(SECRET);
  });

  it('the tool names are bounded, and a subject too long to be a name is left off', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ kind: 'tool' as const, id: `t${i}` }));
    const long = { kind: 'tool' as const, id: 'x'.repeat(257) };
    const built = integrityFindingRowOf({ ...finding, subjects: [long, ...many] }, 1);
    expect(built.tools).toHaveLength(32);
    expect(built.tools).not.toContain(long.id);
    const none = integrityFindingRowOf({ ...finding, subjects: [{ kind: 'entity', id: 'e' }] }, 1);
    expect('tools' in none).toBe(false);
  });

  it('the checkpoint door knows both rows and refuses a malformed one', () => {
    const good = { ...integrityFindingRowOf(finding, 3), turn: 2 };
    expect(witnessRowIsWellFormed(good)).toBe(true);
    expect(witnessRowIsWellFormed({ ...good, finding: 'not-a-kind' })).toBe(false);
    expect(witnessRowIsWellFormed({ ...good, tools: [7] })).toBe(false);
    expect(witnessRowIsWellFormed({ ...good, advisory: false })).toBe(false);
    const { turn: _t, ...noTurn } = good;
    void _t;
    expect(witnessRowIsWellFormed(noTurn)).toBe(false);
    const claim = { kind: 'claim-unsettled', turn: 1, iteration: 1, field: 'a.b' };
    expect(witnessRowIsWellFormed(claim)).toBe(true);
    expect(witnessRowIsWellFormed({ ...claim, field: 7 })).toBe(false);
    const stored = (findingsLedger: readonly unknown[]) =>
      ({
        version: 1,
        runId: 'r',
        originalInput: { message: 'm' },
        history: [{ role: 'user', content: 'm' }],
        lastCompletedIteration: 1,
        failurePoint: { iteration: 1, phase: 'iteration' },
        findingsLedger,
      } as never);
    expect(() => validateCheckpoint(stored([good, claim]))).not.toThrow();
    expect(() => validateCheckpoint(stored([{ ...good, finding: 'not-a-kind' }]))).toThrow(
      /integrity-finding/,
    );
    expect(() => validateCheckpoint(stored([{ ...claim, field: 7 }]))).toThrow(/claim-unsettled/);
  });
});
