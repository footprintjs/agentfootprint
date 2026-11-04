import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ToolExecutionContext } from '../../../../../tools/tools.js';
import type {
  AgentfootprintEventType,
  AgentfootprintEventMap,
} from '../../../../../events/registry.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import {
  type ArtifactEventFact,
  unconfiguredArtifacts,
  type ToolArtifacts,
  bindArtifacts,
} from '../../../../../artifacts/capability.js';
import { agentToolDispatch } from '../../../toolDispatch.js';
import { policyInForce } from '../../../../../redaction/runRedaction.js';
import { reportingCredentials } from '../decorators/reportingCredentials.js';
import { bindToolSecurityEvents } from '../../../toolSecurityEvents.js';
import { requestEvidenceFor } from '../../../../../tools/requestEvidence.js';
import { mcpClientUseFor } from '../../../../../tools/mcpClientUse.js';
import type { ArtifactScope } from '../../../../../artifacts/types.js';
import type { ToolContextOperations } from '../contracts/operations/context.js';
import type { ToolResourcesOperations } from '../contracts/operations/resources.js';
import type { ToolCredentialsOperations } from '../contracts/operations/credentials.js';
import type { ToolProgressOperations } from '../contracts/operations/progress.js';
import { recordSourceClock } from '../evidence/sourceClock.js';
import { madeInRun } from '../evidence/madeInRun.js';

interface ToolContextOperationsLinks {
  readonly runFactsOf: ToolResourcesOperations['runFactsOf'];
  readonly registryByName: ToolCallsHandlerDeps['registryByName'];
  readonly credentialsIn: ToolCredentialsOperations['credentialsIn'];
  readonly hasCredentials: boolean;
  readonly toolProgress: ToolProgressOperations['toolProgress'];
}

