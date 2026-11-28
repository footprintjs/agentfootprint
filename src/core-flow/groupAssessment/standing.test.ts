import { describe, expect, it } from 'vitest';
import { reduceGroupStanding } from './standing.js';

const known = { standing: 'known', coverage: 'complete' } as const;

describe('group standing and coverage', () => {
  it('carries an authorized nested ask and incomplete coverage without witness data', () => {
    const inner = reduceGroupStanding([{ standing: 'ask', coverage: 'complete' }], true);
    expect(inner).toEqual({ standing: 'ask', coverage: 'incomplete' });

    const outer = reduceGroupStanding([inner, known]);
    expect(outer).toEqual({ standing: 'ask', coverage: 'incomplete' });
    expect(reduceGroupStanding([known, outer])).toEqual(outer);
  });

  it('keeps incomplete coverage when policy withholds the nested standing', () => {
    const outer = reduceGroupStanding([{ coverage: 'incomplete' }, known]);
    expect(outer).toEqual({ standing: 'not-assessed', coverage: 'incomplete' });
  });

  it('keeps a gap when a proof is unavailable despite a complete direct settlement', () => {
    expect(reduceGroupStanding([known, { coverage: 'complete' }])).toEqual({
      standing: 'not-assessed',
      coverage: 'incomplete',
    });
  });

  it('reports a fresh prefix gap even when every available member is known', () => {
    expect(reduceGroupStanding([known, known], true)).toEqual({
      standing: 'not-assessed',
      coverage: 'incomplete',
    });
  });

  it('allows an authorized not-sure to survive a scope gap', () => {
    expect(
      reduceGroupStanding([known, { standing: 'not-sure', coverage: 'complete' }], true),
    ).toEqual({
      standing: 'not-sure',
      coverage: 'incomplete',
    });
  });

  it('keeps a fully assessed nested group complete regardless of settlement order', () => {
    const inner = reduceGroupStanding([known, { standing: 'consistent', coverage: 'complete' }]);
    expect(inner).toEqual({ standing: 'consistent', coverage: 'complete' });
    expect(reduceGroupStanding([known, inner])).toEqual(inner);
    expect(reduceGroupStanding([inner, known])).toEqual(inner);
  });

  it('reports no available member assessment as incomplete', () => {
    const unassessed = { standing: 'not-assessed', coverage: 'incomplete' };
    expect(reduceGroupStanding([])).toEqual(unassessed);
    expect(reduceGroupStanding([{ standing: 'not-assessed', coverage: 'complete' }])).toEqual(
      unassessed,
    );
  });
});
