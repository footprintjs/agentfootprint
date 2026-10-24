/** Free post-run replay: synthetic saved artifacts only; no provider or private bank. */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { applyOutputSchema } from '../../../src/answer-validation/outputSchema.js';
import { readToolResultEnvelope } from '../../../src/semantics/toolEffects.js';
import { readResultIdentity } from '../../../src/integrity/claim-binding/capture.js';
import { renderNegativeCandidate } from '../../../src/core/agent/negativeClaims/delivery.js';
import { observeNegativeProse } from '../../../src/core/agent/negativeClaims/prose.js';
import { incidentCall, turnRecord } from '../../integrity/negative-claim/fixtures.js';
// @ts-expect-error — the offline benchmark is a plain injected-dependency .mjs module
import { reparseTrial, summarizeReparse } from '../../../bench/negative/reparse.mjs';
// @ts-expect-error — the offline file adapter is a plain .mjs module
import {
  runReparse,
  reparseMarkdown,
  replayProvenance,
} from '../../../bench/negative/reparse-files.mjs';

const LIB = {
  readToolResultEnvelope,
  applyOutputSchema,
  readResultIdentity,
  renderNegativeCandidate,
  observeNegativeProse,
};
const IDENTITY = { tenant: 'synthetic-tenant', principal: 'reader', conversationId: 'local-test' };
const citation = { kind: 'none', about: 'payments', restsOn: ['r1'] };
const candidate = (negatives: unknown[] = [citation]) => ({
  summary: 'There are no incidents for payments.',
  negatives,
});

function fixture(
  value: unknown = candidate(),
  options: {
    turn?: number;
    trusted?: boolean;
    complete?: boolean;
    raw?: string;
    noAnswer?: boolean;
  } = {},
) {
  const turn = options.turn ?? 1;
  const row = {
    id: 'trial-1',
    caseId: 'private-case',
    model: 'synthetic-model',
    cell: turn === 2 ? 'long' : 'main',
    arm: 'enforce',
    rep: 1,
  };
  const call = { ...incidentCall(), trustedContext: options.trusted ?? true };
  const record = turnRecord([call], { turn, ledgerComplete: options.complete ?? true });
  const text = options.raw ?? '```json\n' + JSON.stringify(value) + '\n```';
  const last = {
    turn,
    nativeRecord: record,
    recording: { snapshot: { sharedState: { runIdentity: IDENTITY } } },
    error: null,
  };
  return {
    row,
    raw: {
      ...row,
      identity: IDENTITY,
      attempts: [
        {
          tool: call.toolName,
          toolCallId: call.toolCallId,
          turn: call.turn,
          args: { ...call.arguments, benchTenant: IDENTITY.tenant },
          outcome: 'returned',
        },
      ],
      turns: turn === 2 ? [{ ...last, turn: 1 }, last] : [last],
      calls: [
        {
          index: 1,
          turn: call.turn,
          source: 'scripted',
          response: {
            content: '',
            providerRef: 'scripted',
            toolCalls: [{ id: call.toolCallId, name: call.toolName, args: call.arguments }],
          },
        },
        ...(options.noAnswer
          ? []
          : [
              {
                index: 2,
                turn,
                source: 'provider',
                response: { providerRef: 'wire-1', content: text, toolCalls: [] },
              },
            ]),
      ],
    },
    wire: options.noAnswer
      ? []
      : [{ response: { id: 'wire-1', content: [{ type: 'text', text }] } }],
  };
}
const run = (artifact: ReturnType<typeof fixture>) => reparseTrial(artifact, artifact.row, LIB);

describe('offline application contract and counters', () => {
  it('uses the fixed library decoder but the unchanged strict application parser', () => {
    const result = run(fixture());
    expect(result).toMatchObject({
      status: 'schema-pass',
      claimCount: 1,
      allClaimsEstablished: true,
      counterfactual: {
        correctionNeeded: false,
        checks: [{ code: 'established', disposition: 'not-applicable' }],
      },
    });
    expect(result.bindings[0].references[0]).toMatchObject({
      status: 'current-turn',
      namespaceMatches: true,
    });
  });

  it.each([
    { summary: 4, negatives: [] },
    { ...candidate(), extra: 'not allowed' },
    candidate([{ ...citation, statement: 'invented statement' }]),
    candidate([{ ...citation, restsOn: [] }]),
    candidate([{ ...citation, restsOn: ['r0'] }]),
    candidate([{ ...citation, about: {} }]),
    candidate([{ ...citation, kind: 'unknown' }]),
  ])('does not loosen the original app contract for %j', (value) => {
    expect(run(fixture(value))).toMatchObject({ status: 'schema-fail', stage: 'schema-validate' });
  });

  it('does not salvage prose, malformed JSON, or an extra fence', () => {
    expect(run(fixture(undefined, { raw: 'Here it is:\n```json\n{}\n```' }))).toMatchObject({
      status: 'schema-fail',
      stage: 'json-parse',
    });
  });

  it('keeps zero claims separate from establishment and keeps no-answer trials', () => {
    const rows = [run(fixture(candidate([]))), run(fixture(undefined, { noAnswer: true }))];
    expect(rows[0]).toMatchObject({ zeroClaims: true, allClaimsEstablished: false });
    expect(rows[1]).toMatchObject({ status: 'no-answer', nativeAudit: { matchedExecutions: 1 } });
    const { totals } = summarizeReparse(rows);
    expect(totals).toMatchObject({
      trials: 2,
      'schema-pass': 1,
      'no-answer': 1,
      'zero-claim-answers': 1,
    });
    expect(totals['nonempty-all-established']).toBeUndefined();
  });
});

