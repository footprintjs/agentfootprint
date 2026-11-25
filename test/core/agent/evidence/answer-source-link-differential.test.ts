/**
 * Run the identical file on the parent with AF_ANSWER_DIFFERENTIAL_BASELINE=1.
 * Set AF_ANSWER_DIFFERENTIAL_OUTPUT on each head and compare the two captures
 * with cmp. The test compares the on/off bytes in each capture before writing
 * it. Witness rows are checked separately because only this head adds them.
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NoOpCacheStrategy } from '../../../../src/cache/index.js';
import {
  Agent,
  AnswerValidationError,
  codeRunnerTool,
  defineTool,
  isInputPause,
  requestInput,
  UnsupportedValuesError,
  type AgentOptions,
  type NamesAndNumbersOptions,
} from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { assessAnswer, recordRun, type Recording } from '../../../../src/observe.js';
import type { LLMMessage, LLMResponse } from '../../../../src/provider-contract/types.js';
import { epochLocations, keyedFold, readAfterCall } from '../../../../src/time-travel/index.js';
import { evidenceFromHistory } from '../../../../src/core/agent/evidence/evidenceIndex.js';
import { figureCheckOf } from '../../../../src/core/agent/evidence/figures.js';
import { checkAnswer, resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';
import rounding from '../fixtures/numeric-rounding-off.json';
import scientific from '../fixtures/numeric-scientific-off.json';
import {
  CORRECT_ANSWERS,
  FABRICATED_ANSWERS,
  TOOL_RESULTS,
  toolMessages,
} from '../fixtures/sanEvidence.js';
import { callCode, fenced, runnerAnswering } from './fixtures/scriptAgent.js';

type Reply = Partial<LLMResponse>;
type Mode = NonNullable<AgentOptions['reactMode']>;
type Builder = ReturnType<typeof Agent.create>;

interface Case {
  name: string;
  replies: Reply[];
  configure: (builder: Builder) => Builder;
  gate?: NamesAndNumbersOptions;
  reactMode?: Mode;
  expected: string[];
  refusal?: 'UnsupportedValuesError' | 'AnswerValidationError';
  resume?: boolean;
}

function call(name: string, id = 'c1'): Reply {
  return { toolCalls: [{ id, name, args: {} }] };
}

const tools = Object.entries(TOOL_RESULTS).map(([name, result]) =>
  defineTool({
    name,
    description: name,
    inputSchema: { type: 'object' },
    execute: () => result,
  }),
);
const sanCall = {
  toolCalls: toolMessages().map(({ toolName, toolCallId }) => ({
    id: toolCallId,
    name: toolName,
    args: {},
  })),
};
const configureSan = (builder: Builder) => tools.reduce((agent, tool) => agent.tool(tool), builder);
const sanCases: Case[] = [
  ...CORRECT_ANSWERS.map((content, index) => ({
    name: `SAN supported ${index + 1}`,
    replies: [sanCall, { content }],
    configure: configureSan,
    gate: { posture: 'assist' as const },
    expected: ['grounded'],
  })),
  ...FABRICATED_ANSWERS.map(({ answer: content }, index) => ({
    name: `SAN fabricated ${index + 1}`,
    replies: [sanCall, { content }],
    configure: configureSan,
    gate: { posture: 'assist' as const },
    expected: ['flagged'],
  })),
];

const flogi = tools.find(({ schema }) => schema.name === 'show_flogi')!;
const correction = 'fc1/5 is logged in with FCID 0x650400 and WWPN 50:00:09:72:08:60:2a:00.';
const fabrication = FABRICATED_ANSWERS[0]!.answer;
const routeCases: Case[] = (['dynamic', 'dynamic-grouped', 'classic'] as const).flatMap(
  (reactMode) =>
    (['guard', 'rails'] as const).flatMap((posture) =>
      [false, true].map((corrected) => ({
        name: `${reactMode} ${posture} ${corrected ? 'corrected' : 'unresolved'}`,
        replies: [
          call(flogi.schema.name),
          { content: fabrication },
          { content: corrected ? correction : fabrication },
        ],
        configure: (builder: Builder) => builder.tool(flogi),
        reactMode,
        gate: { posture },
        expected: [
          'revision-asked',
          corrected ? 'grounded' : posture === 'rails' ? 'refused' : 'flagged',
        ],
        ...(!corrected && posture === 'rails' && { refusal: 'UnsupportedValuesError' as const }),
      })),
    ),
);

const program = 'threshold = 98765\nprint(sum([1200, 2400]))';
const runner = runnerAnswering({ ok: true, exitCode: 0, stdout: '3600', stderr: '' });
const script = codeRunnerTool({ runner });
const askDue = defineTool({
  name: 'ask_due',
  description: 'Ask for the renewal date.',
  inputSchema: { type: 'object' },
  execute: () =>
    requestInput({
      id: 'due',
      question: 'When is the renewal due?',
      fields: [{ id: 'due', type: 'string', required: true }],
    }),
});
const lookalike = defineTool({
  name: 'lookup_due',
  description: 'Read the renewal date.',
  inputSchema: { type: 'object' },
  execute: () => ({
    status: 'input_received',
    requestId: 'r-fixture',
    values: { due: '2031-05-05' },
    origins: { due: 'response' },
  }),
});
const capacity = defineTool({
  name: 'capacity',
  description: 'Read capacity.',
  inputSchema: { type: 'object' },
  execute: () => ({
    cluster: 'CLUSTER-A01',
    capacity: 4200,
    rows: [{ usable_tb: 435.5 }, { usable_tb: 1090.8 }],
  }),
});
const validation = (builder: Builder, answerCapacity: number) =>
  builder
    .tool(capacity)
    .outputSchema({ parse: () => ({ unit: 'GB', capacity: answerCapacity }) })
    .answerValidation({
      id: 'fixture-capacity',
      version: '1',
      agentChecks: ['names-and-numbers'],
      validate: () => ({ checks: [{ id: 'schema', disposition: 'checked-pass' }] }),
    });

const branchCases: Case[] = [
  {
    name: 'same-turn script matched',
    replies: [callCode('c1', program), { content: `The total is 3600.\n\n${fenced(program)}` }],
    configure: (builder) => builder.tool(script),
    gate: { posture: 'assist', code: 'match' },
    expected: ['grounded'],
  },
  {
    name: 'same-turn script one-byte mismatch',
    replies: [
      callCode('c1', program),
      { content: `The total is 3600.\n\n${fenced(program.replace('98765', '98766'))}` },
    ],
    configure: (builder) => builder.tool(script),
    gate: { posture: 'assist', code: 'match' },
    expected: ['flagged'],
  },
  {
    name: 'typed answer landed by resume',
    replies: [call(askDue.schema.name), { content: 'The renewal is due in 2031.' }],
    configure: (builder) => builder.tool(askDue),
    gate: { posture: 'assist' },
    expected: ['grounded'],
    resume: true,
  },
  {
    name: 'tool result resembling a typed answer',
    replies: [call(lookalike.schema.name), { content: 'The renewal is due in 2031.' }],
    configure: (builder) => builder.tool(lookalike),
    gate: { posture: 'assist' },
    expected: ['flagged'],
  },
  {
    name: 'figures enabled with derived column sum',
    replies: [call(capacity.schema.name), { content: 'CLUSTER-A01 has 1,526.3 TB usable.' }],
    configure: (builder) => builder.tool(capacity),
    gate: { posture: 'assist', figures: true },
    expected: ['grounded'],
  },
  {
    name: 'figures enabled with unsupported short value',
    replies: [call(capacity.schema.name), { content: 'CLUSTER-A01 has 6.3 TB free.' }],
    configure: (builder) => builder.tool(capacity),
    gate: { posture: 'assist', figures: true },
    expected: ['flagged'],
  },
  {
    name: 'figures disabled with the same answer',
    replies: [call(capacity.schema.name), { content: 'CLUSTER-A01 has 6.3 TB free.' }],
    configure: (builder) => builder.tool(capacity),
    gate: { posture: 'assist', figures: false },
    expected: ['grounded'],
  },
  {
    name: 'schema transform and validation allow canonical answer',
    replies: [call(capacity.schema.name), { content: '{"capacity":4200}' }],
    configure: (builder) => validation(builder, 4200),
    gate: { posture: 'assist' },
    expected: ['grounded'],
  },
  {
    name: 'validation refuses transformed unsupported value',
    replies: [call(capacity.schema.name), { content: '{"capacity":4200}' }],
    configure: (builder) => validation(builder, 98765),
    gate: { posture: 'assist' },
    expected: ['grounded'],
    refusal: 'AnswerValidationError',
  },
  {
    name: 'no evidence gate',
    replies: [call(capacity.schema.name), { content: 'The storage pool has 4200 GB.' }],
    configure: (builder) => builder.tool(capacity),
    expected: [],
  },
];

async function capture(fixture: Case, links: boolean) {
  const requests: string[] = [];
  let typedRequestId: string | undefined;
  const scripted = mock({ replies: fixture.replies });
  const cache = new NoOpCacheStrategy();
  const builder = Agent.create({
    model: 'mock',
    provider: {
      name: scripted.name,
      complete(request) {
        const bytes = JSON.stringify(request);
        // A resumed native ask carries its freshly generated run-bound ID to the provider.
        requests.push(
          typedRequestId === undefined ? bytes : bytes.replaceAll(typedRequestId, '<ask-id>'),
        );
        return scripted.complete(request);
      },
    },
    cacheStrategy: {
      name: cache.name,
      extractMetrics: cache.extractMetrics,
      async prepareRequest(request, candidates, context) {
        const prepared = await cache.prepareRequest(request, candidates, context);
        if (links) return prepared;
        // Break only the retained-array identity that attests the serving step.
        return { ...prepared, request: { ...request, messages: [...request.messages] } };
      },
    },
    ...(fixture.reactMode !== undefined && { reactMode: fixture.reactMode }),
  });
  if (fixture.gate !== undefined) builder.namesAndNumbersFromEvidence(fixture.gate);
  const agent = fixture.configure(builder).build();
  const recorder = recordRun(agent);
  const checks: unknown[] = [];
  const actions: string[] = [];
  const assessed: unknown[] = [];
  agent.on('agentfootprint.agent.evidence_checked', ({ payload }) => {
    checks.push(payload);
    actions.push(payload.action);
  });
  agent.on('agentfootprint.answer.assessed', ({ payload }) => assessed.push(payload));

  try {
    let returned: string | undefined;
    let refusal: unknown;
    try {
      let output = await agent.run('Answer from the record.');
      if (fixture.resume) {
        if (!isInputPause(output)) throw new Error('Expected the typed input pause.');
        typedRequestId = output.awaitingInput.requestId;
        output = await agent.resume(output.checkpoint, {
          requestId: typedRequestId,
          values: { due: '2031-05-05' },
        });
      }
      if (typeof output !== 'string') throw new Error('Expected a terminal answer.');
      returned = output;
    } catch (error) {
      if (error instanceof UnsupportedValuesError) {
        refusal = {
          name: error.name,
          code: error.code,
          message: error.message,
          values: error.values,
          candidates: error.candidates,
          revised: error.revised,
        };
      } else if (error instanceof AnswerValidationError) {
        refusal = {
          name: error.name,
          code: error.code,
          message: error.message,
          report: error.report,
        };
      } else {
        throw error;
      }
      expect(error.name).toBe(fixture.refusal);
    }
    expect(refusal !== undefined).toBe(fixture.refusal !== undefined);
    expect(actions).toEqual(fixture.expected);
    const saved = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    const finalCall = epochLocations(saved.snapshot).at(-1);
    expect(finalCall).toBeDefined();
    const fold = keyedFold(saved.snapshot);
    const rows = fold.valueAt('sourceLinkRows', fold.length - 1);
    return {
      requests,
      consumer: readAfterCall(finalCall!, 'sourceLinkConsumer'),
      rows,
      bytes: JSON.stringify({
        checks,
        returned,
        refusal,
        values: agent.unsupportedValues(),
        validation: agent.answerValidation(),
        assessed,
        savedAssessment: assessAnswer(saved),
      }),
    };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

describe('deterministic answer differential', () => {
  it('keeps every retained numeric fixture verdict byte-identical with or without match capture', () => {
    for (const { name, history, cases } of [
      { name: 'rounding', ...rounding },
      { name: 'scientific', ...scientific },
    ]) {
      const messages = history as readonly LLMMessage[];
      for (const { answer, options, expected } of cases) {
        for (const explicitOff of [false, true]) {
          const gate = resolveEvidenceGate({
            ...options,
            ...(explicitOff && { decimalRounding: false }),
          });
          const args = {
            gate,
            evidence: evidenceFromHistory(messages, gate),
            exempt: new Set<string>(),
            ...(options.figures && { figures: figureCheckOf(answer, messages, gate) }),
          };
          const withMatches = { ...args, onSourceMatch: () => {} };
          expect(JSON.stringify(checkAnswer(answer, args)), name).toBe(expected);
          expect(JSON.stringify(checkAnswer(answer, withMatches)), name).toBe(expected);
        }
      }
    }
  });

  it('keeps live verdicts, refusal and saved assessment bytes when exact source links are unavailable', async () => {
    const results: Record<string, string> = {};
    const baseline = process.env.AF_ANSWER_DIFFERENTIAL_BASELINE === '1';
    for (const fixture of [...sanCases, ...routeCases, ...branchCases]) {
      const on = await capture(fixture, true);
      const off = await capture(fixture, false);
      expect(on.requests, fixture.name).toEqual(off.requests);
      expect(on.consumer, fixture.name).toBeDefined();
      expect(off.consumer, fixture.name).toBeUndefined();
      expect(off.rows, fixture.name).toBeUndefined();
      expect(on.bytes, fixture.name).toBe(off.bytes);
      if (baseline) expect(on.rows, fixture.name).toBeUndefined();
      if (!baseline && fixture.name === 'schema transform and validation allow canonical answer') {
        expect(on.rows).toMatchObject([
          { kind: 'source-link', check: 'value-found', output: { key: 'llmLatestContent' } },
        ]);
      }
      results[fixture.name] = on.bytes;
    }
    const output = process.env.AF_ANSWER_DIFFERENTIAL_OUTPUT;
    if (output !== undefined) writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
  }, 30_000);
});
