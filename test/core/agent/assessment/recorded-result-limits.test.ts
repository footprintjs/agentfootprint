/**
 * Framework-owned result limits travel from dispatch to the model, to the
 * person reading the answer, and through a JSON round-trip of the recording.
 */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  allow,
  defineTool,
  inMemoryArtifacts,
  withDatasetArtifacts,
  type AgentOptions,
  type Tool,
  type ToolMiddleware,
} from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { accountForAnswer, assessAnswer, recordRun } from '../../../../src/observe.js';
import { assessmentDataOf } from '../../../../src/core/agent/assessment/compose.js';
import type { AnswerAssessmentPayload } from '../../../../src/events/payloads/answer.js';

const answer = 'The array port went offline. STANDING: KNOWN.';
const whole = 'x'.repeat(23_559) + ' PORT DOWN';
const log = defineTool({
  name: 'array_events',
  displayName: 'array event log',
  description: 'Return the raw array event log.',
  resultKind: 'log/array',
  execute: () => whole,
});

function dataset(zoned: boolean, padding?: 'before-ticket' | 'after-ticket') {
  const time = '2026-11-21T03:22:04';
  const rows = [
    { ts: zoned ? time + 'Z' : time },
    { ts: zoned ? time + '+01:00' : time },
    { ts: time + '-03:00' },
  ];
  return withDatasetArtifacts(
    defineTool({
      name: 'app_log',
      displayName: 'application log',
      description: 'Read the application log.',
      execute: () => rows,
    }),
    {
      describe: (result) => ({
        datasets: [
          {
            key: 'app',
            artifact: {
              kind: 'dataset/log',
              mediaType: 'application/json',
              data: result,
              timeAxis: { column: 'ts', unit: 'iso' },
            },
          },
        ],
        project: ([publication]) => ({
          ...(padding === 'before-ticket' && { padding: 'x'.repeat(3_000) }),
          rows: result.length,
          ticket: publication!.artifact,
          ...(padding === 'after-ticket' && { padding: 'x'.repeat(3_000) }),
        }),
      }),
    },
  );
}

type Settings = Pick<AgentOptions, 'artifacts' | 'maxToolResultChars'>;

async function replay(
  tool: Tool,
  settings: Settings = {},
  readPlaced = false,
  policy?: ToolMiddleware,
) {
  let handed = '';
  let dataRead: unknown;
  const reader = defineTool({
    name: 'read_log',
    description: 'Read the placed array log.',
    inputSchema: {
      type: 'object',
      properties: { source: { type: 'string' } },
      required: ['source'],
    },
    wants: { source: 'log/array' },
    execute: ({ source }) => {
      dataRead = source;
      return 'Read the log.';
    },
  });
  const provider = mock({
    respond: ({ messages }) => {
      const output = messages.find(
        (message) => message.role === 'tool' && message.toolCallId === 'producer',
      );
      if (output === undefined)
        return { toolCalls: [{ name: tool.schema.name, id: 'producer', args: {} }] };
      handed = String(output.content);
      if (
        readPlaced &&
        !messages.some((message) => message.toolCallId === 'reader' && message.role === 'tool')
      ) {
        const { ref } = JSON.parse(handed) as { ref: string };
        return { toolCalls: [{ name: reader.schema.name, id: 'reader', args: { source: ref } }] };
      }
      return answer;
    },
  });
  const builder = Agent.create({ provider, model: 'mock', ...settings })
    .tools(readPlaced ? [tool, reader] : [tool])
    .limitsTravelWithTheAnswer();
  if (policy) builder.toolMiddleware(policy);
  const agent = builder.build();
  const recording = recordRun(agent);
  const assessed: AnswerAssessmentPayload[] = [];
  agent.on('agentfootprint.agent.turn_end', ({ payload }) => {
    if (payload.answerAssessment) assessed.push(payload.answerAssessment);
  });
  try {
    const text = await agent.run({ message: 'Why did the storage paths go offline?' });
    const saved = JSON.parse(JSON.stringify(recording.toRecording()));
    const folded = assessAnswer(saved);
    const assessment = assessmentDataOf(folded);
    const account = accountForAnswer(saved);
    expect(account.answer.value).toBe(answer);
    const warning = account.facts.limitsBlock.value;
    expect(text).toBe(warning ? `${answer}\n\n---\n\n${warning}` : answer);
    expect(assessed).toEqual([assessment]);
    return {
      text,
      assessment,
      handed,
      dataRead,
      witnesses: folded.reasons.flatMap(({ witness }) => witness),
    };
  } finally {
    recording.stop();
    await agent.shutdown();
  }
}

