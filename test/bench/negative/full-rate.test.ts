/** Mock transport + synthetic native artifacts; no real keys, case bank or paid calls. */
import { mkdtempSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as root from '../../../src/index.js';
import * as observe from '../../../src/observe.js';
import * as memory from '../../../src/memory/index.js';
import * as negative from '../../../src/core/agent/negativeClaims/capture.js';
// @ts-expect-error — plain benchmark .mjs module
import { runCase } from '../../../bench/negative/full/harness.mjs';
// @ts-expect-error — plain benchmark .mjs module
import { BudgetLedger } from '../../../bench/negative/full/budget.mjs';
// @ts-expect-error — plain benchmark .mjs module
import { ROOT, digest } from '../../../bench/negative/full/plan.mjs';
// @ts-expect-error — plain benchmark .mjs module
import { scoreRows } from '../../../bench/negative/full/score.mjs';
// @ts-expect-error — plain benchmark .mjs module
import { makeLabelPacket, makeUsefulnessPacket } from '../../../bench/negative/full/labels.mjs';
// @ts-expect-error — plain benchmark .mjs module
import {
  normalizeArtifact,
  normalizedScoreRow,
  publicSummary,
  rateBatch,
  ratingPlan,
  resolveRatings,
  validateBatch,
} from '../../../bench/negative/full/rate.mjs';

afterEach(() => vi.unstubAllEnvs());

function fixture() {
  const args = { service: 'synthetic', benchTenant: 'owner' };
  const citation = { kind: 'none', about: 'synthetic', restsOn: ['r1'] };
  const response = (summary: string) => ({
    content: JSON.stringify({ summary, negatives: [citation] }),
    usage: { input: 20, output: 30 },
  });
  const call = {
    resultId: 'native/1',
    toolName: 'search',
    turn: 1,
    arguments: args,
    row: { handle: 'r1' },
    readAt: '2026-10-23T12:00:00Z',
    dispatched: true,
    checkerVerdict: 'CHECKER_SECRET',
  };
  const artifact = {
    row: {
      id: 'private-run',
      caseId: 'private-case',
      model: 'MODEL_SECRET',
      cell: 'long',
      arm: 'enforce',
      rep: 0,
    },
    raw: {
      calls: [
        { source: 'scripted', turn: 1, response: response('SCRIPTED_PADDING_SECRET') },
        {
          source: 'provider',
          turn: 2,
          response: response('There are no incidents.'),
          candidate: { value: { summary: 'UNTRUSTED_CANDIDATE_SECRET', negatives: [citation] } },
        },
        {
          source: 'provider',
          turn: 2,
          response: response('The earlier read found no incidents.'),
          candidate: {
            value: { summary: 'The earlier read found no incidents.', negatives: [citation] },
          },
        },
      ],
      attempts: [
        { tool: 'search', ordinal: 1, turn: 1, args, outcome: 'returned', result: { rows: [] } },
      ],
      turns: [
        { turn: 1, nativeRecord: { calls: [call] } },
        {
          turn: 2,
          message: 'What is known now?',
          output: JSON.stringify({
            summary: 'DELIVERED_LIBRARY_SECRET',
            negatives: [{ kind: 'unknown' }],
          }),
          latencyMs: 100,
          nativeRecord: { calls: [call] },
          answerNegatives: { checks: [{ code: 'stale-turn' }] },
        },
      ],
    },
  };
  const caseDef = {
    prompt: 'Question?',
    tools: [{ name: 'search', effects: 'read', search: { subject: { what: 'incidents' } } }],
    oracle: {
      primary_stratum: 'true_zero',
      expected_answer_boundaries: { negative_required: true },
      subject: { plural: 'incidents' },
      entity: 'synthetic',
      tool_calls: [],
    },
  };
  const normalized = normalizeArtifact(artifact, caseDef, 'random_opaque');
  return {
    blindId: normalized.blindId,
    artifact,
    caseDef,
    normalized,
    truth: makeLabelPacket(normalized),
    usefulness: makeUsefulnessPacket(normalized),
  };
}

function truthLabels(record = fixture()) {
  return {
    sentences: record.truth.stages.flatMap((stage: { sentences: { id: string }[] }) =>
      stage.sentences.map((sentence) => ({
        id: sentence.id,
        kind: 'scoped-negative',
        truth: 'supported',
        flat: false,
        asks: false,
        substitution: false,
        reason: 'Dated scope retained.',
      })),
    ),
    citations: record.truth.stages.flatMap((stage: { citations: { id: string }[] }) =>
      stage.citations.map((citation) => ({
        id: citation.id,
        valid: true,
        correct: false,
        rightReads: [],
        reason: 'Earlier-turn evidence does not settle now.',
      })),
    ),
  };
}

function ratings(record = fixture()) {
  return new Map([
    [JSON.stringify([record.blindId, 'truth', 'A']), truthLabels(record)],
    [JSON.stringify([record.blindId, 'truth', 'B']), truthLabels(record)],
    [
      JSON.stringify([record.blindId, 'usefulness', 'A']),
      { score: 4, reason: 'Accurate limitation.' },
    ],
    [
      JSON.stringify([record.blindId, 'usefulness', 'B']),
      { score: 4, reason: 'Useful uncertainty.' },
    ],
  ]);
}

function cappedFixture() {
  const base = fixture();
  const message = 'benchmark permits one answer and one genuine tools-off citation correction';
  const args = { service: 'synthetic' };
  const response = {
    content: 'I will inspect the source.',
    toolCalls: [{ id: 'extra-call', name: 'search', args }],
    usage: { input: 20, output: 30, cacheRead: 5, cacheWrite: 7 },
    stopReason: 'tool_use',
    providerRef: 'vendor-response-1',
  };
  const artifact = {
    ...base.artifact,
    raw: {
      ...base.artifact.raw,
      calls: [
        base.artifact.raw.calls[0],
        { source: 'provider', turn: 2, response, candidate: { valid: false } },
        {
          source: 'provider',
          turn: 2,
          chunks: [],
          request: { tools: [{}] },
          error: { name: 'Error', message },
        },
      ],
      turns: [
        base.artifact.raw.turns[0],
        {
          ...base.artifact.raw.turns[1],
          output: null,
          error: { name: 'RunCheckpointError', message: `Underlying error: ${message}` },
          delivered: { tokens: ['I will inspect ', 'the source.'], turnEnds: [] },
        },
      ],
    },
    wire: [
      {
        id: 'ledger-reservation-1',
        response: {
          id: response.providerRef,
          content: [
            { type: 'text', text: response.content },
            { type: 'tool_use', id: 'extra-call', name: 'search', input: { ...args } },
          ],
          usage: {
            input_tokens: 20,
            output_tokens: 30,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: 7,
          },
          stop_reason: 'tool_use',
        },
      },
    ],
  };
  return { artifact, caseDef: base.caseDef, blindId: base.blindId };
}

describe('audited unsent-stage processing amendment', () => {
  it('retains the failed trial and its streamed preamble while labelling only actual model text', () => {
    const f = cappedFixture(),
      before = JSON.stringify(f.artifact);
    const normalized = normalizeArtifact(f.artifact, f.caseDef, f.blindId);
    expect(normalized.stages).toEqual([{ text: 'I will inspect the source.', citations: [] }]);
    expect(normalized.trialFailure).toEqual({
      code: 'harness-call-cap',
      unsentStages: 1,
      finalError: 'RunCheckpointError',
    });
    expect(normalized.delivered).toContain('Partial streamed text');
    expect(normalized.delivered).toContain('I will inspect the source.');
    expect(normalized.delivered).toContain('No final answer was delivered');
    const truth = makeLabelPacket(normalized);
    expect(truth.stages).toHaveLength(1);
    expect(JSON.stringify(truth)).not.toContain('harness-call-cap');
    expect(makeUsefulnessPacket(normalized).answer).toBe(normalized.delivered);
    expect(JSON.stringify(f.artifact)).toBe(before);
  });

  it('counts only the paid response tokens, including cache traffic; the unsent stage adds zero', () => {
    const f = cappedFixture();
    const normalized = normalizeArtifact(f.artifact, f.caseDef, f.blindId);
    const record = { ...f, normalized, truth: makeLabelPacket(normalized) };
    const lib = { observeNegativeProse: () => [], detectNegativeClaims: () => ({ claims: [] }) };
    const scored = normalizedScoreRow(
      record,
      { truth: truthLabels(record), usefulness: { score: 1, reason: 'No final answer.' } },
      lib,
    );
    expect(scored.tokens).toBe(62);
    expect(scored.id).toBe(f.artifact.row.id);
    expect(scored.trialFailure).toEqual(normalized.trialFailure);
    expect(scored.fieldPresent).toBe(false);
    expect(scored.citations).toEqual([]);
    expect(scored.rewordingEligible).toBe(false);
  });

  it.each([
    [
      'another error',
      (f: ReturnType<typeof cappedFixture>) =>
        Object.assign(f.artifact.raw.calls[2].error!, { message: 'network failed' }),
    ],
    [
      'different error type',
      (f: ReturnType<typeof cappedFixture>) =>
        Object.assign(f.artifact.raw.calls[2].error!, { name: 'AbortError' }),
    ],
    [
      'a received chunk',
      (f: ReturnType<typeof cappedFixture>) =>
        Object.assign(f.artifact.raw.calls[2], { chunks: [{ content: 'partial' }] }),
    ],
    [
      'a nonfailure final',
      (f: ReturnType<typeof cappedFixture>) =>
        Object.assign(f.artifact.raw.turns[1], { error: null }),
    ],
    [
      'a final answer',
      (f: ReturnType<typeof cappedFixture>) =>
        Object.assign(f.artifact.raw.turns[1], { output: 'delivered' }),
    ],
    [
      'a correction-shaped request',
      (f: ReturnType<typeof cappedFixture>) =>
        Object.assign(f.artifact.raw.calls[2], { request: { tools: [] } }),
    ],
    [
      'no preceding tool proposal',
      (f: ReturnType<typeof cappedFixture>) =>
        Object.assign(f.artifact.raw.calls[1].response!, { toolCalls: [] }),
    ],
    [
      'missing wire',
      (f: ReturnType<typeof cappedFixture>) => {
        f.artifact.wire.length = 0;
      },
    ],
    [
      'an extra wire call',
      (f: ReturnType<typeof cappedFixture>) => {
        f.artifact.wire.push(structuredClone(f.artifact.wire[0]));
      },
    ],
    [
      'wire response id differs',
      (f: ReturnType<typeof cappedFixture>) => {
        f.artifact.wire[0].response.id = 'other';
      },
    ],
    [
      'wire text differs',
      (f: ReturnType<typeof cappedFixture>) => {
        f.artifact.wire[0].response.content[0].text = 'Other text.';
      },
    ],
    [
      'wire tool arguments differ',
      (f: ReturnType<typeof cappedFixture>) => {
        f.artifact.wire[0].response.content[1].input = { service: 'other' };
      },
    ],
    [
      'wire usage differs',
      (f: ReturnType<typeof cappedFixture>) => {
        f.artifact.wire[0].response.usage.input_tokens++;
      },
    ],
    [
      'wire stop differs',
      (f: ReturnType<typeof cappedFixture>) => {
        f.artifact.wire[0].response.stop_reason = 'end_turn';
      },
    ],
    [
      'wire failure',
      (f: ReturnType<typeof cappedFixture>) =>
        Object.assign(f.artifact.wire[0], { error: 'unknown transmission' }),
    ],
    [
      'free preflight only',
      (f: ReturnType<typeof cappedFixture>) =>
        Object.assign(f.artifact.wire[0], { preflight: true }),
    ],
  ])('still rejects a missing response with %s', (_name, alter) => {
    const f = cappedFixture();
    (alter as (value: ReturnType<typeof cappedFixture>) => void)(f);
    expect(() => normalizeArtifact(f.artifact, f.caseDef, f.blindId)).toThrow('terminal response');
  });

  it('never counts a zero-response cap record as a completed trial', () => {
    const f = cappedFixture();
    f.artifact.raw.calls.splice(1, 1);
    f.artifact.wire.length = 0;
    expect(() => normalizeArtifact(f.artifact, f.caseDef, f.blindId)).toThrow('terminal response');
  });

  it('preserves fenced JSON byte-for-byte without recovering citations or upgrading validity', () => {
    const record = fixture();
    const text =
      '```json\n{"summary":"No incidents.","negatives":[{"kind":"none","about":"synthetic","restsOn":["r1"]}]}\n```';
    record.artifact.raw.calls[1].response.content = text;
    Object.assign(record.artifact.raw.calls[1], { candidate: { valid: false } });
    const before = JSON.stringify(record.artifact);
    const normalized = normalizeArtifact(record.artifact, record.caseDef, record.blindId);
    expect(normalized.stages[0]).toEqual({ text, citations: [] });
    expect(JSON.stringify(record.artifact)).toBe(before);
  });
});

describe('native artifacts cross a narrow blinding boundary', () => {
  it('binds real native handles despite the intentionally hidden host-filled tenant argument', async () => {
    const caseDef = {
      id: 'native-normalization',
      prompt: 'Read incidents for payments.',
      tools: [
        {
          name: 'read_incidents',
          description: 'Read this tenant incidents.',
          inputSchema: {
            type: 'object',
            properties: { service: { type: 'string' } },
            required: ['service'],
          },
          effects: 'read',
          search: {
            source: { what: 'incident store', said: ['incident store'] },
            subject: { what: 'incidents', said: ['incidents'] },
            arguments: [{ name: 'service', role: 'population' }],
            complete: 'within-arguments',
          },
          responses: [
            {
              kind: 'absent',
              value: {
                what: 'incidents',
                checked: 'declared',
                resolved: [{ argument: 'service', id: 'payments', name: 'payments' }],
              },
            },
          ],
        },
      ],
      schedule: [[{ name: 'read_incidents', arguments: { service: 'payments' } }]],
    };
    const raw = await runCase({
      doors: { root, observe, memory, negative },
      caseDef,
      arm: 'observe',
      cell: 'main',
      model: 'mock',
      rep: 0,
      provider: {
        name: 'source-mock',
        complete: async () => ({
          content: JSON.stringify({
            summary: 'The search found no incidents.',
            negatives: [{ kind: 'none', about: 'payments', restsOn: ['r1'] }],
          }),
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'stop',
        }),
      },
    });
    expect(raw.turns[0].error).toBeNull();
    expect(raw.attempts[0].args.benchTenant).toBe(raw.identity.tenant);
    expect(raw.turns[0].nativeRecord.calls[0].arguments).not.toHaveProperty('benchTenant');
    expect(raw.attempts[0].toolCallId).toBe(raw.turns[0].nativeRecord.calls[0].toolCallId);
    const normalized = normalizeArtifact({ raw }, caseDef, 'opaque_native');
    expect(normalized.toolTruth[0].id).toBe('r1');
    expect(normalized.toolTruth[0].arguments.benchTenant).toBe(raw.identity.tenant);
    raw.attempts[0].args.service = 'different-service';
    expect(normalizeArtifact({ raw }, caseDef, 'opaque_native').toolTruth[0].id).toBe(
      'unserved-read-1',
    );
  });

  it('retains each original provider draft, excludes script/delivery/diagnostic/model metadata', () => {
    const record = fixture(),
      packet = record.truth;
    expect(packet.stages).toHaveLength(2);
    expect(packet.stages[0].sentences[0].text).toBe('There are no incidents.');
    expect(JSON.stringify(packet)).not.toContain('SECRET');
    expect(JSON.stringify(packet)).not.toContain('private-case');
    expect(packet.toolTruth).toHaveLength(1);
    expect(packet.toolTruth[0]).toMatchObject({
      id: 'r1',
      result: { readTurn: 1, answeringTurn: 2, readAt: '2026-10-23T12:00:00Z', data: { rows: [] } },
    });
    expect(record.usefulness.answer).toContain('DELIVERED_LIBRARY_SECRET');
  });

  it('does not bind a citation handle by tool name when executed arguments differ', () => {
    const record = fixture();
    record.artifact.raw.attempts[0].args = { service: 'other', benchTenant: 'owner' };
    const normalized = normalizeArtifact(record.artifact, record.caseDef, 'opaque');
    expect(normalized.toolTruth[0].id).toBe('unserved-read-1');
  });

  it('preserves invalid model text and explicitly represents no delivered answer', () => {
    const record = fixture();
    record.artifact.raw.calls[1].response.content = 'Invalid JSON. No incidents?';
    Object.assign(record.artifact.raw.turns[1], { output: null });
    const normalized = normalizeArtifact(record.artifact, record.caseDef, 'opaque');
    expect(normalized.stages[0]).toEqual({ text: 'Invalid JSON. No incidents?', citations: [] });
    expect(normalized.delivered).toContain('No final answer was delivered');
  });

  it('does not synthesize an empty response when the provider never returned one', () => {
    const record = fixture();
    Object.assign(record.artifact.raw.calls[1], { response: undefined });
    expect(() => normalizeArtifact(record.artifact, record.caseDef, 'opaque')).toThrow(
      'terminal response',
    );
  });
});

describe('shared-budget rating and resumability', () => {
  it('rejects a nested output directory or saved-file symlink into the repository before any call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'negative-rate-symlink-'));
    const ledger = new BudgetLedger(join(dir, 'budget.jsonl'));
    const packets = [fixture().truth],
      fetchImpl = vi.fn();
    symlinkSync(ROOT, join(dir, 'nested'));
    await expect(
      rateBatch({
        packets,
        kind: 'truth',
        session: 'A',
        dir: join(dir, 'nested'),
        ledger,
        fetchImpl,
      }),
    ).rejects.toThrow(/outside the repository|private/i);
    symlinkSync(join(ROOT, 'package.json'), join(dir, `truth-A-${digest(packets)}.json`));
    await expect(
      rateBatch({ packets, kind: 'truth', session: 'A', dir, ledger, fetchImpl }),
    ).rejects.toThrow(/outside the repository|private/i);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ledger.entries.size).toBe(0);
  });

  it('uses the existing agent ledger, isolates A/B, and resumes a saved invalid rating without resending', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-not-a-real-key');
    const dir = mkdtempSync(join(tmpdir(), 'negative-rate-'));
    const ledger = new BudgetLedger(join(dir, 'budget.jsonl'));
    ledger.reserve('agent-request', 'claude-haiku-4-5-20251001', 1000, 'agent-row');
    ledger.settle('agent-request', { input_tokens: 100, output_tokens: 100 });
    let generations = 0;
    const requests: Record<string, unknown>[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      if (url.endsWith('/count_tokens')) return new Response(JSON.stringify({ input_tokens: 100 }));
      generations++;
      requests.push(JSON.parse(init.body as string));
      expect(
        [...ledger.entries.values()].some((e: { status: string }) => e.status === 'reserved'),
      ).toBe(true);
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'not valid labels' }],
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
      );
    };
    const packets = [fixture().truth];
    const a = await rateBatch({ packets, kind: 'truth', session: 'A', dir, ledger, fetchImpl });
    expect(a.ratings[0].ok).toBe(false);
    const saved = readdirSync(dir).find((name) => name.startsWith('truth-A-'))!;
    expect(JSON.parse(readFileSync(join(dir, saved), 'utf8')).response.content[0].text).toBe(
      'not valid labels',
    );
    const resumed = await rateBatch({
      packets,
      kind: 'truth',
      session: 'A',
      dir,
      ledger: new BudgetLedger(join(dir, 'budget.jsonl')),
      fetchImpl,
    });
    expect(resumed.reused).toBe(true);
    await rateBatch({ packets, kind: 'truth', session: 'B', dir, ledger, fetchImpl });
    expect(generations).toBe(2);
    expect(ledger.entries.size).toBe(3);
    expect(ledger.summary().chargedUsd).toBeCloseTo(0.00064);
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0]).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 4096,
      stream: false,
    });
  });

  it('never automatically retries an uncertain call when no response was saved', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-not-a-real-key');
    const dir = mkdtempSync(join(tmpdir(), 'negative-rate-stop-'));
    const ledger = new BudgetLedger(join(dir, 'budget.jsonl'));
    let generations = 0;
    const fetchImpl = async (url: string) => {
      if (url.endsWith('/count_tokens')) return new Response(JSON.stringify({ input_tokens: 100 }));
      generations++;
      throw new Error('simulated network ambiguity');
    };
    const options = {
      packets: [fixture().truth],
      kind: 'truth',
      session: 'A',
      dir,
      ledger,
      fetchImpl,
    };
    await expect(rateBatch(options)).rejects.toThrow('network ambiguity');
    await expect(rateBatch(options)).rejects.toThrow('reconcile');
    expect(generations).toBe(1);
    expect(ledger.summary().uncertain).toBe(1);
    expect(ledger.summary().chargedUsd).toBeGreaterThan(0);
  });

  it('builds both independent sessions and both passes in batches of at most4', () => {
    const records = Array.from({ length: 9 }, () => fixture());
    const plan = ratingPlan(records);
    expect(plan).toHaveLength(12);
    expect(plan.every((b: { packets: unknown[] }) => b.packets.length <= 4)).toBe(true);
  });
});

