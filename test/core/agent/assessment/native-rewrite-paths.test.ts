import { describe, expect, it } from 'vitest';
import {
  absent,
  Agent,
  allow,
  ask,
  checkInApproved,
  coverage,
  defineTool,
  isInputPause,
  isPaused,
  requestInput,
  slidingWindow,
} from '../../../../src/index.js';
import { bearer, type CredentialProvider } from '../../../../src/identity.js';
import { mock } from '../../../../src/llm-providers.js';
import {
  assessAnswer,
  callTraceTool,
  recordRun,
  traceToolpack,
  type Recording,
} from '../../../../src/observe.js';
import { accountForAnswer } from '../../../../src/answer-account/account.js';
import { assessmentDataOf } from '../../../../src/core/agent/assessment/compose.js';
import type { AnswerAssessedPayload } from '../../../../src/events/payloads/answer.js';
import { pausedRequest } from '../../../helpers/pausedRequest.js';
import { TRACE_WITHHELD } from '../../../../src/trace-toolpack/admission/marker.js';

const name = 'lookup';
const queried = { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' };
const held = { from: '2026-09-25T09:00:00Z', to: '2026-09-25T10:00:00Z' };
const target = { toolCalls: [{ id: 'target', name, args: {} }] };
const tail = { toolCalls: [{ id: 'tail', name: 'finish_fixture', args: {} }] };
const inputCall = { toolCalls: [{ id: 'question', name: 'ask_fixture', args: {} }] };
type Path = 'ordinary' | 'middleware' | 'check-in' | 'lookup-after-input' | 'credential';

async function run(path: Path, observerDelivery: 'inline' | 'deferred', evicts: boolean) {
  let granted = false;
  const vault: CredentialProvider = {
    id: 'fixture-only',
    getCredential: async () =>
      granted
        ? { status: 'issued', credential: bearer('fixture-only-not-a-real-credential') }
        : {
            status: 'authorization-required',
            authorizationUrl: 'https://fixture.invalid/consent',
            sessionId: 'fixture',
          },
  };
  const builder = Agent.create({
    provider: mock({
      replies: [...(path === 'lookup-after-input' ? [inputCall] : []), target, tail, 'Done.'],
    }),
    model: 'mock',
    observerDelivery,
    ...(evicts && { keepLastToolResults: false as const }),
    ...(path === 'credential' && { credentials: vault }),
  })
    .tool(
      defineTool({
        name,
        description: 'Read one fixture index.',
        inputSchema: { type: 'object' },
        ...(path === 'check-in' && { checkIn: 'always' as const }),
        ...(path === 'credential' && {
          needs: { credential: 'fixture', mode: 'user' as const, scopes: ['read'] },
        }),
        execute: () =>
          coverage(absent({ what: 'fixture entry', checked: ['fixture index'] }), {
            checked: ['fixture index'],
            notChecked: ['other scope'],
            period: { queried, held },
          }),
      }),
    )
    .tool(
      defineTool({
        name: 'finish_fixture',
        description: 'Finish the fixture.',
        inputSchema: { type: 'object' },
        execute: () => 'Finished.',
      }),
    )
    .resultsLayer()
    .answerLayer({ standingLine: true });
  if (path === 'lookup-after-input')
    builder.tool(
      defineTool({
        name: 'ask_fixture',
        description: 'Collect a fixture answer.',
        inputSchema: { type: 'object' },
        execute: () =>
          requestInput({
            id: 'fixture-input',
            question: 'Continue?',
            fields: [{ id: 'count', type: 'number', required: true }],
          }),
      }),
    );
  if (evicts) builder.window(slidingWindow({ keepRecentTurns: 1 }));
  builder.toolMiddleware({
    name: 'summary-rule',
    ...(path === 'middleware' && {
      onToolCall: ({ toolName }: { toolName: string }) =>
        toolName === name ? ask({ question: 'Allow the fixture read?' }) : allow(),
    }),
    onToolResult: ({ toolName }) =>
      toolName === name ? allow([{ public: 1 }], 'Return the public summary.') : allow(),
  });
  builder.toolMiddleware({
    name: 'inner-rule',
    onToolResult: ({ toolName }) =>
      toolName === name ? allow([{ intermediate: 1 }], 'Prepare the summary.') : allow(),
  });
  const agent = builder.build();
  const recorder = recordRun(agent);
  const events: AnswerAssessedPayload[] = [];
  const off = agent.on('agentfootprint.answer.assessed', ({ payload }) => events.push(payload));
  try {
    let answer = await agent.run('Read the fixture.');
    if (path !== 'ordinary') {
      if (!isPaused(answer)) throw new Error(`Expected ${path} pause.`);
      const checkpoint = JSON.parse(JSON.stringify(answer.checkpoint));
      if (path === 'lookup-after-input') {
        if (!isInputPause(answer)) throw new Error('Expected input pause.');
        answer = await agent.resume(checkpoint, {
          requestId: answer.awaitingInput.requestId,
          values: { count: 1 },
        });
      } else if (path === 'credential') {
        granted = true;
        answer = await agent.resume(checkpoint);
      } else
        answer = await agent.resume(
          checkpoint,
          checkInApproved({ request: pausedRequest(answer), by: 'fixture' }),
        );
    }
    expect(typeof answer).toBe('string');
    const recording = recorder.toRecording();
    const saved = JSON.parse(JSON.stringify(recording)) as Recording;
    const live = await agent.assessment();
    const folded = assessAnswer(saved);
    expect(folded).toEqual(live);
    expect(folded.reasons.map(({ reason }) => reason)).toEqual([
      ...(evicts ? ['result-dropped-from-window'] : []),
      'coverage-gap',
      'declared-absent',
      'period-not-held',
    ]);
    const { turn: _turn, iteration: _iteration, ...event } = events.at(-1)!;
    expect(event).toEqual(assessmentDataOf(folded));
    expect(answer).toContain('Not sure');
    const account = accountForAnswer(saved, {});
    const fact = account.facts.calls.find((item) => item.toolName === name);
    expect(fact).toMatchObject({
      rewrittenBy: 'summary-rule',
      emptiness: 'non-empty',
      rows: 1,
      coverage: { kind: 'absent' },
    });
    expect(accountForAnswer(recording, {}).facts.calls).toEqual(account.facts.calls);
    const host = await callTraceTool(
      traceToolpack(saved, { showWithheldResults: true }),
      'inspect_tool_call',
      { toolCallId: 'target' },
    );
    expect(host).toContain('rewritten by: "summary-rule"');
    expect(host).not.toContain('rewritten by: "inner-rule"');
    const defaultView = await callTraceTool(traceToolpack(saved), 'inspect_tool_call', {
      toolCallId: 'target',
    });
    expect(defaultView).toContain(TRACE_WITHHELD);
    expect(defaultView).not.toContain('summary-rule');
    return saved;
  } finally {
    off();
    recorder.stop();
    await agent.shutdown();
  }
}

describe('rewritten native declarations through the existing dispatch and record doors', () => {
  it.each(
    (['ordinary', 'middleware', 'check-in', 'lookup-after-input', 'credential'] as const).flatMap(
      (path) =>
        (['inline', 'deferred'] as const).flatMap((delivery) =>
          [false, true].map((evicts) => ({ path, delivery, evicts })),
        ),
    ),
  )('$path / $delivery / evicts=$evicts', async ({ path, delivery, evicts }) => {
    await run(path, delivery, evicts);
  });

  it('an unnamed final changer does not falsely credit an earlier or unrelated rule', async () => {
    const saved = await run('ordinary', 'inline', false);
    const state = saved.snapshot.sharedState as Record<string, unknown>;
    const ledger = state.middlewareDecisions as Record<string, unknown>[];
    const last = ledger
      .filter((row) => row.toolName === name && row.moment === 'after-tool')
      .at(-1)!;
    delete last.middleware;
    ledger.push({ ...last, middleware: 'unrelated-rule', callOccurrenceKey: [9, 8, 7, 6, 0] });
    expect(
      accountForAnswer(saved, {}).facts.calls.find((item) => item.toolName === name),
    ).not.toHaveProperty('rewrittenBy');
    // The account reads committed state; inspector mutations are tested separately
    // against an explicit committed-log fixture in inspectToolCall.occurrence.test.ts.
  });

  it('a deferred rule and retained native mutation cannot rewrite the captured declaration', async () => {
    let announce!: () => void;
    let complete!: () => void;
    const entered = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const allowed = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const native = coverage([{ privateValue: 'HIDDEN_NATIVE_SENTINEL' }], {
      checked: ['fixture scope'],
      notChecked: ['original gap'],
    });
    const agent = Agent.create({ provider: mock({ replies: [target, 'Done.'] }), model: 'mock' })
      .tool(
        defineTool({
          name,
          description: 'Read the fixture.',
          inputSchema: { type: 'object' },
          execute: () => native,
        }),
      )
      .toolMiddleware({
        name: 'summary-rule',
        onToolResult: async () => {
          announce();
          Object.defineProperty(native.af_coverage.not_checked[0]!, 'what', {
            value: 'mutated after capture',
          });
          await allowed;
          return allow('Public summary.', 'Return a summary.');
        },
      })
      .answerLayer()
      .build();
    const recorder = recordRun(agent);
    try {
      const pending = agent.run('Read the fixture.');
      await entered;
      complete();
      await pending;
      const saved = recorder.toRecording();
      const rows = saved.snapshot.sharedState.coverageDeclared as {
        notChecked: { what: string }[];
      }[];
      expect(rows[0]?.notChecked).toEqual([{ what: 'original gap' }]);
      const a = assessAnswer(saved);
      expect(a.reasons.map(({ reason }) => reason)).toEqual(['coverage-gap']);
      expect(JSON.stringify(a)).not.toContain('HIDDEN_NATIVE_SENTINEL');
      expect(JSON.stringify(accountForAnswer(saved, {}))).not.toContain('HIDDEN_NATIVE_SENTINEL');
    } finally {
      complete();
      recorder.stop();
      await agent.shutdown();
    }
  });
});
