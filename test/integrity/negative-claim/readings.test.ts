/**
 * negative-claim — readings (design § 5.3, `readings.ts`): what makes two calls the SAME
 * search, what makes one search WIDER than another, and how reads of one search merge.
 *
 * The key is the COMPOSED executed scope of each row — the tool, every filter in effect
 * (`whenOmitted` defaults composed as if sent), the `fixed` qualifiers, host-filled identity
 * filters by reference, a relative window by its executed dispatch span, and the page asked
 * for — never
 * the tool name or the model-visible arguments alone.
 *
 * Test types: unit (the key's inputs, one by one; the scope relation; the merge rule) ·
 * boundary (a relative window spelled two ways; two clocks; a missing scope).
 */
import { describe, expect, it } from 'vitest';

import {
  mergeKeyReadings,
  readingKey,
  scopeRelation,
} from '../../../src/integrity/negative-claim/readings.js';
import type { ComposedItem as SearchCheckedItem } from '../../../src/semantics/coverage/composedCoverage.js';
import type { TurnCall } from '../../../src/integrity/negative-claim/types.js';
import { CLOCK, LIST_INCIDENTS, incidentCall } from './fixtures.js';

const key = (call: TurnCall, clock = CLOCK) => readingKey(call, LIST_INCIDENTS, clock);

/** The same call with its composed scope edited — a host-filled filter, a different window. */
function withScope(
  call: TurnCall,
  edit: (items: readonly SearchCheckedItem[]) => readonly SearchCheckedItem[],
): TurnCall {
  const items = call.row?.checked ?? call.scope ?? [];
  return call.row === undefined
    ? { ...call, scope: edit(items) }
    : { ...call, row: { ...call.row, checked: edit(items) } };
}

const tenant = (identity: string): SearchCheckedItem => ({
  what: 'tenant: (the caller’s)',
  facet: 'filter',
  argument: 'tenant',
  value: { identity },
  from: 'host',
});

describe('the key — the composed executed scope', () => {
  it('identical model arguments with different host-filled identity references are different keys', () => {
    const a = withScope(incidentCall({ id: 'c1' }), (items) => [...items, tenant('tenant')]);
    const b = withScope(incidentCall({ id: 'c2' }), (items) => [...items, tenant('org')]);
    expect(a.arguments).toEqual(b.arguments);
    expect(key(a)).not.toBe(key(b));
  });

  it('calls differing only in an inert argument are the same key', () => {
    const a = incidentCall({ id: 'c1' });
    const b = { ...incidentCall({ id: 'c2' }), arguments: { service: 'payments', format: 'csv' } };
    expect(key(a)).toBe(key(b));
  });

  it('a default composed as if sent is the same key as the value sent', () => {
    expect(key(incidentCall({ id: 'c1' }))).toBe(key(incidentCall({ id: 'c2', window: '2h' })));
  });

  it('different relative spellings of the same executed span have one key', () => {
    const twoHours = incidentCall({ id: 'c1', window: '2h' });
    const minutes = withScope(incidentCall({ id: 'c2', window: '2h' }), (items) =>
      items.map((item) => (item.facet === 'period' ? { ...item, value: '120m' } : item)),
    );
    expect(key(twoHours)).toBe(key(minutes));
  });

  it('the checking clock does not reinterpret a recorded dispatch span', () => {
    const call = incidentCall({ id: 'c1' });
    expect(key(call, CLOCK)).toBe(key(call, '2026-10-22T11:00:00Z'));
  });

  it('the same relative spelling at different dispatch instants names different searches', () => {
    const early = incidentCall({ id: 'c1', window: '2h', dispatchedAt: CLOCK });
    const late = incidentCall({ id: 'c2', window: '2h', dispatchedAt: '2026-10-22T14:00:00Z' });
    expect(key(early)).not.toBe(key(late));
    expect(scopeRelation(early, late, LIST_INCIDENTS).relation).toBe('other');
  });

  it('equivalent instant offsets have the same key', () => {
    const early = incidentCall({ id: 'c1' });
    const same = withScope(incidentCall({ id: 'c2' }), (items) =>
      items.map((item) =>
        item.facet === 'period'
          ? {
              ...item,
              span: { from: '2026-10-22T10:00:00+02:00', to: '2026-10-22T12:00:00.001+02:00' },
            }
          : item,
      ),
    );
    expect(key(early)).toBe(key(same));
    expect(scopeRelation(early, same, LIST_INCIDENTS).relation).toBe('same');
  });

  it('does not collapse sub-millisecond execution bounds', () => {
    const first = incidentCall({ id: 'c1' });
    const later = withScope(incidentCall({ id: 'c2' }), (items) =>
      items.map((item) =>
        item.facet === 'period'
          ? {
              ...item,
              span: { from: '2026-10-22T08:00:00.000001Z', to: '2026-10-22T10:00:00.001Z' },
            }
          : item,
      ),
    );
    expect(key(first)).not.toBe(key(later));
  });

  it('a different filter in effect is another search', () => {
    expect(key(incidentCall({ id: 'c1' }))).not.toBe(
      key(incidentCall({ id: 'c2', severity: 'critical' })),
    );
  });

  it('the page asked for is part of the key; the cap is not', () => {
    const base = incidentCall({ id: 'c1' });
    const capped = { ...base, arguments: { ...base.arguments, limit: 5 } };
    expect(key(capped)).toBe(key(base));
    const tool = {
      ...LIST_INCIDENTS,
      search: {
        ...LIST_INCIDENTS.search!,
        arguments: [...LIST_INCIDENTS.search!.arguments, { name: 'page', role: 'page' as const }],
      },
    };
    const page2 = { ...base, arguments: { ...base.arguments, page: 2 } };
    expect(readingKey(page2, tool, CLOCK)).not.toBe(readingKey(base, tool, CLOCK));
  });

  it('a failed call keys by the scope the funnel composed before dispatch', () => {
    expect(key(incidentCall({ id: 'c2', outcome: 'error' }))).toBe(key(incidentCall({ id: 'c1' })));
  });

  it('a call with no composed scope has no key', () => {
    expect(key(incidentCall({ id: 'c2', outcome: 'error', noScope: true }))).toBeUndefined();
  });
});

