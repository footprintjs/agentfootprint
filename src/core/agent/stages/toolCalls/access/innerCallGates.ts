/**
 * The gates a call the model makes passes, put to a call one tool makes
 * through another (`ctx.tools.call`) — through the SAME functions.
 *
 * Why: a permission checker or a before-tool middleware that refuses a tool
 * to the model must refuse it to a composing tool too, or the rule is one
 * composed tool away from not existing. So this file holds no rule of its
 * own. The permission gate is `./toolPermission.ts` · `checkToolPermission`,
 * `./capabilityQuestion.ts` · `askDeclaredCapabilities` and
 * `./skillReadQuestion.ts` · `askSkillRead`: whatever they decide about a
 * checker's answer (a deny, a halt, a throw) they decide for an inner call
 * too, and any rule added to them later reaches inner calls with no edit
 * here. The chain is `tools/runChain.ts` · `runToolChain`, walked with
 * `askPolicy: 'refuse'` because a person cannot be asked from inside another
 * tool's execution; its rows land through `middleware/ledger.ts` ·
 * `recordDecisions`, the one writer of `middlewareDecisions`.
 *
 * What differs from a model call, on purpose:
 *   - the facts are the INNER call's — its own id (`<outer>#inner-<n>`) on
 *     every event and row, its own arguments in the checker's `context` and
 *     on the chain;
 *   - the checker's `sequence` is the history's sequence (in which the outer
 *     call is still in flight, so not yet listed) plus the inner calls of the
 *     same outer call that already ran, each `inner: true`
 *     (`innerToolCalls.ts` · `innerCallsRanOf`) — they reach history only
 *     with the outer call's result;
 *   - a refusal is an ANSWER (`refuse`, with the words the model would have
 *     read) handed back to inner dispatch, which refuses by name to the
 *     outer tool; nothing is written into the outer call's result. A `'halt'`
 *     is carried to the outer call (`innerCallOuter.ts`), whose own halt
 *     path ends the run once it settles;
 *   - a rewrite's chain row carries no `changedKeys`: the model call's rows
 *     get them from the inputs layer (`middlewareAdmission.ts`), which judges
 *     only the model's own calls, so `middleware/rewrites.ts` ·
 *     `argumentRewritesOf` does not read an inner call's rewrite.
 *
 * Example: a checker that answers `{ result: 'deny', rationale: 'no' }` for
 * `secret` files `permission.check` `{ toolCallId: 'c1#inner-1', target:
 * 'secret', result: 'deny' }` and answers
 * `{ kind: 'refuse', reason: '[permission denied: no]' }`.
 */
import type { TypedScope } from 'footprintjs';

import type { AgentState } from '../../../types.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';
import {
  checkerGoverns,
  type LLMMessage,
  type PermissionChecker,
  type ToolCallEntry,
} from '../../../../../provider-contract/types.js';
import type { InnerCallAsked, InnerCallGates, InnerGateAnswer } from '../../../toolDispatch.js';
import type { InnerCallHalt } from '../../../innerCallOuter.js';
import { innerCallsRanOf, liveInnerToolCallRowsOf } from '../../../innerToolCalls.js';
import { bindToolSecurityEvents } from '../../../toolSecurityEvents.js';
import { frozenView } from '../../../../../lib/frozenCopy.js';
import { runToolChain, type ToolArgs } from '../../../../../tools/runChain.js';
import { recordDecisions } from '../../../middleware/ledger.js';
import { checkToolPermission } from './toolPermission.js';
import { askDeclaredCapabilities, buildCapabilityQuestion } from './capabilityQuestion.js';
import { askSkillRead } from './skillReadQuestion.js';
import { prepareCallState } from './callState.js';

/** The outer call an inner call belongs to — what every gate is handed besides the call itself. */
export interface InnerCallOuter {
  /** The model's call whose tool made the inner call. */
  readonly toolCallId: string;
  readonly iteration: number;
  /** The history the outer call's own gates were handed. */
  readonly history: () => LLMMessage[];
  /** Carry a checker's `'halt'` to the outer call (`innerCallOuter.ts`). */
  readonly halted: (halt: InnerCallHalt) => void;
}

type RunIdentity = { tenant?: string; principal?: string; conversationId: string } | undefined;

/**
 * The gates for the inner calls of one outer call. A gate the agent did not
 * configure is absent, so nothing is asked and nothing is filed for it.
 */
export function buildInnerCallGates(
  scope: TypedScope<AgentState>,
  deps: Pick<ToolCallsHandlerDeps, 'permissionChecker' | 'toolMiddleware'>,
  parkedNow: ToolCatalogOperations['parkedNow'],
  outer: InnerCallOuter,
): InnerCallGates {
  const permissionChecker = deps.permissionChecker;
  const chain = deps.toolMiddleware;
  return {
    ...(permissionChecker !== undefined && {
      permission: (call: InnerCallAsked) => askPermission(scope, permissionChecker, outer, call),
    }),
    ...(chain !== undefined &&
      chain.length > 0 && {
        middleware: (call: InnerCallAsked) => walkChain(scope, chain, outer, call),
      }),
    ...(permissionChecker !== undefined &&
      checkerGoverns(permissionChecker, 'skill_read') && {
        skillRead: (call: InnerCallAsked) =>
          askSkill(scope, permissionChecker, parkedNow, outer, call),
      }),
  };
}

