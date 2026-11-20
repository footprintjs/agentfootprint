import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  allow,
  defineTool,
  deny,
  isInputPause,
  requestInput,
  RunCheckpointError,
  slidingWindow,
  type AgentRunCheckpoint,
  type ToolMiddleware,
} from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { assessAnswer, recordRun, type Recording } from '../../../../src/observe.js';
import { assessmentDataOf } from '../../../../src/core/agent/assessment/compose.js';
import type { AnswerAssessedPayload } from '../../../../src/events/payloads/answer.js';
import { readCallOccurrenceKey } from '../../../../src/lib/callOccurrence.js';

const TOOL = 'fixture_lookup';
const ID = 'reused';
const PAUSING_TOOL = 'confirm_fixture';
const BODY = 'The lookup is complete.';
const WITHHELD = `${BODY}\n\n---\n\nNot sure — a result was kept out by a rule.`;
const CONSISTENT = `${BODY}\n\n---\n\nConsistent with the run's record — 1 check ran and did not fire: what came back. This is not a verification.`;
const NOTICE = 'The archive is unavailable.';
const OVERSIZED_RESULT = 'x'.repeat(150);
const PROMPT = 'Read the fixture archive and the live index.';
const FAILED = `${BODY}\n\n---\n\nNot sure — a call failed.`;

const lookup = (host: string) => ({ toolCalls: [{ id: ID, name: TOOL, args: { host } }] });

type ResultRule = NonNullable<ToolMiddleware['onToolResult']>;

function fixture({
  evicts,
  pauses,
  blocks,
  throws = false,
  blockPauseAnswer = false,
  archiveResult,
  provider,
}: {
  evicts: boolean;
  pauses: boolean;
  blocks: boolean;
  throws?: boolean;
  blockPauseAnswer?: boolean;
  archiveResult?: 'undefined' | 'over-ceiling';
  provider?: ReturnType<typeof mock>;
}) {
  const execute = vi.fn(({ host }: { host: string }) => {
    if (host === 'archive') {
      if (throws) throw new Error('The fixture archive failed.');
      if (archiveResult === 'undefined') return undefined;
      if (archiveResult === 'over-ceiling') return OVERSIZED_RESULT;
    }
    return [{ host, count: 1 }];
  });
  const onToolResult = vi.fn<ResultRule>(({ toolName, args }) => {
    const block = toolName === PAUSING_TOOL ? blockPauseAnswer : blocks && args.host === 'archive';
    return block ? deny(NOTICE) : allow();
  });
  const builder = Agent.create({
    provider:
      provider ??
      mock({
        chunkDelayMs: 0,
        replies: [
          lookup('archive'),
          ...(pauses ? [{ toolCalls: [{ id: 'pause', name: PAUSING_TOOL, args: {} }] }] : []),
          lookup('live'),
          BODY,
          lookup('follow-up'),
          BODY,
        ],
      }),
    model: 'mock',
    reactMode: 'dynamic',
    ...(evicts && { keepLastToolResults: false as const }),
  })
    .tool(
      defineTool({
        name: TOOL,
        description: 'Read fixture entries for one host.',
        inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
        ...(archiveResult === 'over-ceiling' && { resultCeiling: { maxChars: 100 } }),
        execute,
      }),
    )
    .toolMiddleware({ name: 'fixture_gate', onToolResult })
    .resultsLayer()
    .answerLayer({ standingLine: true });
  if (evicts) builder.window(slidingWindow({ keepRecentTurns: 1 }));
  if (pauses)
    builder.tool(
      defineTool({
        name: PAUSING_TOOL,
        description: 'Ask the caller before reading the live index.',
        inputSchema: { type: 'object' },
        execute: () =>
          requestInput({
            id: 'confirm-live-index',
            question: 'How many entries should I check?',
            fields: [{ id: 'count', type: 'number', required: true }],
          }),
      }),
    );
  return { agent: builder.build(), execute, onToolResult };
}

function observe(agent: Agent) {
  const recorder = recordRun(agent);
  let assessment: AnswerAssessedPayload | undefined;
  const off = agent.on('agentfootprint.answer.assessed', ({ payload }) => {
    assessment = payload;
  });
  return {
    read() {
      if (assessment === undefined) throw new Error('Expected an answer.assessed event.');
      const { turn, iteration, ...liveData } = assessment;
      const snapshot = agent.getLastSnapshot()!.sharedState;
      const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
      return { turn, liveData, snapshot, saved: assessAnswer(recording) };
    },
    stop() {
      off();
      recorder.stop();
    },
  };
}

