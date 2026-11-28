import { callOccurrenceField, type CallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { PausedGatePolicy } from '../../../types/state/pause.js';
import type { MiddlewareDecision } from '../../../middleware/types.js';
import { checkerGoverns, type LLMMessage } from '../../../../../provider-contract/types.js';
import { resolveSkillToolForRole } from '../../toolResolver.js';
import type { SkillRoleView } from '../../../skillContext/toolVisibility.js';
import type { Resolution } from '../contracts/callFacts.js';
import type { Tool } from '../../../../../tools/tools.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type {
  ResumedCallResult,
  ResumedInvocationLinks,
} from '../contracts/operations/resumedInvocation.js';
import { isHiddenSkillRead } from '../../../skillContext/readSkillArguments.js';
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
import { preparedArgumentWitness } from './preparedArgumentWitness.js';
import {
  fingerprintAskedQuestion,
  beforeToolPolicyNames,
  pausedGatePolicyOf,
} from './resumePolicyRecord.js';

interface ResumedSkillAdmission {
  readonly resolved: Resolution;
  readonly role?: SkillRoleView;
}

/** Refresh the role for this call, its refusal roster and its composed calls. */
export function buildResumedSkillAdmission(
  deps: Pick<ToolCallsHandlerDeps, 'permissionChecker' | 'toolClaimants' | 'resolveHiddenSkillIds'>,
) {
  const rolePolicy = checkerGoverns(deps.permissionChecker, 'skill_read');
  const resolveHiddenSkillIds = deps.resolveHiddenSkillIds;
  return (
    scope: TypedScope<AgentState>,
    toolName: string,
    candidate: Resolution,
    signal?: AbortSignal,
  ): ResumedSkillAdmission | Promise<ResumedSkillAdmission> => {
    if (!rolePolicy) return { resolved: candidate };
    const applyRole = (hiddenSkillIds?: readonly string[]): ResumedSkillAdmission => ({
      resolved: resolveSkillToolForRole(
        candidate,
        deps.toolClaimants?.get(toolName) ?? [],
        hiddenSkillIds,
      ),
      role: { hiddenSkillIds },
    });
    if (resolveHiddenSkillIds === undefined) return applyRole();
    return awaitUnder(signal, () => resolveHiddenSkillIds(scope)).then(applyRole);
  };
}

type AccessDeps = Pick<ToolCallsHandlerDeps, 'permissionChecker' | 'toolMiddleware'>;
type ResumedAdmission =
  | {
      readonly allowed: true;
      readonly args: ToolArgs;
      readonly matchesPrepared: (args: ToolArgs) => boolean;
    }
  | { readonly allowed: false; readonly refusal: ResumedCallResult };

const refused = (refusal: ResumedCallResult): ResumedAdmission => ({ allowed: false, refusal });

