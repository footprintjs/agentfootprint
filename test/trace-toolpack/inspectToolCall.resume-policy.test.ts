import { describe, expect, it } from 'vitest';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { callTraceTool, traceToolpack, type TraceToolpackArtifacts } from '../../src/observe.js';

const call = { toolName: 'sample', toolCallId: 'sample-1', iteration: 2 };

function event(
  type: AgentfootprintEvent['type'],
  payload: object,
  leg: 'initial' | 'resume' = 'resume',
): AgentfootprintEvent {
  return {
    type,
    payload,
    meta: { runId: leg, runtimeStageId: `tool-calls#${leg}` },
  } as AgentfootprintEvent;
}

const start = event('agentfootprint.stream.tool_start', { ...call, args: {} }, 'initial');
const finish = event('agentfootprint.stream.tool_end', {
  ...call,
  entered: false,
  error: true,
  result: 'The policies did not authorize the call after the wait.',
  durationMs: 0,
});

function inspect(events: readonly AgentfootprintEvent[], rows: readonly object[] = []) {
  const history = [
    { role: 'assistant', toolCalls: [{ id: call.toolCallId, name: call.toolName, args: {} }] },
    {
      role: 'tool',
      content: 'The policies did not authorize the call after the wait.',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      outcome: 'refused',
    },
  ];
  const snapshot = {
    executionTree: {
      id: 'tool-calls',
      runtimeStageId: 'tool-calls#resume',
      name: 'Tool calls',
      logs: {},
      errors: {},
      metrics: {},
      evals: {},
    },
    commitLog: [
      {
        idx: 0,
        stage: 'Tool calls',
        stageId: 'tool-calls',
        runtimeStageId: 'tool-calls#resume',
        trace: [
          { path: 'history', verb: 'set' },
          { path: 'middlewareDecisions', verb: 'set' },
        ],
        overwrite: { history, middlewareDecisions: rows },
        updates: {},
      },
    ],
    commitValues: 'full',
  } as unknown as TraceToolpackArtifacts['snapshot'];
  // This intentionally partial record tests the host journal's policy ordering.
  return callTraceTool(
    traceToolpack({ snapshot, events }, { showWithheldResults: true }),
    'inspect_tool_call',
    { toolCallId: call.toolCallId },
  );
}

const approval = event('agentfootprint.checkin.decision', {
  ...call,
  approved: true,
  requestId: 'question-1',
  by: 'operator',
});
const permissionRefused = event('agentfootprint.permission.check', {
  ...call,
  capability: 'tool_call',
  actor: 'agent',
  target: call.toolName,
  phase: 'resume',
  result: 'deny',
});

describe('inspect_tool_call reads resumed policy decisions from recordings', () => {
  it('reports a check-in approval and the later permission refusal in order', async () => {
    const line = await inspect([start, approval, permissionRefused, finish]);
    expect(line).toContain(
      'outcome: a person approved the call. The permission policy then refused the call after the wait.',
    );
    expect(line).toContain('was never executed');
    expect(line).not.toContain('declined');
  });

  it('keeps a middleware approval and the same link’s later refusal distinct', async () => {
    const base = {
      ...call,
      at: 'tool',
      moment: 'before-tool',
      middleware: 'sample-rule',
      changed: false,
    };
    const approved = { ...base, outcome: 'allow', personApproved: true };
    const denied = { ...base, outcome: 'deny', phase: 'resume' };
    const line = await inspect(
      [
        start,
        event('agentfootprint.middleware.decision', approved),
        event('agentfootprint.middleware.decision', denied),
        finish,
      ],
      [approved, denied],
    );
    expect(line).toContain(
      "outcome: a person approved the call. Middleware 'sample-rule' then refused the call after the wait.",
    );
    expect(line).not.toContain('declined');
  });

  it('does not borrow an earlier occurrence’s approval for the same call ID', async () => {
    const line = await inspect([start, approval, finish, start, permissionRefused, finish]);
    expect(line).toContain('outcome: The permission policy refused the call after the wait.');
    expect(line).not.toContain('a person approved');
  });

  it('names the library for a recorded refusal when the approval was not retained', async () => {
    const line = await inspect([
      event('agentfootprint.middleware.decision', {
        ...call,
        at: 'tool',
        moment: 'before-tool',
        middleware: 'sample-rule',
        changed: false,
        phase: 'resume',
        outcome: 'refused',
      }),
      finish,
    ]);
    expect(line).toContain('outcome: The library refused the call after the wait.');
    expect(line).not.toContain('a person approved');
  });
});
