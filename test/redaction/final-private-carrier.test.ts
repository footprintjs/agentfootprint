/** Runtime-private selector metadata must not become secret input to Final's mapper. */
import { FlowChartExecutor, flowChart } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { Agent, englishTimeReader, isInputPause, runbookAsTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { recordRun } from '../../src/doors/observe.js';
import { SUBFLOW_IDS } from '../../src/lib/conventions.js';
import { finalBranchInput } from '../../src/core/agent/stages/breakFinal.js';
import { PRIVATE_FIELDS_KEY } from '../../src/redaction/privateFields.js';

const SECRET = 'PRIVATE-FINAL-ASSUMED-ARGUMENT';
type Mode = 'dynamic' | 'dynamic-grouped';

function finalState(agent: Agent): Record<string, unknown> {
  const snapshot = agent.getLastSnapshot()!;
  const entries = Object.entries(snapshot.subflowResults ?? {}).filter(([path]) =>
    path.includes(SUBFLOW_IDS.FINAL),
  );
  expect(entries.length).toBeGreaterThan(0);
  const state = entries.at(-1)![1].treeContext?.globalContext;
  expect(state).toBeDefined();
  return state as Record<string, unknown>;
}

async function run(mode: Mode, privateAssumption: boolean, redact?: { keys: string[] }) {
  const delivered: unknown[] = [];
  const native = runbookAsTool({
    name: 'private_final_fixture',
    description: 'Read a synthetic private argument.',
    inputSchema: {
      type: 'object',
      properties: { subject: { type: 'string' }, secret: { type: 'string' } },
      required: ['subject', ...(privateAssumption ? ['secret'] : [])],
    },
    redact: { keys: ['secret'] },
    procedure: () =>
      flowChart<{ report?: { public: string } }>(
        'Read fixture',
        (scope) => {
          delivered.push(scope.$getArgs<{ subject: string; secret?: string }>()!.secret);
          scope.report = { public: 'completed' };
        },
        'read-fixture',
      ).build(),
  });
  const tool = {
    ...native,
    askOrAssume: {
      subject: { ask: 'Which public subject?' },
      ...(privateAssumption && { secret: { assume: SECRET } }),
    },
  };
  const agent = Agent.create({
    model: 'mock',
    reactMode: mode,
    ...(redact && { redact }),
    provider: mock({
      respond: (request) =>
        !request.messages.some((message) => message.role === 'tool')
          ? { toolCalls: [{ id: 'private-call', name: tool.schema.name, args: {} }] }
          : { content: 'Finished.' },
    }),
  })
    .tool(tool)
    .time({ zone: 'UTC', reader: englishTimeReader() })
    .build();
  const recorder = recordRun(agent);
  try {
    const paused = await agent.run({
      message: 'Read the last 2 hours.',
      time: { now: '2026-10-09T16:00:00.000Z' },
    });
    expect(isInputPause(paused)).toBe(true);
    if (!isInputPause(paused)) throw new Error('The native public subject ask did not pause.');
    expect(paused.checkpoint.sharedState.privateRecordFields).toMatchObject({ version: 1 });
    const privateFields = paused.checkpoint.sharedState.privateRecordFields as {
      keys: string[];
      fields: Record<string, unknown>;
    };
    expect(privateFields).toEqual({
      version: 1,
      keys: [],
      fields: {
        argumentAsk: ['progress.0.answer', 'progress.0.fills'],
        ...(privateAssumption && { argumentResolutions: ['0.fills.0.value'] }),
      },
    });
    expect(JSON.stringify(paused.checkpoint).includes(SECRET)).toBe(privateAssumption);
    await agent.resume(paused.checkpoint, {
      requestId: paused.awaitingInput.requestId,
      values: { [paused.awaitingInput.fields[0]!.id]: 'PUBLIC-SUBJECT' },
    });
    recorder.stop();
    return {
      state: finalState(agent),
      snapshot: agent.getLastSnapshot()!,
      recording: recorder.toRecording(),
      delivered,
    };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

describe.each<Mode>(['dynamic', 'dynamic-grouped'])('Final private metadata (%s)', (mode) => {
  it.each([false, true])(
    'excludes only private metadata while preserving native facts and secrecy (private assumption: %s)',
    async (called) => {
      const result = await run(mode, called);
      if (!called) {
        const ledger = result.state.findingsLedger as Record<string, unknown>[];
        const reading = ledger.find((row) => row.kind === 'time-reading');
        expect(reading).toMatchObject({
          turn: 1,
          iteration: 1,
          mentions: 1,
          quote: 'last 2 hours',
        });
      }
      expect(result.state).not.toHaveProperty('privateRecordFields');
      expect(result.snapshot.sharedState.privateRecordFields).toBe('REDACTED');
      expect(result.delivered).toEqual(called ? [SECRET] : [undefined]);
      expect(JSON.stringify(result.recording)).not.toContain(SECRET);
      expect(JSON.stringify(result.state)).not.toContain(SECRET);
      if (called) expect(JSON.stringify(result.state.argumentResolutions)).toContain('REDACTED');
    },
  );

  it('retains ordinary caller-selected numeric secrecy and native mapper taint', async () => {
    const result = await run(mode, false, { keys: ['turnNumber'] });
    const ledger = result.state.findingsLedger as Record<string, unknown>[];
    expect(ledger.find((row) => row.kind === 'time-reading')).toMatchObject({
      turn: 'REDACTED',
      iteration: 'REDACTED',
    });
    expect(result.state.turnNumber).toBe('REDACTED');
  });
});

it('filters only closed metadata before value access and retains ordinary tracked reads', () => {
  let privateReads = 0,
    userReads = 0;
  const parent = Object.assign(Object.fromEntries([['__proto__', 'PUBLIC-OWN-KEY']]), {
    finalContent: 'later writer',
    newMessages: [],
    answerValidationCommitted: false,
    publicFacts: { turn: 1 },
    privateRecordFieldsUser: 'ordinary user field',
    argumentResolutions: [{ value: 'must retain native policy' }],
  });
  Object.defineProperty(parent, PRIVATE_FIELDS_KEY, {
    enumerable: true,
    get() {
      privateReads++;
      throw Error('The Final mapper read runtime-only metadata.');
    },
  });
  Object.defineProperty(parent, 'userSecret', {
    enumerable: true,
    get() {
      userReads++;
      return 1;
    },
  });
  const ordinary = finalBranchInput(parent, false);
  expect(privateReads).toBe(0);
  expect(userReads, 'ordinary user fields still cross the native tracked mapper read').toBe(1);
  expect(ordinary).toEqual({
    ['__proto__']: 'PUBLIC-OWN-KEY',
    answerValidationCommitted: false,
    publicFacts: { turn: 1 },
    privateRecordFieldsUser: 'ordinary user field',
    argumentResolutions: [{ value: 'must retain native policy' }],
    userSecret: 1,
  });
  expect(Object.getPrototypeOf(ordinary)).toBe(Object.prototype);
  expect(finalBranchInput(parent, true)).not.toHaveProperty('answerValidationCommitted');
  expect(privateReads).toBe(0);
  expect(userReads).toBe(2);
});

it('preserves native taint from a caller-selected writable Final value before discarding it', async () => {
  const inner = flowChart('Keep final inputs', () => {}, 'keep-final-inputs').build();
  const outer = flowChart(
    'Seed',
    (scope) => {
      scope.finalContent = SECRET;
      scope.publicAlias = { value: SECRET };
    },
    'seed',
  )
    .addSubFlowChart('final-input-fixture', inner, 'Final input fixture', {
      inputMapper: (parent) => finalBranchInput(parent, false),
    })
    .build();
  const executor = new FlowChartExecutor(outer);
  executor.setRedactionPolicy({ keys: ['finalContent'] });
  await executor.run();
  const child = executor.getSnapshot({ redact: true }).subflowResults?.['final-input-fixture'];
  expect(child?.treeContext?.globalContext).toMatchObject({ publicAlias: { value: 'REDACTED' } });
  expect(child?.treeContext?.globalContext).not.toHaveProperty('finalContent');
});
