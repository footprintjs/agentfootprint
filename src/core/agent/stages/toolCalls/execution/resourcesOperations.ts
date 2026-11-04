import type { ResourceFacts } from '../../../componentResources.js';
import type { TeardownScope, TeardownOptions } from '../../../../../tools/toolSessions.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import { runOfLink } from '../../../../memberRun.js';
import type { ToolExecutionContext } from '../../../../../tools/tools.js';
import { captureLateEmitter, policyInForce } from '../../../../../redaction/runRedaction.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { ToolResourcesOperations } from '../contracts/operations/resources.js';

interface ToolResourcesOperationsLinks {
  readonly AGENT_TEARDOWN_SCOPES: readonly TeardownScope[];
}

/** Compose the existing resources callbacks once for this handler. */
export function buildToolResourcesOperations(
  deps: Pick<ToolCallsHandlerDeps, 'isOwnRun' | 'currentRun' | 'resources'>,
  links: ToolResourcesOperationsLinks,
): ToolResourcesOperations {
  const runFactsOf = (
    scope: TypedScope<AgentState>,
  ): ReturnType<NonNullable<ToolCallsHandlerDeps['currentRun']>> | undefined => {
    const actual = deps.currentRun?.();
    if (deps.isOwnRun?.(scope) !== false || actual === undefined) return actual;
    const memberRun = scope.memberRun;
    const member = memberRun?.link === '' ? memberRun : runOfLink(memberRun?.link);
    return { ...actual, ...(member?.identity !== undefined && { identity: member.identity }) };
  };

  const resourceFactsOf = (scope: TypedScope<AgentState>): ResourceFacts => {
    const facts = runFactsOf(scope);
    if (facts === undefined || facts.runContext === undefined || facts.runId === '')
      throw new TypeError('Tool resource admission requires actual native run facts');
    return { ...facts, runContext: facts.runContext };
  };

  const sessionContext = (
    scope: TypedScope<AgentState>,
    toolName: string,
    toolCallId: string,
  ): Pick<
    ToolExecutionContext,
    | 'runId'
    | 'sessionId'
    | 'identity'
    | 'redact'
    | 'onTeardown'
    | 'teardownScopes'
    | 'resourceOwner'
  > => {
    const facts = runFactsOf(scope);
    const resource = deps.resources?.context(scope, resourceFactsOf(scope));
    const redact = policyInForce(scope);
    return {
      ...(resource !== undefined && { resourceOwner: resource.owner }),
      ...(facts?.runId !== undefined && { runId: facts.runId }),
      ...(facts?.sessionId !== undefined && { sessionId: facts.sessionId }),
      ...(facts?.identity !== undefined && { identity: facts.identity }),
      ...(redact !== undefined && { redact }),
      teardownScopes: links.AGENT_TEARDOWN_SCOPES,
      onTeardown: (cleanup: () => void | Promise<void>, options?: TeardownOptions): void => {
        const scopeAsked = options?.scope ?? 'run';
        if (!links.AGENT_TEARDOWN_SCOPES.includes(scopeAsked)) {
          // Named, not swallowed: an accepted registration that can never fire
          // is a leaked resource wearing the shape of a tidy one.
          throw new Error(
            `tool '${toolName}': onTeardown scope '${scopeAsked}' is not honoured here. ` +
              `This door supports: ${links.AGENT_TEARDOWN_SCOPES.join(', ')}. ` +
              'Read `ctx.teardownScopes` and pick one of those.',
          );
        }
        const tier = resource?.view;
        if (!tier || !resource) return;
        const filed = tier.register(
          resource.owner,
          {
            tool: toolName,
            toolCallId,
            emit: captureLateEmitter(scope, 'tool-teardown#0'),
            ...(facts?.runContext !== undefined && { runContext: facts.runContext }),
            ...(facts?.runId !== undefined && { runId: facts.runId }),
            ...(facts?.sessionId !== undefined && { sessionId: facts.sessionId }),
          },
          cleanup,
          options,
        );
        // Emitted HERE, not from the tier, because here there is still a stage
        // to be stamped with: a start and a reuse happen inside `tool.execute`,
        // so they ride the ordinary scope channel and carry the real
        // `runtimeStageId`. Only the CLOSE fires after the last stage
        // committed, and only that one wears the `tool-teardown#0` pseudo-stage.
        //
        // `keyHash`, never the key: the key composes tenant, principal and the
        // hosting sessionId, and publishing it would put a user identifier into
        // every exporter's payload.
        typedEmit(
          scope,
          filed.outcome === 'started'
            ? 'agentfootprint.tools.session_started'
            : 'agentfootprint.tools.session_reused',
          {
            tool: toolName,
            scope: scopeAsked,
            keyHash: filed.keyHash,
            ...(options?.runnerId !== undefined && { runnerId: options.runnerId }),
            ...(options?.label !== undefined && { label: options.label }),
            ...(filed.outcome === 'reused' && { calls: filed.calls }),
          },
        );
      },
    };
  };

  /**
   * Fire the `'call'`-scoped cleanups this tool call registered.
   *
   * Runs when `execute` SETTLES — resolve or throw — because a tool that threw
   * halfway may well have opened the thing it was about to close. Deliberately
   * NOT on the pause path: a paused call has not settled, it is waiting for a
   * person, and its resources are exactly what the resume needs.
   */
  const endCall = async (scope: TypedScope<AgentState>): Promise<void> => {
    await deps.resources?.endCall(scope);
  };

  return { runFactsOf, resourceFactsOf, sessionContext, endCall };
}
