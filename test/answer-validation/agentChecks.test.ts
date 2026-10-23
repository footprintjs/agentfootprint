/**
 * The agent's own checks as answer-validation rows — pure adapters and the
 * report merge. Synthetic build-job and order data; no provider, no I/O.
 */
import { describe, expect, it } from 'vitest';
import {
  AGENT_CHECK_PREFIX,
  claimChecksOf,
  evidenceCheckOf,
} from '../../src/answer-validation/agentChecks.js';
import {
  executeAnswerValidation,
  resolveAnswerValidation,
} from '../../src/answer-validation/validate.js';
import type { AnswerCheck } from '../../src/answer-validation/types.js';
import {
  unsupportedClaimsOf,
  type ClaimLedgerRow,
  type DeclaredClaim,
} from '../../src/integrity/unsupported-claim/check.js';
import { known, notApplicable, unknown } from '../../src/doors/maps.js';

const scope = { conversationId: 'synthetic-agent-checks' };
const parser = { parse: (value: unknown) => value };
const hostPass = { id: 'asked-job', disposition: 'checked-pass' as const };

const DURATION: DeclaredClaim = {
  answerField: 'durationMs',
  entity: 'build-job-72',
  field: 'durationMs',
};
const settled = (value: unknown, over: Partial<ClaimLedgerRow> = {}): ClaimLedgerRow => ({
  entity: 'build-job-72',
  field: 'durationMs',
  value,
  toolName: 'read_build',
  toolCallId: 'call-1',
  iteration: 1,
  ...over,
});

/** The matrix both properties read: values, doubts, kinds and wrappers of every shape. */
const VALUES: readonly unknown[] = [
  undefined,
  null,
  false,
  true,
  0,
  30,
  31,
  '',
  ' ',
  '30',
  ' 30 ',
  'unknown',
  'Unknown',
  'other',
  '5 MW',
  '$1,250',
  [],
  [0],
  [0, false],
  {},
  { a: 1, b: 2 },
  { b: 2, a: 1 },
  known(30, 'src'),
  known('30', 'src'),
  known(null, 'src'),
  unknown('absent'),
  notApplicable('n/a'),
  { kind: 'known', value: 30 },
  { kind: 'unknown', reason: 'r', value: 30 },
];

describe('unit: the names-and-numbers row', () => {
  const id = 'agent:names-and-numbers';
  it('a value no tool result carried fails the row, and says whether the repair turn ran', () => {
    expect(
      evidenceCheckOf({ lookedUp: 3, unsupported: 2, truncated: false, unread: 0, revised: false }),
    ).toEqual({
      id,
      disposition: 'checked-fail',
      reason: '2 value(s) the answer states appear in no tool result the run read',
    });
    expect(
      evidenceCheckOf({ lookedUp: 3, unsupported: 1, truncated: false, unread: 0, revised: true })
        .reason,
    ).toBe(
      '1 value(s) the answer states appear in no tool result the run read, after the one repair turn',
    );
  });

  it('an index past its ceiling cannot accuse: unreachable, never a failure or a pass', () => {
    expect(
      evidenceCheckOf({ lookedUp: 4, unsupported: 2, truncated: true, unread: 0, revised: false }),
    ).toMatchObject({ id, disposition: 'unreachable' });
  });

  it('a clean pass clears the answer and never verifies it: not-applicable', () => {
    expect(
      evidenceCheckOf({ lookedUp: 5, unsupported: 0, truncated: false, unread: 0, revised: false }),
    ).toEqual({
      id,
      disposition: 'not-applicable',
      reason:
        'none of the 5 value(s) looked up is unsupported; clearing the gate does not verify the answer',
    });
    // A truncated index can still CLEAR: membership in a prefix is membership.
    expect(
      evidenceCheckOf({ lookedUp: 5, unsupported: 0, truncated: true, unread: 0, revised: false })
        .disposition,
    ).toBe('not-applicable');
    expect(
      evidenceCheckOf({ lookedUp: 0, unsupported: 0, truncated: false, unread: 0, revised: false })
        .reason,
    ).toBe('the answer states no name or number to look up');
  });

  it('an answer longer than the gate reads is unreachable, naming how much went unread', () => {
    expect(
      evidenceCheckOf({
        lookedUp: 2,
        unsupported: 0,
        truncated: false,
        unread: 105,
        revised: false,
      }),
    ).toEqual({
      id,
      disposition: 'unreachable',
      reason:
        'the answer is longer than the evidence gate reads: 105 more word(s) and number(s) ' +
        'were never looked up',
    });
    // A value found unsupported in what WAS read still fails the row.
    expect(
      evidenceCheckOf({
        lookedUp: 2,
        unsupported: 1,
        truncated: false,
        unread: 105,
        revised: false,
      }).disposition,
    ).toBe('checked-fail');
  });

  it('a gate that never judged the answer is unreachable, not clean', () => {
    expect(evidenceCheckOf(undefined)).toEqual({
      id,
      disposition: 'unreachable',
      reason: 'the evidence gate did not judge this answer',
    });
  });

  it('rows are frozen', () => {
    expect(Object.isFrozen(evidenceCheckOf(undefined))).toBe(true);
  });
});

