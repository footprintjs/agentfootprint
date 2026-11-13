/**
 * The gates a call the model makes passes, put to a call one tool makes
 * through another (`ctx.tools.call`) — through the SAME functions.
 *
 * Why: a permission checker or a before-tool middleware that refuses a tool
 * to the model must refuse it to a composing tool too, or the rule is one
 * composed tool away from not existing. So this file holds no rule of its
 * own. The permission gate is `./toolPermission.ts` · `checkToolPermission`
 * and `./capabilityQuestion.ts` · `askDeclaredCapabilities`: whatever they
 * decide about a checker's answer (a deny, a halt, a throw) they decide for
 * an inner call too, and any rule added to them later reaches inner calls
 * with no edit here. The chain is `tools/runChain.ts` · `runToolChain`,
 * walked with `askPolicy: 'refuse'` because a person cannot be asked from
 * inside another tool's execution; its rows land through
 * `middleware/ledger.ts` · `recordDecisions`, the one writer of
 * `middlewareDecisions`.
 *
 * What differs from a model call, on purpose:
 *   - the facts are the INNER call's — its own id (`<outer>#inner-<n>`) on
 *     every event and row, its own arguments in the checker's `context` and
 *     on the chain;
 *   - a refusal is an ANSWER (`refuse`, with the words the model would have
 *     read) handed back to inner dispatch, which refuses by name to the
 *     outer tool; nothing is written into the outer call's result, and a
 *     `'halt'` refuses the inner call without ending the run.
 *
 * Example: a checker that answers `{ result: 'deny', rationale: 'no' }` for
 * `secret` files `permission.check` `{ toolCallId: 'c1#inner-1', target:
 * 'secret', result: 'deny' }` and answers
 * `{ kind: 'refuse', reason: '[permission denied: no]' }`.
 */
import type { TypedScope } from 'footprintjs';

import type { AgentState } from '../../../types.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import type { InnerCallAsked, InnerCallGates, InnerGateAnswer } from '../../../toolDispatch.js';
import { bindToolSecurityEvents } from '../../../toolSecurityEvents.js';
import { frozenView } from '../../../../../lib/frozenCopy.js';
import { runToolChain, type ToolArgs } from '../../../../../tools/runChain.js';
import { recordDecisions } from '../../../middleware/ledger.js';
import { checkToolPermission } from './toolPermission.js';
import { askDeclaredCapabilities, buildCapabilityQuestion } from './capabilityQuestion.js';
import { prepareCallState } from './callState.js';

/** The outer call an inner call belongs to — what every gate is handed besides the call itself. */
export interface InnerCallOuter {
  readonly iteration: number;
  /** The history the outer call's own gates were handed. */
  readonly history: () => LLMMessage[];
}

type RunIdentity = { tenant?: string; principal?: string; conversationId: string } | undefined;

/**
 * The gates for the inner calls of one outer call. A gate the agent did not
 * configure is absent, so nothing is asked and nothing is filed for it.
 */
export function buildInnerCallGates(
  scope: TypedScope<AgentState>,
  deps: Pick<ToolCallsHandlerDeps, 'permissionChecker' | 'toolMiddleware'>,
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
  };
}

/** The permission gate, by the model call's own functions, on fresh call cells for this call. */
async function askPermission(
  scope: TypedScope<AgentState>,
  permissionChecker: NonNullable<ToolCallsHandlerDeps['permissionChecker']>,
  outer: InnerCallOuter,
  call: InnerCallAsked,
): Promise<InnerGateAnswer> {
  const tc = { id: call.toolCallId, name: call.toolName, args: call.args };
  // The model call's own initializer: fresh result, argument and execution cells.
  const { outcome, callArguments, execution } = prepareCallState(
    tc,
    undefined,
    undefined,
    undefined,
    call.args,
  );
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
  await checkToolPermission({
    ...shared,
    permissionChecker,
    tc,
    viewOf,
    runArgs: call.args,
    runIdentity,
    env,
    emitSecurity,
    execution,
    outcome,
  });
  if (!execution.denied && call.tool.capabilities !== undefined) {
    const askCapability = buildCapabilityQuestion({
      ...shared,
      permissionChecker,
      viewOf,
      runIdentity,
      env,
      emitSecurity,
      tc,
      callArguments,
      execution,
      outcome,
    });
    await askDeclaredCapabilities(
      askCapability,
      permissionChecker,
      call.tool.capabilities,
      call.toolName,
      execution,
    );
  }
  return execution.denied
    ? { kind: 'refuse', reason: String(outcome.result) }
    : { kind: 'allow', args: call.args };
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
    ...(call.tool.source !== undefined && { toolSource: call.tool.source }),
    toolCallId: call.toolCallId,
    iteration: outer.iteration,
    args: call.args,
    history: outer.history(),
    ...(runIdentity && { identity: runIdentity }),
    ...(signal && { signal }),
    askPolicy: 'refuse',
  });
  recordDecisions(scope, walked.decisions);
  if (walked.kind === 'allow') return { kind: 'allow', args: walked.args };
  // `askPolicy: 'refuse'` turns every ask into a deny that says why, so an
  // `ask` cannot come back here; it is refused all the same if one ever does.
  return {
    kind: 'refuse',
    reason: walked.kind === 'deny' ? walked.reason : `middleware '${walked.middleware}' asked`,
  };
}
