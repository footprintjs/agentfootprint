import { describe, expect, it } from 'vitest';
import {
  renderNegativeCandidate,
  reportWithNegatives,
} from '../../../src/core/agent/negativeClaims/delivery.js';
import type { TurnCall, TurnRecord } from '../../../src/integrity/negative-claim/types.js';
import type { AnswerValidationReport } from '../../../src/answer-validation/types.js';
import { quoteValue } from '../../../src/integrity/negative-claim/statement.js';
import { CLOCK, incidentCall, turnRecord } from '../../integrity/negative-claim/fixtures.js';

const config = {
  field: 'negatives',
  tools: ['list_incidents'],
  unestablished: 'state-searched',
} as const;
const candidate = (about: string | number = 'payments', extra = {}) => ({
  ...extra,
  negatives: [{ kind: 'none', about, restsOn: ['r1'] }],
});
const render = (
  calls: readonly TurnCall[],
  options: {
    value?: unknown;
    record?: Partial<TurnRecord>;
    trusted?: (call: TurnCall) => boolean;
  } = {},
) =>
  renderNegativeCandidate(
    options.value ?? candidate(),
    config,
    { ...turnRecord(calls), ...options.record },
    options.trusted ?? (() => true),
  );

describe('delivered negative statements explain the actual failure', () => {
  it('includes the later positive read instead of describing only the old empty result', () => {
    const result = render([
      incidentCall(),
      incidentCall({ id: 'c2', emptiness: 'non-empty', rows: 1 }),
    ]);
    expect(result.answer.checks[0]?.code).toBe('contradicted-by-rows');
    expect(result.answer.claims[0]?.statement).toContain('recorded rows contradict');
    expect(result.answer.claims[0]?.statement).toContain('read 1 row');
    expect(result.answer.claims[0]?.statement).toContain('incidents filed by email');
    expect(result.answer.claims[0]?.restsOn).toEqual(['r1', 'r2']);
    expect(result.answer.checks[0]?.results).toHaveLength(2);
    expect(result.answer.delivery).toBe('recorded');
  });

  it('states the failed reread rather than just repeating that the earlier result was empty', () => {
    const result = render([incidentCall(), incidentCall({ id: 'c2', outcome: 'error' })]);
    expect(result.answer.checks[0]?.code).toBe('later-read-failed');
    expect(result.answer.claims[0]?.statement).toContain(
      'later attempt to repeat this search failed',
    );
  });

  it('states that a subsequent write invalidated the read without claiming that write succeeded', () => {
    const result = render([
      incidentCall(),
      incidentCall({ id: 'c2', effect: 'not-read', outcome: 'error', service: 'another' }),
    ]);
    expect(result.answer.checks[0]?.code).toBe('superseded-by-write');
    expect(result.answer.claims[0]?.statement).toContain(
      'a call that may change the data was dispatched',
    );
    expect(result.answer.claims[0]?.statement).not.toContain('write succeeded');
  });

  it('dates a safely retained earlier-turn read and says it was not re-read', () => {
    const result = render([incidentCall({ turn: 1, readAt: CLOCK })], { record: { turn: 2 } });
    expect(result.answer.checks[0]?.code).toBe('stale-turn');
    expect(result.answer.claims[0]?.statement).toContain('read on turn 1');
    expect(result.answer.claims[0]?.statement).toContain('2026-10-22T10:00:00.000Z');
    expect(result.answer.claims[0]?.statement).toContain('not re-read');
    expect(result.answer.claims[0]?.statement).not.toContain('found none');
  });

  it('dates retained metadata without exposing an untrusted stale scope', () => {
    const result = render([incidentCall({ turn: 1, readAt: CLOCK, service: 'private-service' })], {
      value: candidate('private-service'),
      record: { turn: 2 },
      trusted: () => false,
    });
    expect(result.answer.checks[0]?.code).toBe('stale-turn');
    expect(result.answer.claims[0]?.statement).toContain('read on turn 1');
    expect(result.answer.claims[0]?.statement).not.toContain('private-service');
    expect(result.answer.claims[0]?.statement).toContain('2026-10-22T10:00:00.000Z');
    expect(result.answer.claims[0]?.restsOn).toEqual([]);
  });

  it('never discloses a contrary peer outside trusted caller context', () => {
    const positive = incidentCall({
      id: 'c2',
      emptiness: 'non-empty',
      rows: 1,
      gaps: [{ kind: 'scope', what: 'PRIVATE-PEER-SOURCE', bears: 'source' }],
    });
    const result = render([incidentCall(), positive], {
      trusted: (call) => call.resultId !== positive.resultId,
    });
    expect(result.answer.checks[0]?.code).toBe('contradicted-by-rows');
    expect(result.answer.claims[0]?.statement).not.toContain('PRIVATE-PEER-SOURCE');
    expect(result.answer.claims[0]?.restsOn).toEqual(['r1']);
  });

  it('bounds contrary detail without hiding how many additional positive reads exist', () => {
    const result = render([
      incidentCall(),
      ...Array.from({ length: 14 }, (_, index) =>
        incidentCall({ id: `c${index + 2}`, emptiness: 'non-empty', rows: 1 }),
      ),
    ]);
    const text = result.answer.claims[0]?.statement ?? '';
    expect(text.match(/Contrary recorded evidence \(read /g)).toHaveLength(12);
    expect(text).toContain('2 additional positive reads');
    expect(result.answer.claims[0]?.restsOn).toHaveLength(15);
  });

  for (const [name, call, expectedCode, reason] of [
    [
      'incomplete',
      incidentCall({
        gaps: [{ kind: 'paged', what: 'another page remains', bears: 'population' }],
      }),
      'search-incomplete',
      'does not cover the complete search',
    ],
    [
      'remote',
      incidentCall({ composed: 'remote' }),
      'coverage-unverified',
      'coverage was not composed by this runtime',
    ],
    [
      'not read',
      incidentCall({ emptiness: 'unknown' }),
      'call-not-read',
      'did not establish a read',
    ],
  ] as const) {
    it(`uses a specific refusal for ${name}`, () => {
      const result = render([call]);
      expect(result.answer.checks[0]?.code).toBe(expectedCode);
      expect(result.answer.claims[0]?.statement).toContain(reason);
    });
  }
});

describe('delivery markers describe the whole candidate', () => {
  it('reserves as-checked for a candidate containing only established negative fields', () => {
    expect(render([incidentCall()]).answer.delivery).toBe('as-checked');
  });
  for (const extra of [
    { summary: 'Everything is fine.' },
    { score: 100 },
    { details: { complete: true } },
  ]) {
    it(`marks unchecked ${
      Object.keys(extra)[0]
    } recorded even after an app validator passes`, () => {
      const result = render([incidentCall()], { value: candidate('payments', extra) });
      expect(result.answer.delivery).toBe('recorded');
      const report: AnswerValidationReport = {
        validatorId: 'host',
        validatorVersion: '1',
        mode: 'enforce',
        status: 'passed',
        checked: 1,
        failed: 0,
        unreachable: 0,
        notApplicable: 0,
        checks: [{ id: 'host-check', disposition: 'checked-pass' }],
        resolvedRefs: [],
        schemaAccepted: true,
      };
      expect(reportWithNegatives(report, result.answer, true).delivery).toBe('recorded');
    });
  }
});

describe('about stays model data, never a new evidence binding', () => {
  it('keeps the original about data and quotes only the statement', () => {
    const raw = 'pay\u202ements\n`admin`';
    const result = render([incidentCall({ service: raw })], { value: candidate(raw) });
    expect(result.answer.checks[0]?.code).toBe('established');
    expect(result.answer.claims[0]?.about).toBe(raw);
    expect(result.answer.claims[0]?.statement).toContain(quoteValue(raw));
    expect(result.answer.claims[0]?.statement).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  });
  it('binds the original about before display normalization', () => {
    const result = render([incidentCall()], { value: candidate('pay\u202ements') });
    expect(result.answer.checks[0]?.code).toBe('about-mismatch');
    expect(result.answer.claims[0]?.about).toBe('pay\u202ements');
    expect(result.answer.claims[0]?.statement).not.toContain('found none');
  });
});
