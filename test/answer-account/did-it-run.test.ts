/**
 * The account says "It ran {tool}" only when the record shows the tool ran.
 *
 * A call can end in an error before its tool is reached (an unknown name,
 * arguments the schema rejects, a blocked credential). Its `tool_end` now says
 * so (`entered: false`), a call whose tool ran and threw says that
 * (`entered: true`), and a record from before the field says neither — so the
 * account, the tool-call ledger and every other reader ask one function
 * (`semantics/toolRan.ts` · `toolRanOf`).
 *
 * Every case is a REAL agent run with a scripted provider, saved by
 * `recordRun`, sent through a JSON round trip and read back by
 * `accountForAnswer`; the old-shape record is the same saved record with the
 * field taken off, as a record written before this version has it.
 *
 * Test types: SCENARIO (real runs, each case of the contract), REGRESSION
 * (the byte law: a success keeps its bytes), BOUNDARY (a record that does not
 * say), INTEGRATION (the ledger an answer check reads; a resumed door; the
 * trace toolpack's call journal; the summary an approver reads).
 */
import { describe, expect, it } from 'vitest';

import {
  Agent,
  ask,
  checkInApproved,
  checkInDeclined,
  defineTool,
  isAskPause,
  type AnswerToolCallsView,
  type OutputSchemaParser,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { callTraceTool, recordRun, traceToolpack } from '../../src/observe.js';
import type { CredentialProvider } from '../../src/identity.js';
import { accountForAnswer } from '../../src/answer-account/account.js';
import type { AnswerAccount, RowId } from '../../src/answer-account/types.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import type { TraceToolpackArtifacts } from '../../src/trace-toolpack/types.js';
import { pausedRequest } from '../helpers/pausedRequest.js';
import { assertP1 } from './helpers.js';

type Payload = Record<string, unknown>;

/** How many times each tool's function was entered — the ground truth the record must match. */
function tools() {
  const entered = { lookup: 0, crash: 0, billing: 0 };
  const lookup = defineTool({
    name: 'lookup',
    description: 'look up a row by id',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    execute: () => {
      entered.lookup += 1;
      return { rows: [1] };
    },
  });
  const crash = defineTool({
    name: 'crash',
    description: 'always throws',
    inputSchema: { type: 'object', properties: {} },
    execute: () => {
      entered.crash += 1;
      throw new Error('boom');
    },
  });
  const billing = defineTool({
    name: 'billing',
    description: 'needs a credential',
    inputSchema: { type: 'object', properties: {} },
    needs: { credential: 'billing' },
    execute: () => {
      entered.billing += 1;
      return 'billed';
    },
  });
  return { entered, list: [lookup, crash, billing] };
}

/** A vault that cannot answer: every call that needs it is blocked before its tool runs. */
const vaultDown = {
  id: 'vault',
  getCredential: async () => {
    throw new Error('vault down');
  },
} as unknown as CredentialProvider;

type Call = { id: string; name: string; args: Record<string, unknown> };

/** One real run: the scripted calls, then a final answer; the record saved and read back. */
async function runAndRead(calls: Call[]) {
  const { entered, list } = tools();
  const agent = Agent.create({
    provider: mock({ replies: [{ toolCalls: calls }, { content: 'Done.' }] as never }),
    model: 'mock',
    maxIterations: 4,
    credentials: vaultDown,
  } as never)
    .tools(list)
    .build();
  const recorder = recordRun(agent);
  await agent.run({ message: 'go' });
  recorder.stop();
  // A saved record: what a store holds, through a JSON round trip.
  const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  return { entered, recording, account: read(recording) };
}

function read(recording: Recording): AnswerAccount {
  const account = accountForAnswer(recording);
  assertP1(account, recording, {});
  return account;
}

const ends = (recording: Recording): Payload[] =>
  recording.events
    .filter((e) => String(e.type).endsWith('stream.tool_end'))
    .map((e) => e.payload as Payload);

const rowText = (a: AnswerAccount, id: RowId) =>
  a.rows.find((r) => r.id === id)!.lines.map((l) => l.text);

/** The record as one written before `entered` existed holds it: the field taken off every bracket. */
function writtenBeforeEntered(recording: Recording): Recording {
  return {
    ...recording,
    events: recording.events.map((e) => {
      if (!String(e.type).endsWith('stream.tool_end')) return e;
      const { entered: _gone, ...payload } = e.payload as Payload;
      return { ...e, payload };
    }),
  } as Recording;
}

describe('a call that never reached its tool — "It asked to run {tool}; the call was not executed."', () => {
  it('an unknown tool name', async () => {
    const { entered, recording, account } = await runAndRead([
      { id: 'u1', name: 'reboot_host', args: {} },
    ]);
    expect(entered).toEqual({ lookup: 0, crash: 0, billing: 0 });
    expect(ends(recording)[0]).toMatchObject({ error: true, entered: false });
    expect(account.facts.calls[0]).toMatchObject({ outcome: 'not-executed' });
    expect(rowText(account, 'checked')).toEqual([
      'It asked to run reboot_host; the call was not executed.',
    ]);
    // The results row never says it "returned an error".
    expect(rowText(account, 'found')).toEqual(['reboot_host did not run, so it found nothing.']);
    // Every call is KNOWN not to have run, so "none ran" is true here.
    expect(rowText(account, 'not-checked')).toEqual([
      'Nothing to report: none of the tool calls ran.',
    ]);
  });

  it('arguments the schema rejects', async () => {
    const { entered, recording, account } = await runAndRead([
      { id: 's1', name: 'lookup', args: { id: 7 } },
    ]);
    expect(entered.lookup).toBe(0);
    expect(ends(recording)[0]).toMatchObject({ error: true, entered: false });
    expect(rowText(account, 'checked')).toEqual([
      'It asked to run lookup; the call was not executed.',
    ]);
    expect(rowText(account, 'found')).toEqual(['lookup did not run, so it found nothing.']);
  });

  it('a blocked credential', async () => {
    const { entered, recording, account } = await runAndRead([
      { id: 'b1', name: 'billing', args: {} },
    ]);
    expect(entered.billing).toBe(0);
    expect(ends(recording)[0]).toMatchObject({ error: true, entered: false });
    expect(rowText(account, 'checked')).toEqual([
      'It asked to run billing; the call was not executed.',
    ]);
  });
});

describe('a tool that ran and threw — "It ran {tool}, and the tool reported an error." (as before)', () => {
  it('says it ran, and never "none of the tool calls ran"', async () => {
    const { entered, recording, account } = await runAndRead([
      { id: 't1', name: 'crash', args: {} },
    ]);
    expect(entered.crash).toBe(1);
    expect(ends(recording)[0]).toMatchObject({ error: true, entered: true });
    expect(account.facts.calls[0]).toMatchObject({ outcome: 'failed' });
    expect(rowText(account, 'checked')).toEqual(['It ran crash, and the tool reported an error.']);
    expect(rowText(account, 'found')).toEqual(['crash returned an error, not a result.']);
    // It ran, so "none ran" would be false: the line says only what is true.
    expect(rowText(account, 'not-checked')).toEqual([
      'Nothing to report: no tool call returned a result in this record.',
    ]);
    expect(account.facts.errors.failed).toBe(1);
  });
});

describe('a record that does not say (written before `entered`)', () => {
  it('an error reads "It asked to run {tool}; the call ended in an error." — never "It ran"', async () => {
    const { recording } = await runAndRead([{ id: 't1', name: 'crash', args: {} }]);
    const old = writtenBeforeEntered(recording);
    expect(ends(old)[0]).not.toHaveProperty('entered');
    const account = read(JSON.parse(JSON.stringify(old)) as Recording);
    expect(account.facts.calls[0]).toMatchObject({ outcome: 'ended-in-error' });
    expect(rowText(account, 'checked')).toEqual([
      'It asked to run crash; the call ended in an error.',
    ]);
    expect(rowText(account, 'found')).toEqual([
      'The call to crash ended in an error, not a result.',
    ]);
    expect(rowText(account, 'not-checked')).toEqual([
      'Nothing to report: no tool call returned a result in this record.',
    ]);
  });

  it('a call that never ran, on an old record, reads the same neutral sentence', async () => {
    const { recording } = await runAndRead([{ id: 'u1', name: 'reboot_host', args: {} }]);
    const account = read(writtenBeforeEntered(recording));
    expect(rowText(account, 'checked')).toEqual([
      'It asked to run reboot_host; the call ended in an error.',
    ]);
  });

  it('a hand-built old-shape record gets the neutral sentence', () => {
    const meta = (runtimeStageId: string) => ({
      runId: 'run-old',
      runtimeStageId,
      subflowPath: [],
      compositionPath: [],
      wallClockMs: 1,
      runOffsetMs: 0,
    });
    const recording = {
      events: [
        {
          type: 'agentfootprint.stream.tool_start',
          payload: { toolCallId: 'c1', toolName: 'reboot_host', args: {} },
          meta: meta('tool-calls#3'),
        },
        {
          type: 'agentfootprint.stream.tool_end',
          payload: { toolCallId: 'c1', result: 'Unknown tool', durationMs: 0, error: true },
          meta: meta('tool-calls#3'),
        },
      ],
    } as unknown as Recording;
    const account = accountForAnswer(recording);
    expect(account.facts.calls[0]).toMatchObject({ outcome: 'ended-in-error' });
    expect(rowText(account, 'checked')).toEqual([
      'It asked to run reboot_host; the call ended in an error.',
    ]);
    expect(JSON.stringify(account.rows)).not.toContain('It ran');
  });
});

describe('the byte law: a call that succeeded keeps exactly its bytes', () => {
  it('a success has no `entered`', async () => {
    const { entered, recording, account } = await runAndRead([
      { id: 'ok1', name: 'lookup', args: { id: 'r1' } },
    ]);
    expect(entered.lookup).toBe(1);
    expect(Object.keys(ends(recording)[0]!).sort()).toEqual(['durationMs', 'result', 'toolCallId']);
    expect(account.facts.calls[0]).toMatchObject({ outcome: 'ran' });
  });

  it('a mixed batch: "none ran" is not said while one call ran', async () => {
    const { account } = await runAndRead([
      { id: 'u1', name: 'reboot_host', args: {} },
      { id: 'ok1', name: 'lookup', args: { id: 'r1' } },
    ]);
    expect(account.facts.calls.map((c) => c.outcome)).toEqual(['not-executed', 'ran']);
    expect(rowText(account, 'not-checked').join('\n')).not.toContain('none of the tool calls ran');
  });
});

describe('the tool-call ledger an answer check reads asks the same reader', () => {
  interface Reply {
    readonly text: string;
  }
  const parser: OutputSchemaParser<Reply> = {
    parse: (value) => ({ text: String((value as { text?: unknown }).text) }),
  };

  it('never-entered calls are `not-run`; a tool that threw is `error`', async () => {
    const { list } = tools();
    const seen: AnswerToolCallsView[] = [];
    const agent = Agent.create({
      provider: mock({
        replies: [
          {
            toolCalls: [
              { id: 'u1', name: 'reboot_host', args: {} },
              { id: 's1', name: 'lookup', args: { id: 7 } },
              { id: 't1', name: 'crash', args: {} },
            ],
          },
          JSON.stringify({ text: 'Done.' }),
        ] as never,
      }),
      model: 'mock',
    })
      .tools(list)
      .outputSchema(parser)
      .answerValidation<Reply>({
        id: 'reads-calls',
        version: '1',
        validate: (_answer, context) => {
          seen.push(context.toolCalls);
          return { checks: [{ id: 'read', disposition: 'checked-pass' }] };
        },
      })
      .build();
    await agent.run({ message: 'go' });
    expect(seen[0]!.calls.map((c) => [c.name, c.outcome])).toEqual([
      ['reboot_host', 'not-run'],
      ['lookup', 'not-run'],
      ['crash', 'error'],
    ]);
  });
});

describe('a resumed door writes the same field', () => {
  async function resumed(approve: boolean) {
    const { entered, list } = tools();
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'b1', name: 'billing', args: {} }] }, { content: 'Done.' }],
      }),
      model: 'mock',
      credentials: vaultDown,
    } as never)
      .tools(list)
      .toolMiddleware({ name: 'gate', onToolCall: () => ask({ question: 'approve?' }) })
      .build();
    const recorder = recordRun(agent);
    const paused = await agent.run({ message: 'go' });
    if (!isAskPause(paused as never)) throw new Error('expected an ask pause');
    const decide = approve ? checkInApproved : checkInDeclined;
    await agent.resume(
      (paused as { checkpoint: unknown }).checkpoint as never,
      decide({ request: pausedRequest(paused), by: 'reviewer' }),
    );
    recorder.stop();
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    return { entered, recording };
  }

  it('an approved call blocked by its credential on resume: entered false, not executed', async () => {
    const { entered, recording } = await resumed(true);
    expect(entered.billing).toBe(0);
    expect(ends(recording).at(-1)).toMatchObject({ error: true, entered: false });
  });

  it('a declined call on resume: entered false, and the account still says a person declined', async () => {
    const { entered, recording } = await resumed(false);
    expect(entered.billing).toBe(0);
    const end = ends(recording).at(-1)!;
    expect(end).toMatchObject({ entered: false });
    expect(end).not.toHaveProperty('error');
    // The person's decision is read first: declined, never "not executed" or "failed".
    const account = accountForAnswer(recording);
    expect(account.facts.calls.find((c) => c.toolCallId === 'b1')?.outcome).toBe('declined');
    expect(account.facts.errors.failed).toBe(0);
  });

  it('an approved call blocked by its credential on resume reads "not executed", counted as an error', async () => {
    const { recording } = await resumed(true);
    const account = accountForAnswer(recording);
    expect(account.facts.calls.find((c) => c.toolCallId === 'b1')?.outcome).toBe('not-executed');
    expect(account.facts.errors.failed).toBe(1);
    expect(JSON.stringify(account.rows)).not.toContain('It ran billing');
  });
});

