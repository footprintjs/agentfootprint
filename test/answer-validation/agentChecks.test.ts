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

describe('unit: the names-and-numbers row', () => {
  const id = 'agent:names-and-numbers';
  it('a value no tool result carried fails the row, and says whether the repair turn ran', () => {
    expect(
      evidenceCheckOf({ lookedUp: 3, unsupported: 2, truncated: false, revised: false }),
    ).toEqual({
      id,
      disposition: 'checked-fail',
      reason: '2 value(s) the answer states appear in no tool result the run read',
    });
    expect(
      evidenceCheckOf({ lookedUp: 3, unsupported: 1, truncated: false, revised: true }).reason,
    ).toBe(
      '1 value(s) the answer states appear in no tool result the run read, after the one repair turn',
    );
  });

  it('an index past its ceiling cannot accuse: unreachable, never a failure or a pass', () => {
    expect(
      evidenceCheckOf({ lookedUp: 4, unsupported: 2, truncated: true, revised: false }),
    ).toMatchObject({ id, disposition: 'unreachable' });
  });

  it('a clean pass clears the answer and never verifies it: not-applicable', () => {
    expect(
      evidenceCheckOf({ lookedUp: 5, unsupported: 0, truncated: false, revised: false }),
    ).toEqual({
      id,
      disposition: 'not-applicable',
      reason:
        'none of the 5 value(s) looked up is unsupported; clearing the gate does not verify the answer',
    });
    // A truncated index can still CLEAR: membership in a prefix is membership.
    expect(
      evidenceCheckOf({ lookedUp: 5, unsupported: 0, truncated: true, revised: false }).disposition,
    ).toBe('not-applicable');
    expect(
      evidenceCheckOf({ lookedUp: 0, unsupported: 0, truncated: false, revised: false }).reason,
    ).toBe('the answer states no name or number to look up');
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
    ['agrees', { durationMs: 1250 }, [settled(1250)], 'checked-pass'],
    ['numeric string toward its number', { durationMs: '1250' }, [settled(1250)], 'checked-pass'],
    // Agreement on doubt verifies nothing: the tool established no value.
    ['null against a settled null', { durationMs: null }, [settled(null)], 'unreachable'],
    ["null against a settled 'unknown'", { durationMs: null }, [settled('unknown')], 'unreachable'],
    [
      "'unknown' against a settled 'unknown'",
      { durationMs: 'unknown' },
      [settled('unknown')],
      'unreachable',
    ],
    // …but an absence the tool DECLARED (`known(null)`) is established.
    [
      'null against a declared known(null)',
      { durationMs: null },
      [settled(known(null, 'no run recorded'))],
      'checked-pass',
    ],
    ['contradicts', { durationMs: 9750 }, [settled(1250)], 'checked-fail'],
    [
      'contradicts the LATEST row',
      { durationMs: 900 },
      [settled(900), settled(1250)],
      'checked-fail',
    ],
    [
      'agrees with the latest, not an earlier row',
      { durationMs: 1250 },
      [settled(900), settled(1250)],
      'checked-pass',
    ],
    ['no tool settled the fact', { durationMs: 9750 }, [], 'unreachable'],
    [
      'only another entity settled',
      { durationMs: 9750 },
      [settled(1250, { entity: 'build-job-73' })],
      'unreachable',
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
    ['field left out', {}, [settled(1250)], 'not-applicable'],
    ['declined with null', { durationMs: null }, [settled(1250)], 'not-applicable'],
    ["declined with 'unknown'", { durationMs: 'unknown' }, [settled(1250)], 'not-applicable'],
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
      'checked-pass',
    ],
  ] as const)('%s → %s', (_case, answer, ledger, disposition) => {
    const row = rowFor(answer, ledger);
    expect(row.disposition).toBe(disposition);
    expect(row.id).toBe('agent:claims:durationMs');
    expect(row.path).toBe('durationMs');
    expect(Object.isFrozen(row)).toBe(true);
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
      ['agent:claims:durationMs', 'checked-pass'],
      ['agent:claims:report.outcome', 'checked-fail'],
      ['agent:claims:queuedMs', 'not-applicable'],
    ]);
  });
});

describe('property: a claim row and the claim detector never compare differently', () => {
  // The detector (`unsupportedClaimsOf`) and the row both derive from
  // `compareClaim`. Over a value matrix: the row FAILS exactly when the
  // detector files a non-advisory finding, and is UNREACHABLE exactly when the
  // detector says unreachable — a row can neither hide a contradiction the
  // detector reports nor invent one it does not.
  const values: readonly unknown[] = [
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
    'other',
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
  ];
  it('agrees across every evidence × claim pair', () => {
    let cases = 0;
    for (const evidence of values) {
      for (const claim of values) {
        for (const ledger of [[], [settled(evidence)], [settled(999), settled(evidence)]]) {
          const answer = { durationMs: claim };
          const [row] = claimChecksOf([DURATION], ledger, answer, 0);
          const { findings, dispositions } = unsupportedClaimsOf([DURATION], ledger, answer, 0);
          const contradiction = findings.some((f) => f.advisory !== true);
          expect(row!.disposition === 'checked-fail').toBe(contradiction);
          expect(row!.disposition === 'unreachable').toBe(
            dispositions[0]!.disposition === 'unreachable',
          );
          // A pass is never filed where the detector found a contradiction.
          if (row!.disposition === 'checked-pass') expect(contradiction).toBe(false);
          cases++;
        }
      }
    }
    expect(cases).toBe(values.length * values.length * 3);
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
      evidenceCheckOf({ lookedUp: 2, unsupported: 2, truncated: false, revised: true }),
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
      return [passRow];
    });
    expect(seen).toEqual({ durationMs: 9750 });
    expect(Object.isFrozen(seen)).toBe(true);
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

  it('a passing claim row is a comparison: it can carry a report your checks left empty', async () => {
    const result = await run([], () => [passRow]);
    expect(result.report).toMatchObject({ status: 'passed', checked: 1 });
    expect(result.content).toBe('{"durationMs":9750}');
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
    expect(result.report).toMatchObject({
      status: 'unverified',
      reason: 'invalid-validator-result',
    });
    // The agent's own row still says what it found.
    expect(result.report.checks).toEqual([failRow]);
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
