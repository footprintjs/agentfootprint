/** Comparison-runner contracts; checkers are injected so tests never need an old
 * checkout or a paid model. The baseline schema/evidence admission is real. */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { applyOutputSchema } from '../../../src/answer-validation/outputSchema.js';
import { readResultIdentity } from '../../../src/integrity/claim-binding/capture.js';
import { readToolResultEnvelope } from '../../../src/semantics/toolEffects.js';
import { incidentCall, turnRecord } from '../../integrity/negative-claim/fixtures.js';
// @ts-expect-error — plain offline .mjs benchmark with injected dependencies
import {
  compareTrial,
  summarizeComparison,
} from '../../../bench/negative/compare-evidence-owned.mjs';
// @ts-expect-error — plain offline private-file adapter
import {
  comparisonMarkdown,
  runComparison,
} from '../../../bench/negative/compare-evidence-owned-files.mjs';

const candidate = {
  summary: 'Original unchecked sentence.',
  negatives: [{ kind: 'not-found', about: 'advisory words about payments', restsOn: ['r1'] }],
};
const identity = { tenant: 'synthetic-tenant', principal: 'reader', conversationId: 'comparison' };
function fixture(id: string, value: unknown = candidate, noAnswer = false) {
  const row = { id, caseId: 'private-case', model: 'model', cell: 'main', arm: 'enforce', rep: 1 };
  const call = { ...incidentCall(), trustedContext: true };
  const text = '```json\n' + JSON.stringify(value) + '\n```';
  return {
    row,
    raw: {
      ...row,
      identity,
      attempts: [
        {
          tool: call.toolName,
          toolCallId: call.toolCallId,
          turn: 1,
          args: { ...call.arguments, benchTenant: identity.tenant },
          outcome: 'returned',
        },
      ],
      turns: [
        {
          turn: 1,
          nativeRecord: turnRecord([call]),
          recording: { snapshot: { sharedState: { runIdentity: identity } } },
        },
      ],
      calls: [
        {
          index: 1,
          turn: 1,
          source: 'scripted',
          response: {
            content: '',
            providerRef: 'scripted',
            toolCalls: [{ id: call.toolCallId, name: call.toolName, args: call.arguments }],
          },
        },
        ...(noAnswer
          ? []
          : [
              {
                index: 2,
                turn: 1,
                source: 'provider',
                response: { providerRef: 'wire', content: text, toolCalls: [] },
              },
            ]),
      ],
    },
    wire: noAnswer ? [] : [{ response: { id: 'wire', content: [{ type: 'text', text }] } }],
  };
}

function checker(code: string) {
  return vi.fn((value, _config, record, trusted) => {
    const resultCode = trusted(record.calls[0]) ? code : 'outside-trusted-context';
    const checks = value.negatives.map((_entry: unknown, index: number) => ({
      index,
      code: resultCode,
      disposition: resultCode === 'established' ? 'not-applicable' : 'unreachable',
      results: [record.calls[0].resultId],
    }));
    return {
      answer: { checks, claims: [] },
      correction: false,
      allowed: checks.every((c: { code: string }) => c.code === 'established'),
    };
  });
}
const baseline = () => ({
  applyOutputSchema,
  readResultIdentity,
  readToolResultEnvelope,
  observeNegativeProse: () => [],
  renderNegativeCandidate: checker('kind-mismatch'),
});
const current = () => ({ renderNegativeCandidate: checker('established') });
const EXPECTED = {
  trials: 4,
  schemaPass: 2,
  schemaFail: 1,
  noAnswer: 1,
  zeroClaims: 1,
  claims: 1,
  established: 0,
};
function cases() {
  return [
    fixture('one'),
    fixture('schema', { ...candidate, negatives: [{ ...candidate.negatives[0], restsOn: [] }] }),
    fixture('no-answer', undefined, true),
    fixture('empty', { summary: '', negatives: [] }),
  ];
}