describe('offline binding and native evidence', () => {
  it('reports an unknown handle as unresolved and correction only as counterfactual', () => {
    const result = run(fixture(candidate([{ ...citation, restsOn: ['r99'] }])));
    expect(result.counterfactual).toMatchObject({
      allowed: false,
      correctionNeeded: true,
      checks: [{ code: 'citation-unresolved' }],
    });
    expect(result.bindings[0].references[0].status).toBe('missing-or-ambiguous');
  });

  it('keeps earlier-turn reads stale without inventing a reread', () => {
    const result = run(fixture(undefined, { turn: 2 }));
    expect(result.counterfactual).toMatchObject({
      correctionNeeded: true,
      checks: [{ code: 'stale-turn' }],
    });
    expect(result.bindings[0].references[0].status).toBe('earlier-turn');
  });

  it('ignores model display wording while retaining trusted-context and record guards', () => {
    expect(
      run(fixture(candidate([{ ...citation, about: 'different-entity' }]))).counterfactual.checks[0]
        .code,
    ).toBe('established');
    expect(run(fixture(undefined, { trusted: false })).counterfactual.checks[0].code).toBe(
      'outside-trusted-context',
    );
    expect(run(fixture(undefined, { complete: false })).counterfactual.checks[0].code).toBe(
      'record-incomplete',
    );
  });

  it('refuses corrupted recorded tuples or execution bindings before checker invocation', () => {
    const a = fixture();
    const saved = a.raw.turns.at(-1)!.nativeRecord;
    a.raw.turns.at(-1)!.nativeRecord = {
      ...saved,
      calls: [{ ...saved.calls[0], row: { ...saved.calls[0].row!, toolName: 'forged' } }],
    };
    expect(run(a)).toMatchObject({
      status: 'binding-error',
      error: 'composed call tuple mismatch',
    });
    const b = fixture();
    b.raw.attempts[0].args.benchTenant = 'another-tenant';
    expect(run(b)).toMatchObject({
      status: 'binding-error',
      error: 'native executed arguments mismatch',
    });
    expect(() => reparseTrial(fixture(), { ...fixture().row, rep: 2 }, LIB)).toThrow(
      'registered trial tuple mismatch',
    );
  });

  it('requires the actual saved wire answer, rather than a history or scripted answer', () => {
    const a = fixture();
    a.wire[0].response.content[0].text = 'different wire text';
    expect(() => run(a)).toThrow('saved wire response');
    const b = fixture();
    b.raw.calls.at(-1)!.source = 'scripted';
    expect(run(b).status).toBe('no-answer');
  });

  it('observes only the original model candidate and never adds it to frozen evidence', () => {
    const a = fixture(),
      before = JSON.stringify(a);
    const observe = vi.fn(observeNegativeProse),
      render = vi.fn(renderNegativeCandidate);
    const result = reparseTrial(a, a.row, {
      ...LIB,
      observeNegativeProse: observe,
      renderNegativeCandidate: render,
    });
    const originalRecord = a.raw.turns.at(-1)!.nativeRecord;
    expect(observe.mock.calls[0][0]).toEqual(candidate());
    expect(observe.mock.calls[0][1]).toBe(originalRecord);
    expect(render.mock.calls[0][2]).toBe(originalRecord);
    expect(Object.isFrozen(originalRecord.calls)).toBe(true);
    expect(JSON.stringify(a)).toBe(before);
    expect(result.evidenceUnchanged).toBe(true);
    expect(observe.mock.calls[0][0]).not.toHaveProperty('negatives.0.statement');
  });
});

