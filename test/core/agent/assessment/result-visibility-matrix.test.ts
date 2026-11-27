import { describe, expect, it, vi } from 'vitest';
import {
  absent,
  Agent,
  allow,
  coverage,
  defineTool,
  deny,
  describedResult,
  inMemoryArtifacts,
  withDatasetArtifacts,
  type AgentInput,
  type OutputSchemaParser,
  type ToolMiddleware,
} from '../../../../src/index.js';
import { assessmentDataOf } from '../../../../src/core/agent/assessment/compose.js';
import { REASON_WITNESS_CLASSES } from '../../../../src/core/agent/assessment/reasonClasses.js';
import type { AssessmentReason } from '../../../../src/core/agent/assessment/types.js';
import { mock } from '../../../../src/llm-providers.js';
import { observeStanding } from './standing-surfaces.js';

const BODY = 'Here is what I can report.';
const TYPED_BODY = JSON.stringify({ summary: BODY, negatives: [] });
const WITHHELD_LINE = 'Not sure — a result was kept out by a rule.';
const NAME = 'fixture_lookup';
const PRIVATE_RESULT = 'private report '.repeat(180);
const PUBLIC_REPLACEMENT = 'public report '.repeat(250);
const QUERY = { from: '2026-10-08T15:40:00Z', to: '2026-10-09T15:40:00Z' };
const OLDER = { from: '2026-06-08T15:40:00Z', to: '2026-06-09T15:40:00Z' };
const PARTLY_HELD = { from: QUERY.from, to: '2026-10-09T03:40:00Z' };

type Mode = 'control' | 'deny' | 'rewrite';
type Delivery = 'inline' | 'deferred';
type Hook = NonNullable<ToolMiddleware['onToolResult']>;

function described(held: typeof QUERY | 'unknown', queried = QUERY) {
  return describedResult({
    facts: [{ entity: 'fixture shelf', count: 1 }],
    provenance: { measuredAt: QUERY.to, source: 'fixture archive' },
    period: { queried, held },
  });
}

const FIXTURES = {
  'result-cut': PRIVATE_RESULT,
  'placed-unread': PRIVATE_RESULT,
  'times-without-zone': [{ ts: '2026-10-09T12:00:00' }],
  'work-not-finished': { content: 'A private job is waiting.', effects: [], status: 'pending' },
  'coverage-gap': coverage([{ entry: 'private' }], {
    checked: ['one shelf'],
    notChecked: ['another'],
  }),
  'declared-absent': absent({ what: 'private entries', checked: ['the archive'] }),
  'empty-undeclared': [],
  'period-not-held': described(OLDER),
  'period-partly-held': described(PARTLY_HELD),
  'period-unknown': described('unknown'),
  'period-undeclared': [{ entry: 'no period declared' }],
  'period-differs-from-asked': described(QUERY, PARTLY_HELD),
  // The requested window is allowed. The tool itself reports a read wholly outside retention.
  'period-beyond-retention': described(OLDER, OLDER),
  'column-type-mismatch': [{ logical_unit_number: 'private label' }],
  'missing-column': [{ private_column: 1 }],
};

type NativeReason = keyof typeof FIXTURES;
type FixtureReason = NativeReason | 'sources-conflict' | 'declaration-overclaimed';
type Proof = Awaited<ReturnType<typeof observeStanding>>;

const columns = new Set<FixtureReason>(['column-type-mismatch', 'missing-column']);
const nativeTime = new Set<FixtureReason>(['period-differs-from-asked', 'period-beyond-retention']);
const nativeDeclarations = new Set<FixtureReason>([
  'coverage-gap',
  'declared-absent',
  'period-not-held',
  'period-partly-held',
  'period-unknown',
  'period-undeclared',
  'period-differs-from-asked',
  'period-beyond-retention',
]);
const deliveredRows = [{ logical_unit_number: 1 }];
const typedReply: OutputSchemaParser<{ summary: string; negatives: unknown[] }> = {
  parse(raw) {
    const value = raw as { summary?: unknown; negatives?: unknown };
    if (typeof value?.summary !== 'string' || !Array.isArray(value.negatives)) {
      throw new Error('summary and negatives are required');
    }
    return { summary: value.summary, negatives: value.negatives };
  },
};
const typedSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    negatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['none', 'not-found', 'complete'] },
          about: { type: ['string', 'number'] },
          restsOn: { type: 'array', items: { type: 'string' } },
        },
        required: ['kind', 'restsOn'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'negatives'],
  additionalProperties: false,
};

