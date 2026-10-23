/**
 * `absent({ among })` — a name that resolves to nothing is a NAMED MISS over
 * the names the tool read, never "it does not exist".
 *
 * The study this answers: a lookup refused an unknown array name with "No
 * array matches 'X'. Known arrays: … a wrong identifier, not missing data",
 * and the models told users "X is not in your estate" — when the tool had
 * only failed to find X in ONE inventory export. A declaration is a claim.
 * So the mint composes the names facet the tool searched and ADDS the gap the
 * author cannot remove: names outside that source (or, for a partial read,
 * the names in it the read did not see). The names themselves are read only
 * to check the count, and are never served.
 *
 * Sections (Convention 3): Unit (the mint) · Functional (served value,
 * evidence) · Security (no name served; the looked-for value off evidence) ·
 * Edge (refusals, mismatch) · Property (a seeded generator — no fast-check in
 * the tree) · Byte identity.
 */

import { describe, expect, it } from 'vitest';

import { absent, ABSENCE_NOTE, coverage, type ToolAbsence } from '../../../src/index.js';
import { absenceEvidenceProjection } from '../../../src/semantics/coverage/index.js';
import { namesFacetOf } from '../../../src/semantics/coverage/among.js';
import { servedToModel } from '../../../src/semantics/coverage/read.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

const SOURCE = 'the PowerStore inventory export';
const READ_AT = '2026-10-22T09:14:00Z';
/** The name the MODEL asked for — never one of the inventory's names. */
const ASKED = 'PS-ARRAY-99';

const INVENTORY = Array.from(
  { length: 25 },
  (_, i) => `PS-ARRAY-${String(i + 1).padStart(2, '0')}`,
);

const among = (extra: Record<string, unknown> = {}) => ({
  argument: 'array_id',
  source: SOURCE,
  measuredAt: READ_AT,
  count: INVENTORY.length,
  names: INVENTORY,
  ...extra,
});

const mint = (extra: Record<string, unknown> = {}, decl: Record<string, unknown> = {}) =>
  absent({ what: ASKED, among: among(extra), ...decl } as never);

/** Every string a value would put into the evidence corpus, flattened. */
const leavesOf = (value: unknown): string[] => {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object' && v !== null) Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
};

const refusalOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected a refusal');
};

const OUTSIDE_GAP = {
  what: `names outside ${SOURCE}`,
  kind: 'scope',
  relevance: 'bears',
  bears: 'source',
};
const PARTIAL_GAP = {
  what: `not every name in ${SOURCE} was read`,
  kind: 'scope',
  relevance: 'bears',
  bears: 'source',
};

// ── Unit — what the mint composes ────────────────────────────────────────

describe('unit — an among miss composes the names facet and the irremovable gap', () => {
  it('composes checked, the gap and provenance — and keeps looked_for', () => {
    const v = mint();
    expect(v.af_absent).toBe(true);
    expect(v.looked_for).toBe(ASKED);
    expect(v.checked).toEqual([
      {
        what: `the 25 array_id names listed in ${SOURCE}`,
        why: `names as of ${READ_AT}`,
        facet: 'names',
        argument: 'array_id',
        count: 25,
        source: SOURCE,
        from: 'result',
      },
    ]);
    expect(v.not_checked).toEqual([OUTSIDE_GAP]);
    expect(v.provenance).toEqual({ measured_at: READ_AT, source: SOURCE });
    expect(v.note).toBe(ABSENCE_NOTE);
  });

  it('the gap cannot be removed by the author — notChecked and cannotCover only add to it', () => {
    const v = mint(
      {},
      {
        notChecked: [{ what: 'arrays decommissioned this week', why: 'the export is nightly' }],
        cannotCover: [{ what: 'Unity arrays', why: 'a different inventory' }],
      },
    );
    expect(v.not_checked?.[0]).toEqual(OUTSIDE_GAP);
    expect(v.not_checked).toHaveLength(2);
    expect(v.cannot_cover).toEqual([{ what: 'Unity arrays', why: 'a different inventory' }]);
  });

  it('an authored checked list follows the composed names facet', () => {
    const v = mint({}, { checked: ['the PowerStore REST API, live'] });
    expect(v.checked.map((i) => i.what)).toEqual([
      `the 25 array_id names listed in ${SOURCE}`,
      'the PowerStore REST API, live',
    ]);
  });

  it('authoritative removes the outside gap — the only opt-out — and says why on the facet', () => {
    const v = mint({ authoritative: { why: 'the export is the system of record for arrays' } });
    expect(v.not_checked).toBeUndefined();
    expect(namesFacetOf(v)?.authoritative).toEqual({
      why: 'the export is the system of record for arrays',
    });
  });

  it('a count of one reads in the singular', () => {
    const v = absent({
      what: ASKED,
      among: { argument: 'array_id', source: SOURCE, measuredAt: READ_AT, count: 1 },
    });
    expect(v.checked[0]?.what).toBe(`the 1 array_id name listed in ${SOURCE}`);
  });
});