it('writes new private analyses, preserves all original bytes, and prints aggregate fields only', () => {
  const base = mkdtempSync(join(tmpdir(), 'af-free-reparse-')),
    input = join(base, 'original'),
    output = join(base, 'analysis');
  mkdirSync(join(input, 'raw'), { recursive: true });
  const a = fixture();
  const manifest = Buffer.from(JSON.stringify({ schedule: [a.row] }));
  const raw = gzipSync(JSON.stringify(a));
  writeFileSync(join(input, 'manifest.json'), manifest);
  writeFileSync(join(input, 'raw', a.row.id + '.json.gz'), raw);
  const report = runReparse(input, output, LIB);
  expect(report.originalFiles).toEqual({ count: 2, allUnchanged: true });
  expect(readFileSync(join(input, 'manifest.json'))).toEqual(manifest);
  expect(readFileSync(join(input, 'raw', a.row.id + '.json.gz'))).toEqual(raw);
  const aggregate = reparseMarkdown(report) + JSON.stringify(report);
  for (const privateText of ['private-case', 'trial-1', 'payments', 'list_incidents'])
    expect(aggregate).not.toContain(privateText);
  expect(() => runReparse(input, output, LIB)).toThrow('new directory');
  expect(() => runReparse(input, join(input, 'new-output'), LIB)).toThrow('outside the original');
});

it('counts schema defects without admitting or scanning rejected candidates', () => {
  const result = run(fixture(candidate([{ ...citation, restsOn: [], invented: 'private text' }])));
  expect(result).toMatchObject({
    status: 'schema-fail',
    schemaIssues: ['empty-references', 'extra-citation-fields'],
  });
  expect(result.proseHeuristic).toBeUndefined();
  expect(summarizeReparse([result]).totals).toMatchObject({
    'schema-issue:empty-references': 1,
    'schema-issue:extra-citation-fields': 1,
    'prose-unscanned:schema-fail': 1,
  });
});

it('does not silently lose an actual execution from the native evidence record', () => {
  const artifact = fixture();
  const last = artifact.raw.turns.at(-1)!;
  last.nativeRecord = { ...last.nativeRecord, calls: [] };
  expect(run(artifact)).toMatchObject({
    status: 'binding-error',
    error: 'execution missing from native record',
  });
});

it('provenance changes when a transitive built helper changes', () => {
  const base = mkdtempSync(join(tmpdir(), 'af-reparse-provenance-'));
  mkdirSync(join(base, 'dist/esm/helpers'), { recursive: true });
  mkdirSync(join(base, 'bench/negative'), { recursive: true });
  writeFileSync(join(base, 'dist/esm/entry.js'), 'export { value } from "./helpers/value.js";');
  const helper = join(base, 'dist/esm/helpers/value.js');
  writeFileSync(helper, 'export const value = 1;');
  writeFileSync(join(base, 'package-lock.json'), '{}');
  for (const name of [
    'reparse.mjs',
    'reparse-core.mjs',
    'reparse-files.mjs',
    'reparse-contract.mjs',
  ])
    writeFileSync(join(base, 'bench/negative', name), '// synthetic replay file');
  const first = replayProvenance(base);
  writeFileSync(helper, 'export const value = 2;');
  expect(replayProvenance(base).builtJsTreeSha256).not.toBe(first.builtJsTreeSha256);
  expect(first.builtJsFiles).toBe(2);
});

it('rejects end-of-turn evidence containing a later tool proposal instead of slicing it', () => {
  const a = fixture();
  a.raw.calls.push({
    index: 3,
    turn: 1,
    source: 'provider',
    response: {
      content: '',
      providerRef: 'later',
      toolCalls: [{ id: 'later-read', name: 'list_incidents', args: {} }],
    },
  });
  expect(run(a)).toMatchObject({
    status: 'binding-error',
    error: 'native evidence is not bound before selected answer',
  });
  const b = fixture();
  b.raw.calls[0].index = 3;
  expect(run(b)).toMatchObject({ status: 'binding-error' });
});

it.each(['invalid', 'denied', 'failure', 'pending'])(
  'retains a returned %s envelope as an error read for the checker',
  (status) => {
    const a = fixture();
    Object.assign(a.raw.attempts[0], { result: { content: 'unavailable', effects: [], status } });
    const last = a.raw.turns.at(-1)!;
    last.nativeRecord = {
      ...last.nativeRecord,
      calls: [{ ...last.nativeRecord.calls[0], outcome: 'error', emptiness: 'unknown' }],
    };
    expect(run(a)).toMatchObject({
      status: 'schema-pass',
      counterfactual: { allowed: false, checks: [{ code: 'call-not-read' }] },
    });
  },
);
