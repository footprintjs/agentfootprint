/**
 * The negative-claim replay (`bench/negative/`), on a SYNTHETIC study folder written here — no
 * study data enters this repository. No build is needed: the replay takes the checker as an
 * argument, and this suite hands it the SOURCES; only the command line loads the built package.
 *
 * Test types:
 *   - UNIT — the split (flagships held out, the per-kind quota, deterministic), the exact
 *     case-level bound (Clopper-Pearson over cases), the floors;
 *   - FUNCTIONAL — a whole folder read and replayed: the detector's hits against the labels, the
 *     baseline equal to detector + record while no call carries a composed row, the gates, a
 *     label set without a key rebuilt by the sheet rule;
 *   - CONTRACT — the printed report carries no reply text.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { detectNegativeClaims } from '../../../src/integrity/negative-claim/detect.js';
import {
  NEGATIVE_CLAIM_PHRASES_HASH,
  NEGATIVE_CLAIM_PHRASES_VERSION,
} from '../../../src/integrity/negative-claim/phrases.js';
import { judgeProseNegatives } from '../../../src/integrity/negative-claim/prose.js';
import { STATEMENT_VERSION } from '../../../src/integrity/negative-claim/statement.js';
// @ts-expect-error — a plain .mjs bench module, no types
import {
  FLAGSHIPS,
  casesRatio,
  clopperPearson,
  splitCases,
  TUNE_QUOTA,
} from '../../../bench/negative/measure.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { print, replay } from '../../../bench/negative/replay.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { loadStudy, rebuildSheetKey } from '../../../bench/negative/study.mjs';

/** The checker, from the sources. */
const LIB = { detectNegativeClaims, judgeProseNegatives };
const VERSIONS = {
  phrases: NEGATIVE_CLAIM_PHRASES_VERSION,
  phrasesHash: NEGATIVE_CLAIM_PHRASES_HASH,
  statement: STATEMENT_VERSION,
};

const KINDS: Record<string, string> = {
  a1: 'A',
  a3: 'A',
  b1: 'B',
  b3: 'B',
  c1: 'C',
  c2: 'C',
  c3: 'C',
  c4: 'C',
  c6: 'C',
  c7: 'C',
  d1: 'D',
  d2: 'D',
  d3: 'D',
  d4: 'D',
  d5: 'D',
  d6: 'D',
  f1: 'F',
  f3: 'F',
  f4: 'F',
  g3: 'G',
  g4: 'G',
};

const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

const FLAT = 'There are no open incidents on the synthetic service.';
const SCOPED = 'The synthetic lookup returned two rows for the service.';

/** A synthetic study folder: 21 cases, one Haiku run with a key, one later run without a label key. */
/**
 * A synthetic study folder: 21 cases; a registered run with a key (and one excluded and one voided
 * turn the sheet left out); a later run whose label set ships without its key (and a voided turn);
 * and a PILOT run with a key, which the registration never counts. `labelUncounted` puts the
 * voided and excluded turns on the sheet; `labelPilot` puts a pilot turn there.
 */
