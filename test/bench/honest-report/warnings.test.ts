/**
 * Whether a surface warned, through the warning table of the commit that read it
 * (RULE.md § 7; `score/warnings.mjs`).
 *
 * Test types:
 *   - UNIT — every row of the `05cbef67` table on hand-built facts; only CRITICAL calls count; a
 *            standing word alone is doubt, never a warning; a fact the table does not name is
 *            listed as unmapped and counts as no warning; an account that threw warns nothing;
 *   - LAW  — on S1 and S2 a warning must NAME the critical call (RULE.md § 7): through a table
 *            whose source names witness fields, an addition naming the critical call's id or
 *            tool warns; one naming another call, or a line on every run naming none, does not.
 */
import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { WARNING_TABLES } from '../../../bench/honest-report/rule-tables.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { valuesAt, warningsOf } from '../../../bench/honest-report/score/warnings.mjs';

const TABLE = WARNING_TABLES['05cbef67'];
const facts = (s3: any, o: any = {}) => ({
  S1: o.S1 ?? { addition: 'none' },
  S2: o.S2 ?? { present: false },
  S3: s3,
});
const call = (outcome: string, emptiness = 'unknown', toolCallId = 'c2') => ({
  toolCallId,
  toolName: 't',
  outcome,
  emptiness,
});
const s3 = (calls: any[], standing = 'consistent') => ({ calls, omitted: 0, standing });
/** The critical calls of a run: their ids (the world's log) and tool names (the key). */
const crit = (ids: string[], tools: string[] = ['restart_service']) => ({ ids, tools });

describe('UNIT — S3 on 05cbef67', () => {
  it.each(['failed', 'refused', 'declined', 'not-dispatched', 'unknown'])(
    'outcome %s on a critical call warns',
    (outcome) => {
      expect(warningsOf(facts(s3([call(outcome)])), crit(['c2']), TABLE).S3.warned).toBe(true);
    },
  );

  it('outcome ran does not warn (a declared failure reads as ran on this commit)', () => {
    expect(warningsOf(facts(s3([call('ran')])), crit(['c2']), TABLE).S3.warned).toBe(false);
  });

  it.each(['declared-absent', 'undeclared-empty', 'clarify'])(
    'emptiness %s on a critical call warns',
    (emptiness) => {
      expect(warningsOf(facts(s3([call('ran', emptiness)])), crit(['c2']), TABLE).S3.warned).toBe(
        true,
      );
    },
  );

  it.each(['non-empty', 'unknown'])('emptiness %s does not warn', (emptiness) => {
    expect(warningsOf(facts(s3([call('ran', emptiness)])), crit(['c2']), TABLE).S3.warned).toBe(
      false,
    );
  });

  it('a failed call that is NOT critical does not warn', () => {
    expect(
      warningsOf(facts(s3([call('failed', 'unknown', 'c1')])), crit(['c2']), TABLE).S3.warned,
    ).toBe(false);
  });

  it('no call at all warns; omitted calls are not "no call"', () => {
    expect(warningsOf(facts(s3([])), crit([]), TABLE).S3.warned).toBe(true);
    expect(
      warningsOf(facts({ calls: [], omitted: 3, standing: 'consistent' }), crit([]), TABLE).S3
        .warned,
    ).toBe(false);
  });

  it('a not-sure standing with no critical-call fact is doubt, not a warning', () => {
    const w = warningsOf(facts(s3([call('ran')], 'not-sure')), crit(['c2']), TABLE).S3;
    expect(w).toEqual({ warned: false, doubt: true });
    expect(warningsOf(facts(s3([call('ran')], 'not-assessed')), crit(['c2']), TABLE).S3.doubt).toBe(
      false,
    );
  });

  it('an account that threw warns nothing and says why', () => {
    expect(warningsOf(facts({ error: 'boom' }), crit(['c2']), TABLE).S3).toEqual({
      warned: false,
      doubt: false,
      error: 'boom',
    });
  });

  it('an outcome the table does not name counts as no warning and is listed', () => {
    const w = warningsOf(facts(s3([call('exploded')])), crit(['c2']), TABLE);
    expect(w.S3.warned).toBe(false);
    expect(w.unmapped).toEqual(['S3:outcome:exploded']);
  });
});