describe('unit: the claims rows', () => {
  const rowFor = (answer: unknown, ledger: readonly ClaimLedgerRow[]): AnswerCheck => {
    const rows = claimChecksOf([DURATION], ledger, answer, 1);
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };

  it.each([
    // Agreement with an unscoped fact is not verification: never a pass.
    ['agrees', { durationMs: 1250 }, [settled(1250)], 'not-applicable'],
    ['numeric string toward its number', { durationMs: '1250' }, [settled(1250)], 'not-applicable'],
    // Agreement on doubt verifies nothing: the tool established no value.
    ['null against a settled null', { durationMs: null }, [settled(null)], 'unreachable'],
    ["null against a settled 'unknown'", { durationMs: null }, [settled('unknown')], 'unreachable'],
    [
      "'unknown' against a settled 'unknown'",
      { durationMs: 'unknown' },
      [settled('unknown')],
      'unreachable',
    ],
    // …and agreeing with an absence the tool DECLARED is agreement, no more.
    [
      'null against a declared known(null)',
      { durationMs: null },
      [settled(known(null, 'no run recorded'))],
      'not-applicable',
    ],
    ['contradicts', { durationMs: 9750 }, [settled(1250)], 'checked-fail'],
    // A contradiction found against ANY reading is reported as one — whatever
    // else the run read (withheld either way; never merely "unverified").
    [
      'the run read the fact two ways; the answer contradicts the latest',
      { durationMs: 900 },
      [settled(900), settled(1250)],
      'checked-fail',
    ],
    [
      'the run read it two ways; the answer contradicts the earlier one',
      { durationMs: 1250 },
      [settled(900), settled(1250)],
      'checked-fail',
    ],
    [
      'a real contradicting reading beside a forged null',
      { durationMs: 9750 },
      [settled(1250), settled(null, { toolCallId: 'call-2' })],
      'checked-fail',
    ],
    [
      'a real contradicting reading beside an unknown one',
      { durationMs: 9750 },
      [settled(unknown('no clock')), settled(1250, { toolCallId: 'call-2' })],
      'checked-fail',
    ],
    [
      'two readings that agree are one fact',
      { durationMs: 9750 },
      [settled(1250), settled(1250, { toolName: 'read_build_again', toolCallId: 'call-2' })],
      'checked-fail',
    ],
    // Every reading counts, never the latest alone: a reading that settled
    // nothing beside one that agrees is a run that could not settle it.
    [
      'an unknown reading beside an agreeing value',
      { durationMs: 1250 },
      [settled(unknown('clock unavailable')), settled(1250)],
      'unreachable',
    ],
    [
      'a bare doubt, then a later reading that agrees',
      { durationMs: 9750 },
      [settled('unknown'), settled(9750, { toolCallId: 'call-2' })],
      'unreachable',
    ],
    [
      'a value, then a later bare doubt',
      { durationMs: 1250 },
      [settled(1250), settled('unknown', { toolCallId: 'call-2' })],
      'unreachable',
    ],
    // No reading: the claim is not checked — no more permissive than any row.
    ['no tool settled the fact', { durationMs: 9750 }, [], 'not-applicable'],
    [
      'only another entity settled',
      { durationMs: 9750 },
      [settled(1250, { entity: 'build-job-73' })],
      'not-applicable',
    ],
    [
      'settled as unknown',
      { durationMs: 9750 },
      [settled(unknown('clock unavailable'))],
      'unreachable',
    ],
    [
      'settled as not applicable',
      { durationMs: 9750 },
      [settled(notApplicable('not timed'))],
      'unreachable',
    ],
    // A value against a tool's bare doubt has nothing to agree with.
    [
      "a value against a settled 'unknown'",
      { durationMs: 9750 },
      [settled('unknown')],
      'unreachable',
    ],
    ['a value against a settled null', { durationMs: 9750 }, [settled(null)], 'unreachable'],
    // Doubt words are read after the comparison's own normalization.
    [
      "a value against a settled 'Unknown'",
      { durationMs: 9750 },
      [settled('Unknown')],
      'unreachable',
    ],
    [
      "'UNKNOWN' against a settled 'Unknown'",
      { durationMs: 'UNKNOWN' },
      [settled('Unknown')],
      'unreachable',
    ],
    [
      "'unknown' against a settled ' Unknown '",
      { durationMs: 'unknown' },
      [settled(' Unknown ')],
      'unreachable',
    ],
    ["declined with 'Unknown'", { durationMs: 'Unknown' }, [settled(1250)], 'not-applicable'],
    // A Claim wrapper of either kind is read only when well formed.
    [
      'an unknown wrapper that carries a value',
      { durationMs: { kind: 'unknown', reason: 'r', value: 9750 } },
      [settled(1250)],
      'unreachable',
    ],
    [
      'a not-applicable wrapper that carries a value',
      { durationMs: { kind: 'not-applicable', evidence: 'x', value: 9750 } },
      [settled(1250)],
      'unreachable',
    ],
    [
      'a known wrapper with no evidence',
      { durationMs: { kind: 'known', value: 1250 } },
      [settled(1250)],
      'unreachable',
    ],
    [
      'a known wrapper whose evidence is an own undefined',
      { durationMs: { kind: 'known', value: 1250, evidence: undefined } },
      [settled(1250)],
      'unreachable',
    ],
    [
      'a tool reading wrapped badly',
      { durationMs: 1250 },
      [settled({ kind: 'unknown', reason: 'r', value: 1250 })],
      'unreachable',
    ],
    // A value against an absence the tool DECLARED contradicts it.
    [
      'a value against a declared known(null)',
      { durationMs: 9750 },
      [settled(known(null, 'no run recorded'))],
      'checked-fail',
    ],
    ['field left out', {}, [settled(1250)], 'not-applicable'],
    ['declined with null', { durationMs: null }, [settled(1250)], 'not-applicable'],
    ["declined with 'unknown'", { durationMs: 'unknown' }, [settled(1250)], 'not-applicable'],
    [
      'declined while the run read the fact two ways',
      { durationMs: null },
      [settled(900), settled(1250)],
      'not-applicable',
    ],
    [
      'stated as an unknown value',
      { durationMs: unknown('declined') },
      [settled(1250)],
      'not-applicable',
    ],
    [
      'a known wrapper of the settled value',
      { durationMs: known(1250, 'answer') },
      [settled(1250)],
      'not-applicable',
    ],
  ] as const)('%s → %s', (_case, answer, ledger, disposition) => {
    const row = rowFor(answer, ledger);
    expect(row.disposition).toBe(disposition);
    expect(row.id).toBe('agent:claims:durationMs');
    expect(row.path).toBe('durationMs');
    expect(Object.isFrozen(row)).toBe(true);
  });

  it('agreement says why it is not a pass', () => {
    expect(rowFor({ durationMs: 1250 }, [settled(1250)]).reason).toBe(
      "the answer's 'durationMs' agrees with the fact 'durationMs' a tool settled, " +
        'but agreement with a fact the contract does not scope is not verification',
    );
  });

  it('a fact no tool result settled is not checked, and says so', () => {
    expect(rowFor({ durationMs: 9750 }, []).reason).toBe(
      "no tool result the run read settled the fact 'durationMs', so the answer's " +
        "'durationMs' is not checked",
    );
  });

  it('a disputed fact says the run read it two ways', () => {
    // Readings that differ while the answer contradicts neither of them.
    expect(rowFor({ durationMs: 1250 }, [settled(1250), settled('1250 ms')]).reason).toBe(
      "the tool results the run read disagree about the fact 'durationMs', so the answer's " +
        "'durationMs' cannot be checked against one of them",
    );
  });

  it('a contradiction of one reading among several says so', () => {
    expect(rowFor({ durationMs: 1250 }, [settled(900), settled(1250)]).reason).toBe(
      "the answer's 'durationMs' contradicts one tool result's reading of the fact 'durationMs' " +
        '(the readings the run made of it are not all the same)',
    );
  });

  it('one row per declared claim, in declaration order, each its own id', () => {
    const rows = claimChecksOf(
      [
        DURATION,
        { answerField: 'report.outcome', entity: 'build-job-72', field: 'outcome' },
        { answerField: 'queuedMs', entity: 'build-job-72', field: 'queuedMs' },
      ],
      [settled(1250), settled('passed', { field: 'outcome' })],
      { durationMs: 1250, report: { outcome: 'failed' } },
      1,
    );
    expect(rows.map((r) => [r.id, r.disposition])).toEqual([
      ['agent:claims:durationMs', 'not-applicable'],
      ['agent:claims:report.outcome', 'checked-fail'],
      ['agent:claims:queuedMs', 'not-applicable'],
    ]);
  });
});

