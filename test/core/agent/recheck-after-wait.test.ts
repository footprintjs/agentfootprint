/**
 * After a wait for a person, the permission checker and the before-tool
 * middleware are asked again before the approved call runs. These cases cover
 * the answers that are now "no", through a real Agent run:
 *
 *   approved by a person ──▶ policy asked again ──▶ no ──▶ the tool does not run
 *
 * and what the record and the account of the run then say.
 */
import { describe, expect, it } from 'vitest';

import {
  Agent,
  allow,
  ask,
  checkInApproved,
  defineTool,
  deny,
  isAskPause,
  isCheckInPause,
  type MiddlewareDecision,
  type ToolMiddleware,
} from '../../../src/index.js';
import { recordRun } from '../../../src/observe.js';
import { accountForAnswer } from '../../../src/answer-account/account.js';
import type {
  LLMMessage,
  LLMProvider,
  LLMResponse,
  PermissionChecker,
} from '../../../src/provider-contract/types.js';
import type { Recording } from '../../../src/recorders/observability/recordRun.js';
import { pausedRequest } from '../../helpers/pausedRequest.js';

/** A tool that records the arguments it was entered with. */
function recordingTool(extra: Record<string, unknown> = {}) {
  const seen: Record<string, unknown>[] = [];
  const tool = {
    ...defineTool<Record<string, unknown>, string>({
      name: 'act',
      description: 'does a thing',
      inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
      execute: (args) => {
        seen.push({ ...args });
        return 'tool ran';
      },
    }),
    ...extra,
  };
  return { seen, tool };
}

/**
 * Asks for `act` once, and answers `done` as soon as a tool result is in the
 * conversation. Reads the messages, so a freshly built agent that resumes a
 * stored run does not propose the call a second time.
 */
const provider = (): LLMProvider => ({
  name: 'mock',
  complete: async (req): Promise<LLMResponse> => {
    const answered = req.messages.some((m) => m.role === 'tool');
    return {
      content: answered ? 'done' : '',
      toolCalls: answered ? [] : [{ id: 'c1', name: 'act', args: { amount: 5 } }],
      usage: { input: 1, output: 1 },
      stopReason: answered ? 'stop' : 'tool_use',
    };
  },
});

const ledger = (agent: Agent): readonly MiddlewareDecision[] =>
  (
    agent.getLastSnapshot()?.sharedState as
      | { middlewareDecisions?: readonly MiddlewareDecision[] }
      | undefined
  )?.middlewareDecisions ?? [];

const toolResultOf = (agent: Agent): string | undefined =>
  (agent.getLastSnapshot()?.sharedState as { history: LLMMessage[] }).history.find(
    (m) => m.role === 'tool' && m.toolCallId === 'c1',
  )?.content;

const eventsOf = (recording: Recording, suffix: string) =>
  (recording.events as unknown as { type: string; payload: Record<string, unknown> }[]).filter(
    (e) => e.type === `agentfootprint.${suffix}`,
  );

