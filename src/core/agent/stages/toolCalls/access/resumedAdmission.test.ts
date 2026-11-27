import { describe, expect, it, vi } from 'vitest';
import type { ToolMiddleware, MiddlewareDecision } from '../../../middleware/types.js';
import { pauseGatePolicy } from './resumePolicyRecord.js';
import { buildResumedSkillAdmission, recheckResumedCall } from './resumedAdmission.js';
import type { Resolution } from '../contracts/callFacts.js';

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

describe('resumed skill-role decision', () => {
  const tool = {} as never;
  const candidate: Resolution = { tool, party: { channel: 'skill', id: 'records' } };
  const permissionChecker = { name: 'role', governs: ['skill_read' as const], check: vi.fn() };
  const toolClaimants = new Map([
    ['summary', [{ tool, channel: 'skill' as const, id: 'records' }]],
  ]);
  const savedScope = { hiddenSkillIds: [] } as never;

  it('uses the current role decision for a governed skill candidate', async () => {
    const resolveHiddenSkillIds = vi.fn().mockResolvedValue(['records']);
    const deps = { permissionChecker, toolClaimants, resolveHiddenSkillIds };
    const resolve = buildResumedSkillAdmission(deps);

    await expect(Promise.resolve(resolve(savedScope, 'summary', candidate))).resolves.toEqual({
      resolved: {},
      role: { hiddenSkillIds: ['records'] },
    });
    expect(resolveHiddenSkillIds).toHaveBeenCalledWith(savedScope);
  });

  it('keeps the ordinary candidate and refreshes the role for its composed calls', async () => {
    const resolveHiddenSkillIds = vi.fn().mockResolvedValue([]);
    const deps = { permissionChecker, toolClaimants, resolveHiddenSkillIds };
    const resolve = buildResumedSkillAdmission(deps);
    const ordinary: Resolution = { tool };

    await expect(resolve(savedScope, 'summary', ordinary)).resolves.toEqual({
      resolved: ordinary,
      role: { hiddenSkillIds: [] },
    });
    await expect(resolve(savedScope, 'summary', candidate)).resolves.toEqual({
      resolved: candidate,
      role: { hiddenSkillIds: [] },
    });
  });

  it('withholds a governed candidate when the current role is unavailable', () => {
    const resolve = buildResumedSkillAdmission({ permissionChecker, toolClaimants });
    expect(resolve(savedScope, 'summary', candidate)).toEqual({
      resolved: {},
      role: { hiddenSkillIds: undefined },
    });
  });
});

describe('resumed tool admission without execution', () => {
  it('returns the same detached bytes that asynchronous policy saw', async () => {
    const swatch = new Uint8Array(new SharedArrayBuffer(1));
    swatch[0] = 7;
    let acknowledge!: () => void;
    const waiting = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    let release!: () => void;
    const delay = new Promise<void>((resolve) => {
      release = resolve;
    });
    const check = vi.fn(async (_question: { readonly context?: unknown }) => {
      acknowledge();
      await delay;
      return { result: 'allow' as const };
    });
    const deps = { permissionChecker: { name: 'swatch-catalogue', check } };
    const scope = capture(pauseGatePolicy(deps, address));

    const pending = recheckResumedCall(scope as never, deps, { ...frame, args: { swatch } });
    await waiting;
    swatch[0] = 8;
    release();
    const admission = await pending;

    expect(check.mock.calls[0]?.[0].context).toEqual({ swatch: Uint8Array.of(7) });
    expect(admission).toMatchObject({ allowed: true, args: { swatch: Uint8Array.of(7) } });
    if (!admission.allowed) throw new Error('Expected an admitted swatch.');
    expect(admission.matchesPrepared(admission.args)).toBe(true);
  });

  it('refuses prepared values it cannot detach before asking the policy', async () => {
    const check = vi.fn();
    const deps = { permissionChecker: { name: 'swatch-catalogue', check } };
    const scope = capture(pauseGatePolicy(deps, address));

    const admission = await recheckResumedCall(scope as never, deps, {
      ...frame,
      args: { formatter: () => 'sample' },
    });

    expect(admission).toEqual({
      allowed: false,
      refusal: { result: "Tool 'sample' could not be authorized after the wait.", error: true },
    });
    expect(check).not.toHaveBeenCalled();
  });

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
      allowed: false,
      refusal: {
        result:
          "Tool 'sample' did not run because the current policy requires a person's answer again. The tool may be called again.",
        error: true,
      },
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
    expect(result).toMatchObject({ allowed: false, refusal: { error: true } });
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

    expect(result).toMatchObject({ allowed: false, refusal: { error: true } });
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

    expect(result).toMatchObject({
      allowed: false,
      refusal: {
        halt: {
          outer: true,
          reason: 'sample-verdict',
          call: { toolName: frame.toolName, toolCallId: address.toolCallId, args: frame.args },
        },
      },
    });
    expect(scope.$emit.mock.calls.map(([type]) => type)).toEqual([
      'agentfootprint.permission.check',
    ]);
  });
});