describe('strict packet labels and owner decisions', () => {
  it('batch omissions remain unknown and unknown/duplicate IDs cannot overwrite a label', () => {
    const record = fixture();
    const response = (packets: unknown[]) => ({
      content: [{ type: 'text', text: JSON.stringify({ packets }) }],
    });
    expect(validateBatch([record.truth], response([]))[0]).toMatchObject({ ok: false });
    const value = { id: record.blindId, labels: truthLabels(record) };
    expect(validateBatch([record.truth], response([value]))[0].ok).toBe(true);
    expect(validateBatch([record.truth], response([value, value]))[0].ok).toBe(false);
    expect(
      validateBatch([record.truth], { ...response([value]), stop_reason: 'max_tokens' })[0].ok,
    ).toBe(false);
  });

  it('agreed usefulness remains valid, and all truth stages are preserved', () => {
    const record = fixture(),
      resolved = resolveRatings([record], ratings(record));
    expect(resolved.queue).toHaveLength(0);
    expect(resolved.resolved.get(record.blindId).truth.sentences).toHaveLength(2);
    expect(resolved.resolved.get(record.blindId).usefulness.score).toBe(4);
  });

  it('allows a partial owner decision while keeping every other disagreement queued', () => {
    const record = fixture(),
      all = ratings(record),
      b = truthLabels(record);
    b.sentences[0].truth = 'unsupported';
    b.sentences[1].flat = true;
    all.set(JSON.stringify([record.blindId, 'truth', 'B']), b);
    const pending = resolveRatings([record], all);
    expect(pending.queue).toHaveLength(2);
    const resolved = resolveRatings([record], all, [
      {
        packetId: record.blindId,
        kind: 'sentences',
        id: 's1.p1',
        value: truthLabels(record).sentences[0],
      },
    ]);
    expect(resolved.queue).toHaveLength(1);
    expect(resolved.resolved.get(record.blindId).truth).toBeUndefined();
  });

  it('rejects malformed or unrelated owner decisions instead of trusting a file flag', () => {
    const record = fixture();
    expect(() =>
      resolveRatings([record], ratings(record), [
        { packetId: 'invented', kind: 'usefulness', value: { score: 5, reason: 'Approved.' } },
      ]),
    ).toThrow('no current dispute');
  });
});