describe('a check-in is approved, and the permission checker now says no', () => {
  it('does not run the tool on a freshly built agent whose policy now denies', async () => {
    const { seen, tool } = recordingTool({ checkIn: 'always' });
    const build = (checker: PermissionChecker) =>
      Agent.create({ provider: provider(), model: 'm', permissionChecker: checker })
        .tools([tool as never])
        .build();
    const paused = await build({ name: 'policy', check: () => ({ result: 'allow' }) }).run({
      message: 'go',
    });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');

    const after = build({
      name: 'policy',
      check: () => ({ result: 'deny', rationale: 'not any more' }),
    });
    const recorder = recordRun(after);
    const answer = await after.resume(
      paused.checkpoint,
      checkInApproved({ request: pausedRequest(paused), by: 'alice' }),
    );
    recorder.stop();
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;

    expect(answer).toBe('done\n\n---\n\nNot sure — a call was refused.');
    expect(seen).toEqual([]);
    expect(toolResultOf(after)).toContain('permission denied');
    // The checker's answer after the wait is on the record, marked as a second asking.
    expect(
      eventsOf(recording, 'permission.check').map((e) => [e.payload.result, e.payload.phase]),
    ).toEqual([['deny', 'resume']]);
  });

  it('is told by the account as a refusal by a rule, after the person approved', async () => {
    const { seen, tool } = recordingTool({ checkIn: 'always' });
    let verdict: 'allow' | 'deny' = 'allow';
    const agent = Agent.create({
      provider: provider(),
      model: 'm',
      permissionChecker: { name: 'policy', check: () => ({ result: verdict }) },
    })
      .tools([tool as never])
      .build();
    const recorder = recordRun(agent);
    const paused = await agent.run({ message: 'go' });
    if (!isCheckInPause(paused)) throw new Error('expected a check-in pause');
    verdict = 'deny';
    await agent.resume(
      paused.checkpoint,
      checkInApproved({ request: pausedRequest(paused), by: 'alice' }),
    );
    recorder.stop();
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;

    expect(seen).toEqual([]);
    // Both answers, in order: yes before the wait, the person's yes, no after it.
    // One list, so the order between the checker's answers and the person's is asserted too.
    const told = (
      recording.events as unknown as { type: string; payload: Record<string, unknown> }[]
    ).flatMap((event) => {
      if (event.type === 'agentfootprint.permission.check')
        return [['permission', event.payload.result, event.payload.phase]];
      if (event.type === 'agentfootprint.checkin.decision')
        return [['decision', event.payload.approved]];
      return [];
    });
    expect(told).toEqual([
      ['permission', 'allow', undefined],
      ['decision', true],
      ['permission', 'deny', 'resume'],
    ]);
    const account = accountForAnswer(recording, {});
    expect(account.facts.calls.map((c) => [c.toolCallId, c.outcome])).toEqual([['c1', 'refused']]);
    expect(account.facts.errors.refused).toBe(1);
  });
});

describe('a middleware ask is approved, and the same link now says no', () => {
  it('does not run the tool, and the account does not call it a decline by the person', async () => {
    const { seen, tool } = recordingTool();
    let gate: NonNullable<ToolMiddleware['onToolCall']> = () => ask({ question: 'approve?' });
    const agent = Agent.create({ provider: provider(), model: 'm' })
      .tools([tool])
      .toolMiddleware({ name: 'gate', onToolCall: (call) => gate(call) })
      .build();
    const recorder = recordRun(agent);
    const paused = await agent.run({ message: 'go' });
    if (!isAskPause(paused)) throw new Error('expected an ask pause');
    gate = () => deny('the policy changed');
    const answer = await agent.resume(
      paused.checkpoint,
      checkInApproved({ request: pausedRequest(paused), by: 'alice' }),
    );
    recorder.stop();
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;

    expect(answer).toBe('done\n\n---\n\nNot sure — a call was refused.');
    expect(seen).toEqual([]);
    expect(toolResultOf(agent)).toContain('the policy changed');
    // In order: the link's question, the person's yes, the link's no on the second asking.
    expect(
      ledger(agent)
        .filter((row) => row.moment === 'before-tool')
        .map((row) => [row.middleware, row.outcome, row.phase, row.why]),
    ).toEqual([
      ['gate', 'ask', undefined, 'approve?'],
      ['gate', 'allow', undefined, 'approved by alice'],
      ['gate', 'deny', 'resume', 'the policy changed'],
    ]);
    // The person said yes. The account must not say the person declined.
    const account = accountForAnswer(recording, {});
    expect(account.facts.calls.map((c) => [c.toolCallId, c.outcome])).toEqual([['c1', 'refused']]);
    expect(account.facts.errors.declined).toBe(0);
    expect(JSON.stringify(account)).not.toContain('a person was asked and declined');
  });
});

