/**
 * What a `search` tool's composed coverage puts on an EVENT — references, never
 * values, in every mode. The values live on the committed row, under the run's
 * redaction policy; `lookedFor` stays the tool's own bytes while the arm is
 * off and becomes a reference under it.
 *
 * Sections: Unit · Security.
 */

import { describe, expect, it } from 'vitest';

import { absent, describedResult } from '../../../../src/index.js';
import { composeSearchCoverage } from '../../../../src/semantics/coverage/search/compose.js';
import { composedEventFields } from '../../../../src/semantics/coverage/search/events.js';
import type { ToolSearch } from '../../../../src/semantics/coverage/search/types.js';

const SECRET = 'payments-7f3a';
const RESULT_ID = 'claim-result/ns/run-1/1';

const SEARCH: ToolSearch = {
  source: { what: 'the incident store', said: ['the incident store'] },
  subject: { what: 'incidents', said: ['incidents'] },
  fixed: [{ name: 'status', value: 'open', said: ['open'] }],
  arguments: [
    { name: 'service', role: 'population' },
    { name: 'severity', role: 'filter', whenOmitted: { any: true } },
    { name: 'window', role: 'period', whenOmitted: '2h' },
    { name: 'tenantId', role: 'filter' },
  ],
  complete: 'within-arguments',
};

const factsOf = (result: unknown) => {
  const out = composeSearchCoverage(
    {
      toolName: 'list_incidents',
      toolCallId: 'c1',
      iteration: 1,
      resultId: RESULT_ID,
      handle: 'r1',
      search: SEARCH,
      origin: 'local',
      args: { service: SECRET, severity: 'sev1-secret' },
      hostFilled: { identity: { tenantId: 'tenant' }, credential: [] },
    },
    result,
  );
  if (out?.outcome !== 'composed') throw new Error('not composed');
  const facts = out.reading.declared[0];
  if (facts === undefined) throw new Error('no facts');
  return facts;
};

const NONE = absent({ what: `open incidents on ${SECRET}`, checked: 'declared' });

describe('composed events — unit', () => {
  it('checked holds the declaration’s constants; every other facet rides by reference', () => {
    const fields = composedEventFields(factsOf(NONE), { armed: false });
    expect(fields.checked).toEqual([
      { what: 'the incident store' },
      { what: 'incidents' },
      { what: 'status: open' },
    ]);
    expect(fields.composition.facets).toEqual([
      { facet: 'population', from: 'call', ref: { resultId: RESULT_ID, argument: 'service' } },
      { facet: 'filter', from: 'call', ref: { resultId: RESULT_ID, argument: 'severity' } },
      { facet: 'period', from: 'default', ref: { resultId: RESULT_ID, argument: 'window' } },
      { facet: 'filter', from: 'host', ref: { resultId: RESULT_ID, argument: 'tenantId' } },
    ]);
    expect(fields.composition).toMatchObject({
      origin: 'local',
      resultId: RESULT_ID,
      complete: true,
    });
  });

  it('unarmed, lookedFor is the tool’s own bytes; armed, a reference to the row', () => {
    expect(composedEventFields(factsOf(NONE), { armed: false }).lookedFor).toBe(
      `open incidents on ${SECRET}`,
    );
    const armed = composedEventFields(factsOf(NONE), { armed: true });
    expect(armed.lookedFor).toBeUndefined();
    expect(armed.lookedForRef).toEqual({ resultId: RESULT_ID, field: 'lookedFor' });
  });
});

describe('composed events — security: composed values ride no event, in any mode', () => {
  it.each([false, true])('armed %s: no sent value appears anywhere but lookedFor', (armed) => {
    const fields = composedEventFields(factsOf(NONE), { armed });
    const { lookedFor: _, ...rest } = fields;
    const bytes = JSON.stringify(rest);
    expect(bytes).not.toContain(SECRET);
    expect(bytes).not.toContain('sev1-secret');
    expect(bytes).not.toContain('2h');
  });

  it('a described result’s event carries no row value either', () => {
    const rows = describedResult({
      facts: [{ entity: 'INC-1' }],
      provenance: { measuredAt: '2026-10-22T10:00:00Z', source: 'the incident store' },
    });
    const bytes = JSON.stringify(composedEventFields(factsOf(rows), { armed: false }));
    expect(bytes).not.toContain(SECRET);
  });
});