/** The model call's fresh cells and bindings, made for one inner call. */
function questionFor(
  scope: TypedScope<AgentState>,
  permissionChecker: PermissionChecker,
  outer: InnerCallOuter,
  call: InnerCallAsked,
) {
  const tc = { id: call.toolCallId, name: call.toolName, args: call.args };
  // The model call's own initializer: fresh result, argument and execution cells.
  const cells = prepareCallState(tc, undefined, undefined, undefined, call.args);
  const emitSecurity = bindToolSecurityEvents(scope, {
    toolCallId: call.toolCallId,
    iteration: outer.iteration,
  });
  // A callback is handed a frozen copy of the arguments, never the object the
  // tool runs with — the model call's rule (`execution/callStart.ts` · `viewOf`).
  const viewOf = (source: ToolArgs): ToolArgs | undefined => frozenView(source);
  const runIdentity = scope.runIdentity as RunIdentity;
  const scopeEnv = scope.$getEnv();
  const env = call.signal !== undefined ? { ...scopeEnv, signal: call.signal } : scopeEnv;
  const shared = { historyForCallbacks: outer.history, iteration: outer.iteration };
  const askCapability = buildCapabilityQuestion({
    ...shared,
    permissionChecker,
    viewOf,
    runIdentity,
    env,
    emitSecurity,
    tc,
    callArguments: cells.callArguments,
    execution: cells.execution,
    outcome: cells.outcome,
  });
  return { tc, ...cells, emitSecurity, viewOf, runIdentity, env, shared, askCapability };
}

/** The answer the cells hold once a question was asked: refuse (and carry a halt), or allow. */
function answerOf(
  question: ReturnType<typeof questionFor>,
  outer: InnerCallOuter,
  call: InnerCallAsked,
): InnerGateAnswer {
  const { execution, outcome } = question;
  if (!execution.denied) return { kind: 'allow' };
  const halt = execution.haltContext;
  if (halt === undefined) return { kind: 'refuse', reason: String(outcome.result) };
  outer.halted({
    ...halt,
    call: { toolCallId: call.toolCallId, toolName: call.toolName, args: call.args },
  });
  return { kind: 'refuse', reason: String(outcome.result), halted: true };
}

/** The permission gate's first half: `tool_call`, then the tool's declared capabilities. */
async function askPermission(
  scope: TypedScope<AgentState>,
  permissionChecker: PermissionChecker,
  outer: InnerCallOuter,
  call: InnerCallAsked,
): Promise<InnerGateAnswer> {
  const question = questionFor(scope, permissionChecker, outer, call);
  const { tc, execution, outcome } = question;
  await checkToolPermission({
    ...question.shared,
    permissionChecker,
    tc,
    viewOf: question.viewOf,
    runArgs: call.args,
    runIdentity: question.runIdentity,
    env: question.env,
    emitSecurity: question.emitSecurity,
    execution,
    outcome,
    innerCallsSoFar: () => innerCallsSoFar(scope, outer),
  });
  if (!execution.denied && call.tool?.capabilities !== undefined) {
    await askDeclaredCapabilities(
      question.askCapability,
      permissionChecker,
      call.tool.capabilities,
      call.toolName,
      execution,
    );
  }
  return answerOf(question, outer, call);
}

/** The permission gate's second half, for an inner `read_skill` (after the schema check). */
async function askSkill(
  scope: TypedScope<AgentState>,
  permissionChecker: PermissionChecker,
  parkedNow: ToolCatalogOperations['parkedNow'],
  outer: InnerCallOuter,
  call: InnerCallAsked,
): Promise<InnerGateAnswer> {
  const question = questionFor(scope, permissionChecker, outer, call);
  await askSkillRead(question.askCapability, permissionChecker, {
    toolName: call.toolName,
    args: call.args,
    currentSkillId: () => scope.currentSkillId,
    parked: () => parkedNow(scope),
  });
  return answerOf(question, outer, call);
}

/** The inner calls of this outer call that already ran, as sequence entries (`inner: true`). */
function innerCallsSoFar(
  scope: TypedScope<AgentState>,
  outer: InnerCallOuter,
): readonly ToolCallEntry[] {
  return innerCallsRanOf(liveInnerToolCallRowsOf(scope), outer.toolCallId, outer.iteration).map(
    (ran) => ({ name: ran.toolName, args: ran.args, iteration: outer.iteration, inner: true }),
  );
}

/** The before-tool chain, walked by the one walker; an ask refuses — nobody can be asked here. */
async function walkChain(
  scope: TypedScope<AgentState>,
  chain: NonNullable<ToolCallsHandlerDeps['toolMiddleware']>,
  outer: InnerCallOuter,
  call: InnerCallAsked,
): Promise<InnerGateAnswer> {
  const runIdentity = scope.runIdentity as RunIdentity;
  const signal = call.signal ?? scope.$getEnv().signal;
  const walked = await runToolChain(chain, {
    toolName: call.toolName,
    ...(call.tool?.source !== undefined && { toolSource: call.tool.source }),
    toolCallId: call.toolCallId,
    iteration: outer.iteration,
    args: call.args,
    history: outer.history(),
    ...(runIdentity && { identity: runIdentity }),
    ...(signal && { signal }),
    askPolicy: 'refuse',
  });
  recordDecisions(scope, walked.decisions);
  // Only a link that rewrote hands arguments back; a pass-through changes nothing.
  if (walked.kind === 'allow') {
    return walked.args === call.args ? { kind: 'allow' } : { kind: 'allow', args: walked.args };
  }
  // `askPolicy: 'refuse'` turns every ask into a deny that says why, so an
  // `ask` cannot come back here; it is refused all the same if one ever does.
  return {
    kind: 'refuse',
    reason: walked.kind === 'deny' ? walked.reason : `middleware '${walked.middleware}' asked`,
  };
}
