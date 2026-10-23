/** The real count-only `among` producer's gaps must survive the prose checker. */
import { describe, expect, it } from 'vitest';

import { absent } from '../../../src/semantics/coverage/absent.js';
import { judgeTypedNegatives } from '../../../src/integrity/negative-claim/judge.js';
import { judgeProseNegatives } from '../../../src/integrity/negative-claim/prose.js';
import type { TurnCall } from '../../../src/integrity/negative-claim/types.js';
import { amongCall, CLOCK, turnRecord } from './fixtures.js';

describe('a source-scoped absence over a partial inventory', () => {
  it.each([false, true])('keeps completeness relevant when partial=%s', (partial) => {
    const name = 'ARRAY-X9';
    const source = 'the array inventory export';
    const sentinel = 'SYNTHETIC-NAME-NEVER-SERVED';
    const result = absent({
      what: name,
      among: {
        argument: 'array_id',
        source,
        measuredAt: CLOCK,
        count: 1,
        names: [sentinel],
        partial,
      },
    });
    const base = amongCall({ name });
    const row = base.row;
    if (row === undefined) throw new Error('The synthetic inventory fixture needs a row.');
    const call: TurnCall = {
      ...base,
      row: {
        ...row,
        complete: !partial,
        checked: [
          ...row.checked
            .filter((item) => item.facet !== 'names')
            .map((item) =>
              item.facet === 'population' ? { ...item, resolved: { id: name, name } } : item,
            ),
          ...result.checked.map((item) => ({
            ...item,
            facet: 'names' as const,
            from: 'result' as const,
          })),
        ],
        notChecked: result.not_checked ?? [],
        gaps: (result.not_checked ?? []).map((gap) => {
          if (gap.kind !== 'scope' || (gap.bears !== 'source' && gap.bears !== 'completeness'))
            throw new Error('The inventory producer changed its scope gap contract.');
          return { kind: gap.kind, what: gap.what, bears: gap.bears };
        }),
      },
    };
    const record = turnRecord([call]);
    const prose = judgeProseNegatives({
      field: 'summary',
      text: `The array ${name} is not in the inventory export.`,
      record,
    });
    expect(prose).toHaveLength(1);
    expect(prose[0]).toMatchObject({
      kind: 'negative-claim',
      phraseId: 'none.is-not-in',
      notes: partial ? ['coverage-gap'] : [],
    });

    // The typed door describes the actual search and retains its caveat. The prose note
    // must not turn into a different typed verdict or a served inventory-name list.
    const [typed] = judgeTypedNegatives({
      field: 'negatives',
      negatives: [{ kind: 'not-found', restsOn: ['r4'], about: name }],
      record,
    });
    expect(typed?.row.code).toBe('established');
    if (partial) expect(typed?.statement?.text).toContain(`not every name in ${source} was read`);
    expect(JSON.stringify({ result, prose, typed })).not.toContain(sentinel);
  });
});
