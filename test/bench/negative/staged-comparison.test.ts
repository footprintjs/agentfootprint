/** Sequential comparison contracts; checkers are injected so tests never need an old
 * checkout or a paid model. The baseline schema/evidence admission is real. */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { applyOutputSchema } from '../../../src/answer-validation/outputSchema.js';
import { readResultIdentity } from '../../../src/integrity/claim-binding/capture.js';
import { readToolResultEnvelope } from '../../../src/semantics/toolEffects.js';
import { renderNegativeCandidate } from '../../../src/core/agent/negativeClaims/delivery.js';
import { incidentCall, turnRecord } from '../../integrity/negative-claim/fixtures.js';
// @ts-expect-error — plain offline .mjs benchmark with injected dependencies
import { compareStages, summarizeStages } from '../../../bench/negative/staged-comparison.mjs';
// @ts-expect-error — plain offline private-file adapter
import {
  stagedMarkdown,
  runStagedComparison,
} from '../../../bench/negative/staged-comparison-files.mjs';

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

const render = (code: string, value: typeof candidate, record: ReturnType<typeof turnRecord>) => ({
  answer: {
    checks: value.negatives.map((_entry, index) => ({
      index,
      code,
      kind: 'none',
      disposition: code === 'established' ? 'not-applicable' : 'unreachable',
      results: [record.calls[0].resultId],
    })),
    claims: value.negatives.map(() => ({ kind: 'none', statement: 'Synthetic recorded scope.' })),
  },
  correction: false,
  allowed: code === 'established',
});
const baseline = () => ({
  applyOutputSchema,
  readResultIdentity,
  readToolResultEnvelope,
  observeNegativeProse: () => [],
  renderNegativeCandidate: vi.fn((value, _config, record) =>
    render('kind-mismatch', value, record),
  ),
});
const corrected = () => ({
  renderNegativeCandidate: vi.fn((value, _config, record, trusted, mode) =>
    render(
      !trusted(record.calls[0])
        ? 'outside-trusted-context'
        : mode === 'kind-only'
        ? 'about-mismatch'
        : 'established',
      value,
      record,
    ),
  ),
});
const EXPECTED = {
  trials: 4,
  schemaPass: 2,
  schemaFail: 1,
  noAnswer: 1,
  zeroClaims: 1,
  claims: 1,
  established: 0,
};
const cases = () => [
  fixture('one'),
  fixture('schema', { ...candidate, negatives: [{ ...candidate.negatives[0], restsOn: [] }] }),
  fixture('no-answer', undefined, true),
  fixture('empty', { summary: '', negatives: [] }),
];