describe('standing when a previously withheld result leaves history', () => {
  it.each([
    { evicts: false, pauses: false, blocks: true },
    { evicts: true, pauses: false, blocks: true },
    { evicts: false, pauses: true, blocks: true },
    { evicts: true, pauses: true, blocks: true },
    { evicts: false, pauses: false, blocks: false },
    { evicts: true, pauses: false, blocks: false },
  ])(
    'a reused ID preserves anonymous withholding only in its own turn (evicts=$evicts, pauses=$pauses, blocks=$blocks)',
    async (options) => {
      const { evicts, pauses, blocks } = options;
      const { agent, execute, onToolResult } = fixture(options);
      const observation = observe(agent);
      try {
        let first = await agent.run({ message: PROMPT });
        if (pauses) {
          if (!isInputPause(first)) throw new Error('Expected the fixture input pause.');
          first = await agent.resume(JSON.parse(JSON.stringify(first.checkpoint)), {
            requestId: first.awaitingInput.requestId,
            values: { count: 1 },
          });
        }
        const { turn, liveData, snapshot, saved } = observation.read();
        expect(turn).toBe(1);
        expect(execute.mock.calls.map(([{ host }]) => host)).toEqual(['archive', 'live']);
        expect(execute.mock.results.map(({ type }) => type)).toEqual(['return', 'return']);
        expect(
          onToolResult.mock.calls
            .filter(([call]) => call.toolName === TOOL)
            .map(([call]) => call.toolCallId),
        ).toEqual([ID, ID]);
        const results = snapshot.history.filter(
          (entry) => entry.role === 'tool' && entry.toolName === TOOL,
        );
        const retainedKeys = results.map(readCallOccurrenceKey);
        const denials = (snapshot.middlewareDecisions ?? []).filter(
          (decision) => decision.toolName === TOOL && decision.outcome === 'deny',
        );
        const entries = snapshot.enteredToolCalls?.entries.map(readCallOccurrenceKey) ?? [];
        const [firstKey] = entries;
        const laterKey = entries.at(-1);
        expect(firstKey).toEqual(expect.any(String));
        expect(laterKey).toEqual(expect.any(String));
        expect(firstKey).not.toBe(laterKey);
        expect(denials.map(readCallOccurrenceKey)).toEqual(blocks ? [firstKey] : []);
        expect(retainedKeys).toEqual(evicts ? [laterKey] : [firstKey, laterKey]);
        expect(results.map(({ toolResultDisposition }) => toolResultDisposition)).toEqual(
          !evicts && blocks ? ['withheld', undefined] : results.map(() => undefined),
        );

        const reasons = blocks ? ['result-withheld'] : [];
        expect.soft(liveData.reasons, 'live answer assessment').toEqual(reasons);
        expect
          .soft(
            saved.reasons.map(({ reason }) => reason),
            'saved answer assessment',
          )
          .toEqual(reasons);
        expect.soft(assessmentDataOf(saved), 'saved/live parity').toEqual(liveData);
        expect.soft(first, 'delivered standing').toBe(blocks ? WITHHELD : CONSISTENT);
        if (blocks) {
          expect
            .soft(saved.reasons[0])
            .toEqual(
              expect.objectContaining({ reason: 'result-withheld', source: { kind: 'run' } }),
            );
          expect.soft(saved.reasons[0]?.witness ?? []).toEqual([]);
        }

        const next = await agent.run({
          message: 'Read the follow-up index.',
          continueFrom: agent.checkpoint()!,
        });
        const nextAssessment = observation.read();
        expect(nextAssessment.turn).toBe(2);
        expect(execute.mock.calls.at(-1)?.[0].host).toBe('follow-up');
        expect(next).toBe(CONSISTENT);
        expect(nextAssessment.liveData.reasons).toEqual([]);
        expect(assessmentDataOf(nextAssessment.saved)).toEqual(nextAssessment.liveData);
      } finally {
        observation.stop();
        await agent.shutdown();
      }
    },
  );

  it('a plain pause answer withheld by the tool rule still counts after eviction', async () => {
    const { agent, onToolResult } = fixture({
      evicts: true,
      pauses: true,
      blocks: false,
      blockPauseAnswer: true,
    });
    const observation = observe(agent);
    try {
      const paused = await agent.run({ message: PROMPT });
      if (!isInputPause(paused)) throw new Error('Expected the fixture input pause.');
      const answer = await agent.resume(JSON.parse(JSON.stringify(paused.checkpoint)), {
        requestId: paused.awaitingInput.requestId,
        values: { count: 1 },
      });
      const { liveData, snapshot, saved } = observation.read();
      const plainResult = onToolResult.mock.calls.find(([call]) => call.toolName === PAUSING_TOOL);
      expect(plainResult?.[0].result).toMatchObject({ values: { count: 1 } });
      expect(
        snapshot.history.filter(
          ({ role, toolName }) => role === 'tool' && toolName === PAUSING_TOOL,
        ),
      ).toEqual([]);
      expect.soft(liveData.reasons).toEqual(['result-withheld']);
      expect.soft(assessmentDataOf(saved)).toEqual(liveData);
      expect.soft(answer).toBe(WITHHELD);
    } finally {
      observation.stop();
      await agent.shutdown();
    }
  });

  it.each([
    {
      archiveResult: 'undefined',
      evicts: true,
      nativeValue: undefined,
      ruleValue: undefined,
      reasons: ['result-withheld'],
      expectedAnswer: WITHHELD,
    },
    {
      archiveResult: 'over-ceiling',
      evicts: true,
      nativeValue: OVERSIZED_RESULT,
      ruleValue: expect.stringContaining('over its declared 100-char ceiling'),
      reasons: [],
      expectedAnswer: CONSISTENT,
    },
    {
      archiveResult: 'over-ceiling',
      evicts: false,
      nativeValue: OVERSIZED_RESULT,
      ruleValue: expect.stringContaining('over its declared 100-char ceiling'),
      reasons: ['call-not-completed'],
      expectedAnswer: FAILED,
    },
  ] as const)(
    'governs the result actually received by the rule (archive=$archiveResult, evicts=$evicts)',
    async ({ archiveResult, evicts, nativeValue, ruleValue, reasons, expectedAnswer }) => {
      const { agent, execute, onToolResult } = fixture({
        evicts,
        pauses: false,
        blocks: true,
        archiveResult,
      });
      const observation = observe(agent);
      try {
        const answer = await agent.run({ message: PROMPT });
        const { turn, liveData, snapshot, saved } = observation.read();
        expect(execute.mock.results[0]).toEqual({ type: 'return', value: nativeValue });
        expect(onToolResult.mock.calls[0]?.[0]).toMatchObject({
          args: { host: 'archive' },
          result: ruleValue,
        });
        expect(onToolResult.mock.results[0]?.value).toEqual(deny(NOTICE));
        const liveResult = expect.objectContaining({ content: '[{"host":"live","count":1}]' });
        expect(
          snapshot.history.filter(({ role, toolName }) => role === 'tool' && toolName === TOOL),
        ).toEqual(
          evicts
            ? [liveResult]
            : [
                expect.objectContaining({
                  content: NOTICE,
                  outcome: 'failed',
                  toolResultExecution: 'returned-unserved',
                  reportedStatus: 'invalid',
                }),
                liveResult,
              ],
        );
        expect(snapshot.withheldToolResultTurn).toBe(
          archiveResult === 'undefined' ? turn : undefined,
        );
        expect.soft(liveData.reasons).toEqual(reasons);
        expect.soft(saved.reasons.map(({ reason }) => reason)).toEqual(reasons);
        expect.soft(assessmentDataOf(saved)).toEqual(liveData);
        expect.soft(answer).toBe(expectedAnswer);
      } finally {
        observation.stop();
        await agent.shutdown();
      }
    },
  );

  it('recovers a withheld-return warning from a serialized error checkpoint for the same request', async () => {
    const respond = vi
      .fn()
      .mockReturnValueOnce(lookup('archive'))
      .mockReturnValueOnce(lookup('live'))
      // Complete an iteration after the window has dropped the archive result.
      .mockReturnValueOnce(lookup('verify'))
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('Fixture model unavailable'), { status: 503 });
      });
    const failed = fixture({
      evicts: true,
      pauses: false,
      blocks: true,
      provider: mock({ respond }),
    });
    const retry = fixture({
      evicts: true,
      pauses: false,
      blocks: false,
      provider: mock({ reply: BODY, chunkDelayMs: 0 }),
    });
    const next = fixture({
      evicts: true,
      pauses: false,
      blocks: false,
      provider: mock({ replies: [lookup('follow-up'), BODY], chunkDelayMs: 0 }),
    });
    const resumed = observe(retry.agent);
    const continued = observe(next.agent);
    try {
      const error: unknown = await failed.agent
        .run({ message: PROMPT })
        .catch((failure: unknown) => failure);
      if (!(error instanceof RunCheckpointError))
        throw new Error('Expected an error checkpoint.', { cause: error });
      expect(error.cause).toMatchObject({ message: 'Fixture model unavailable' });
      expect(failed.execute.mock.calls.map(([{ host }]) => host)).toEqual([
        'archive',
        'live',
        'verify',
      ]);
      expect(failed.onToolResult.mock.results[0]?.value).toEqual(deny(NOTICE));
      const checkpoint = JSON.parse(JSON.stringify(error.checkpoint)) as AgentRunCheckpoint;
      expect(checkpoint.originalInput.message).toBe(PROMPT);
      const checkpointResults = checkpoint.history.filter(
        ({ role, toolName }) => role === 'tool' && toolName === TOOL,
      );
      expect(checkpointResults.at(-1)?.content).toBe('[{"host":"verify","count":1}]');
      expect(checkpointResults).not.toContainEqual(expect.objectContaining({ content: NOTICE }));
      expect(
        checkpointResults.some(({ toolResultDisposition }) => toolResultDisposition === 'withheld'),
      ).toBe(false);
      expect.soft(checkpoint).toHaveProperty('withheldToolResult', true);

      const answer = await retry.agent.resumeOnError(checkpoint);
      const sameTurn = resumed.read();
      expect(sameTurn.turn).toBe(1);
      expect(retry.execute).not.toHaveBeenCalled();
      const reasons = ['result-withheld', 'check-unreachable'];
      expect.soft(sameTurn.liveData.reasons).toEqual(reasons);
      expect.soft(sameTurn.saved.reasons.map(({ reason }) => reason)).toEqual(reasons);
      expect.soft(sameTurn.saved.reasons[0]).toMatchObject({
        reason: 'result-withheld',
        source: { kind: 'run' },
        witness: [],
      });
      expect.soft(assessmentDataOf(sameTurn.saved)).toEqual(sameTurn.liveData);
      expect.soft(answer).toContain('a result was kept out by a rule');

      expect(
        await next.agent.run({ message: 'Read the follow-up index.', continueFrom: checkpoint }),
      ).toBe(CONSISTENT);
      const newTurn = continued.read();
      expect(newTurn.turn).toBe(2);
      expect(newTurn.snapshot.withheldToolResultTurn).toBeUndefined();
      expect(newTurn.liveData.reasons).toEqual([]);
      expect(assessmentDataOf(newTurn.saved)).toEqual(newTurn.liveData);
    } finally {
      resumed.stop();
      continued.stop();
      await Promise.all([failed.agent.shutdown(), retry.agent.shutdown(), next.agent.shutdown()]);
    }
  });

  it.each([false, true])(
    'a withheld error notice contributes no withheld-return fact (evicts=%s)',
    async (evicts) => {
      const { agent, execute, onToolResult } = fixture({
        evicts,
        pauses: false,
        blocks: true,
        throws: true,
      });
      const observation = observe(agent);
      try {
        const answer = await agent.run({ message: PROMPT });
        const { liveData, snapshot, saved } = observation.read();
        expect(execute.mock.calls.map(([{ host }]) => host)).toEqual(['archive', 'live']);
        expect(execute.mock.results.map(({ type }) => type)).toEqual(['throw', 'return']);
        expect(onToolResult.mock.results[0]?.value).toEqual(deny(NOTICE));
        expect(snapshot.withheldToolResultTurn).toBeUndefined();
        const rows = snapshot.history.filter(
          ({ role, toolName }) => role === 'tool' && toolName === TOOL,
        );
        const liveResult = expect.objectContaining({ content: '[{"host":"live","count":1}]' });
        expect(rows).toEqual(
          evicts
            ? [liveResult]
            : [expect.objectContaining({ toolResultExecution: 'threw' }), liveResult],
        );
        expect(liveData.reasons).toEqual(evicts ? [] : ['call-not-completed']);
        expect(assessmentDataOf(saved)).toEqual(liveData);
        expect(answer).toBe(evicts ? CONSISTENT : FAILED);
      } finally {
        observation.stop();
        await agent.shutdown();
      }
    },
  );
});
