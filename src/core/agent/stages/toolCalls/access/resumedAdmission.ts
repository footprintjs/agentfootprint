import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { PausedGatePolicy } from '../../../types/state/pause.js';
import type { MiddlewareDecision } from '../../../middleware/types.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import type { Tool } from '../../../../../tools/tools.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { ResumedCallResult } from '../contracts/operations/resumedInvocation.js';
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';
import {
  runToolChain,
  type ToolArgs,
  type ToolChainResult,
} from '../../../../../tools/runChain.js';
import { awaitUnder } from '../../../../../lib/abort.js';
import { copyJson } from '../../../../../lib/boundedJson.js';
import { canonicalJson } from '../../../../../lib/canonicalJson.js';
import { frozenCopyOf, frozenView } from '../../../../../lib/frozenCopy.js';
import { gatedCallOf, runsAsAsked } from '../../../../consentRequest.js';
import { shouldCheckIn } from '../../../../checkin.js';
import { bindToolSecurityEvents } from '../../../toolSecurityEvents.js';
import { recordDecisions } from '../../../middleware/ledger.js';
import { policyArgsOf } from '../../../innerCallPolicyArgs.js';
import { prepareCallState } from './callState.js';
import { checkToolPermission } from './toolPermission.js';
import { askDeclaredCapabilities, buildCapabilityQuestion } from './capabilityQuestion.js';
import { askSkillRead } from './skillReadQuestion.js';
import { changedAfterApproval, rewrittenAfterApproval } from './bindings.js';
import {
  fingerprintAskedQuestion,
  beforeToolPolicyNames,
  pausedGatePolicyOf,
} from './resumePolicyRecord.js';

type AccessDeps = Pick<ToolCallsHandlerDeps, 'permissionChecker' | 'toolMiddleware'>;
interface ResumeGateFrame {
  readonly gate: PausedGatePolicy['gate'];
  readonly tool: Tool;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  readonly args: ToolArgs;
  readonly env: ReturnType<TypedScope<AgentState>['$getEnv']>;
  readonly parkedNow: ToolCatalogOperations['parkedNow'];
  readonly historyForCheckIn: (
    scope: TypedScope<AgentState>,
    history: readonly LLMMessage[],
  ) => readonly LLMMessage[];
}

const secondQuestion = (name: string): string =>
  `Tool '${name}' did not run because the current policy requires a person's answer again. ` +
  'The tool may be called again.';

function sameArguments(actual: ToolArgs, returned: ToolArgs): boolean {
  try {
    return (
      canonicalJson(copyJson(actual, Infinity, false)) ===
      canonicalJson(copyJson(returned, Infinity, false))
    );
  } catch {
    return false;
  }
}

function hasRequiredMiddleware(required: readonly string[], current: readonly string[]): boolean {
  const remaining = new Map<string, number>();
  for (const name of current) remaining.set(name, (remaining.get(name) ?? 0) + 1);
  for (const name of required) {
    const count = remaining.get(name) ?? 0;
    if (count === 0) return false;
    remaining.set(name, count - 1);
  }
  return true;
}

function isApprovedQuestion(
  scope: TypedScope<AgentState>,
  policy: PausedGatePolicy,
  question: Extract<ToolChainResult, { kind: 'ask' }>,
): boolean {
  if (policy.gate !== 'ask' || policy.question === undefined) return false;
  const read = (key: string): unknown => scope.$getValue(key);
  const bound = gatedCallOf(read, 'ask');
  return (
    question.index === bound.askIndex &&
    question.middleware === bound.middleware &&
    fingerprintAskedQuestion(question.payload) === policy.question &&
    runsAsAsked(read('pausedRequest'), bound, question.args)
  );
}

export function recordResumedRefusal(
  scope: TypedScope<AgentState>,
  call: Pick<ResumeGateFrame, 'toolName' | 'toolCallId' | 'iteration'>,
  why: string,
): void {
  recordDecisions(scope, [
    {
      ...call,
      middleware: 'agentfootprint',
      at: 'tool',
      moment: 'before-tool',
      phase: 'resume',
      outcome: 'refused',
      changed: false,
      why,
    },
  ]);
}