describe('oracle: a claim row compares values after the declared normalization', () => {
  // Written out by hand, pair by pair — never derived from the comparator it
  // checks. Text is trimmed and case-folded; a number and a string written as
  // a plain decimal compare by value, both ways, digit for digit; a number
  // with a unit compares only with the same unit; lists item by item, objects
  // key by key. Values of kinds that cannot be compared safely are
  // `unreachable` ("could not compare"), never "contradicts". Agreement is
  // `not-applicable`: it never verifies.
  const AGREES = 'not-applicable';
  const CONTRADICTS = 'checked-fail';
  const INCOMPARABLE = 'unreachable';
  const PAIRS: readonly (readonly [string, unknown, unknown, string])[] = [
    // text: NFC, trimmed, inner spaces collapsed, a word case-folded
    ['same text', 'settled', 'settled', AGREES],
    ['case differs', 'settled', 'Settled', AGREES],
    ['trailing space', 'settled', 'settled ', AGREES],
    ['both trimmed and folded', ' SETTLED', 'settled\n', AGREES],
    ['different text', 'settled', 'pending', CONTRADICTS],
    ['inner spacing collapses', 'in progress', 'in  progress', AGREES],
    ['NFC and NFD spellings of one word', 'caf\u00e9', 'cafe\u0301', AGREES],
    ['a real case fold', 'Straße', 'STRASSE', AGREES],
    ["an id's case may matter", 'ORD-44710', 'ord-44710', INCOMPARABLE],
    ['a mixed-case token', 'aB3xZ9', 'Ab3Xz9', INCOMPARABLE],
    // Case agrees only for a plain word of more than three letters whose first
    // letter's case or whole-word case differs; any other case-only difference
    // is not compared — case can carry meaning.
    ['a whole word in capitals', 'true', 'TRUE', AGREES],
    ['a bare unit', 'MW', 'mW', INCOMPARABLE],
    ['megabits and megabytes, bare', 'Mb', 'MB', INCOMPARABLE],
    ['cobalt and carbon monoxide', 'Co', 'CO', INCOMPARABLE],
    ['a mixed-case word with no digit', 'dQwXyZaBcDe', 'DqWxYzAbCdE', INCOMPARABLE],
    ['a short word in a phrase', 'New York', 'new york', INCOMPARABLE],
    ['letters and a slash', 'N/A', 'n/a', INCOMPARABLE],
    ['a unit inside an object', { amount: 5, unit: 'MW' }, { amount: 5, unit: 'mW' }, INCOMPARABLE],
    ['a unit inside a list', [5, 'MW'], [5, 'mW'], INCOMPARABLE],
    // A full case fold without the Turkic mappings: ı stays ı, ẞ and ß are ss.
    ['dotless and dotted i', 'ılık', 'ilik', INCOMPARABLE],
    ['a Turkish capital I', 'ISPARTA', 'ısparta', INCOMPARABLE],
    ['the capital sharp s', 'STRAẞE', 'Straße', AGREES],
    ['capitals of a word with ß', 'MASSE', 'Maße', AGREES],
    ['ß and ss in one case: two words', 'Masse', 'Maße', INCOMPARABLE],
    // A dot-grouped or comma decimal may be read either way round.
    ['a dot-grouped number', '1.250', 1.25, INCOMPARABLE],
    ['a dot-grouped number with a unit', '1.250 kg', '1.25 kg', INCOMPARABLE],
    ['a decimal comma', '1,5', '1,50', INCOMPARABLE],
    ['another id', 'ORD-44710', 'ORD-44711', CONTRADICTS],
    // formatted values: a currency symbol, thousands separators, a date or a time
    ['a currency amount spelled two ways', '$1,250.00', '$1,250', INCOMPARABLE],
    ['thousands separators', '1,250', '1,250.0', INCOMPARABLE],
    ['a euro amount', '€42.50', '€42.5', INCOMPARABLE],
    ['a date and a timestamp', '2026-01-01', '2026-01-01T00:00:00Z', INCOMPARABLE],
    ['a number spelled two ways inside text', 'USD 42.50', 'USD 42.5', INCOMPARABLE],
    // numbers and decimal strings, both ways
    ['same number', 1250, 1250, AGREES],
    ['different number', 1250, 9750, CONTRADICTS],
    ['decimal string → number', '42.50', 42.5, AGREES],
    ['number → decimal string', 42.5, '42.50', AGREES],
    ['integer string → number', 1250, '1250', AGREES],
    ['number → integer string', '1250', 1250, AGREES],
    ['two decimal strings', '42.50', '42.5', AGREES],
    ['trailing zeros on the integer side', '1200.0', 1200, AGREES],
    ['padded decimal string', 1250, ' 1250 ', AGREES],
    ['a different decimal', '42.50', 42.51, CONTRADICTS],
    ['negative and positive', -5, '5', CONTRADICTS],
    ['zero and negative zero', 0, '-0', AGREES],
    // A JS number is a double: a decimal against it compares at double precision.
    ['a double cannot tell …993 from …992', '9007199254740993', 9007199254740992, AGREES],
    ['two decimal strings compare as written', '9007199254740993', '9007199254740992', CONTRADICTS],
    ['an exponent the number prints', 1e21, '1000000000000000000000', AGREES],
    // what is not a plain decimal stays text
    ['a leading zero is an id', '02139', 2139, INCOMPARABLE],
    ['a thousands separator', 1250, '1,250', INCOMPARABLE],
    ['a word against a number', 1250, 'fast', INCOMPARABLE],
    ['true against its spelling', true, 'true', INCOMPARABLE],
    ['true against one', true, 1, INCOMPARABLE],
    ['booleans that agree', false, false, AGREES],
    ['booleans that differ', true, false, CONTRADICTS],
    // units
    ['a unit against a bare number', 1250, '1250 ms', INCOMPARABLE],
    ['a bare decimal against a unit', '1250', '1250ms', INCOMPARABLE],
    ['two different units', '1250 ms', '1.25 s', INCOMPARABLE],
    ['the same unit, spaced differently', '1250 ms', '1250ms', AGREES],
    ["a unit's case is part of it", '1250 ms', '1250MS', INCOMPARABLE],
    ['megawatts are not milliwatts', '5 MW', '5 mW', INCOMPARABLE],
    ['megabits are not megabytes', '100 Mb', '100 MB', INCOMPARABLE],
    ['the same unit, decimal spelling', '42.50 USD', '42.5 USD', AGREES],
    ['the same unit, another number', '1250 ms', '1300 ms', CONTRADICTS],
    // lists and objects
    ['a list against a scalar', [1250], 1250, INCOMPARABLE],
    ['an object against a scalar', { ms: 1250 }, 1250, INCOMPARABLE],
    ['a list against an object', [1250], { 0: 1250 }, INCOMPARABLE],
    ['lists that agree after normalization', ['Settled', '42.50'], ['settled', 42.5], AGREES],
    ['lists in another order', [1, 2], [2, 1], CONTRADICTS],
    ['lists of another length', [1, 2], [1, 2, 3], CONTRADICTS],
    ['a list with one item not comparable', [1, 'x'], [1, ['x']], INCOMPARABLE],
    ['a definite difference wins over one not comparable', [1, 'x'], [2, ['x']], CONTRADICTS],
    [
      'objects that agree after normalization',
      { s: 'Settled ', n: '7' },
      { n: 7, s: 'settled' },
      AGREES,
    ],
    ['objects with another key', { a: 1 }, { b: 1 }, CONTRADICTS],
    ['objects with one value not comparable', { a: 1 }, { a: '1 ms' }, INCOMPARABLE],
    // a Claim wrapper is read at the top of a value only, and only well formed
    [
      'a wrapper nested in the answer is its data',
      { amount: 1 },
      { amount: { kind: 'known', value: 1, evidence: 'the model' } },
      INCOMPARABLE,
    ],
    [
      'a wrapper with another key',
      1250,
      { kind: 'known', value: 1250, evidence: 'x', note: 'y' },
      INCOMPARABLE,
    ],
    // a declared absence (`known(null)`) is a settled value
    ['a value against a declared absence', known(null, 'no run'), 9750, CONTRADICTS],
    ['a list against a declared absence', known(null, 'no run'), [9750], CONTRADICTS],
  ];

  it.each(PAIRS)('%s: settled %j, answered %j → %s', (_case, settledValue, answered, expected) => {
    const [row] = claimChecksOf([DURATION], [settled(settledValue)], { durationMs: answered }, 1);
    expect(row!.disposition).toBe(expected);
  });

  it('a pair that cannot be compared says so, and never "contradicts"', () => {
    const [row] = claimChecksOf([DURATION], [settled(1250)], { durationMs: '1250 ms' }, 1);
    expect(row).toMatchObject({
      disposition: 'unreachable',
      reason:
        "could not compare the answer's 'durationMs' with the fact 'durationMs' a tool " +
        'settled: they are different kinds of value (a list, an object, a number, text, or a ' +
        'number with a unit), or one is not a well-formed value',
    });
  });

  it('a dispute is read across every pair, never against the first reading alone', () => {
    // A double agrees with each decimal string at double precision, but the
    // two strings, written out, are different numbers: the run read the fact
    // two ways, whichever value the answer repeats.
    const ledger = [
      settled(9007199254740992),
      settled('9007199254740992', { toolCallId: 'call-2' }),
      settled('9007199254740993', { toolCallId: 'call-3' }),
    ];
    // The double agrees with every reading at double precision: a dispute.
    const [double] = claimChecksOf([DURATION], ledger, { durationMs: 9007199254740992 }, 1);
    expect(double!.disposition).toBe(INCOMPARABLE);
    expect(double!.reason).toMatch(/disagree about the fact 'durationMs'/);
    // A written number contradicts the other written one: a contradiction.
    for (const answered of ['9007199254740992', '9007199254740993']) {
      const [row] = claimChecksOf([DURATION], ledger, { durationMs: answered }, 1);
      expect(row!.disposition).toBe(CONTRADICTS);
    }
  });

  it('two readings that agree after normalization are one fact, not a dispute', () => {
    const ledger = [settled('42.50'), settled(42.5, { toolCallId: 'call-2' })];
    const [agreeing] = claimChecksOf([DURATION], ledger, { durationMs: '42.5' }, 1);
    const [contradicting] = claimChecksOf([DURATION], ledger, { durationMs: 43 }, 1);
    expect(agreeing!.disposition).toBe(AGREES);
    expect(contradicting!.disposition).toBe(CONTRADICTS);
    // …and readings that cannot be compared are a dispute.
    const [disputed] = claimChecksOf(
      [DURATION],
      [settled(1250), settled('1250 ms', { toolCallId: 'call-2' })],
      { durationMs: 1250 },
      1,
    );
    expect(disputed!.disposition).toBe(INCOMPARABLE);
  });
});

