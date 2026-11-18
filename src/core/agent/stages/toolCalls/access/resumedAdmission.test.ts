import { describe, expect, it, vi } from 'vitest';
import type { ToolMiddleware, MiddlewareDecision } from '../../../middleware/types.js';
import { pauseGatePolicy } from './resumePolicyRecord.js';
import { recheckResumedCall } from './resumedAdmission.js';

const address = { gate: 'checkIn', toolCallId: 'sample-call', iteration: 2 } as const;
const frame = {
  ...address,
  toolName: 'sample',
  tool: {} as never,
  args: { label: 'sample' },
  env: {} as never,
  parkedNow: () => undefined,
  historyForCheckIn: () => [],
};

function capture(policy: unknown, prior: readonly MiddlewareDecision[] = []) {
  const fixture: Record<string, unknown> = { pausedGatePolicy: policy, history: [] };
  return {
    $getValue: (key: string) => fixture[key],
    $emit: vi.fn(),
    middlewareDecisions: prior,
  };
}

describe('resumed tool admission without execution', () => {
  it('keeps the policy question and the library’s second-question refusal in order', async () => {
    const middleware: ToolMiddleware = {
      name: 'example-rule',
      onToolCall: () => ({ kind: 'ask', payload: { question: 'Review the example?' } }),
    };
    const deps = { toolMiddleware: [middleware] };
    const prior: MiddlewareDecision = {
      toolCallId: address.toolCallId,
      toolName: frame.toolName,
      middleware: middleware.name,
      moment: 'before-tool',
      at: 'tool',
      iteration: address.iteration,
      outcome: 'allow',
      changed: false,
    };
    const scope = capture(pauseGatePolicy(deps, address), [prior]);

    await expect(recheckResumedCall(scope as never, deps, frame)).resolves.toEqual({
      result:
        "Tool 'sample' did not run because the current policy requires a person's answer again. The tool may be called again.",
      error: true,
    });
    expect(scope.middlewareDecisions).toMatchObject([
      prior,
      { middleware: 'example-rule', phase: 'resume', outcome: 'ask' },
      { middleware: 'agentfootprint', phase: 'resume', outcome: 'refused', why: 'second-question' },
    ]);
  });

  it('refuses missing provenance without consulting a hook', async () => {
    const onToolCall = vi.fn();
    const scope = capture(undefined);
    const deps = { toolMiddleware: [{ name: 'example-rule', onToolCall }] };

    const result = await recheckResumedCall(scope as never, deps, frame);
    expect(result?.error).toBe(true);
    expect(onToolCall).not.toHaveBeenCalled();
    expect(scope.$emit.mock.calls.map(([type]) => type)).toEqual([
      'agentfootprint.permission.check',
    ]);
  });

  it('requires every before-tool policy that the pause recorded', async () => {
    const onToolCall = vi.fn(() => ({ kind: 'allow' as const }));
    const current = { name: 'available-rule', onToolCall };
    const original = { toolMiddleware: [current, { name: 'required-rule', onToolCall }] };
    const scope = capture(pauseGatePolicy(original, address));

    const result = await recheckResumedCall(scope as never, { toolMiddleware: [current] }, frame);

    expect(result?.error).toBe(true);
    expect(onToolCall).not.toHaveBeenCalled();
    expect(scope.middlewareDecisions).toMatchObject([
      { middleware: 'agentfootprint', phase: 'resume', outcome: 'refused' },
    ]);
  });

  it('keeps a terminal policy decision attached to the resumed call', async () => {
    const deps = {
      permissionChecker: {
        name: 'sample-policy',
        check: () => ({ result: 'halt' as const, reason: 'sample-verdict' }),
      },
    };
    const scope = capture(pauseGatePolicy(deps, address));

    const result = await recheckResumedCall(scope as never, deps, frame);

    expect(result?.halt).toMatchObject({
      outer: true,
      reason: 'sample-verdict',
      call: { toolName: frame.toolName, toolCallId: address.toolCallId, args: frame.args },
    });
    expect(scope.$emit.mock.calls.map(([type]) => type)).toEqual([
      'agentfootprint.permission.check',
    ]);
  });
});