describe('same-candidate comparison', () => {
  it('holds all trial, admission and claim denominators fixed; empty claims never establish', () => {
    const old = baseline(),
      next = current();
    const rows = cases().map((a) => compareTrial(a, a.row, old, next));
    const report = summarizeComparison(rows, EXPECTED);
    expect(report.denominators).toEqual(EXPECTED);
    expect(report.totals).toMatchObject({
      trials: 4,
      admittedAnswers: 2,
      claims: 1,
      zeroClaimAnswers: 1,
      baselineEstablished: 0,
      currentEstablished: 1,
      currentNonemptyAllEstablished: 1,
      transitions: { 'kind-mismatch -> established': 1 },
    });
    expect(report.baselineSchemaReasons).toEqual({ 'schema-issue:empty-references': 1 });
    expect(next.renderNegativeCandidate).toHaveBeenCalledTimes(2);
    expect(rows[1].current).toBeNull();
    expect(rows[2].current).toBeNull();
    expect(rows[3].current.allClaimsEstablished).toBe(false);
  });

  it('passes the original advisory values unchanged and the exact frozen saved evidence', () => {
    const a = fixture('one'),
      before = JSON.stringify(a),
      next = current();
    const row = compareTrial(a, a.row, baseline(), next);
    expect(next.renderNegativeCandidate.mock.calls[0][0]).toEqual(candidate);
    expect(next.renderNegativeCandidate.mock.calls[0][2]).toBe(a.raw.turns[0].nativeRecord);
    expect(Object.isFrozen(next.renderNegativeCandidate.mock.calls[0][0])).toBe(true);
    expect(Object.isFrozen(a.raw.turns[0].nativeRecord.calls)).toBe(true);
    expect(JSON.stringify(a)).toBe(before);
    expect(row.evidenceUnchanged).toBe(true);
  });

  it('preserves trusted-context restrictions independently of advisory model labels', () => {
    const a = fixture('one');
    a.raw.turns[0].nativeRecord = {
      ...a.raw.turns[0].nativeRecord,
      calls: [{ ...a.raw.turns[0].nativeRecord.calls[0], trustedContext: false }],
    };
    const result = compareTrial(a, a.row, baseline(), current());
    expect(result.transitions[0]).toMatchObject({
      baselineCode: 'outside-trusted-context',
      currentCode: 'outside-trusted-context',
    });
  });

  it('refuses changed expected denominators and a renderer dropping a claim', () => {
    const a = fixture('one');
    const row = compareTrial(a, a.row, baseline(), current());
    expect(() => summarizeComparison([row], EXPECTED)).toThrow('denominator/result drift');
    const b = fixture('two');
    expect(() =>
      compareTrial(b, b.row, baseline(), {
        renderNegativeCandidate: () => ({
          answer: { checks: [], claims: [] },
          allowed: true,
          correction: false,
        }),
      }),
    ).toThrow('fixed claim denominator');
  });

  it('cannot add candidate text to evidence, even through an injected renderer', () => {
    const a = fixture('one'),
      before = JSON.stringify(a);
    expect(() =>
      compareTrial(a, a.row, baseline(), {
        renderNegativeCandidate: (
          _candidate: unknown,
          _config: unknown,
          record: { calls: unknown[] },
        ) => {
          record.calls.push({ invented: 'model prose' });
        },
      }),
    ).toThrow();
    expect(JSON.stringify(a)).toBe(before);
  });
});

it('writes a separate private comparison and leaves every original compressed artifact unchanged', () => {
  const base = mkdtempSync(join(tmpdir(), 'af-comparison-')),
    run = join(base, 'original'),
    out = join(base, 'new-analysis');
  mkdirSync(join(run, 'raw'), { recursive: true });
  const artifacts = cases();
  const original = new Map<string, Buffer>();
  original.set(
    'manifest.json',
    Buffer.from(JSON.stringify({ schedule: artifacts.map((a) => a.row) })),
  );
  for (const a of artifacts)
    original.set('raw/' + a.row.id + '.json.gz', gzipSync(JSON.stringify(a)));
  for (const [path, bytes] of original) writeFileSync(join(run, path), bytes);
  const report = runComparison(run, out, baseline(), current(), EXPECTED);
  expect(report.originalFiles).toEqual({ count: 5, allUnchanged: true });
  for (const [path, bytes] of original) expect(readFileSync(join(run, path))).toEqual(bytes);
  const publicText = JSON.stringify(report) + comparisonMarkdown(report);
  for (const secret of ['private-case', 'advisory words about payments', 'list_incidents'])
    expect(publicText).not.toContain(secret);
  expect(() => runComparison(run, out, baseline(), current(), EXPECTED)).toThrow('new directory');
  expect(() => runComparison(run, join(run, 'nested'), baseline(), current(), EXPECTED)).toThrow(
    'outside original',
  );
});