describe('property: a claim row never says more than the claim detector', () => {
  // The detector (`unsupportedClaimsOf`) and the row both start from
  // `compareClaim`. Over a value matrix, the row is the stricter reader: it
  // never PASSES (agreement with an unscoped fact is not verification); it
  // FAILS only where the detector, judging some reading the run made, files a
  // contradiction (a row never invents one); and where the detector could not
  // compare a fact the run did read, the row withholds.
  it('holds across every evidence × claim pair', () => {
    let cases = 0;
    for (const evidence of VALUES) {
      for (const claim of VALUES) {
        for (const ledger of [[], [settled(evidence)], [settled(999), settled(evidence)]]) {
          const answer = { durationMs: claim };
          const [row] = claimChecksOf([DURATION], ledger, answer, 0);
          const { dispositions } = unsupportedClaimsOf([DURATION], ledger, answer, 0);
          expect(row!.disposition).not.toBe('checked-pass');
          if (row!.disposition === 'checked-fail') {
            const contradicted = ledger.some((reading) =>
              unsupportedClaimsOf([DURATION], [reading], answer, 0).findings.some(
                (f) => f.advisory !== true,
              ),
            );
            expect(contradicted).toBe(true);
          }
          if (ledger.length > 0 && dispositions[0]!.disposition === 'unreachable') {
            expect(['unreachable', 'checked-fail']).toContain(row!.disposition);
          }
          cases++;
        }
      }
    }
    expect(cases).toBe(VALUES.length * VALUES.length * 3);
  });
});