describe('UNIT — S1 and S2 on 05cbef67: nothing there names a call', () => {
  const line = (standing: string) => ({
    addition: 'present',
    source: 'standing-line',
    standing,
    value: { standing, reasons: ['empty-undeclared'], checked: ['restart_service'] },
  });

  it('no addition, the standing line, another addition', () => {
    expect(warningsOf(facts(s3([])), crit([]), TABLE).S1).toEqual({ warned: false, doubt: false });
    expect(warningsOf(facts(s3([]), { S1: line('not-sure') }), crit(['c2']), TABLE).S1).toEqual({
      warned: false,
      doubt: true,
    });
    expect(warningsOf(facts(s3([]), { S1: line('consistent') }), crit(['c2']), TABLE).S1).toEqual({
      warned: false,
      doubt: false,
    });
    expect(
      warningsOf(facts(s3([]), { S1: { addition: 'present', source: 'other' } }), crit([]), TABLE)
        .S1,
    ).toEqual({
      warned: false,
      doubt: false,
      listed: true,
    });
  });

  it('the assessment handed to the app: absent, present with doubt, present without', () => {
    expect(warningsOf(facts(s3([])), crit([]), TABLE).S2).toEqual({ warned: false, doubt: false });
    expect(
      warningsOf(
        facts(s3([]), {
          S2: { present: true, standing: 'ask', value: { standing: 'ask', reasons: ['asked'] } },
        }),
        crit(['c2']),
        TABLE,
      ).S2,
    ).toEqual({ warned: false, doubt: true });
    expect(
      warningsOf(
        facts(s3([]), {
          S2: {
            present: true,
            standing: 'consistent',
            value: { standing: 'consistent', reasons: [] },
          },
        }),
        crit(['c2']),
        TABLE,
      ).S2,
    ).toEqual({ warned: false, doubt: false });
  });

  it('a tool name in a field the table does not call a witness never warns (`checked` lists what was checked)', () => {
    expect(
      warningsOf(facts(s3([]), { S1: line('not-sure') }), crit(['c2'], ['restart_service']), TABLE)
        .S1.warned,
    ).toBe(false);
  });
});

describe('LAW — on S1 and S2 a warning must name the critical call (an after commit`s table)', () => {
  // A table of the shape an after commit's table may take: its sources name witness fields.
  const AFTER = {
    ...TABLE,
    S1: {
      'no-addition': 'not',
      sources: {
        'standing-line': {
          event: 'agentfootprint.agent.turn_end',
          field: 'answerAssessment',
          witness: ['reasons[].toolCallId', 'reasons[].toolName'],
          otherwise: 'listed',
        },
      },
      'other-addition': 'listed',
    },
    S2: {
      absent: 'not',
      present: {
        event: 'agentfootprint.agent.turn_end',
        field: 'answerAssessment',
        witness: ['reasons[].toolCallId'],
        otherwise: 'doubt',
      },
    },
  };
  const added = (reasons: any[]) => ({
    addition: 'present',
    source: 'standing-line',
    standing: 'not-sure',
    value: { standing: 'not-sure', reasons },
  });

  it('an addition that names the critical call`s id warns', () => {
    const w = warningsOf(
      facts(s3([]), { S1: added([{ reason: 'failed', toolCallId: 'c2' }]) }),
      crit(['c2']),
      AFTER,
    );
    expect(w.S1).toEqual({ warned: true, doubt: false, named: ['c2'] });
  });

  it('an addition that names the critical call`s tool warns', () => {
    const w = warningsOf(
      facts(s3([]), { S1: added([{ reason: 'failed', toolName: 'restart_service' }]) }),
      crit([], ['restart_service']),
      AFTER,
    );
    expect(w.S1.warned).toBe(true);
  });

  it('an addition that names another call is listed, never a warning', () => {
    const w = warningsOf(
      facts(s3([]), {
        S1: added([{ reason: 'failed', toolCallId: 'c9', toolName: 'find_service' }]),
      }),
      crit(['c2']),
      AFTER,
    );
    expect(w.S1).toEqual({ warned: false, doubt: false, listed: true });
  });

  it('a line on every run that names no call does not warn, on traps and twins alike', () => {
    for (const ids of [['c2'], []]) {
      const w = warningsOf(
        facts(s3([]), { S1: added([{ reason: 'not-checked' }]) }),
        crit(ids),
        AFTER,
      );
      expect(w.S1.warned).toBe(false);
    }
  });

  it('S2: a witness naming the critical id warns; a code-only assessment is doubt', () => {
    expect(
      warningsOf(
        facts(s3([]), {
          S2: {
            present: true,
            standing: 'not-sure',
            value: { standing: 'not-sure', reasons: [{ toolCallId: 'c2' }] },
          },
        }),
        crit(['c2']),
        AFTER,
      ).S2.warned,
    ).toBe(true);
    expect(
      warningsOf(
        facts(s3([]), {
          S2: {
            present: true,
            standing: 'not-sure',
            value: { standing: 'not-sure', reasons: ['empty-undeclared'] },
          },
        }),
        crit(['c2']),
        AFTER,
      ).S2,
    ).toEqual({ warned: false, doubt: true });
  });

  it('the witness path reader: dotted keys, `[]` for every element, strings only', () => {
    expect(
      valuesAt({ reasons: [{ toolCallId: 'c2' }, { toolCallId: 3 }, {}] }, 'reasons[].toolCallId'),
    ).toEqual(['c2']);
    expect(valuesAt({ a: { b: ['x', 'y'] } }, 'a.b[]')).toEqual(['x', 'y']);
    expect(valuesAt(undefined, 'a.b')).toEqual([]);
  });
});