/** Compose the existing context callbacks once for this handler. */
export function buildToolContextOperations(
  deps: Pick<
    ToolCallsHandlerDeps,
    'emitForRun' | 'currentRun' | 'isRunRetired' | 'time' | 'artifactStore'
  >,
  links: ToolContextOperationsLinks,
): ToolContextOperations {
  /**
   * `ctx.artifacts` + `ctx.hasArtifacts` for one dispatch — the claim-check
   * capability, shaped exactly like `ctx.credentials` (9.21.0).
   *
   * The SCOPE is `scope.runIdentity` — the tuple the seed stage committed and
   * memory already scopes on (an anonymous run isolates to its own runId, a
   * session-bound run to its sessionId, an identity-carrying run to the
   * caller's tenant/principal). Composed HERE, where the tool cannot reach:
   * the capability closes over it, so a ref alone opens nothing and a tool
   * can never widen the scope it resolves under. Detached to a plain object
   * so the store never holds a live scope proxy.
   *
   * Every fact the capability reports rides the ordinary emit channel via
   * `typedEmit`, mid-stage, carrying the real runtimeStageId — collected
   * during traversal, exactly like `credential.failed`. Payload bytes never
   * enter an event; the facts are meta only.
   *
   * The binding owns WHOSE RUN its facts are for: the run context is captured
   * here, when it is built. A fact that lands after that run ended — a tool
   * that fired a `put` without awaiting it, finishing during a later run on a
   * shared agent — goes out through `deps.emitForRun` stamped with the run it
   * was made in, never with whichever run is live then (which would put one
   * person's upload into another person's recording).
   *
   * With NO store attached the capability is the fail-closed teacher and no
   * runIdentity read happens — a storeless agent's trace stays byte-identical.
   */
  const toolArtifacts = (
    scope: TypedScope<AgentState>,
    toolName: string,
    toolCallId: string,
  ): Pick<ToolExecutionContext, 'artifacts' | 'hasArtifacts'> => {
    const bindRun = links.runFactsOf(scope);
    const emitFact = <K extends AgentfootprintEventType>(
      type: K,
      payload: AgentfootprintEventMap[K]['payload'],
    ): void => {
      const madeIn = bindRun?.runContext;
      const emitForRun = deps.emitForRun;
      if (
        madeIn !== undefined &&
        emitForRun !== undefined &&
        (deps.isRunRetired() || deps.currentRun?.().runId !== madeIn.runId)
      ) {
        emitForRun(type, payload as unknown as Record<string, unknown>, madeIn);
        return;
      }
      typedEmit(scope, type, payload);
    };
    const onEvent = (fact: ArtifactEventFact): void => {
      switch (fact.type) {
        case 'minted': {
          const meta = fact.meta;
          emitFact('agentfootprint.artifacts.minted', {
            ref: meta.ref,
            kind: meta.kind,
            mediaType: meta.mediaType,
            bytes: meta.bytes,
            ...(meta.label !== undefined && { label: meta.label }),
            ...(meta.digest !== undefined && { digest: meta.digest }),
            ...(meta.expiresAt !== undefined && { expiresAt: meta.expiresAt }),
            ...(meta.origin !== undefined && { origin: meta.origin }),
            ...(meta.parentRefs !== undefined && { parentRefs: meta.parentRefs }),
            ...(meta.timeAxis !== undefined && { timeAxis: meta.timeAxis }),
            tool: toolName,
          });
          // Under `.time()` (step T8): a dataset whose declared axis names a
          // zone is a wall-clock source — one `source-clock` row per call and
          // zone, for the limits block's `Clocks` lines. Only in the run the
          // binding was made in (a late mint's run has ended).
          const zone = meta.timeAxis?.zone;
          if (
            deps.time !== undefined &&
            zone !== undefined &&
            !deps.isRunRetired() &&
            (madeInRun(bindRun) === undefined || madeInRun(bindRun) === deps.currentRun?.().runId)
          ) {
            recordSourceClock(scope, { toolCallId, toolName }, zone);
          }
          return;
        }
        case 'resolved':
          emitFact('agentfootprint.artifacts.resolved', {
            ref: fact.ref,
            via: fact.via,
            kind: fact.kind,
            bytes: fact.bytes,
            tool: toolName,
          });
          return;
        case 'expired':
          emitFact('agentfootprint.artifacts.expired', {
            ref: fact.swept.ref,
            reason: fact.swept.reason,
            kind: fact.swept.kind,
            bytes: fact.swept.bytes,
            tool: toolName,
          });
          return;
        case 'refused':
          emitFact('agentfootprint.artifacts.refused', {
            op: fact.op,
            reason: fact.reason,
            ...(fact.ref !== undefined && { ref: fact.ref }),
            ...(fact.detail !== undefined && { detail: fact.detail }),
            tool: toolName,
          });
          return;
      }
    };
    const store = deps.artifactStore;
    if (store === undefined) {
      return { artifacts: unconfiguredArtifacts(onEvent), hasArtifacts: false };
    }
    const artifacts: ToolArtifacts = bindArtifacts(store, runScopeOf(scope), {
      origin: { ...(bindRun?.runId !== undefined && { runId: bindRun.runId }), toolCallId },
      onEvent,
    });
    return { artifacts, hasArtifacts: true };
  };

  /**
   * `ctx.tools` for one dispatch (9.76.0) — the run's own tool dispatch, so a
   * composed tool (runbookAsTool's procedure stages, or any tool that
   * composes) calls its ingredient tools through the SAME map the model
   * dispatches by, instead of importing modules and building a second query
   * stack.
   *
   * The inner context is the OUTER call's own facts with two deliberate
   * overrides: `hasArtifacts: false` with the fail-closed capability (an
   * inner tool must not mint claim tickets competing with the composed
   * answer's own — the one-chip-per-answer discipline), and a DERIVED
   * `toolCallId` (`<outer>#inner-<n>`) so an inner tool's progress reports
   * and kept records name the call they belong to without ever being
   * mistaken for a call the model made. No `tool_start`/`tool_end` fires for
   * an inner call — it is the outer call's work; `ctx.progress` is its
   * visible channel and the composed envelope its record.
   */
  const toolDispatchCtx = (
    scope: TypedScope<AgentState>,
    call: {
      readonly toolName: string;
      readonly toolCallId: string;
      readonly iteration: number;
    },
    signal?: AbortSignal,
  ): Pick<ToolExecutionContext, 'tools'> => ({
    tools: agentToolDispatch({
      lookup: (name) => links.registryByName.get(name),
      innerContext: (name, seq) => {
        const innerId = `${call.toolCallId}#inner-${seq}`;
        // An inner call runs inside the same run, under the same policy.
        const redact = policyInForce(scope);
        return {
          toolCallId: innerId,
          iteration: call.iteration,
          ...(signal && { signal }),
          ...(redact !== undefined && { redact }),
          credentials: reportingCredentials(
            links.credentialsIn(scope, links.registryByName.get(name)?.needs?.credential),
            bindToolSecurityEvents(scope, { toolCallId: innerId, iteration: call.iteration }),
            name,
          ),
          hasCredentials: links.hasCredentials,
          artifacts: unconfiguredArtifacts(),
          hasArtifacts: false,
          ...links.toolProgress(scope, {
            toolName: name,
            toolCallId: innerId,
            iteration: call.iteration,
          }),
          ...requestEvidenceFor(scope, {
            toolName: name,
            toolCallId: innerId,
            iteration: call.iteration,
          }),
          ...mcpClientUseFor(scope, { toolCallId: innerId }),
        };
      },
    }),
  });

  /**
   * The run's artifact scope — `scope.runIdentity`, detached to a plain
   * object so no store or resolver ever holds a live scope proxy. ONE
   * composition shared by the capability binding, `wants` resolution,
   * `present`, and placement: four doors, one isolation rule, no drift.
   */
  const runScopeOf = (scope: TypedScope<AgentState>): ArtifactScope => {
    const identity = scope.runIdentity;
    return {
      conversationId: identity.conversationId,
      ...(identity.tenant !== undefined && { tenant: identity.tenant }),
      ...(identity.principal !== undefined && { principal: identity.principal }),
    };
  };

  return { toolArtifacts, toolDispatchCtx, runScopeOf };
}
