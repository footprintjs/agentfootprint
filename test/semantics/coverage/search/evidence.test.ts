/**
 * What a COMPOSED absence may ground. A composed `value` quotes the call — the
 * `looked_for` rule, applied to one field kind — so an item the call sent
 * never grounds its own value (a failed lookup must not launder an invented
 * identifier). Constants and result facts ground.
 *
 * Sections: Security · Regression.
 */

import { describe, expect, it } from 'vitest';

import { absent, coverage } from '../../../../src/index.js';
import { absenceEvidenceProjection } from '../../../../src/semantics/coverage/evidence.js';
import { composeSearchCoverage } from '../../../../src/semantics/coverage/search/compose.js';
import type { ToolSearch } from '../../../../src/semantics/coverage/search/types.js';

const INVENTED = 'SHPRSTPRNCL003';

const SEARCH: ToolSearch = {
  source: { what: 'the incident store', said: ['the incident store'] },
  subject: { what: 'incidents', said: ['incidents'] },
  fixed: [{ name: 'status', value: 'open', said: ['open'] }],
  arguments: [
    { name: 'service', role: 'population' },
    { name: 'window', role: 'period', whenOmitted: '2h' },
  ],
  complete: 'within-arguments',
};

const served = (result: unknown): unknown => {
  const out = composeSearchCoverage(
    {
      toolName: 't',
      toolCallId: 'c1',
      iteration: 1,
      resultId: 'claim-result/ns/r/1',
      search: SEARCH,
      origin: 'local',
      args: { service: INVENTED },
    },
    result,
  );
  if (out?.outcome !== 'composed') throw new Error('not composed');
  // What reaches history is JSON; the projection reads it parsed.
  return JSON.parse(JSON.stringify(out.value));
};

const leaves = (value: unknown): string[] => {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(value);
  return out;
};

/** What the evidence index walks: the projection, or — when it has none — the value whole. */
const grounds = (value: unknown): string[] => leaves(absenceEvidenceProjection(value) ?? value);

describe('composed evidence — security', () => {
  it('a sent value never grounds — not as value, not inside its what', () => {
    const grounded = grounds(
      served(absent({ what: `incidents on ${INVENTED}`, checked: 'declared' })),
    );
    expect(grounded.some((l) => l.includes(INVENTED))).toBe(false);
  });

  it('constants and defaults ground', () => {
    const grounded = grounds(served(absent({ what: 'x', checked: 'declared' })));
    expect(grounded).toContain('the incident store');
    expect(grounded).toContain('status: open');
    expect(grounded).toContain('window: 2h');
  });

  it('a composed ledger withholds the sent value too', () => {
    const grounded = grounds(served(coverage([], { checked: 'declared' })));
    expect(grounded.some((l) => l.includes(INVENTED))).toBe(false);
  });
});

describe('composed evidence — regression', () => {
  it('a hand-written absence projects as before', () => {
    const value = JSON.parse(JSON.stringify(absent({ what: 'x', checked: ['the store'] })));
    expect(absenceEvidenceProjection(value)).toEqual(
      Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'looked_for')),
    );
  });
});
