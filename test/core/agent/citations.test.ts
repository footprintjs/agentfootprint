import { expect, it } from 'vitest';
import { Agent, defineTool, describedResult } from '../../../src/index.js';
import { anthropic } from '../../../src/providers.js';
import { assessAnswer, recordRun } from '../../../src/observe.js';
import type { RedactionPolicy } from 'footprintjs';
import { withFallback } from '../../../src/resilience/withFallback.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import type { ProseCitationOptions } from '../../../src/core/agent/citations/config.js';
import type { AnthropicMessagesBody } from '../../../src/adapters/llm/anthropicMessagesWire.js';

const tool = defineTool({
  name: 'measure',
  description: 'Read the North measurement.',
  inputSchema: { type: 'object', properties: { unit: { type: 'string' } }, required: ['unit'] },
  execute: () =>
    describedResult({
      facts: [{ entity: 'North', amount: 12 }],
      provenance: { measuredAt: '2026-11-23T00:00:00Z', source: 'fixture' },
      coverage: { checked: ['amount'] },
    }),
});

function fixture(
  calls: readonly { readonly id: string; readonly tool: string; readonly input: unknown }[] = [
    { id: 'c1', tool: 'measure', input: { unit: 'mm' } },
  ],
  answer: (marker: string, attempt: number) => string = (marker) =>
    `North recorded 12 mm ${marker}.`,
) {
  const seen: AnthropicMessagesBody[] = [];
  const sdk = anthropic({
    _client: {
      messages: {
        async create(params) {
          seen.push(params);
          const offer =
            (JSON.stringify(params.system) ?? '').match(/\[c:[A-Za-z0-9_-]+:1\]/u)?.[0] ??
            '[c:missing:1]';
          const reading = seen.length === 1;
          return {
            id: reading ? 'measure-turn' : 'answer-turn',
            model: 'claude-sonnet-4-6',
            role: 'assistant',
            content: reading
              ? calls.map(({ id, tool: name, input }) => ({ type: 'tool_use', id, name, input }))
              : [{ type: 'text', text: answer(offer, seen.length) }],
            stop_reason: reading ? 'tool_use' : 'end_turn',
            usage: { input_tokens: 8, output_tokens: 3 },
          };
        },
        stream() {
          throw new Error('The complete path is the fixture.');
        },
      },
    },
  });
  return { provider: { ...sdk, stream: undefined }, seen };
}

const measurementCitations: ProseCitationOptions = {
  verification: {
    rules: [
      {
        id: 'measurement-amount',
        version: '1',
        toolName: 'measure',
        scopeDeclaration: {
          id: 'measurement',
          version: '1',
          dimensions: [{ name: 'unit', argumentPath: ['unit'] }],
        },
        fact: { entity: 'North', field: 'amount' },
        coverage: () => 'complete',
      },
    ],
    authorizeEvidence: () => ({ resultVisible: true, scopeVisible: true }),
  },
  extractClaim: (span) =>
    span === 'North recorded 12 mm'
      ? {
          ruleId: 'measurement-amount',
          entity: 'North',
          field: 'amount',
          intendedScope: { unit: 'mm' },
          value: 12,
        }
      : undefined,
  requestedColumn: (message) => (message.includes('discount') ? 'discount' : undefined),
  completeColumns: () => ['amount'],
};

it.each(['dynamic', 'dynamic-grouped'] as const)(
  'binds the SDK offer in %s and records scoped and column verdicts',
  async (reactMode) => {
    const { provider, seen } = fixture();
    const agent = Agent.create({
      provider,
      model: 'claude-sonnet-4-6',
      reactMode,
      citations: measurementCitations,
    })
      .tool(tool)
      .build();
    const recording = recordRun(agent);
    await expect(agent.run({ message: 'Read discount in mm.' })).resolves.toMatch(
      /\[c:[A-Za-z0-9_-]+:1\]/u,
    );
    expect(seen).toHaveLength(2);
    expect(JSON.stringify(seen[1].system) ?? '').toContain('submitted tool result block 1');
    expect(recording.toRecording().snapshot?.sharedState?.answerCitations).toMatchObject({
      complete: true,
      findings: [
        { kind: 'citation', slot: 1, outcome: 'supported' },
        {
          kind: 'column',
          slot: 1,
          reason: 'ungrounded-entity',
          name: 'discount',
          nearestName: 'amount',
        },
      ],
    });
  },
);

