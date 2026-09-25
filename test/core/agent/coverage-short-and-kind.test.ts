/**
 * `short` and `kind` on a coverage item — the two doors, the one reader, the
 * strip, and the evidence corpus.
 *
 * Test types (Convention 3):
 *   - UNIT      — `normalizeCoverageList` (via `absent()` / `coverage()`)
 *                 refuses at the call site; `readItemExtras` drops, never
 *                 repairs; `servedToModel` strips every shape and returns the
 *                 SAME reference when there is nothing to strip.
 *   - SECURITY  — a value that appears ONLY in `short` never grounds
 *                 (`absenceEvidenceProjection`), bare, nested, as JSON text.
 *   - EDGE      — `null` reads as omitted; an item that is not an object is
 *                 left as found; one dev warning per tool.
 *   - REGRESSION— no library switch over the kind union is exhaustive. A
 *                 regex TRIPWIRE, not a proof: it slices each switch body to
 *                 the first two-space-indented `}`, so a deeper-nested switch
 *                 is judged against what follows it; it does not see
 *                 double-quoted cases, if-chains, or exhaustiveness through a
 *                 `Record<…, …>` map. A review still owns that law.
 *
 * The dispatch paths are driven end to end in
 * `coverage-record-only-fields.test.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { disableDevMode, enableDevMode } from 'footprintjs';

import { absent, coverage, readCoverageResult } from '../../../src/index.js';
import {
  absenceEvidenceProjection,
  normalizeCoverageList,
} from '../../../src/core/agent/coverage/index.js';
import {
  listWithoutRecordOnly,
  MAX_SHORT_CHARS,
  readItemExtras,
} from '../../../src/core/agent/coverage/items.js';
import { servedToModel, strippedOnly } from '../../../src/core/agent/coverage/read.js';
import { semantic } from '../../../src/lib/semantics/index.js';

const WHAT = 'whether that name is a storage array, and which VM disks are on it';
const item = (extra: Record<string, unknown>) => ({
  what: WHAT,
  why: 'not an array list',
  ...extra,
});

describe('UNIT — the mint door refuses where the author typed it', () => {
  it('keeps a valid short (trimmed) and kind, in every section they are allowed', () => {
    const out = normalizeCoverageList(
      'absent',
      'notChecked',
      [item({ short: '  whether that name is a storage array ', kind: 'existence' })],
      false,
    );
    expect(out).toEqual([
      {
        what: WHAT,
        why: 'not an array list',
        short: 'whether that name is a storage array',
        kind: 'existence',
      },
    ]);
    expect(
      normalizeCoverageList('coverage', 'checked', [{ what: WHAT, short: 'a name' }], false),
    ).toEqual([{ what: WHAT, short: 'a name' }]);
    expect(
      normalizeCoverageList('absent', 'cannotCover', [item({ kind: 'scope' })], true)[0]!.kind,
    ).toBe('scope');
  });

  it('declaring neither is byte-identical: no key appears', () => {
    const out = normalizeCoverageList('absent', 'notChecked', [item({})], false);
    expect(Object.keys(out[0]!)).toEqual(['what', 'why']);
    const nulls = normalizeCoverageList(
      'absent',
      'notChecked',
      [item({ short: null, kind: null })],
      false,
    );
    expect(Object.keys(nulls[0]!)).toEqual(['what', 'why']);
  });

  it.each([
    ['an empty short', { short: '   ' }, /non-empty/],
    ['a short that is not a string', { short: 7 }, /non-empty/],
    ['a two-line short', { short: 'one\ntwo' }, /plain visible text/],
    [
      `a short over ${MAX_SHORT_CHARS} characters`,
      { short: 'x'.repeat(MAX_SHORT_CHARS + 1) },
      /limit is 80/,
    ],
    ['an unknown kind', { kind: 'window' }, /must be one of 'existence', 'scope'/],
  ])('refuses %s', (_label, extra, message) => {
    const what = 'y'.repeat(200);
    expect(() =>
      normalizeCoverageList('absent', 'notChecked', [{ what, ...extra }], false),
    ).toThrow(message);
  });

  it.each([
    ['CR', 'one\rtwo'],
    ['TAB (Cc)', 'whether\tthat name is an array'],
    ['VT (Cc)', 'whether that\u000bname is an array'],
    ['FF (Cc)', 'whether that\u000cname is an array'],
    ['NEL U+0085 (Cc)', 'whether that\u0085name is an array'],
    ['U+2028 line separator (Zl)', 'whether that\u2028name is an array'],
    ['U+2029 paragraph separator (Zp)', 'whether that\u2029name is an array'],
    ['U+202E RTL override (Cf)', 'whether \u202Eyarra na si eman taht'],
    ['U+200B zero-width space ×60 (Cf) — padding past 80', 'short' + '\u200B'.repeat(60)],
    ['U+2066 bidi isolate (Cf)', 'whether \u2066that\u2069 name'],
  ])('S3: refuses %s in short, at both doors', (_label, short) => {
    const what = 'whether that name is a storage array, and which VM disks are on it';
    expect(() => absent({ what: 'x', checked: [{ what, short }] })).toThrow(/plain visible text/);
    expect(() => coverage(1, { notChecked: [{ what, short }] })).toThrow(/plain visible text/);
    expect(readItemExtras({ what, short }, 'notChecked', 'py_s3')).toEqual({});
  });

  it('refuses a short longer than its what', () => {
    expect(() =>
      normalizeCoverageList(
        'absent',
        'notChecked',
        [{ what: 'the archive', short: 'the whole archive' }],
        false,
      ),
    ).toThrow(/longer than `what`/);
  });

  it('refuses kind on checked — both doors', () => {
    expect(() => absent({ what: 'x', checked: [{ what: 'the fcns db', kind: 'scope' }] })).toThrow(
      /refused on `checked`/,
    );
    expect(() => coverage(1, { checked: [{ what: 'the fcns db', kind: 'existence' }] })).toThrow(
      /refused on `checked`/,
    );
  });

  it('absent() and coverage() carry the fields onto the envelope the tool returns', () => {
    const a = absent({
      what: 'a disk',
      checked: ['the export'],
      notChecked: [item({ short: 'whether it is an array', kind: 'existence' })],
    });
    expect(a.not_checked?.[0]).toMatchObject({
      short: 'whether it is an array',
      kind: 'existence',
    });
    const c = coverage(
      { n: 1 },
      { cannotCover: [item({ short: 'non-VMware hosts', kind: 'scope' })] },
    );
    expect(c.af_coverage.cannot_cover?.[0]).toMatchObject({
      short: 'non-VMware hosts',
      kind: 'scope',
    });
  });
});

describe('UNIT — the dispatch reader drops, never repairs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    disableDevMode();
  });

  it('copies a valid short / kind, trimmed', () => {
    expect(
      readItemExtras(
        item({ short: ' whether it is an array ', kind: 'existence' }),
        'notChecked',
        't',
      ),
    ).toEqual({
      short: 'whether it is an array',
      kind: 'existence',
    });
  });

  it('returns {} for an item that declares neither — a spread adds no key', () => {
    expect(readItemExtras(item({}), 'notChecked')).toEqual({});
    expect(readItemExtras(item({ short: null, kind: null }), 'notChecked')).toEqual({});
    expect(readItemExtras('bare string', 'checked')).toEqual({});
    expect(readItemExtras(null, 'checked')).toEqual({});
  });

  it('drops an invalid value, keeps the valid one, and warns once per tool', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      readItemExtras(item({ short: 'x'.repeat(90), kind: 'scope' }), 'notChecked', 'py_tool_a'),
    ).toEqual({
      kind: 'scope',
    });
    expect(readItemExtras(item({ kind: 'existence' }), 'checked', 'py_tool_a')).toEqual({});
    expect(readItemExtras(item({ kind: 'window' }), 'cannotCover', 'py_tool_a')).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("tool 'py_tool_a'");
    readItemExtras(item({ kind: 'window' }), 'cannotCover', 'py_tool_b');
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('UNIT — the strip serves every shape without the record-only keys', () => {
  const declared = {
    checked: [{ what: 'the RVTools export', short: 'the export' }],
    notChecked: [item({ short: 'whether it is an array', kind: 'existence' as const })],
    cannotCover: [item({ short: 'non-VMware hosts', kind: 'scope' as const })],
  };
  const plain = {
    checked: [{ what: 'the RVTools export' }],
    notChecked: [item({})],
    cannotCover: [item({})],
  };
  const noExtras = (v: unknown) => {
    const s = JSON.stringify(v);
    expect(s).not.toContain('"short"');
    expect(s).not.toContain('"kind"');
  };

  it('a bare absence', () => {
    const served = servedToModel(absent({ what: 'a disk', ...declared }));
    noExtras(served);
    expect(served).toEqual(absent({ what: 'a disk', ...plain }));
  });

  it('a ledger — its own lists', () => {
    const served = servedToModel(coverage({ rows: [1] }, declared));
    noExtras(served);
    expect(served).toEqual(coverage({ rows: [1] }, plain));
  });

  it('coverage(absent(…)) — the ledger lists AND the inner absence', () => {
    const served = servedToModel(coverage(absent({ what: 'a disk', ...declared }), declared));
    noExtras(served);
    expect(served).toEqual(coverage(absent({ what: 'a disk', ...plain }), plain));
  });

  it('a hand-built snake_case envelope (a Python sidecar)', () => {
    const envelope = {
      af_absent: true,
      outcome: 'nothing_found',
      looked_for: 'a disk',
      checked: declared.checked,
      not_checked: declared.notChecked,
      cannot_cover: declared.cannotCover,
      retry_returns_the_same: true,
      note: 'n',
    };
    const served = servedToModel(envelope) as Record<string, unknown>;
    noExtras(served);
    expect(Object.keys(served)).toEqual(Object.keys(envelope));
    expect(served.not_checked).toEqual(plain.notChecked);
  });

  it('a semantic envelope’s coverage', () => {
    const env = {
      ...(semantic({
        facts: [{ entity: 'vm-1', disks: 0 }],
        provenance: { measured_at: '2026-09-19T00:00:00Z', source: 'rvtools' },
        coverage: { checked: [{ what: 'the export' }] },
      }) as object),
    } as Record<string, unknown>;
    const withShort = { ...env, coverage: { checked: [{ what: 'the export', short: 'export' }] } };
    const served = servedToModel(withShort) as Record<string, unknown>;
    noExtras(served);
    expect(served.coverage).toEqual({ checked: [{ what: 'the export' }] });
  });

  it('the SAME reference when nothing is declared, and for anything unrecognized', () => {
    const bare = absent({ what: 'a disk', ...plain });
    const ledger = coverage({ n: 1 }, plain);
    const nested = coverage(absent({ what: 'a disk', ...plain }), plain);
    for (const v of [bare, ledger, nested]) expect(servedToModel(v)).toBe(v);
    const text = JSON.stringify(absent({ what: 'a disk', ...declared }));
    expect(servedToModel(text)).toBe(text); // JSON text is data — never recognized
    const rows = [{ short: 'not coverage' }];
    expect(servedToModel(rows)).toBe(rows);
    const lookalike = { af_absent: 'yes', checked: [{ what: 'x', short: 'x' }] };
    expect(servedToModel(lookalike)).toBe(lookalike);
  });

  it('readCoverageResult RECORDS the fields — and carries no served copy (M1)', () => {
    const value = absent({ what: 'a disk', ...declared });
    const reading = readCoverageResult(value)!;
    expect(reading.declared[0]!.coverage.notChecked[0]).toMatchObject({ kind: 'existence' });
    expect('served' in reading).toBe(false);
  });

  it('S4: a ledger is stripped through whatever it bounds — ledger in ledger, semantic in ledger', () => {
    const inner = coverage({ a: 1 }, declared);
    const served = servedToModel(coverage(inner, declared));
    noExtras(served);
    expect(served).toEqual(coverage(coverage({ a: 1 }, plain), plain));
    const sem = {
      ...(semantic({
        facts: [{ entity: 'vm-1', disks: 0 }],
        provenance: { measured_at: '2026-09-19T00:00:00Z', source: 'rvtools' },
        coverage: { checked: [{ what: 'the export' }] },
      }) as object),
      coverage: { checked: [{ what: 'the export', short: 'export' }] },
    };
    noExtras(servedToModel(coverage(sem, plain)));
    // Same-reference short-circuit at every depth when nothing is declared.
    const deep = coverage(coverage(absent({ what: 'a disk', ...plain }), plain), plain);
    expect(servedToModel(deep)).toBe(deep);
  });

  it('S4 (stated, pre-existing): the recognizer does not RECORD an inner ledger', () => {
    // Only the outer ledger (and an inner ABSENCE) is declared; an inner
    // ledger's lists are served stripped but are not a statement on the record.
    const reading = readCoverageResult(coverage(coverage({ a: 1 }, declared), plain))!;
    expect(reading.declared.map((d) => d.kind)).toEqual(['ledger']);
    expect(reading.declared[0]!.coverage.checked).toEqual(plain.checked);
  });

  it('M4: a null short/kind (a Python None) is omitted — served as written, no copy', () => {
    const envelope = {
      af_absent: true,
      outcome: 'nothing_found',
      looked_for: 'a disk',
      checked: [{ what: 'the export', short: null, kind: null }],
      retry_returns_the_same: true,
      note: 'n',
    };
    expect(servedToModel(envelope)).toBe(envelope);
    const mixed = [{ what: 'the export', short: 'export', kind: null }];
    expect(listWithoutRecordOnly(mixed)).toEqual([{ what: 'the export', kind: null }]);
  });

  it('S2 helper: strippedOnly recognizes the strip, and only the strip', () => {
    const value = absent({ what: 'a disk', ...declared });
    const served = servedToModel(value);
    expect(strippedOnly(value, served)).toBe(true);
    expect(strippedOnly(value, { ...(served as object) })).toBe(false);
    expect(strippedOnly(value, value)).toBe(false);
    expect(strippedOnly(absent({ what: 'a disk', ...declared }), served)).toBe(false);
  });

  it('listWithoutRecordOnly leaves non-object items as found', () => {
    const list = ['bare', null, { what: 'x', short: 'x' }];
    expect(listWithoutRecordOnly(list)).toEqual(['bare', null, { what: 'x' }]);
    const clean = ['bare', { what: 'x' }];
    expect(listWithoutRecordOnly(clean)).toBe(clean);
  });
});

describe('SECURITY — a value that lives only in short never grounds', () => {
  // The inverted v1 test: `short` was once going to ground like `what`.
  const INVENTED = 'SHPSTRPLPCL999';
  const leaves = (v: unknown): string => JSON.stringify(v);
  const declaring = {
    checked: [{ what: 'every VM disk in the RVTools export', short: `disks on ${INVENTED}` }],
    notChecked: [
      {
        what: 'whether that name is a storage array',
        short: `whether ${INVENTED}`,
        kind: 'existence' as const,
      },
    ],
  };

  it('a bare absence', () => {
    const projection = absenceEvidenceProjection(
      JSON.parse(JSON.stringify(absent({ what: 'a disk', ...declaring }))),
    );
    expect(leaves(projection)).not.toContain(INVENTED);
    expect(leaves(projection)).not.toContain('existence');
    expect(leaves(projection)).toContain('every VM disk in the RVTools export');
  });

  it('coverage(absent(…)) — the ledger lists and the inner absence', () => {
    const v = coverage(absent({ what: 'a disk', ...declaring }), declaring);
    const projection = absenceEvidenceProjection(JSON.parse(JSON.stringify(v)));
    expect(leaves(projection)).not.toContain(INVENTED);
  });

  it('a bare ledger is withheld the same way — and indexed whole when it declares neither', () => {
    const v = coverage({ rows: ['r1'] }, declaring);
    const projection = absenceEvidenceProjection(JSON.parse(JSON.stringify(v)));
    expect(leaves(projection)).not.toContain(INVENTED);
    expect(leaves(projection)).toContain('r1');
    expect(
      absenceEvidenceProjection(coverage({ rows: ['r1'] }, { checked: ['x'] })),
    ).toBeUndefined();
  });

  it('an absence that declares neither projects exactly as before (looked_for only)', () => {
    const a = absent({ what: 'a disk', checked: ['the export'] });
    const projection = absenceEvidenceProjection(a) as Record<string, unknown>;
    expect('looked_for' in projection).toBe(false);
    expect(projection.checked).toBe(a.checked);
  });
});

describe('REGRESSION — no library switch over the kind vocabulary is exhaustive', () => {
  it("every `case 'existence'` / `case 'scope'` switch in src has a default arm", () => {
    const SRC = resolve(__dirname, '../../../src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          const code = readFileSync(full, 'utf8');
          for (const m of code.matchAll(/switch\s*\([^)]*\)\s*\{/g)) {
            const body = code.slice(m.index!, code.indexOf('\n  }', m.index!) + 4);
            if (/case 'existence'|case 'scope'/.test(body) && !/default\s*:/.test(body)) {
              offenders.push(full);
            }
          }
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});