function toolCall(id = 'target', args: Record<string, unknown> = {}) {
  return { toolCalls: [{ id, name: NAME, args }] };
}

function previous(id: string, status: string) {
  return {
    basis: 'exploratory',
    previous: [
      {
        toolCallId: id,
        standing: 'fact',
        assertions: [{ subject: { kind: 'port', id: 'p1' }, predicate: 'status', value: status }],
      },
    ],
  };
}

function fixtureAgent(
  reason: FixtureReason,
  mode: Mode,
  observerDelivery: Delivery,
  keepConflict = false,
  policyText?: string,
) {
  const conflict = reason === 'sources-conflict';
  const typed = reason === 'declaration-overclaimed';
  const time = nativeTime.has(reason);
  const column = columns.has(reason);
  const undeclared = reason === 'period-undeclared';
  const constrained = time || undeclared;
  const target = typed ? toolCall('target', { service: 'payments' }) : toolCall();
  const rewrittenStatus = keepConflict ? 'up' : 'down';
  const replies = conflict
    ? [
        toolCall('first', { host: 'old' }),
        toolCall('target', { host: 'private', _findings: previous('first', 'down') }),
        toolCall('last', {
          host: 'other',
          _findings: previous('target', mode === 'rewrite' ? rewrittenStatus : 'up'),
        }),
        BODY,
      ]
    : typed
    ? [toolCall('first', { service: 'billing' }), target, TYPED_BODY]
    : [target, BODY];
  const builder = Agent.create({
    provider: mock({ chunkDelayMs: 0, replies }),
    model: 'mock',
    observerDelivery,
    ...(reason === 'result-cut' && { maxToolResultChars: 500 }),
    ...(reason === 'placed-unread' && {
      artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: 500 } },
    }),
    ...(reason === 'times-without-zone' && { artifacts: inMemoryArtifacts() }),
    // Typed negative-claims turn_end currently carries a live scope value.
    ...(typed &&
      observerDelivery === 'deferred' && { observerDeliveryOptions: { capture: 'ref' as const } }),
    ...(column && { checkColumnTypes: 'warn' as const }),
  });
  const execute = vi.fn((args: Record<string, unknown>) => {
    if (conflict) return [{ port: 'p1', status: args.host === 'private' ? 'up' : 'down' }];
    if (typed)
      return args.service === 'billing'
        ? [{ incident: 'fixture incident' }]
        : { content: 'Service payments does not exist.', effects: [], status: 'denied' };
    return FIXTURES[reason];
  });
  const tool = defineTool({
    name: NAME,
    description: 'Read a fixture archive.',
    inputSchema: {
      type: 'object',
      properties: {
        ...(conflict && { host: { type: 'string' } }),
        ...(typed && { service: { type: 'string' } }),
        ...(constrained && { start: { type: 'integer' }, end: { type: 'integer' } }),
      },
    },
    ...(typed && {
      effects: 'read' as const,
      search: {
        source: { what: 'incident store', said: ['incident store'] },
        subject: { what: 'incidents', said: ['incidents'] },
        arguments: [{ name: 'service', role: 'population' as const }],
        complete: 'within-arguments' as const,
      },
    }),
    ...(column && { resultColumns: { logical_unit_number: 'number' } }),
    ...(constrained && {
      askOrAssume: { start: { ask: 'From when?' }, end: { ask: 'Until when?' } },
      period: {
        ...(reason === 'period-beyond-retention' && { retention: '90d' }),
        forms: [
          {
            kind: 'bounds',
            from: { argument: 'start', as: 'epoch-ms' },
            to: { argument: 'end', as: 'epoch-ms', edge: 'exclusive' },
          },
        ],
      },
    }),
    execute,
  });
  builder.tool(
    reason === 'times-without-zone'
      ? withDatasetArtifacts(tool, {
          describe: (result) => ({
            datasets: [
              {
                key: 'clock',
                artifact: {
                  kind: 'dataset/clock',
                  mediaType: 'application/json',
                  data: result,
                  timeAxis: { column: 'ts', unit: 'iso' },
                },
              },
            ],
            project: ([publication]) => ({ ticket: publication!.artifact }),
          }),
        })
      : tool,
  );

  if (conflict) builder.findings();
  if (constrained) builder.time({ zone: 'UTC' });
  else builder.resultsLayer();
  if (typed) {
    builder
      .outputSchema(typedReply, { jsonSchema: typedSchema })
      .negativeClaims({ field: 'negatives', tools: [NAME] })
      .answerLayer();
  } else {
    builder.answerLayer({ standingLine: true });
  }
  const policy = vi.fn<Hook>(({ toolCallId }) => {
    if (toolCallId !== 'target' || mode === 'control') return allow();
    return mode === 'deny'
      ? deny(policyText ?? 'Archive result is unavailable.')
      : allow(
          policyText ?? (conflict ? [{ port: 'p1', status: rewrittenStatus }] : deliveredRows),
          'Serve the public index.',
        );
  });
  builder.toolMiddleware({ name: 'archive_rule', onToolResult: policy });
  const input: AgentInput = {
    message: typed ? 'Any open incidents for billing and payments?' : 'Check the archive.',
    ...(constrained && { time: { now: QUERY.to, window: QUERY } }),
  };
  return { agent: builder.build(), input, execute, policy };
}