describe('a middleware ask is approved, and the same link now asks something else', () => {
  it('refuses without a second pause and tells the model it may call again', async () => {
    const { seen, tool } = recordingTool();
    const build = (question: string) =>
      Agent.create({ provider: provider(), model: 'm' })
        .tools([tool])
        .toolMiddleware({ name: 'gate', onToolCall: () => ask({ question }) })
        .build();
    const paused = await build('approve?').run({ message: 'go' });
    if (!isAskPause(paused)) throw new Error('expected an ask pause');

    const after = build('approve, and has a manager signed?');
    const answer = await after.resume(
      paused.checkpoint,
      checkInApproved({ request: pausedRequest(paused), by: 'alice' }),
    );

    expect(answer).toBe('done\n\n---\n\nNot sure — a call was refused.');
    expect(seen).toEqual([]);
    expect(toolResultOf(after)).toContain("the current policy requires a person's answer again");
    expect(
      ledger(after)
        .filter((row) => row.phase === 'resume')
        .map((row) => [row.middleware, row.outcome, row.why]),
    ).toEqual([
      ['gate', 'ask', 'approve, and has a manager signed?'],
      ['agentfootprint', 'refused', 'second-question'],
    ]);
  });
});

describe('a middleware answers something the library does not recognise', () => {
  const garbage = (() => ({ kind: 'maybe' })) as unknown as ToolMiddleware['onToolCall'];

  it('on a first call: the tool does not run and the row is the library’s refusal', async () => {
    const { seen, tool } = recordingTool();
    const agent = Agent.create({ provider: provider(), model: 'm' })
      .tools([tool])
      .toolMiddleware({ name: 'gate', onToolCall: garbage })
      .build();
    const recorder = recordRun(agent);
    await agent.run({ message: 'go' });
    recorder.stop();
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;

    expect(seen).toEqual([]);
    expect(toolResultOf(agent)).toContain('unrecognised middleware answer');
    expect(ledger(agent).map((row) => [row.middleware, row.outcome])).toEqual([
      ['gate', 'refused'],
    ]);
    const account = accountForAnswer(recording, {});
    expect(account.facts.calls.map((c) => [c.toolCallId, c.outcome])).toEqual([['c1', 'refused']]);
  });

  it('on the second asking after an approval: the tool does not run', async () => {
    const { seen, tool } = recordingTool();
    const build = (gate: ToolMiddleware['onToolCall']) =>
      Agent.create({ provider: provider(), model: 'm' })
        .tools([tool])
        .toolMiddleware({ name: 'gate', onToolCall: gate })
        .build();
    const paused = await build(() => ask({ question: 'approve?' })).run({ message: 'go' });
    if (!isAskPause(paused)) throw new Error('expected an ask pause');

    const after = build(garbage);
    await after.resume(
      paused.checkpoint,
      checkInApproved({ request: pausedRequest(paused), by: 'alice' }),
    );

    expect(seen).toEqual([]);
    expect(
      ledger(after)
        .filter((row) => row.phase === 'resume')
        .map((row) => [row.middleware, row.outcome]),
    ).toEqual([['gate', 'refused']]);
  });
});

describe('a policy that was there at the pause and is gone at the resume', () => {
  it('refuses when the asking link was removed', async () => {
    const { seen, tool } = recordingTool();
    const paused = await Agent.create({ provider: provider(), model: 'm' })
      .tools([tool])
      .toolMiddleware({ name: 'gate', onToolCall: () => ask({ question: 'approve?' }) })
      .build()
      .run({ message: 'go' });
    if (!isAskPause(paused)) throw new Error('expected an ask pause');

    const after = Agent.create({ provider: provider(), model: 'm' })
      .tools([tool])
      .toolMiddleware({ name: 'other', onToolCall: () => allow() })
      .build();
    // The resume itself is refused, by name: the chain the approval was given under has changed.
    await expect(
      after.resume(
        paused.checkpoint,
        checkInApproved({ request: pausedRequest(paused), by: 'alice' }),
      ),
    ).rejects.toMatchObject({
      name: 'ResumeDecisionError',
      code: 'ERR_RESUME_DECISION',
      reason: 'chain-changed',
      gate: 'ask',
    });
    expect(seen).toEqual([]);
  });
});