describe('the scope relation — wider, narrower, the same, or another search', () => {
  const rel = (a: TurnCall, b: TurnCall) => scopeRelation(a, b, LIST_INCIDENTS, CLOCK);

  it('`{ any }` severity is wider than `critical`, and names the narrowed field', () => {
    const relation = rel(
      incidentCall({ id: 'c2' }),
      incidentCall({ id: 'c1', severity: 'critical' }),
    );
    expect(relation).toEqual({
      relation: 'wider',
      narrowed: [{ argument: 'severity', values: ['critical'] }],
      windowNarrowed: false,
    });
  });

  it('a longer window is wider, and says the window was narrowed', () => {
    const relation = rel(incidentCall({ id: 'c2', window: '7d' }), incidentCall({ id: 'c1' }));
    expect(relation).toMatchObject({ relation: 'wider', windowNarrowed: true });
  });

  it('the reverse is narrower; equal scopes are the same', () => {
    expect(
      rel(incidentCall({ id: 'c1', severity: 'critical' }), incidentCall({ id: 'c2' })).relation,
    ).toBe('narrower');
    expect(rel(incidentCall({ id: 'c1' }), incidentCall({ id: 'c2' })).relation).toBe('same');
  });

  it('another population, or a disjoint filter, is another search', () => {
    expect(
      rel(incidentCall({ id: 'c2', service: 'checkout' }), incidentCall({ id: 'c1' })).relation,
    ).toBe('other');
    expect(
      rel(
        incidentCall({ id: 'c2', severity: 'minor' }),
        incidentCall({ id: 'c1', severity: 'critical' }),
      ).relation,
    ).toBe('other');
  });

  it('a host-filled identity that differs makes them another search', () => {
    const a = withScope(incidentCall({ id: 'c1' }), (items) => [...items, tenant('tenant')]);
    const b = withScope(incidentCall({ id: 'c2' }), (items) => [...items, tenant('org')]);
    expect(rel(a, b).relation).toBe('other');
  });
});

describe('merging the reads of one key', () => {
  const merge = (...calls: TurnCall[]) => mergeKeyReadings(calls);

  it('a later read replaces an unread outcome', () => {
    const read = incidentCall({ id: 'c2' });
    expect(merge(incidentCall({ id: 'c1', outcome: 'error' }), read)).toEqual({
      reading: read,
      disagree: false,
    });
  });

  it('a later unread outcome never replaces a read', () => {
    const read = incidentCall({ id: 'c1' });
    expect(merge(read, incidentCall({ id: 'c2', outcome: 'error' })).reading).toBe(read);
  });

  it('two reads that agree keep the first; one empty and one with rows disagree', () => {
    const first = incidentCall({ id: 'c1' });
    expect(merge(first, incidentCall({ id: 'c2' }))).toEqual({ reading: first, disagree: false });
    expect(merge(first, incidentCall({ id: 'c2', emptiness: 'non-empty', rows: 1 })).disagree).toBe(
      true,
    );
  });

  it('only unread outcomes: no reading', () => {
    expect(merge(incidentCall({ id: 'c1', outcome: 'error' })).reading).toBeUndefined();
  });
});