async function prove(
  reason: FixtureReason,
  mode: Mode,
  delivery: Delivery,
  keepConflict = false,
  policyText?: string,
): Promise<Proof> {
  const { agent, input, execute, policy } = fixtureAgent(
    reason,
    mode,
    delivery,
    keepConflict,
    policyText,
  );
  try {
    const proof = await observeStanding(agent, input);
    expect(execute).toHaveBeenCalledTimes(
      reason === 'sources-conflict' ? 3 : reason === 'declaration-overclaimed' ? 2 : 1,
    );
    expect(policy.mock.calls.filter(([call]) => call.toolCallId === 'target')).toHaveLength(1);
    return proof;
  } finally {
    await agent.shutdown();
  }
}

function checkSurfaces(proof: Proof, reasons: readonly AssessmentReason[]) {
  expect.soft(proof.eventAssessment.reasons, 'answer.assessed').toEqual(reasons);
  expect.soft(proof.turnEnd.answerAssessment, 'turn_end assessment').toEqual(proof.eventAssessment);
  expect.soft(assessmentDataOf(proof.saved), 'saved assessment').toEqual(proof.eventAssessment);
  expect.soft(proof.turnEnd.finalContent, 'turn_end text').toBe(proof.returned);
  expect.soft(proof.sse, 'text SSE').toBe(proof.returned);
  expect.soft(proof.aguiText, 'AG-UI assistant text').toBe(proof.returned);
}

const witnessCases = REASON_WITNESS_CLASSES.filter(({ class: kind }) => kind === 'result');
const fixtureNames = new Set<string>([
  ...Object.keys(FIXTURES),
  'sources-conflict',
  'declaration-overclaimed',
]);