describe('the trace toolpack reads the same answer (inspect_tool_call)', () => {
  const journal = (recording: Recording, id: string) =>
    callTraceTool(
      traceToolpack({
        snapshot: recording.snapshot,
        events: recording.events,
      } as unknown as TraceToolpackArtifacts),
      'inspect_tool_call',
      { toolCallId: id },
    );

  it('an unknown tool name: it ran with nothing, and was not executed', async () => {
    const { recording } = await runAndRead([{ id: 'u1', name: 'reboot_host', args: {} }]);
    const out = await journal(recording, 'u1');
    expect(out).toContain("ran with: nothing — call 'u1' was never executed.");
    expect(out).toContain(
      "outcome: error — call 'u1' was not executed: the tool was never entered",
    );
    expect(out).not.toContain('the tool threw');
  });

  it('a tool that ran and threw keeps its words; an old record does not say', async () => {
    const { recording } = await runAndRead([{ id: 't1', name: 'crash', args: {} }]);
    expect(await journal(recording, 't1')).toContain(
      'outcome: error — the tool threw or returned a failure',
    );
    expect(await journal(writtenBeforeEntered(recording), 't1')).toContain(
      'outcome: error — this record does not say whether the tool ran',
    );
  });
});

describe('the summary an approver reads counts calls, never runs', () => {
  it('an unknown tool name before a check-in is "1 tool call", not "1 tool run"', async () => {
    const refund = defineTool<{ amount: number }, string>({
      name: 'issue_refund',
      description: 'Issue a refund',
      inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
      checkIn: 'always',
      execute: ({ amount }) => `refunded ${amount}`,
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'u1', name: 'reboot_host', args: {} }] },
          { toolCalls: [{ id: 'r1', name: 'issue_refund', args: { amount: 5 } }] },
        ] as never,
      }),
      model: 'mock',
    })
      .tool(refund)
      .checkIn({ evidence: 'standard' })
      .build();
    const out = (await agent.run({ message: 'go' })) as {
      checkIn?: { evidence: { trail?: { summary: string; toolCalls: readonly unknown[] } } };
    };
    const trail = out.checkIn?.evidence.trail;
    expect(trail?.toolCalls).toHaveLength(1);
    expect(trail?.summary).toMatch(/^1 tool call over \d+ iterations?$/);
    expect(trail?.summary).not.toContain('run');
  });
});