describe('unit — a partial read composes a completeness gap', () => {
  it('partial: "not every name in <source> was read", in place of "names outside"', () => {
    const v = mint({ partial: true, count: 3, names: INVENTORY.slice(0, 3) });
    expect(v.not_checked).toEqual([PARTIAL_GAP]);
    expect(v.checked[0]?.what).toBe(`the 3 array_id names read from ${SOURCE}`);
  });

  it('authoritative does not remove the completeness gap', () => {
    const v = mint({ partial: true, authoritative: { why: 'the system of record' } });
    expect(v.not_checked).toEqual([PARTIAL_GAP]);
  });

  it('partial: false reads as omitted', () => {
    expect(mint({ partial: false }).not_checked).toEqual([OUTSIDE_GAP]);
  });
});

describe('unit — a dated note when measuredAt is an instant, and no judgement of age', () => {
  it('an ISO 8601 instant adds "names as of <measuredAt>"', () => {
    expect(namesFacetOf(mint({ measuredAt: '2019-01-01T00:00:00Z' }))?.why).toBe(
      'names as of 2019-01-01T00:00:00Z',
    );
  });

  it('words that are not an instant add no note — they still ride provenance', () => {
    const v = mint({ measuredAt: 'the 02:00 export' });
    expect(namesFacetOf(v)?.why).toBeUndefined();
    expect(v.provenance).toEqual({ measured_at: 'the 02:00 export', source: SOURCE });
  });
});

// ── Security — no name is served; the looked-for value stays off evidence ─

describe('security — the names are read to check the count, never served', () => {
  it('no name the list holds is in the envelope, or what the model is served', () => {
    const v = mint();
    for (const name of INVENTORY) {
      expect(JSON.stringify(v)).not.toContain(name);
      expect(JSON.stringify(servedToModel(v))).not.toContain(name);
    }
    expect(v).not.toHaveProperty('known_names');
  });

  it('visible is no longer a field: it is refused, naming the fields there are', () => {
    expect(refusalOf(() => mint({ visible: 'caller' }))).toMatch(/'among.visible'/);
  });

  it('the looked-for value stays off evidence; the facet and the gap ground', () => {
    const projected = leavesOf(absenceEvidenceProjection(JSON.parse(JSON.stringify(mint()))));
    expect(projected).not.toContain(ASKED);
    expect(projected).toContain(`names outside ${SOURCE}`);
  });

  it('the composed ground never quotes the looked-for value', () => {
    const { looked_for: _echo, ...rest } = mint();
    expect(JSON.stringify(rest)).not.toContain(ASKED);
  });
});

// ── Functional — what the model is served ────────────────────────────────

describe('functional — served to the model', () => {
  it('the facet and the gap are served; the record-only kind comes off', () => {
    const served = servedToModel(mint()) as ToolAbsence;
    expect(served.not_checked).toEqual([
      { what: `names outside ${SOURCE}`, relevance: 'bears', bears: 'source' },
    ]);
    expect(served.checked[0]).toMatchObject({ facet: 'names', count: 25, from: 'result' });
  });

  it('a ledger around an among absence keeps the gap', () => {
    const bounded = coverage(mint(), { checked: ['the array estate API'] });
    expect(bounded.result).toMatchObject({ not_checked: [OUTSIDE_GAP] });
  });
});

// ── Edge — what the mint refuses ─────────────────────────────────────────