describe('result witness privacy through a live answer', () => {
  it('uses a real fixture for every result witness in the reason table', () => {
    expect(new Set(witnessCases.map(({ reason }) => reason))).toEqual(fixtureNames);
  });

  it.each(
    witnessCases.flatMap(({ reason, witness }) =>
      (['inline', 'deferred'] as const).map((delivery) => ({
        reason: reason as FixtureReason,
        witness,
        delivery,
      })),
    ),
  )('$reason / $witness ($delivery) admits only served evidence', async ({ reason, delivery }) => {
    const typed = reason === 'declaration-overclaimed';
    const control = await prove(reason, 'control', delivery);
    const expectedControl: readonly AssessmentReason[] = typed
      ? ['call-not-completed', reason, 'check-unreachable']
      : reason === 'period-beyond-retention'
      ? ['period-differs-from-asked', reason]
      : [reason];
    checkSurfaces(control, expectedControl);
    // A typed answer can carry the assessment as data, but cannot append prose to its schema.
    if (typed) expect(control.returned).toBe(TYPED_BODY);
    else expect(control.returned).toMatch(/^Here is what I can report\.\n\n---\n\nNot sure — /);

    const denied = await prove(reason, 'deny', delivery);
    checkSurfaces(denied, typed ? ['result-withheld', 'check-unreachable'] : ['result-withheld']);
    expect(denied.returned).toBe(typed ? TYPED_BODY : `${BODY}\n\n---\n\n${WITHHELD_LINE}`);
    expect(denied.saved.reasons[0]?.witness ?? []).toEqual([]);
    expect(denied.saved.checked.some(({ check }) => check === 'result-period')).toBe(false);

    const rewritten = await prove(reason, 'rewrite', delivery);
    checkSurfaces(
      rewritten,
      nativeDeclarations.has(reason) ? expectedControl : typed ? ['check-unreachable'] : [],
    );
    if (typed) expect(rewritten.returned).toBe(TYPED_BODY);
    else if (nativeDeclarations.has(reason))
      expect(rewritten.returned).toMatch(/^Here is what I can report\.\n\n---\n\nNot sure — /);
    else
      expect(rewritten.returned).toMatch(
        /^Here is what I can report\.\n\n---\n\nConsistent with the run's record — /,
      );
    if (columns.has(reason)) {
      for (const governed of [denied, rewritten]) {
        expect(governed.recording.snapshot.sharedState.findingsLedger).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: 'integrity-finding', finding: reason }),
          ]),
        );
      }
    }
  });

  it.each(
    (['inline', 'deferred'] as const).flatMap((delivery) =>
      (['result-cut', 'placed-unread'] as const).map((reason) => ({ delivery, reason })),
    ),
  )(
    'reports the $reason of a served replacement but hides a denial ($delivery)',
    async ({ delivery, reason }) => {
      const replacement = await prove(reason, 'rewrite', delivery, false, PUBLIC_REPLACEMENT);
      checkSurfaces(replacement, [reason]);
      if (reason === 'result-cut') {
        expect(replacement.returned).toContain(
          `of ${PUBLIC_REPLACEMENT.length.toLocaleString('en-US')} characters`,
        );
        expect(replacement.returned).not.toContain(PRIVATE_RESULT.length.toLocaleString('en-US'));
      } else {
        expect(replacement.returned).toContain('stored by reference');
      }

      const denied = await prove(reason, 'deny', delivery, false, PUBLIC_REPLACEMENT);
      checkSurfaces(denied, ['result-withheld']);
      expect(denied.saved.reasons[0]?.witness ?? []).toEqual([]);
      expect(denied.returned).toBe(`${BODY}\n\n---\n\n${WITHHELD_LINE}`);
    },
  );

  it('keeps a withheld call separate from a later cut with the same provider call ID', async () => {
    const tool = defineTool<{ source: string }, string>({
      name: NAME,
      description: 'Read a selected archive.',
      inputSchema: {
        type: 'object',
        properties: { source: { type: 'string' } },
        required: ['source'],
      },
      execute: ({ source }) => (source === 'private' ? PRIVATE_RESULT : PUBLIC_REPLACEMENT),
    });
    const agent = Agent.create({
      model: 'mock',
      provider: mock({
        replies: [
          toolCall('repeated', { source: 'private' }),
          toolCall('repeated', { source: 'public' }),
          BODY,
        ],
        chunkDelayMs: 0,
      }),
      maxToolResultChars: 500,
    })
      .tool(tool)
      .toolMiddleware({
        name: 'private_archive',
        onToolResult: ({ result }) => (result === PRIVATE_RESULT ? deny('Unavailable.') : allow()),
      })
      .limitsTravelWithTheAnswer()
      .build();
    try {
      const proof = await observeStanding(agent, { message: 'Check both archives.' });
      checkSurfaces(proof, ['result-withheld', 'result-cut']);
      expect(proof.returned).toContain(PUBLIC_REPLACEMENT.length.toLocaleString('en-US'));
      expect(proof.returned).not.toContain(PRIVATE_RESULT.length.toLocaleString('en-US'));
    } finally {
      await agent.shutdown();
    }
  });

  it('keeps an unreturned working dataset out of the answer', async () => {
    const tool = defineTool({
      name: NAME,
      description: 'Save a working dataset, then look up public rows.',
      execute: async (_args, ctx) => {
        await ctx.artifacts.put({
          kind: 'dataset/working',
          mediaType: 'application/json',
          timeAxis: { column: 'ts', unit: 'iso' },
          data: [{ ts: '2026-10-09T12:00:00' }, { ts: '2026-10-09T13:00:00' }],
        });
        return deliveredRows;
      },
    });
    const agent = Agent.create({
      model: 'mock',
      provider: mock({ replies: [toolCall(), BODY], chunkDelayMs: 0 }),
      artifacts: inMemoryArtifacts(),
    })
      .tool(tool)
      .limitsTravelWithTheAnswer()
      .build();
    try {
      const proof = await observeStanding(agent, { message: 'Check the public index.' });
      checkSurfaces(proof, []);
      expect(proof.returned).toBe(BODY);
    } finally {
      await agent.shutdown();
    }
  });

  it('keeps a conflict when the replacement result itself still disagrees', async () => {
    const proof = await prove('sources-conflict', 'rewrite', 'inline', true);
    checkSurfaces(proof, ['sources-conflict']);
    expect(proof.returned).toContain('two results the answer stood on disagree');
  });
});