describe('property: a reading can only withhold — never more permissive than its absence', () => {
  // THE law of the claims row (review: a forged or stale row must not turn a
  // withheld answer into a delivered one). Whatever the run read, ONE more
  // reading — at any position, forged, stale, doubtful or malformed — keeps or
  // adds withholding; a contradiction found stays a contradiction; and the
  // order of the readings never matters. Starting sets: none, every single
  // value, and seeded sets of two and three readings.
  const judge = (claim: unknown, values: readonly unknown[]): AnswerCheck =>
    claimChecksOf(
      [DURATION],
      values.map((value, index) => settled(value, { toolCallId: `call-${index}` })),
      { durationMs: claim },
      0,
    )[0]!;
  let seed = 20261022;
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const bases: (readonly unknown[])[] = [[], ...VALUES.map((value) => [value])];
  for (let i = 0; i < 60; i++) {
    const size = 2 + random(2);
    bases.push(Array.from({ length: size }, () => VALUES[random(VALUES.length)]));
  }

  it('adding any reading at any position never un-withholds, and never un-contradicts', () => {
    let cases = 0;
    for (const claim of VALUES) {
      for (const base of bases) {
        const before = judge(claim, base).disposition;
        for (const extra of VALUES) {
          for (let at = 0; at <= base.length; at++) {
            const after = judge(claim, [
              ...base.slice(0, at),
              extra,
              ...base.slice(at),
            ]).disposition;
            if (before !== 'not-applicable') expect(after).not.toBe('not-applicable');
            if (before === 'checked-fail') expect(after).toBe('checked-fail');
            cases++;
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(100_000);
  });

  it('the order of the readings never changes the row', () => {
    for (const claim of VALUES) {
      for (const base of bases.filter((b) => b.length > 1)) {
        expect(judge(claim, [...base].reverse())).toEqual(judge(claim, base));
      }
    }
  });

  it('with no reading the row is not-applicable, whatever the answer says', () => {
    for (const claim of VALUES) expect(judge(claim, []).disposition).toBe('not-applicable');
  });
});

describe('security: rows carry declared names and counts, never conversation values', () => {
  it('neither the answer nor the tool value appears in any reason', () => {
    const SECRET_ANSWER = 'ANSWER-VALUE-58213';
    const SECRET_FACT = 'TOOL-VALUE-77140';
    const rows = [
      ...claimChecksOf([DURATION], [settled(SECRET_FACT)], { durationMs: SECRET_ANSWER }, 1),
      ...claimChecksOf([DURATION], [], { durationMs: SECRET_ANSWER }, 1),
      ...claimChecksOf(
        [DURATION],
        [settled(unknown(SECRET_FACT))],
        { durationMs: SECRET_ANSWER },
        1,
      ),
      evidenceCheckOf({ lookedUp: 2, unsupported: 2, truncated: false, unread: 0, revised: true }),
    ];
    const text = JSON.stringify(rows);
    expect(text).not.toContain(SECRET_ANSWER);
    expect(text).not.toContain(SECRET_FACT);
    // Nor the entity: a contract may be declared per user.
    expect(text).not.toContain('build-job-72');
    expect(rows[0]!.reason).toBe(
      "the answer's 'durationMs' contradicts the fact 'durationMs' a tool settled",
    );
  });
});

describe('contract: resolving agentChecks', () => {
  const base = { id: 'build-report', version: '1', validate: () => ({ checks: [hostPass] }) };

  it('absent is an empty, frozen list — the report is your checks alone, as before', () => {
    const config = resolveAnswerValidation(base);
    expect(config.agentChecks).toEqual([]);
    expect(Object.isFrozen(config.agentChecks)).toBe(true);
  });

  it('keeps a copy of a valid list, frozen', () => {
    const list = ['names-and-numbers', 'claims'] as const;
    const config = resolveAnswerValidation({ ...base, agentChecks: list });
    expect(config.agentChecks).toEqual(['names-and-numbers', 'claims']);
    expect(config.agentChecks).not.toBe(list);
    expect(Object.isFrozen(config.agentChecks)).toBe(true);
  });

  it.each([
    ['an empty list', []],
    ['an unknown name', ['claims', 'schema']],
    ['a duplicate', ['claims', 'claims']],
    ['a non-string', [1]],
    ['a non-array', 'claims'],
    ['a decorated array', Object.setPrototypeOf(['claims'], Object.create(Array.prototype))],
    // eslint-disable-next-line no-sparse-arrays
    ['a hole', [, 'claims']],
    [
      'a getter slot',
      Object.defineProperty([] as string[], 0, { get: () => 'claims', enumerable: true }),
    ],
    ['more names than exist', ['claims', 'names-and-numbers', 'claims']],
  ])('refuses %s, naming the rule', (_case, agentChecks) => {
    expect(() => resolveAnswerValidation({ ...base, agentChecks } as never)).toThrow(
      /answerValidation\.agentChecks must list 'claims' and\/or 'names-and-numbers', each once/,
    );
  });
});

describe('functional: the report merges your checks and the agent rows under one rule', () => {
  const failRow: AnswerCheck = { id: 'agent:claims:durationMs', disposition: 'checked-fail' };
  const passRow: AnswerCheck = { id: 'agent:claims:durationMs', disposition: 'checked-pass' };
  const clearRow: AnswerCheck = { id: 'agent:names-and-numbers', disposition: 'not-applicable' };

  async function run(
    hostChecks: readonly AnswerCheck[],
    rows: ((candidate: unknown) => readonly AnswerCheck[]) | undefined,
    agentChecks: readonly ('claims' | 'names-and-numbers')[] = ['claims'],
  ) {
    const config = resolveAnswerValidation({
      id: 'build-report',
      version: '1',
      agentChecks,
      validate: () => ({ checks: hostChecks }),
    });
    return executeAnswerValidation(
      '{"durationMs":9750}',
      parser,
      config,
      undefined,
      scope,
      undefined,
      undefined,
      rows,
    );
  }

  it('a failed agent row fails the report and withholds the content in enforce', async () => {
    const result = await run([hostPass], () => [failRow]);
    expect(result.report).toMatchObject({ status: 'failed', checked: 2, failed: 1 });
    expect(result.report.checks.map((c) => c.id)).toEqual(['asked-job', 'agent:claims:durationMs']);
    expect(result.content).toBeUndefined();
  });

  it('the agent rows are built from the frozen candidate the validator receives', async () => {
    let seen: unknown;
    await run([hostPass], (candidate) => {
      seen = candidate;
      return [clearRow];
    });
    expect(seen).toEqual({ durationMs: 9750 });
    expect(Object.isFrozen(seen)).toBe(true);
  });

  it('…and its canonical JSON — the text delivered after the schema transformed the draft', async () => {
    const config = resolveAnswerValidation({
      id: 'build-report',
      version: '1',
      agentChecks: ['names-and-numbers'],
      validate: () => ({ checks: [hostPass] }),
    });
    let judged: string | undefined;
    const result = await executeAnswerValidation(
      '{"durationMs":1250}',
      { parse: (value) => ({ ...(value as object), durationMs: 9750, unit: 'ms' }) },
      config,
      undefined,
      scope,
      undefined,
      undefined,
      (_candidate, canonical) => {
        judged = canonical;
        return [clearRow];
      },
    );
    expect(judged).toBe('{"durationMs":9750,"unit":"ms"}');
    expect(result.content).toBe(judged);
  });

  it('a clean names-and-numbers row never makes a report pass on its own', async () => {
    const result = await run([], () => [clearRow], ['names-and-numbers']);
    expect(result.report).toMatchObject({
      status: 'unverified',
      reason: 'no-comparable-checks',
      checked: 0,
      notApplicable: 1,
    });
    expect(result.content).toBeUndefined();
  });

  it('an agreeing claim row never carries a report your checks left empty', async () => {
    // The real row for an answer that agrees with the fact a tool settled:
    // agreement is not verification, so only YOUR checks can pass a report.
    const result = await run([], (candidate) =>
      claimChecksOf([DURATION], [settled(9750)], candidate, 1),
    );
    expect(result.report.checks).toEqual([
      expect.objectContaining({ id: 'agent:claims:durationMs', disposition: 'not-applicable' }),
    ]);
    expect(result.report).toMatchObject({
      status: 'unverified',
      reason: 'no-comparable-checks',
      checked: 0,
    });
    expect(result.content).toBeUndefined();
  });

  it('an agent row that claims to pass is refused: unverified, never a pass', async () => {
    const result = await run([hostPass], () => [passRow]);
    expect(result.report).toMatchObject({ status: 'unverified', reason: 'agent-check-error' });
    expect(result.content).toBeUndefined();
  });

  it('a failed row outranks an unreachable one: failed, and the reason still names the unreachable rows', async () => {
    const unreachableRow: AnswerCheck = { id: 'agent:claims:queuedMs', disposition: 'unreachable' };
    const result = await run([hostPass], () => [failRow, unreachableRow]);
    expect(result.report).toMatchObject({
      status: 'failed',
      reason: 'unreachable-checks',
      checked: 2,
      failed: 1,
      unreachable: 1,
    });
    expect(result.content).toBeUndefined();
  });

  it('…your own checks too: a contradiction you found is failed, never "unverified"', async () => {
    const config = resolveAnswerValidation({
      id: 'build-report',
      version: '1',
      validate: () => ({
        checks: [
          { id: 'asked-job', disposition: 'checked-fail' },
          { id: 'region', disposition: 'unreachable' },
        ],
      }),
    });
    const result = await executeAnswerValidation('{}', parser, config, undefined, scope);
    expect(result.report).toMatchObject({
      status: 'failed',
      reason: 'unreachable-checks',
      failed: 1,
      unreachable: 1,
    });
    expect(result.content).toBeUndefined();
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('the host check broke');
      },
      'validator-error',
    ],
    ['returns no list', () => ({ checks: 'nope' }), 'invalid-validator-result'],
  ] as const)(
    "an agent row's contradiction is failed when your validator %s — it never depended on it",
    async (_case, validate, reason) => {
      const config = resolveAnswerValidation({
        id: 'build-report',
        version: '1',
        agentChecks: ['claims'],
        validate: validate as never,
      });
      const result = await executeAnswerValidation(
        '{"durationMs":9750}',
        parser,
        config,
        undefined,
        scope,
        undefined,
        undefined,
        () => [failRow],
      );
      expect(result.report).toMatchObject({ status: 'failed', reason, failed: 1 });
      expect(result.content).toBeUndefined();
    },
  );

  it('unreachable rows with no failure stay unverified', async () => {
    const unreachableRow: AnswerCheck = { id: 'agent:claims:queuedMs', disposition: 'unreachable' };
    const result = await run([hostPass], () => [unreachableRow]);
    expect(result.report).toMatchObject({ status: 'unverified', reason: 'unreachable-checks' });
  });

  it('a row builder that throws makes the report unverified, never a pass', async () => {
    const result = await run([hostPass], () => {
      throw new Error('a ledger value JSON cannot render');
    });
    expect(result.report).toMatchObject({ status: 'unverified', reason: 'agent-check-error' });
    expect(result.content).toBeUndefined();
  });

  it('a listed check with no row builder is unverified, never a silent pass', async () => {
    const result = await run([hostPass], undefined);
    expect(result.report).toMatchObject({ status: 'unverified', reason: 'agent-check-error' });
  });

  it("a host check id under 'agent:' is refused while agent rows are on", async () => {
    const result = await run(
      [{ id: `${AGENT_CHECK_PREFIX}claims:durationMs`, disposition: 'checked-pass' }],
      () => [failRow],
    );
    // The impersonating id is refused: none of your checks counts.
    expect(result.report).toMatchObject({ reason: 'invalid-validator-result', checked: 1 });
    // The agent's own row still says what it found — and its contradiction
    // does not depend on your validator, so the report is failed.
    expect(result.report.checks).toEqual([failRow]);
    expect(result.report.status).toBe('failed');
  });

  it('…and an impersonating PASS beside a clean agent row passes nothing', async () => {
    const result = await run(
      [{ id: `${AGENT_CHECK_PREFIX}claims:durationMs`, disposition: 'checked-pass' }],
      () => [clearRow],
    );
    expect(result.report).toMatchObject({
      status: 'unverified',
      reason: 'invalid-validator-result',
      checked: 0,
    });
    expect(result.content).toBeUndefined();
  });

  it('…and allowed when no agent check is listed (no row can collide)', async () => {
    const config = resolveAnswerValidation({
      id: 'build-report',
      version: '1',
      validate: () => ({ checks: [{ id: 'agent:own', disposition: 'checked-pass' }] }),
    });
    const result = await executeAnswerValidation('{}', parser, config, undefined, scope);
    expect(result.report.status).toBe('passed');
  });

  it('observe records a failed agent row and still delivers', async () => {
    const config = resolveAnswerValidation({
      id: 'build-report',
      version: '1',
      mode: 'observe',
      agentChecks: ['claims'],
      validate: () => ({ checks: [hostPass] }),
    });
    const result = await executeAnswerValidation(
      '{"durationMs":9750}',
      parser,
      config,
      undefined,
      scope,
      undefined,
      undefined,
      () => [failRow],
    );
    expect(result.report.status).toBe('failed');
    expect(result.content).toBe('{"durationMs":9750}');
  });
});