function syntheticStudy(options: { labelUncounted?: boolean; labelPilot?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'negative-replay-'));
  mkdirSync(join(dir, 'cases'));
  for (const [code, kind] of Object.entries(KINDS)) {
    writeFileSync(
      join(dir, 'cases', `${code}-synthetic.json`),
      JSON.stringify({ id: `${code}-synthetic`, kind }),
    );
  }
  writeFileSync(
    join(dir, 'cases', 'a2-spare.json'),
    JSON.stringify({ id: 'a2-spare', kind: 'A', role: 'spare' }),
  );
  writeFileSync(
    join(dir, 'cases', 'g1-gone.json'),
    JSON.stringify({ id: 'g1-gone', kind: 'G', withdrawn: 'reason' }),
  );

  const turns: unknown[] = [];
  const key: unknown[] = [];
  const sheet: { sheetId: string; turnId: string }[] = [];
  const labelsA: unknown[] = [];
  const labelsB: unknown[] = [];
  let n = 0;
  for (const code of Object.keys(KINDS)) {
    for (const arm of ['PLAIN', 'DECLARED', 'PROMPT']) {
      n += 1;
      const turnId = `t${String(n).padStart(3, '0')}`;
      const flat = n % 2 === 0;
      turns.push({
        turnId,
        status: 'done',
        reply: flat ? FLAT : SCOPED,
        model: 'claude-haiku-4-5',
        startedAt: '2026-10-22T10:00:00Z',
      });
      key.push({ turnId, arm, caseId: `${code}-synthetic` });
      const sheetId = `S${String(n).padStart(4, '0')}`;
      sheet.push({ sheetId, turnId });
      labelsA.push({ sheetId, claimsNonExistence: flat, flagged: flat && KINDS[code] === 'C' });
      labelsB.push({
        sheetId,
        claimsNonExistence: flat,
        flagged: flat && KINDS[code] === 'C' && n % 4 === 0,
      });
    }
  }
  // Two turns the registration does not count: one excluded, one voided by its sealed checks.
  turns.push(
    {
      turnId: 'tx',
      status: 'done',
      exclusion: 'connection-error',
      reply: FLAT,
      model: 'claude-haiku-4-5',
    },
    { turnId: 'tv', status: 'done', reply: FLAT, model: 'claude-haiku-4-5' },
  );
  key.push(
    { turnId: 'tx', arm: 'PLAIN', caseId: 'c4-synthetic' },
    { turnId: 'tv', arm: 'PLAIN', caseId: 'c4-synthetic' },
  );
  if (options.labelUncounted === true) {
    for (const [i, turnId] of ['tx', 'tv'].entries()) {
      const sheetId = `S9${i}`;
      sheet.push({ sheetId, turnId });
      labelsA.push({ sheetId, claimsNonExistence: true, flagged: true });
      labelsB.push({ sheetId, claimsNonExistence: true, flagged: true });
    }
  }
  const main = join(dir, 'runs', 'run-20261001T000000Z');
  mkdirSync(join(main, 'sealed'), { recursive: true });
  writeFileSync(join(main, 'plan.json'), JSON.stringify({ runName: 'synthetic-full' }));
  writeFileSync(join(main, 'turns.jsonl'), jsonl(turns));
  writeFileSync(join(main, 'key.jsonl'), jsonl(key));
  writeFileSync(join(main, 'sealed', 'checks.jsonl'), jsonl([{ turnId: 'tv', void: true }]));

  // A pilot run with a key: registered for its own purpose, never counted here.
  const pilot = join(dir, 'runs', 'run-20260930T000000Z');
  mkdirSync(pilot, { recursive: true });
  writeFileSync(join(pilot, 'plan.json'), JSON.stringify({ runName: 'synthetic-pilot' }));
  writeFileSync(
    join(pilot, 'turns.jsonl'),
    jsonl([
      { turnId: 'p1', status: 'done', reply: FLAT, model: 'claude-sonnet-4-6' },
      { turnId: 'p2', status: 'done', reply: SCOPED, model: 'claude-sonnet-4-6' },
    ]),
  );
  writeFileSync(
    join(pilot, 'key.jsonl'),
    jsonl([
      { turnId: 'p1', arm: 'PLAIN', caseId: 'c3-synthetic' },
      { turnId: 'p2', arm: 'PLAIN', caseId: 'c3-synthetic' },
    ]),
  );
  if (options.labelPilot === true) {
    sheet.push({ sheetId: 'S99', turnId: 'p1' });
    labelsA.push({ sheetId: 'S99', claimsNonExistence: true, flagged: true });
    labelsB.push({ sheetId: 'S99', claimsNonExistence: true, flagged: true });
  }
  mkdirSync(join(dir, 'labels', 'set-a'), { recursive: true });
  writeFileSync(join(dir, 'labels', 'set-a', 'key.jsonl'), jsonl(sheet));
  writeFileSync(join(dir, 'labels', 'set-a', 'labels-a.jsonl'), jsonl(labelsA));
  writeFileSync(join(dir, 'labels', 'set-a', 'labels-b.jsonl'), jsonl(labelsB));

  // A second model's run whose label set ships without its key.
  const second = [
    { turnId: 'u1', status: 'done', reply: FLAT, model: 'claude-sonnet-4-6' },
    { turnId: 'u2', status: 'done', reply: SCOPED, model: 'claude-sonnet-4-6' },
    { turnId: 'u3', status: 'not-run', reply: '', model: 'claude-sonnet-4-6' },
    { turnId: 'u4', status: 'done', reply: FLAT, model: 'claude-sonnet-4-6' },
  ];
  mkdirSync(join(dir, 'runs', 'run-20261002T000000Z', 'sealed'), { recursive: true });
  writeFileSync(
    join(dir, 'runs', 'run-20261002T000000Z', 'plan.json'),
    JSON.stringify({ runName: 'synthetic-second' }),
  );
  writeFileSync(
    join(dir, 'runs', 'run-20261002T000000Z', 'sealed', 'checks-amended.jsonl'),
    jsonl([{ turnId: 'u4', void: true }]),
  );
  writeFileSync(join(dir, 'runs', 'run-20261002T000000Z', 'turns.jsonl'), jsonl(second));
  writeFileSync(
    join(dir, 'runs', 'run-20261002T000000Z', 'key.jsonl'),
    jsonl(second.map((t) => ({ turnId: t.turnId, arm: 'PLAIN', caseId: 'c3-synthetic' }))),
  );
  const rebuilt = rebuildSheetKey(dir, ['run-20261002T000000Z']) as {
    sheetId: string;
    turnId: string;
  }[];
  mkdirSync(join(dir, 'labels', 'set-b'), { recursive: true });
  writeFileSync(
    join(dir, 'labels', 'set-b', 'labels-a.jsonl'),
    jsonl(
      rebuilt.map((r) => ({
        sheetId: r.sheetId,
        claimsNonExistence: r.turnId === 'u1',
        flagged: r.turnId === 'u1',
      })),
    ),
  );
  writeFileSync(
    join(dir, 'labels', 'set-b', 'labels-b.jsonl'),
    jsonl(
      rebuilt.map((r) => ({
        sheetId: r.sheetId,
        claimsNonExistence: r.turnId === 'u1',
        flagged: false,
      })),
    ),
  );
  return dir;
}