interface ResumeGateFrame {
  readonly callOccurrenceKey?: CallOccurrenceKey;
  readonly gate: PausedGatePolicy['gate'];
  readonly hiddenSelectionRefusal?: string;
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

/** Validate the saved selection and retain the policy receipt for a known hidden skill. */
export function buildResumedArgumentRefusal(
  deps: AccessDeps,
  links: Pick<ResumedInvocationLinks, 'argumentRefusal' | 'parkedNow' | 'historyForCheckIn'>,
) {
  return (
    scope: TypedScope<AgentState>,
    role: SkillRoleView | undefined,
    frame: Omit<ResumeGateFrame, 'parkedNow' | 'historyForCheckIn' | 'hiddenSelectionRefusal'>,
  ): string | Promise<string> | undefined => {
    const { tool, toolName, toolCallId, iteration, args } = frame;
    const refusal = links.argumentRefusal(scope, tool, args, {
      toolName,
      toolCallId,
      iteration,
      ...(role === undefined ? {} : { role }),
    });
    if (refusal === undefined || role === undefined || !isHiddenSkillRead(tool, args, role)) {
      return refusal;
    }
    return recheckResumedCall(scope, deps, {
      ...frame,
      parkedNow: links.parkedNow,
      historyForCheckIn: links.historyForCheckIn,
      hiddenSelectionRefusal: refusal,
    }).then(() => refusal);
  };
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
  call: Pick<ResumeGateFrame, 'toolName' | 'toolCallId' | 'iteration' | 'callOccurrenceKey'>,
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
): Promise<ResumedAdmission> {
  const { gate, tool, toolName, toolCallId, iteration, env } = frame;
  const occurrence = callOccurrenceField(frame.callOccurrenceKey);
  const read = (key: string): unknown => scope.$getValue(key);
  const policy = pausedGatePolicyOf(read('pausedGatePolicy'), { gate, toolCallId, iteration });
  const emitSecurity = bindToolSecurityEvents(
    scope,
    { toolCallId, iteration, ...occurrence },
    'resume',
  );
  const permissionRefusal = (rationale: string): ResumedAdmission => {
    emitSecurity('agentfootprint.permission.check', {
      capability: 'tool_call',
      actor: 'agent',
      target: toolName,
      result: 'deny',
      rationale,
    });
    return refused({
      result: `Tool '${toolName}' could not be authorized after the wait.`,
      error: true,
    });
  };
  env.signal?.throwIfAborted();
  if (policy === undefined)
    return permissionRefusal('The original gate configuration is unavailable.');
  const permissionChecker = deps.permissionChecker;
  if (policy.permission && permissionChecker === undefined)
    return permissionRefusal('The permission checker required by the paused call is unavailable.');

  // Keep the prepared values stable while every gate is awaited. A plain
  // structured clone can still share the backing memory of prepared bytes.
  const uncopiable = (): ResumedAdmission =>
    permissionRefusal('The prepared arguments could not be held for recheck.');
  let snapshot: ToolArgs | undefined;
  try {
    snapshot = frozenCopyOf(frame.args);
  } catch {
    return uncopiable();
  }
  if (snapshot === undefined) return uncopiable();
  const args = snapshot;
  let matchesPrepared: (current: ToolArgs) => boolean;
  try {
    matchesPrepared = preparedArgumentWitness(args);
  } catch {
    return uncopiable();
  }

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
  const askSelection = (auditOnly?: true) =>
    askSkillRead(
      (...call) => awaitUnder(env.signal, () => askCapability(...call)),
      permissionChecker,
      {
        toolName,
        args,
        ...(auditOnly === true && { auditOnly }),
        currentSkillId: () => scope.currentSkillId,
        parked: () => frame.parkedNow(scope),
      },
    );
  if (frame.hiddenSelectionRefusal !== undefined) {
    await askSelection(true);
    return refused({ result: frame.hiddenSelectionRefusal, error: true });
  }
  const deniedByPolicy = (): ResumedAdmission =>
    refused({
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
      frame.callOccurrenceKey,
    );
  const refuse = (why: string, result: string): ResumedAdmission => {
    recordResumedRefusal(scope, { toolName, toolCallId, iteration, ...occurrence }, why);
    return refused({ result, error: true });
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
    if (chain.kind === 'deny') return refused({ result: chain.reason, error: true });
    if (!sameArguments(args, chain.args)) {
      return refuse(
        'call-changed',
        rewrittenAfterApproval(toolName, changedAfterApproval(chain.decisions)),
      );
    }
    if (chain.kind === 'ask') return refuse('second-question', secondQuestion(toolName));
  }
  await askSelection();
  if (execution.denied) return deniedByPolicy();
  const needsAnotherQuestion =
    gate !== 'checkIn' &&
    tool.checkIn !== undefined &&
    shouldCheckIn(tool.checkIn, args, {
      iteration,
      toolCallId,
      history: frame.historyForCheckIn(scope, historyForCallbacks()),
    });
  if (!matchesPrepared(args))
    return refuse(
      'call-changed',
      rewrittenAfterApproval(toolName, 'those arguments changed before the call could run'),
    );
  if (needsAnotherQuestion) return refuse('second-question', secondQuestion(toolName));

  // Only the invocation gets this copy. A tool still receives ordinary
  // arguments, even when the policy views were frozen.
  try {
    return { allowed: true, args: structuredClone(args), matchesPrepared };
  } catch {
    return uncopiable();
  }
}