async function runColumnCase(
  message: string,
  completeColumns: readonly string[],
  options: {
    redact?: RedactionPolicy;
    reactMode?: 'dynamic' | 'dynamic-grouped';
    commitValues?: 'full' | 'delta';
  } = {},
) {
  const { provider } = fixture(
    undefined,
    (marker) => 'North recorded 12 mm ' + marker + '. The model also mentioned discount.',
  );
  const agent = Agent.create({
    provider,
    model: 'claude-sonnet-4-6',
    citations: {
      ...measurementCitations,
      requestedColumn: (humanMessage) =>
        /^(?:Read|Average) (discount|amount|rebate) (?:in mm|per region)\.$/u.exec(
          humanMessage,
        )?.[1],
      completeColumns: () => completeColumns,
    },
    ...options,
  })
    .tool(tool)
    .answerLayer({ standingLine: true })
    .build();
  const recorder = recordRun(agent);
  try {
    const answer = await agent.run({ message });
    const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
    const live = await agent.assessment();
    const reopened = assessAnswer(recording);
    expect(live).toEqual(reopened);
    return {
      answer: answer.replace(/\[c:[A-Za-z0-9_-]+:1\]/gu, '[citation]'),
      reasons: live?.reasons,
      standing: live?.standing,
      report: recording.snapshot?.sharedState?.answerCitations,
    };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

it.each([
  { reactMode: 'dynamic', commitValues: 'full' },
  { reactMode: 'dynamic-grouped', commitValues: 'delta' },
] as const)('reports the missing requested column in $reactMode/$commitValues', async (options) => {
  const outcome = await runColumnCase(
    'Average discount per region.',
    ['region', 'amount'],
    options,
  );
  expect(outcome.standing).toBe('not-sure');
  expect(outcome.answer).toContain('requested column `discount`');
  expect(outcome.answer).toContain('closest visible name: `amount`');
  expect(outcome.report).toMatchObject({
    findings: [
      { kind: 'citation', outcome: 'supported' },
      { kind: 'column', reason: 'ungrounded-entity', name: 'discount', nearestName: 'amount' },
    ],
  });
  const present = await runColumnCase('Average amount per region.', ['region', 'amount'], options);
  expect(present.report).toMatchObject({ findings: [{ kind: 'citation', outcome: 'supported' }] });
});

it('does not derive a public column finding from a kept-out user message', async () => {
  const options = { redact: { keys: ['userMessage'] } };
  const first = await runColumnCase('Average discount per region.', ['region', 'amount'], options);
  const second = await runColumnCase('Average rebate per region.', ['region', 'amount'], options);
  expect(first).toEqual(second);
  expect(first.report).toMatchObject({ findings: [{ kind: 'citation', outcome: 'unverified' }] });
});

it.each([
  { keys: ['citationSources'] },
  { keys: ['completeColumns'] },
  { fields: { citationSources: ['0.completeColumns.0'] } },
  { keys: ['citationSources.0.completeColumns.0'] },
  { fields: { citationSources: ['0.callOccurrenceKey.0'] } },
] satisfies RedactionPolicy[])(
  'does not use a kept-out schema or occurrence under %o',
  async (redact) => {
    const options = { redact };
    const missing = await runColumnCase(
      'Average discount per region.',
      ['discounter', 'amount'],
      options,
    );
    const present = await runColumnCase(
      'Average discount per region.',
      ['discount', 'amount'],
      options,
    );
    expect(missing).toEqual(present);
    expect(missing.report).toMatchObject({
      findings: [{ kind: 'citation', outcome: 'supported' }],
    });
  },
);

const day = { from: '2026-11-23T00:00:00Z', to: '2026-11-24T00:00:00Z' };
const measuredScope = { station: 'North', unit: 'mm', grain: 'daily', period: day };
const sensors = ['primary', 'secondary'] as const;
const readings = sensors.map((name, index) =>
  defineTool({
    name,
    description: 'Return one daily station total.',
    inputSchema: {
      type: 'object',
      properties: {
        station: { type: 'string' },
        unit: { type: 'string' },
        grain: { type: 'string' },
        period: {
          type: 'object',
          properties: { from: { type: 'string' }, to: { type: 'string' } },
        },
      },
      required: ['station', 'unit', 'grain', 'period'],
    },
    execute: () =>
      describedResult({
        facts: [{ entity: 'North', amount: index === 0 ? 12 : 11 }],
        provenance: { measuredAt: day.to, source: 'fixture' },
        coverage: { checked: ['amount'] },
        period: { queried: day, held: day },
      }),
  }),
);

it.each([
  { secondUnit: 'mm', expected: [[1, 2]] },
  { secondUnit: 'cm', expected: [] },
])(
  'compares two submitted and uncited tools when the scope matches ($secondUnit)',
  async ({ secondUnit, expected }) => {
    const { provider } = fixture(
      [
        { id: 'call-first', tool: sensors[0], input: measuredScope },
        { id: 'call-second', tool: sensors[1], input: { ...measuredScope, unit: secondUnit } },
      ],
      () => 'The two instruments were read.',
    );
    const agent = Agent.create({
      provider,
      model: 'claude-sonnet-4-6',
      citations: {
        verification: {
          rules: sensors.map((toolName) => ({
            id: toolName,
            version: '1',
            toolName,
            scopeDeclaration: {
              id: 'customer-reading',
              version: '1',
              dimensions: Object.keys(measuredScope).map((name) => ({
                name,
                argumentPath: [name],
              })),
              periodDimension: 'period',
            },
            fact: { entity: { scopeDimension: 'station' }, field: 'amount' },
            coverage: () => 'complete',
          })),
          authorizeEvidence: () => ({ resultVisible: true, scopeVisible: true }),
        },
        comparisonGroups: [{ concept: 'rainfall', rules: sensors }],
      },
    })
      .tool(readings[0])
      .tool(readings[1])
      .build();
    await agent.run({ message: 'Compare the two daily station totals.' });
    const assessment = await agent.assessment();
    expect(assessment?.citations).toEqual({
      complete: true,
      findings: [],
      comparisonComplete: true,
      conflicts: expected,
    });
    const reason = assessment?.reasons.find(({ reason }) => reason === 'sources-conflict');
    if (expected.length > 0) {
      expect(assessment?.standing).toBe('not-sure');
      expect(reason?.source).toEqual({ kind: 'calls', calls: [], unnamed: 2 });
    } else {
      expect(reason).toBeUndefined();
    }
  },
);

it.each(['retry', 'fallback'] as const)(
  'accepts only the winning SDK offer after a discarded %s leaf',
  async (mode) => {
    let discarded: string | undefined;
    const { provider, seen } = fixture(undefined, (marker, attempt) => {
      if (attempt === 2) discarded = marker;
      return attempt === 2
        ? `North recorded 12 mm ${marker}.`
        : `The earlier draft cited ${discarded}. North recorded 12 mm ${marker}.`;
    });
    const primary = {
      ...provider,
      async complete(...args: Parameters<typeof provider.complete>) {
        const response = await provider.complete(...args);
        if (seen.length === 2) throw new Error('Scripted transport discard after normalization.');
        return response;
      },
    };
    const selected =
      mode === 'retry'
        ? withRetry(primary, { maxAttempts: 2, initialDelayMs: 0 })
        : withFallback(primary, provider);
    const agent = Agent.create({
      provider: selected,
      model: 'claude-sonnet-4-6',
      citations: measurementCitations,
    })
      .tool(tool)
      .build();
    await agent.run({ message: 'Read the amount.' });
    expect(seen).toHaveLength(3);
    expect(discarded).toMatch(/^\[c:[A-Za-z0-9_-]+:1\]$/u);
    expect((await agent.assessment())?.citations?.findings).toMatchObject([
      { kind: 'citation', outcome: 'unverified', reason: 'offer-unavailable' },
      { kind: 'citation', outcome: 'supported', slot: 1 },
    ]);
  },
);

it('leaves a plain SDK request and assessment alone with citations disabled', async () => {
  const { provider, seen } = fixture(undefined, () => 'North recorded 12 mm.');
  const agent = Agent.create({ provider, model: 'claude-sonnet-4-6' }).tool(tool).build();
  await expect(agent.run({ message: 'Read the amount.' })).resolves.toBe('North recorded 12 mm.');
  expect(JSON.stringify(seen[1].system) ?? '').not.toContain('citation marker');
  expect((await agent.assessment())?.citations).toBeUndefined();
});

it.each([
  { label: 'list fence', definition: false },
  { label: 'definition inside a fence', definition: true },
])('preserves citation boundaries for a $label in a native SDK answer', async ({ definition }) => {
  const claim = 'North recorded 12 mm';
  const fence = '\x60\x60\x60';
  let proseStart = 0;
  const { provider } = fixture(undefined, (marker) => {
    if (!definition)
      return ['- ' + fence + 'text', '', '  ' + claim + ' ' + marker + '.', '', '  ' + fence].join(
        '\n',
      );
    const example = [fence + 'text', marker + ': sample', fence, '', ''].join('\n');
    proseStart = example.length;
    return example + claim + ' ' + marker + '.';
  });
  const agent = Agent.create({
    provider,
    model: 'claude-sonnet-4-6',
    citations: measurementCitations,
  })
    .tool(tool)
    .build();
  const recording = recordRun(agent);
  await agent.run({ message: 'Read the amount.' });
  expect(recording.toRecording().snapshot?.sharedState?.answerCitations).toEqual({
    complete: true,
    findings: definition
      ? [
          {
            kind: 'citation',
            outcome: 'supported',
            slot: 1,
            start: proseStart,
            end: proseStart + claim.length,
          },
        ]
      : [],
  });
});

it('keeps a supported prose citation after list-item inline code', async () => {
  const ticks = '\x60\x60\x60';
  const { provider } = fixture(
    undefined,
    (marker) => '- ' + ticks + 'example' + ticks + '\n\n  North recorded 12 mm ' + marker + '.',
  );
  const agent = Agent.create({
    provider,
    model: 'claude-sonnet-4-6',
    citations: measurementCitations,
  })
    .tool(tool)
    .build();
  const recording = recordRun(agent);
  try {
    await agent.run({ message: 'Read the amount.' });
    expect(recording.toRecording().snapshot?.sharedState?.answerCitations).toEqual({
      complete: true,
      findings: [{ kind: 'citation', outcome: 'supported', slot: 1, start: 19, end: 39 }],
    });
  } finally {
    recording.stop();
    await agent.shutdown();
  }
});

it.each([
  { punctuation: '.', adjacentProse: false },
  { punctuation: ';', adjacentProse: false },
  { punctuation: '.', adjacentProse: true },
  { punctuation: ';', adjacentProse: true },
])(
  'leaves inline-code markers literal across "$punctuation" (adjacent prose: $adjacentProse)',
  async ({ punctuation, adjacentProse }) => {
    const claim = 'North recorded 12 mm';
    let code = '';
    const { provider, seen } = fixture(undefined, (marker) => {
      code = `Example \`${claim} ${marker}${punctuation} Next example.\`.`;
      return adjacentProse ? `${code} ${claim} ${marker}.` : code;
    });
    const agent = Agent.create({
      provider,
      model: 'claude-sonnet-4-6',
      citations: measurementCitations,
    })
      .tool(tool)
      .build();
    const recording = recordRun(agent);
    await expect(agent.run({ message: 'Read discount in mm.' })).resolves.toMatch(
      /\[c:[A-Za-z0-9_-]+:1\]/u,
    );
    expect(seen).toHaveLength(2);
    expect(JSON.stringify(seen[1].system)).toContain('submitted tool result block 1');
    const answerCitations = recording.toRecording().snapshot?.sharedState?.answerCitations;
    const start = code.length + 1;
    const span = { start, end: start + claim.length };
    expect(answerCitations).toEqual({
      complete: true,
      findings: adjacentProse
        ? [
            { kind: 'citation', ...span, slot: 1, outcome: 'supported' },
            {
              kind: 'column',
              ...span,
              slot: 1,
              reason: 'ungrounded-entity',
              name: 'discount',
              nearestName: 'amount',
            },
          ]
        : [],
    });
  },
);