describe('edge — the mint refuses what it cannot honour', () => {
  it('names-count-mismatch: the count disagrees with the names, either way', () => {
    for (const count of [30, 3]) {
      const message = refusalOf(() => mint({ count }));
      expect(message).toMatch(/^refused: /);
      expect(message).toContain('names-count-mismatch');
      expect(message).toContain(String(count));
      expect(message).toContain('25');
    }
  });

  it.each([
    ['a non-object among', 'nope', /`among` takes/],
    [
      'an unknown key, naming the spelling meant',
      { measured_at: READ_AT },
      /did you mean `measuredAt`/,
    ],
    ['no argument', { argument: ' ' }, /`among.argument`/],
    ['no source', { source: '' }, /`among.source`/],
    ['a source on two lines', { source: 'a\nb' }, /`among.source`/],
    ['no measuredAt', { measuredAt: '' }, /`among.measuredAt`/],
    ['a fractional count', { count: 2.5, names: undefined }, /`among.count`/],
    ['a negative count', { count: -1, names: undefined }, /`among.count`/],
    ['names that are not a list', { names: 'PS-1' }, /`among.names`/],
    ['a partial that is not true or false', { partial: 'yes' }, /`among.partial`/],
    ['authoritative with no why', { authoritative: {} }, /among\.authoritative/],
    [
      'authoritative with an unknown key',
      { authoritative: { why: 'x', how: 'y' } },
      /authoritative/,
    ],
  ])('refuses %s', (_label, value, pattern) => {
    const decl =
      typeof value === 'object' && value !== null
        ? { what: ASKED, among: { ...among(), ...value } }
        : { what: ASKED, among: value };
    const message = refusalOf(() => absent(decl as never));
    expect(message).toMatch(/^refused: /);
    expect(message).toMatch(pattern);
  });

  it('refuses provenance beside among — among composes it', () => {
    const message = refusalOf(() =>
      absent({
        what: ASKED,
        among: among(),
        provenance: { measuredAt: READ_AT, source: SOURCE },
      } as never),
    );
    expect(message).toMatch(/^refused: /);
    expect(message).toContain('`provenance`');
  });

  it('among: null reads as omitted, as every optional field does', () => {
    const v = absent({ what: 'x', checked: ['y'], among: null } as never);
    expect(v.checked).toEqual([{ what: 'y' }]);
  });

  it('without among, an empty checked is still refused', () => {
    expect(refusalOf(() => absent({ what: 'x', checked: [] }))).toContain('`checked` must name');
  });
});

// ── Property — a seeded generator ────────────────────────────────────────

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('property — the gap always stands, and no name is ever served', () => {
  it('300 generated declarations', () => {
    const next = rng(20261023);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
    const pick = (n: number) =>
      Array.from({ length: n }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
    for (let run = 0; run < 300; run++) {
      const size = Math.floor(next() * 40);
      const names = Array.from({ length: size }, () => `NM-${pick(6)}`);
      const partial = next() < 0.3;
      const authoritative = next() < 0.3 ? { why: 'the system of record' } : undefined;
      const v = absent({
        what: pick(8),
        among: {
          argument: 'name',
          source: SOURCE,
          measuredAt: READ_AT,
          count: size,
          names,
          ...(partial && { partial: true }),
          ...(authoritative !== undefined && { authoritative }),
        },
      });
      const wire = JSON.stringify(v);
      for (const name of names) expect(wire).not.toContain(name);
      expect(namesFacetOf(v)?.count).toBe(size);
      const gap = v.not_checked?.[0];
      if (partial) expect(gap).toEqual(PARTIAL_GAP);
      else if (authoritative === undefined) expect(gap).toEqual(OUTSIDE_GAP);
      else expect(v.not_checked).toBeUndefined();
    }
  });
});

// ── Byte identity — an absence without among mints what it always did ────

describe('byte identity — no among, the bytes absent() always minted', () => {
  it('mints the pre-change shape, key for key', () => {
    const v = absent({
      what: 'FLOGI entries on fc1/3',
      checked: ['the live fcns database'],
      notChecked: [{ what: 'the archived history', why: 'older than 24h' }],
      tryInstead: 'Ask for a different interface.',
    });
    expect(JSON.stringify(v)).toBe(
      JSON.stringify({
        af_absent: true,
        outcome: 'nothing_found',
        looked_for: 'FLOGI entries on fc1/3',
        checked: [{ what: 'the live fcns database' }],
        not_checked: [{ what: 'the archived history', why: 'older than 24h' }],
        retry_returns_the_same: true,
        try_instead: 'Ask for a different interface.',
        note: ABSENCE_NOTE,
      }),
    );
    expect(servedToModel(v)).toBe(v);
  });
});
