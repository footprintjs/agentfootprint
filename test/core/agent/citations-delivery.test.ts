import { expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  describedResult,
  isInputPause,
  slidingWindow,
} from '../../../src/index.js';
import { anthropic } from '../../../src/providers.js';
import { recordRun } from '../../../src/observe.js';
import type {
  AnthropicMessage,
  AnthropicMessagesBody,
} from '../../../src/adapters/llm/anthropicMessagesWire.js';
import type { ProseCitationOptions } from '../../../src/core/agent/citations/config.js';

const citations: ProseCitationOptions = {
  verification: {
    rules: [
      {
        id: 'measured-amount',
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
  extractClaim: (span) => {
    const number = /^North recorded (12|13) mm$/u.exec(span)?.[1];
    return number === undefined
      ? undefined
      : {
          ruleId: 'measured-amount',
          entity: 'North',
          field: 'amount',
          intendedScope: { unit: 'mm' },
          value: Number(number),
        };
  },
};

function scripted(
  replies: readonly ((request: AnthropicMessagesBody) => AnthropicMessage['content'])[],
) {
  const wire: AnthropicMessagesBody[] = [];
  const sdk = anthropic({
    _client: {
      messages: {
        async create(request) {
          const respond = replies[wire.length];
          if (!respond) throw new Error('Unexpected extra SDK request.');
          wire.push(request);
          const content = respond(request);
          return {
            id: `scripted-${wire.length}`,
            model: 'claude-sonnet-4-6',
            role: 'assistant',
            content,
            stop_reason: content.some((block) => block.type === 'tool_use')
              ? 'tool_use'
              : 'end_turn',
            usage: { input_tokens: 10, output_tokens: 4 },
          };
        },
        stream() {
          throw new Error('This fixture observes complete requests only.');
        },
      },
    },
  });
  return { provider: { ...sdk, stream: undefined }, wire };
}

const reading = (amount: number) =>
  describedResult({
    facts: [{ entity: 'North', amount }],
    provenance: { measuredAt: '2026-11-23T00:00:00Z', source: 'fixture' },
    coverage: { checked: ['amount'] },
  });
const inputSchema = {
  type: 'object',
  properties: { unit: { type: 'string' } },
  required: ['unit'],
} as const;
const call = (id: string, unit: string): AnthropicMessage['content'] => [
  { type: 'tool_use', id, name: 'measure', input: { unit } },
];
const onlyLabel = (request: AnthropicMessagesBody) => {
  const labels = JSON.stringify(request.system)?.match(/\[c:[A-Za-z0-9_-]+:\d+\]/gu) ?? [];
  expect(labels).toHaveLength(1);
  if (!labels[0]) throw new Error('Expected one offered source.');
  return labels[0];
};
const resultIds = (request: AnthropicMessagesBody) =>
  request.messages.flatMap(({ content }) =>
    typeof content === 'string'
      ? []
      : content.flatMap((block) => (block.type === 'tool_result' ? [block.tool_use_id] : [])),
  );

it.each([
  { observerDelivery: 'inline', commitValues: 'full' },
  { observerDelivery: 'inline', commitValues: 'delta' },
  { observerDelivery: 'deferred', commitValues: 'full' },
  { observerDelivery: 'deferred', commitValues: 'delta' },
] as const)(
  'preserves source ASK and the cited result with $observerDelivery observers and $commitValues commits',
  async (options) => {
    const ran: string[] = [];
    const tool = defineTool({
      name: 'measure',
      description: 'Read a measurement.',
      inputSchema,
      askOrAssume: { unit: { ask: 'Which unit?', choices: ['cm', 'mm'] } },
      execute: ({ unit }) => {
        ran.push(unit);
        return reading(12);
      },
    });
    const { provider, wire } = scripted([
      () => call('asked', 'cm'),
      (request) => [{ type: 'text', text: `North recorded 12 mm ${onlyLabel(request)}.` }],
    ]);
    const agent = Agent.create({ provider, model: 'claude-sonnet-4-6', citations, ...options })
      .tool(tool)
      .findings({ argumentSources: true })
      .build();
    const paused = await agent.run({ message: 'Read the measurement.' });
    if (!isInputPause(paused)) throw new Error('The untraced model argument must require ASK.');
    expect(wire[0]?.tools?.find(({ name }) => name === 'measure')?.input_schema).toHaveProperty(
      'properties._findings.properties.from',
    );
    expect(paused.awaitingInput.supplied).toEqual({});
    expect(paused.awaitingInput.fields[0]).not.toHaveProperty('default');
    expect(ran).toEqual([]);
    expect(agent.findings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'argument', argument: 'unit', asked: 'unverified' }),
      ]),
    );

    const recording = recordRun(agent);
    const finished = await agent.resume(JSON.parse(JSON.stringify(paused.checkpoint)), {
      requestId: paused.awaitingInput.requestId,
      values: { f1: 'mm' },
    });
    expect(ran).toEqual(['mm']);
    expect(wire).toHaveLength(2);
    const snapshot = recording.toRecording().snapshot;
    expect(snapshot?.commitValues).toBe(options.commitValues);
    expect(snapshot?.sharedState?.answerCitations).toEqual({
      complete: true,
      findings: [{ kind: 'citation', start: 0, end: 20, slot: 1, outcome: 'supported' }],
    });
    const accepted = wire[1];
    if (!accepted) throw new Error('Expected the accepted request.');
    expect(finished).toContain(onlyLabel(accepted));
  },
);

it('offers only the surviving result from an applied window on the same request', async () => {
  let count = 0;
  let old = '';
  let latest = '';
  const tool = defineTool({
    name: 'measure',
    description: 'Read a measurement.',
    inputSchema,
    execute: () => reading(++count === 1 ? 12 : 13),
  });
  const { provider, wire } = scripted([
    () => call('evicted', 'mm'),
    (request) => {
      expect(resultIds(request)).toEqual(['evicted']);
      old = onlyLabel(request);
      return call('kept', 'mm');
    },
    (request) => {
      expect(resultIds(request)).toEqual(['kept']);
      latest = onlyLabel(request);
      return [
        { type: 'text', text: `North recorded 12 mm ${old}. North recorded 13 mm ${latest}.` },
      ];
    },
  ]);
  const agent = Agent.create({
    provider,
    model: 'claude-sonnet-4-6',
    citations,
    keepLastToolResults: false,
  })
    .window(slidingWindow({ keepRecentTurns: 1 }))
    .tool(tool)
    .build();
  const recording = recordRun(agent);
  await expect(agent.run({ message: 'Read twice and report.' })).resolves.toContain(
    'North recorded 13 mm',
  );
  expect(old).not.toBe(latest);
  expect(wire).toHaveLength(3);
  expect(agent.checkpoint()?.citationSources).toHaveLength(2);
  expect(recording.toRecording().snapshot?.sharedState?.answerCitations).toMatchObject({
    complete: true,
    findings: [
      { kind: 'citation', outcome: 'unverified', reason: 'offer-unavailable' },
      { kind: 'citation', slot: 1, outcome: 'supported' },
    ],
  });
});