/** The permission and before-tool owners decide again on the prepared call. */
export async function recheckResumedCall(
  scope: TypedScope<AgentState>,
  deps: AccessDeps,
  frame: ResumeGateFrame,
): Promise<ResumedCallResult | undefined> {
  const { gate, tool, toolName, toolCallId, iteration, args, env } = frame;
  const read = (key: string): unknown => scope.$getValue(key);
  const policy = pausedGatePolicyOf(read('pausedGatePolicy'), { gate, toolCallId, iteration });
  const emitSecurity = bindToolSecurityEvents(scope, { toolCallId, iteration }, 'resume');
  const permissionRefusal = (rationale: string): ResumedCallResult => {
    emitSecurity('agentfootprint.permission.check', {
      capability: 'tool_call',
      actor: 'agent',
      target: toolName,
      result: 'deny',
      rationale,
    });
    return { result: `Tool '${toolName}' could not be authorized after the wait.`, error: true };
  };
  env.signal?.throwIfAborted();
  if (policy === undefined)
    return permissionRefusal('The original gate configuration is unavailable.');
  const permissionChecker = deps.permissionChecker;
  if (policy.permission && permissionChecker === undefined)
    return permissionRefusal('The permission checker required by the paused call is unavailable.');

  const historyForCallbacks = (): LLMMessage[] => {
    const history = frozenCopyOf((read('history') ?? []) as LLMMessage[]);
    if (history === undefined) throw new Error('The resumed call history could not be copied.');
    return history;
  };
  const runIdentity = scope.runIdentity;
  const tc = { id: toolCallId, name: toolName, args };
  const { callArguments, execution, outcome } = prepareCallState(
    tc,
    undefined,
    undefined,
    undefined,
    args,
  );
  const bindings = {
    historyForCallbacks,
    iteration,
    tc,
    viewOf: frozenView,
    runIdentity,
    env,
    emitSecurity,
    execution,
    outcome,
  };
  const askCapability = buildCapabilityQuestion({ ...bindings, permissionChecker, callArguments });
  const deniedByPolicy = (): ResumedCallResult => ({
    result: outcome.result,
    error: true,
    ...(execution.haltContext !== undefined && {
      halt: {
        ...execution.haltContext,
        outer: true as const,
        call: { toolCallId, toolName, args },
      },
    }),
  });
  if (permissionChecker !== undefined) {
    await awaitUnder(env.signal, () =>
      checkToolPermission({
        ...bindings,
        permissionChecker,
        runArgs: args,
        innerArgsOf: (inner) => policyArgsOf(scope, inner),
      }),
    );
    if (execution.denied) return deniedByPolicy();
    if (tool.capabilities !== undefined) {
      await askDeclaredCapabilities(
        (...call) => awaitUnder(env.signal, () => askCapability(...call)),
        permissionChecker,
        tool.capabilities,
        toolName,
        execution,
      );
      if (execution.denied) return deniedByPolicy();
    }
  }

  const record = (rows: readonly MiddlewareDecision[]): void =>
    recordDecisions(
      scope,
      rows.map((row) => ({ ...row, phase: 'resume' })),
    );
  const refuse = (why: string, result: string): ResumedCallResult => {
    recordResumedRefusal(scope, { toolName, toolCallId, iteration }, why);
    return { result, error: true };
  };
  const middleware = deps.toolMiddleware;
  const currentNames = beforeToolPolicyNames(middleware);
  if (!hasRequiredMiddleware(policy.middleware, currentNames))
    return refuse(
      'The original before-tool policy is unavailable.',
      `Tool '${toolName}' could not be authorized after the wait.`,
    );
  if (middleware !== undefined && currentNames.length > 0) {
    // Middleware may edit its input. Use another tree and keep the bound args for entry.
    let detached: ToolArgs;
    try {
      detached = copyJson(args, Infinity, false) as ToolArgs;
    } catch {
      return refuse(
        'Resumed arguments could not be copied.',
        `Tool '${toolName}' could not be authorized after the wait.`,
      );
    }
    const input = {
      toolName,
      ...(tool.source !== undefined && { toolSource: tool.source }),
      toolCallId,
      iteration,
      args: detached,
      history: historyForCallbacks(),
      ...(runIdentity !== undefined && { identity: runIdentity }),
      ...(env.signal !== undefined && { signal: env.signal }),
    };
    let chain = await awaitUnder(env.signal, () => runToolChain(middleware, input));
    record(chain.decisions);
    if (
      chain.kind === 'ask' &&
      sameArguments(args, chain.args) &&
      isApprovedQuestion(scope, policy, chain)
    ) {
      const next = { ...input, args: chain.args, startIndex: chain.index + 1 };
      chain = await awaitUnder(env.signal, () => runToolChain(middleware, next));
      record(chain.decisions);
    }
    if (chain.kind === 'deny') return { result: chain.reason, error: true };
    if (!sameArguments(args, chain.args)) {
      return refuse(
        'call-changed',
        rewrittenAfterApproval(toolName, changedAfterApproval(chain.decisions)),
      );
    }
    if (chain.kind === 'ask') return refuse('second-question', secondQuestion(toolName));
  }
  await askSkillRead(
    (...call) => awaitUnder(env.signal, () => askCapability(...call)),
    permissionChecker,
    {
      toolName,
      args,
      currentSkillId: () => scope.currentSkillId,
      parked: () => frame.parkedNow(scope),
    },
  );
  if (execution.denied) return deniedByPolicy();
  if (
    gate !== 'checkIn' &&
    tool.checkIn !== undefined &&
    shouldCheckIn(tool.checkIn, args, {
      iteration,
      toolCallId,
      history: frame.historyForCheckIn(scope, historyForCallbacks()),
    })
  )
    return refuse('second-question', secondQuestion(toolName));
  return undefined;
}