describe('UNIT — the split', () => {
  const cases = Object.entries(KINDS).map(([code, kind]) => ({ code, kind }));

  it('holds the flagships out, tunes the quota per kind, 8 and 13', () => {
    const split = splitCases(cases) as Map<string, string>;
    for (const code of FLAGSHIPS as string[]) expect(split.get(code)).toBe('held-out');
    const tune = [...split.entries()].filter(([, side]) => side === 'tune').map(([code]) => code);
    expect(tune).toHaveLength(8);
    for (const [kind, quota] of Object.entries(TUNE_QUOTA as Record<string, number>)) {
      expect(tune.filter((code) => KINDS[code] === kind)).toHaveLength(quota);
    }
  });

  it('is deterministic and independent of input order', () => {
    const a = splitCases(cases) as Map<string, string>;
    const b = splitCases([...cases].reverse()) as Map<string, string>;
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });
});

describe('UNIT — the exact case-level bound', () => {
  it('Clopper-Pearson: known values', () => {
    const [low, high] = clopperPearson(3, 8) as [number, number];
    expect(low).toBeCloseTo(0.0852, 3);
    expect(high).toBeCloseTo(0.7551, 3);
    expect(clopperPearson(0, 5)[0]).toBe(0);
    expect(clopperPearson(5, 5)[1]).toBe(1);
  });

  it('a ratio over replies, bounded over its CASES', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      code: `k${i % 8}`,
      num: i % 3 === 0 ? 1 : 0,
      den: 1,
    }));
    const r = casesRatio(items);
    expect(r.point).toBeCloseTo(14 / 40);
    expect(r.cases).toBe(8);
    expect(r.low).toBeCloseTo(0.0852, 3);
    expect(r.high).toBeCloseTo(0.7551, 3);
    expect(casesRatio(items)).toEqual(r);
  });

  it('an empty denominator has no estimate', () => {
    expect(casesRatio([{ code: 'k', num: 0, den: 0 }]).point).toBeUndefined();
  });
});