describe('recorded result limits in the delivered answer and saved replay', () => {
  it('leaves the answer byte-identical when the entire result was inline', async () => {
    const run = await replay(log, { maxToolResultChars: whole.length });
    expect(run.handed).toBe(whole);
    expect(run.text).toBe(answer);
    expect(run.assessment.standing).toBe('not-assessed');
  });

  it('reports the retained characters and original size from the real cut', async () => {
    const run = await replay(log, { maxToolResultChars: 2_000 });
    const { head, truncated } = JSON.parse(run.handed) as { head: string; truncated: boolean };
    expect(truncated).toBe(true);
    expect(head).toBe(whole.slice(0, head.length));
    expect(head.length).toBeLessThan(2_000);
    expect(run.assessment).toMatchObject({ standing: 'not-sure', reasons: ['result-cut'] });
    expect(run.witnesses).toEqual([
      { kind: 'state', key: 'libraryResultLimits', path: '/0/keptChars' },
    ]);
    expect(run.text).toContain('Not sure');
    expect(run.text).toContain('array event log');
    expect(run.text).toContain(head.length.toLocaleString('en-US'));
    expect(run.text).toContain(whole.length.toLocaleString('en-US'));
  });

  it('warns when a placed log was never read', async () => {
    const run = await replay(log, {
      artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: 2_000 } },
    });
    expect(JSON.parse(run.handed)).toMatchObject({ placed: true, kind: 'log/array' });
    expect(run.assessment).toMatchObject({ standing: 'not-sure', reasons: ['placed-unread'] });
    expect(run.witnesses).toEqual([{ kind: 'state', key: 'libraryResultLimits', path: '/0/kind' }]);
    expect(run.text).not.toContain(JSON.parse(run.handed).ref);
    expect(run.text).toMatch(/array event log.*stored by reference.*not read/i);
  });

  it('delivers the original answer when another tool actually reads the placed log', async () => {
    const run = await replay(
      log,
      { artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: 2_000 } } },
      true,
    );
    expect(run.dataRead).toBe(whole);
    expect(run.assessment.reasons).not.toContain('placed-unread');
    expect(run.text).toBe(answer);
  });

  it('shows the same count to the model and the reader for just the times without a zone', async () => {
    const run = await replay(dataset(false), { artifacts: inMemoryArtifacts() });
    expect(JSON.parse(run.handed)).toMatchObject({ rows: 3, ticket: { meta: { naiveCount: 2 } } });
    expect(run.assessment).toMatchObject({ standing: 'not-sure', reasons: ['times-without-zone'] });
    expect(run.witnesses).toEqual([
      { kind: 'state', key: 'libraryResultLimits', path: '/0/naiveCount' },
    ]);
    expect(run.text).not.toContain(JSON.parse(run.handed).ticket.meta.ref);
    expect(run.text).toMatch(/2 times in (?:the )?application log have no zone/i);
  });

  it('preserves the model answer when the declared axis has only offset-bearing times', async () => {
    const run = await replay(dataset(true), { artifacts: inMemoryArtifacts() });
    expect(JSON.parse(run.handed)).toMatchObject({ rows: 3, ticket: { status: 'stored' } });
    expect(JSON.parse(run.handed).ticket.meta).not.toHaveProperty('naiveCount');
    expect(run.assessment.reasons).not.toContain('times-without-zone');
    expect(run.text).toBe(answer);
  });

  it('keeps the zone warning when the native dataset ticket survived a cut', async () => {
    const run = await replay(dataset(false, 'after-ticket'), {
      artifacts: inMemoryArtifacts(),
      maxToolResultChars: 1_000,
    });
    const { head } = JSON.parse(run.handed) as { head: string };
    expect(head).toContain('"naiveCount":2');
    expect(head).toContain('"ref":"art_');
    expect(run.assessment.reasons).toEqual(['result-cut', 'times-without-zone']);
    expect(run.witnesses).toContainEqual({
      kind: 'state',
      key: 'libraryResultLimits',
      path: '/1/naiveCount',
    });
    expect(run.text).toMatch(/2 times in (?:the )?application log have no zone/i);
    expect(run.text).not.toContain('art_');
  });

  it('omits the zone warning when the dataset ticket is outside the served prefix', async () => {
    const run = await replay(dataset(false, 'before-ticket'), {
      artifacts: inMemoryArtifacts(),
      maxToolResultChars: 1_000,
    });
    const { head } = JSON.parse(run.handed) as { head: string };
    expect(head).toContain('"padding":');
    expect(head).not.toContain('art_');
    expect(run.assessment.reasons).toEqual(['result-cut']);
    expect(run.text).not.toMatch(/zone/i);
  });

  it('keeps a native count private when a capped replacement echoes its reference', async () => {
    const run = await replay(
      dataset(false),
      { artifacts: inMemoryArtifacts(), maxToolResultChars: 1_000 },
      false,
      {
        name: 'public_reference',
        onToolResult: ({ result }) => {
          const { ticket } = result as { ticket: { meta: { ref: string } } };
          return allow(
            { publicRef: ticket.meta.ref, padding: 'x'.repeat(3_000) },
            'Expose the reference alone.',
          );
        },
      },
    );
    const { head } = JSON.parse(run.handed) as { head: string };
    expect(head).toContain('"publicRef":"art_');
    expect(head).not.toContain('naiveCount');
    expect(run.assessment.reasons).toEqual(['result-cut']);
    expect(run.text).not.toMatch(/zone/i);
  });
});