describe('normalization and public result boundaries', () => {
  const lib = { observeNegativeProse: () => [], detectNegativeClaims: () => ({ claims: [] }) };

  it('counts a detected supported scoped negative as a true positive, separate from an overclaim', () => {
    const record = fixture(),
      resolved = resolveRatings([record], ratings(record));
    Object.assign(record.artifact.raw.calls[2], {
      request: { tools: [], system: 'internal citation correction' },
    });
    const detecting = {
      ...lib,
      observeNegativeProse: () => [
        {
          kind: 'negative-claim',
          span: { start: 0, end: record.normalized.stages.at(-1).text.length },
        },
      ],
    };
    const value = normalizedScoreRow(record, resolved.resolved.get(record.blindId), detecting);
    expect(value.detector).toEqual([{ positive: true, detected: true }]);
    expect(value.rewordingEligible).toBe(true);
    expect(value.reworded).toBe(false);
    const scored = scoreRows([value], { expectedReplyIds: [value.id], scriptedPassed: true });
    expect(scored.groups[0].metrics.sensitivity.observations).toEqual({ num: 1, den: 1, point: 1 });
    expect(scored.groups[0].metrics.specificity.observations.den).toBe(0);
  });

  it.each([false, true])(
    'long-cell negative requirement follows the fresh-turn oracle: %s',
    (required) => {
      const record = fixture();
      Object.assign(record.caseDef, {
        longContext: { expectedFresh: { negative_required: required } },
      });
      record.artifact.raw.attempts[0].turn = 2;
      Object.assign(record.artifact.raw.turns[1].nativeRecord.calls[0], {
        turn: 2,
        effect: 'read',
        outcome: 'ok',
      });
      const resolved = resolveRatings([record], ratings(record));
      const value = normalizedScoreRow(record, resolved.resolved.get(record.blindId), lib);
      expect(value.negativeRequired).toBe(required);
      expect(value.citations[0].trueZero).toBe(required);
      record.artifact.raw.attempts[0].outcome = 'threw';
      const failed = normalizedScoreRow(record, resolved.resolved.get(record.blindId), lib);
      expect(failed.negativeRequired).toBe(false);
      expect(failed.citations[0].trueZero).toBe(false);
    },
  );

  it('counts both paid stages, excludes scripted tokens and never treats wrong-citation withholding as a false hold', () => {
    const record = fixture(),
      resolved = resolveRatings([record], ratings(record));
    const row = normalizedScoreRow(record, resolved.resolved.get(record.blindId), lib);
    expect(row).toMatchObject({
      tokens: 100,
      labelsComplete: true,
      ownerPending: false,
      negativeRequired: false,
      citations: [
        { valid: true, correct: false, trueZero: false, held: true },
        { valid: true, correct: false, trueZero: false, held: true },
      ],
    });
  });

  it('includes a large cache hit and both stages cache writes, excluding scripted usage', () => {
    const record = fixture(),
      resolved = resolveRatings([record], ratings(record));
    Object.assign(record.artifact.raw.calls[0].response.usage, { cacheRead: 900_000 });
    Object.assign(record.artifact.raw.calls[1].response.usage, {
      cacheRead: 250_000,
      cacheWrite: 4_000,
    });
    Object.assign(record.artifact.raw.calls[2].response.usage, { cacheRead: 0, cacheWrite: 64 });
    expect(normalizedScoreRow(record, resolved.resolved.get(record.blindId), lib).tokens).toBe(
      254_164,
    );
  });

  it.each(['cacheRead', 'cacheWrite'])('invalid %s remains unknown and blocks scoring', (field) => {
    for (const invalid of [-1, 1.5, NaN, Infinity, '20', null, Number.MAX_SAFE_INTEGER + 1]) {
      const record = fixture(),
        resolved = resolveRatings([record], ratings(record));
      Object.assign(record.artifact.raw.calls[1].response.usage, { [field]: invalid });
      const value = normalizedScoreRow(record, resolved.resolved.get(record.blindId), lib);
      expect(value.tokens).toBeUndefined();
      const score = scoreRows([value], { expectedReplyIds: [value.id], scriptedPassed: true });
      expect(score.complete).toBe(false);
      expect(score.problems[0].errors).toContain('tokens missing');
    }
  });

  it('missing labels never normalize to a complete all-clear', () => {
    const record = fixture();
    expect(normalizedScoreRow(record, undefined, lib)).toMatchObject({
      labelsComplete: false,
      ownerPending: true,
    });
  });

  it.each([false, true])(
    'keeps the initial correct citation when correction preserves it: %s',
    (preserved) => {
      const record = fixture();
      record.artifact.row.cell = 'main';
      const correct = { kind: 'none', about: 'synthetic', restsOn: ['r1'] };
      const wrong = { ...correct, restsOn: ['r9'] };
      const initial = { summary: 'The search found no incidents.', negatives: [correct, wrong] };
      const final = {
        summary: 'The search found no incidents.',
        negatives: preserved ? [correct] : [],
      };
      record.artifact.raw.calls[1].response.content = JSON.stringify(initial);
      record.artifact.raw.calls[2].response.content = JSON.stringify(final);
      record.artifact.raw.calls[2].candidate!.value = final;
      Object.assign(record.artifact.raw.calls[2], {
        request: { tools: [], system: 'internal citation correction' },
      });
      record.artifact.raw.turns[1].output = JSON.stringify(final);
      record.artifact.raw.turns[1].answerNegatives!.checks = preserved
        ? [{ code: 'established' }]
        : [];
      record.normalized = normalizeArtifact(record.artifact, record.caseDef, record.blindId);
      record.truth = makeLabelPacket(record.normalized);
      const truth = truthLabels(record);
      for (const citation of truth.citations) {
        const valid = citation.id !== 's1.c2';
        Object.assign(citation, { valid, correct: valid, rightReads: valid ? ['r1'] : [] });
      }
      const value = normalizedScoreRow(
        record,
        { truth, usefulness: { score: 4, reason: 'Synthetic.' } },
        lib,
      );
      expect(value.citations[0]).toMatchObject({
        stageId: 's1',
        proposalId: 's1.c1',
        correct: true,
        trueZero: true,
        held: !preserved,
      });
      expect(value.citations[1]).toMatchObject({ correct: false, held: true });
      const scored = scoreRows([value], { expectedReplyIds: [value.id], scriptedPassed: true });
      expect(scored.groups[0].metrics.falseHold.observations.num).toBe(preserved ? 0 : 1);
      expect(scored.groups[0].citationStages.s1.falseHold.observations).toMatchObject({
        num: preserved ? 0 : 1,
        den: 1,
      });
      expect(scored.groups[0].metrics.fieldDrop.observations.num).toBe(preserved ? 0 : 1);
    },
  );

  it('public summary excludes row/case ids and raw disagreements', () => {
    const result = publicSummary(
      {
        complete: false,
        expectedReplies: 784,
        receivedReplies: 1,
        scoredReplies: 0,
        caseRule: 'actual cases',
        groups: [],
        problems: [
          { id: 'PRIVATE_CASE_TEXT', reason: 'missing reply', errors: ['PRIVATE_MODEL_OUTPUT'] },
        ],
      },
      3,
      { capUsd: 4.3 },
    );
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(result).toMatchObject({
      status: 'pending-or-incomplete',
      ownerDecisionsPending: 3,
      expectedReplies: 784,
    });
  });
});