describe('FUNCTIONAL — a synthetic folder, read and replayed', () => {
  const dir = syntheticStudy();

  it('reads the bank (no spare, no withdrawn case) and rebuilds a missing key', () => {
    const study = loadStudy(dir);
    expect(study.cases).toHaveLength(21);
    expect(study.replies).toHaveLength(63 + 2);
    expect(study.rebuilt).toEqual([{ set: 'set-b', runs: 1, items: 2 }]);
  });

  it('counts only the registered runs: a pilot is never swept into a rebuilt sheet', () => {
    const study = loadStudy(dir);
    expect(study.runs).toEqual(['run-20261001T000000Z', 'run-20261002T000000Z']);
    expect(study.replies.map((r: { turnId: string }) => r.turnId)).not.toContain('p1');
  });

  it('a voided or an excluded turn is never counted, and a sheet naming one is refused', () => {
    const ids = loadStudy(dir).replies.map((r: { turnId: string }) => r.turnId);
    for (const id of ['tx', 'tv', 'u3', 'u4']) expect(ids).not.toContain(id);
    expect(() => loadStudy(syntheticStudy({ labelUncounted: true }))).toThrow(
      /2 labelled items are not analysed rows of a counted run/,
    );
  });

  it('a sheet naming a turn of an uncounted (pilot) run is refused', () => {
    expect(() => loadStudy(syntheticStudy({ labelPilot: true }))).toThrow(
      /1 labelled items are not analysed rows of a counted run/,
    );
  });

  it('the detector finds the flat claims the labels mark, and only those', () => {
    const result = replay(loadStudy(dir), LIB);
    const cell = result.cells.find(
      (c: { cell: string; resolution: string }) =>
        c.cell === 'held-out · haiku · test-arm' && c.resolution === 'A',
    );
    expect(cell.detector.sensitivity.point).toBe(1);
    expect(cell.detector.firesOnNotFlat.point).toBe(0);
    expect(cell.baseline.missedOverclaims.point).toBe(0);
    expect(cell.record.sameAsBaseline).toBe(true);
  });

  it('with no composed row, detector + record IS the baseline; every claim notes entity-unresolved', () => {
    const result = replay(loadStudy(dir), LIB);
    for (const cell of result.cells) expect(cell.record.sameAsBaseline).toBe(true);
    expect(Object.keys(result.notes)).toEqual(['entity-unresolved']);
  });

  it('reads the gates on held-out test-arm replies, per model and resolution; floors enforced', () => {
    const result = replay(loadStudy(dir), LIB);
    expect(
      result.gates.map((g: { model: string; resolution: string }) => `${g.model}/${g.resolution}`),
    ).toEqual(['haiku/A', 'haiku/B', 'haiku/agreed', 'sonnet/A', 'sonnet/B', 'sonnet/agreed']);
    const verdict = (name: string) =>
      result.gates[0].verdicts.find((v: { name: string }) => v.name.startsWith(name)).verdict;
    expect(verdict('detector sensitivity')).toBe('below floor');
    expect(verdict('missed overclaims')).toBe('below floor');
    expect(verdict('specificity above')).toBe('not measurable');
  });

  it('the printed report carries no reply text', () => {
    const report = print(replay(loadStudy(dir), LIB), VERSIONS) as string;
    expect(report).toContain('PRELIMINARY');
    expect(report).not.toContain(FLAT);
    expect(report).not.toContain('synthetic service');
  });
});