describe('sequential kind then subject comparison', () => {
  it('uses real renderer modes: exact subject blocks a phrase, then containment passes', () => {
    const record = turnRecord([incidentCall()]);
    const value = {
      negatives: [{ kind: 'not-found', about: 'incidents for Payments', restsOn: ['r1'] }],
    };
    const original = JSON.stringify({ value, record });
    const config = {
      field: 'negatives',
      tools: ['list_incidents'],
      unestablished: 'withhold' as const,
    };
    const exact = renderNegativeCandidate(value, config, record, () => true, 'kind-only');
    const contained = renderNegativeCandidate(value, config, record, () => true, 'evidence-owned');
    expect(exact.answer.checks[0]).toMatchObject({ kind: 'none', code: 'about-mismatch' });
    expect(contained.answer.checks[0]).toMatchObject({ kind: 'none', code: 'established' });
    expect(exact.allowed).toBe(false);
    expect(contained.allowed).toBe(true);
    expect(JSON.stringify({ value, record })).toBe(original);
  });

  it('reports sequential first blockers without adding mismatch counts to successes', () => {
    const old = baseline(),
      next = corrected();
    const rows = cases().map((artifact) => compareStages(artifact, artifact.row, old, next));
    const summary = summarizeStages(rows, EXPECTED);
    expect(summary.denominators).toEqual(EXPECTED);
    expect(summary.totals).toMatchObject({
      trials: 4,
      claims: 1,
      zeroClaimAnswers: 1,
      stages: {
        baseline: { established: 0, unestablished: 1 },
        kindOnly: { established: 0, unestablished: 1, codes: { 'about-mismatch': 1 } },
        kindAndSubject: { established: 1, nonemptyAllEstablishedAnswers: 1 },
      },
      baselineToKind: { 'kind-mismatch -> about-mismatch': 1 },
      kindToSubject: { 'about-mismatch -> established': 1 },
    });
    expect(summary.baselineSchemaReasons).toEqual({ 'schema-issue:empty-references': 1 });
    expect(rows[1].stages).toBeNull();
    expect(rows[2].stages).toBeNull();
    expect(next.renderNegativeCandidate).toHaveBeenCalledTimes(4);
    expect(next.renderNegativeCandidate.mock.calls.map((args) => args[4])).toEqual([
      'kind-only',
      'evidence-owned',
      'kind-only',
      'evidence-owned',
    ]);
  });

  it('feeds both stages the identical frozen original fields and native evidence', () => {
    const a = fixture('one'),
      original = JSON.stringify(a),
      next = corrected();
    compareStages(a, a.row, baseline(), next);
    for (const args of next.renderNegativeCandidate.mock.calls) {
      expect(args[0]).toEqual(candidate);
      expect(args[2]).toBe(a.raw.turns[0].nativeRecord);
      expect(Object.isFrozen(args[0])).toBe(true);
      expect(Object.isFrozen(args[2].calls)).toBe(true);
    }
    expect(next.renderNegativeCandidate.mock.calls[0][0]).toBe(
      next.renderNegativeCandidate.mock.calls[1][0],
    );
    expect(JSON.stringify(a)).toBe(original);
  });

  it.each(['untrusted', 'incomplete'] as const)('does not infer trusted context (%s)', (reason) => {
    const a = fixture('one');
    const record = a.raw.turns[0].nativeRecord;
    a.raw.turns[0].nativeRecord =
      reason === 'untrusted'
        ? { ...record, calls: [{ ...record.calls[0], trustedContext: false }] }
        : { ...record, ledgerComplete: false };
    const result = compareStages(a, a.row, baseline(), corrected());
    expect(result.transitions[0].stages.kindOnly.code).toBe('outside-trusted-context');
    expect(result.transitions[0].stages.kindAndSubject.code).toBe('outside-trusted-context');
  });

  it('retains explicit complete requests and counts narrower rendered absences separately', () => {
    const a = fixture('one', {
      ...candidate,
      negatives: [{ ...candidate.negatives[0], kind: 'complete' }],
    });
    const result = compareStages(a, a.row, baseline(), corrected());
    expect(result.transitions[0].requestedKind).toBe('complete');
    const summary = summarizeStages([result], {
      ...EXPECTED,
      trials: 1,
      schemaPass: 1,
      schemaFail: 0,
      noAnswer: 0,
      zeroClaims: 0,
    });
    expect(summary.totals.stages.kindAndSubject).toMatchObject({
      requestedCompleteSlots: 1,
      completeRequestedRenderedAbsence: 1,
    });
  });

  it('counts a real scoped-absence fallback without establishing requested completeness', () => {
    const a = fixture('partial', {
      summary: '',
      negatives: [{ kind: 'complete', about: 'payments', restsOn: ['r1'] }],
    });
    a.raw.turns[0].nativeRecord = turnRecord([
      { ...incidentCall({ complete: false }), trustedContext: true },
    ]);
    const result = compareStages(a, a.row, baseline(), { renderNegativeCandidate });
    const summary = summarizeStages([result], {
      ...EXPECTED,
      trials: 1,
      schemaPass: 1,
      schemaFail: 0,
      noAnswer: 0,
      zeroClaims: 0,
    });
    for (const stage of ['kindOnly', 'kindAndSubject'])
      expect(summary.totals.stages[stage]).toMatchObject({
        established: 0,
        unestablished: 1,
        codes: { 'search-incomplete': 1 },
        completeRequestedRenderedAbsence: 0,
        completeRequestsWithAbsenceFallback: 1,
      });
  });

  it('refuses a stage dropping or renumbering original claim slots', () => {
    const a = fixture('one');
    expect(() =>
      compareStages(a, a.row, baseline(), {
        renderNegativeCandidate: () => ({ answer: { checks: [], claims: [] } }),
      }),
    ).toThrow('fixed claim denominator/order');
    const b = fixture('two');
    expect(() =>
      compareStages(b, b.row, baseline(), {
        renderNegativeCandidate: (
          value: typeof candidate,
          _config: unknown,
          record: ReturnType<typeof turnRecord>,
        ) => {
          const response = render('established', value, record);
          response.answer.checks[0].index = 1;
          return response;
        },
      }),
    ).toThrow('fixed claim denominator/order');
  });

  it('rejects evidence injection and fixed-denominator drift', () => {
    const a = fixture('one'),
      before = JSON.stringify(a);
    expect(() =>
      compareStages(a, a.row, baseline(), {
        renderNegativeCandidate: (
          _value: unknown,
          _config: unknown,
          record: { calls: unknown[] },
        ) => {
          record.calls.push({ invented: 'model text' });
        },
      }),
    ).toThrow();
    expect(JSON.stringify(a)).toBe(before);
    const b = fixture('two');
    expect(() =>
      summarizeStages([compareStages(b, b.row, baseline(), corrected())], EXPECTED),
    ).toThrow('denominator/result drift');
  });
});

it('writes only new private outputs and preserves original compressed bytes and public privacy', () => {
  const base = mkdtempSync(join(tmpdir(), 'af-staged-comparison-')),
    run = join(base, 'original'),
    out = join(base, 'new-analysis');
  mkdirSync(join(run, 'raw'), { recursive: true });
  const artifacts = cases(),
    bytes = new Map<string, Buffer>();
  bytes.set(
    'manifest.json',
    Buffer.from(JSON.stringify({ schedule: artifacts.map((a) => a.row) })),
  );
  for (const a of artifacts) bytes.set(`raw/${a.row.id}.json.gz`, gzipSync(JSON.stringify(a)));
  for (const [path, data] of bytes) writeFileSync(join(run, path), data);
  const report = runStagedComparison(run, out, baseline(), corrected(), EXPECTED);
  expect(report.originalFiles).toMatchObject({ count: 5, allUnchanged: true });
  for (const [path, data] of bytes) expect(readFileSync(join(run, path))).toEqual(data);
  const publicText = JSON.stringify(report) + stagedMarkdown(report);
  for (const secret of ['private-case', 'advisory words about payments', 'list_incidents'])
    expect(publicText).not.toContain(secret);
  expect(() => runStagedComparison(run, out, baseline(), corrected(), EXPECTED)).toThrow(
    'new directory',
  );
  expect(() =>
    runStagedComparison(run, join(run, 'nested'), baseline(), corrected(), EXPECTED),
  ).toThrow('outside original');
});
