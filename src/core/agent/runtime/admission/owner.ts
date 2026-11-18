import type { AgentRunOptions } from '../runOptions/options.js';
import { assertOutputStrategySupported } from '../../run/outputStrategySupport.js';
import { type AgentRunValues } from '../../runValues.js';
import { type RunnerInvocation } from '../../../runnerExecution.js';
import { type AttachRecorderOptions, type CombinedRecorder, type RunSetup } from 'footprintjs';
import type { RunContext } from '../../../../bridge/eventMeta.js';
import { ContextRecorder } from '../../../../recorders/core/ContextRecorder.js';
import { contextRecordedRecorder } from '../../../../recorders/core/ContextRecordedRecorder.js';
import { contextEvaluatedRecorder } from '../../../../recorders/core/ContextEvaluatedRecorder.js';
import { streamRecorder } from '../../../../recorders/core/StreamRecorder.js';
import { agentRecorder } from '../../../../recorders/core/AgentRecorder.js';
import { errorBridge } from '../../../../recorders/core/ErrorBridge.js';
import { costRecorder } from '../../../../recorders/core/CostRecorder.js';
import { permissionRecorder } from '../../../../recorders/core/PermissionRecorder.js';
import { evalRecorder } from '../../../../recorders/core/EvalRecorder.js';
import { memoryRecorder } from '../../../../recorders/core/MemoryRecorder.js';
import { embeddingRecorder } from '../../../../recorders/core/EmbeddingRecorder.js';
import { skillRecorder } from '../../../../recorders/core/SkillRecorder.js';
import { validationRecorder } from '../../../../recorders/core/ValidationRecorder.js';
import { credentialRecorder } from '../../../../recorders/core/CredentialRecorder.js';
import { mapRecorder } from '../../../../recorders/core/MapRecorder.js';
import { integrityRecorder } from '../../../../recorders/core/IntegrityRecorder.js';
import { artifactsRecorder } from '../../../../recorders/core/ArtifactsRecorder.js';
import { toolsRecorder } from '../../../../recorders/core/ToolsRecorder.js';
import { reliabilityRecorder } from '../../../../recorders/core/ReliabilityRecorder.js';
import { resilienceRecorder } from '../../../../recorders/core/ResilienceRecorder.js';
import { checkInEventsBridge } from '../../../../recorders/core/CheckInRecorder.js';
import {
  hostedConversationKey,
  hostedConversationOf,
  sessionConversationKey,
} from '../../servingConversation.js';
import { EmitBridge } from '../../../../recorders/core/EmitBridge.js';
import { providerTargets } from '../../providerTargets.js';
import { assertInjectionDelivery } from '../../run/injectionDelivery.js';
import type { RequestContext } from '../../../../identity/requestContext.js';
import type { AgentContext } from '../contracts.js';

export function assertDeliverableRoles(this: Pick<AgentContext, 'configuration'>): void {
  assertInjectionDelivery(
    this.configuration.injections,
    providerTargets(
      this.configuration.provider,
      this.configuration.model,
      this.configuration.reliabilityConfig?.providers,
    ).map((target) => target.provider),
  );
}

export function prepareAgentRun(
  this: Pick<
    AgentContext,
    | 'assertDeliverableRoles'
    | 'configuration'
    | 'emitRunManifest'
    | 'emitSkillGraphDeclared'
    | 'inputsLayerArmed'
    | 'native'
    | 'resultsLayerArmed'
    | 'runner'
  >,
  invocation: RunnerInvocation<AgentRunValues>,
  runOptions?: AgentRunOptions,
  request?: RequestContext,
): {
  readonly setup: RunSetup;
  readonly binding: Parameters<RunnerInvocation<AgentRunValues>['execute']>[2];
} {
  this.assertDeliverableRoles();
  assertOutputStrategySupported({
    enforcement: this.configuration.outputEnforcement,
    provider: this.configuration.provider,
    model: this.configuration.model,
    providers: this.configuration.reliabilityConfig?.providers,
    modelResolvedAtSeed: this.configuration.runConfigFn !== undefined,
  });
  const correlationId = runOptions?.correlationId;
  const traceId = runOptions?.traceId ?? runOptions?.env?.traceId;
  const sessionId = runOptions?.sessionId;
  // The actor, for every event this run emits (9.11.0).
  //
  // `lastRunIdentity` is what the CALLER passed and nothing else — `run()`
  // sets it from `input.identity ?? options.identity ?? the conversation's`,
  // and `resume()` from `options.identity ?? the paused run's caller's`
  // (`agent/callerIdentity.ts`), both before this method is reached; it stays
  // undefined when nobody named one.
  //
  // NOT `scope.runIdentity`: that one is always populated and defaults to
  // `{ conversationId: '<runId>' }` (or, since 9.10.0, to the sessionId on a
  // session-bound run). Stamping either as the principal would publish a
  // synthesized conversation as an actor — and a caller-supplied session id
  // is exactly the string an auditor must not read as "who did this".
  // `conversationId` is deliberately not carried: it is a thread, not a
  // person, and `sessionId` beside it is the fact the transport delivered.
  const actor = runOptions?.identity ?? invocation.value.identity;
  invocation.value.request = request;
  // A fresh run starts with no evictions filed — the previous run's last
  // visit must not be read as this run's (`window/evictedTurns.ts`).
  const hosted = hostedConversationOf(runOptions);
  invocation.value.servingConversation =
    sessionId !== undefined
      ? sessionConversationKey(sessionId)
      : hosted !== undefined
      ? hostedConversationKey(hosted)
      : undefined;
  const metadata = {
    compositionPath: [`Agent:${this.runner.id}`],
    ...(correlationId !== undefined && { correlationId }),
    ...(traceId !== undefined && { traceId }),
    ...(sessionId !== undefined && { sessionId }),
    ...(actor?.principal !== undefined && { principal: actor.principal }),
    ...(actor?.tenant !== undefined && { tenant: actor.tenant }),
  };

  const getRunCtx = (): RunContext => invocation.context();
  // The run's redaction (`src/redaction/`): this agent's `redact` joined
  // with any policy the caller handed down for this run (a tool's
  // `ctx.redact`). Opened for EVERY run — with no policy the serving is the
  // identity, but the stages' scopes still feed the real-value path the
  // crash checkpoint and the window's meter read.
  const redaction = this.native.prepareRunRedaction(invocation, runOptions?.redact);

  const attachments: NonNullable<RunSetup['attachments']>[number][] = redaction.recorders.map(
    (recorder) => ({ recorder }),
  );
  const dispatcher = this.native.getDispatcher();

  // Authoritative source frames must survive a bounded public observer queue.
  attachments.push({ recorder: contextRecordedRecorder({ dispatcher, getRunContext: getRunCtx }) });

  // RFC-001 Block 10 — observer delivery tier. With 'deferred', every
  // bridge below is attached onto footprintjs's bounded capture queue
  // ("one beat behind": capture inline ≈ microseconds, delivery at the
  // next microtask checkpoint, terminal flush before run()/resume()
  // returns). Default 'inline' attaches with no options bag —
  // byte-identical to every prior release.
  const deferredOpts: AttachRecorderOptions | undefined =
    this.configuration.observerDelivery === 'deferred'
      ? { delivery: 'deferred', ...this.configuration.observerDeliveryOptions }
      : undefined;
  const attachObserver = (rec: CombinedRecorder): void => {
    attachments.push({ recorder: rec, ...(deferredOpts && { options: deferredOpts }) });
  };

  attachObserver(
    new ContextRecorder({ dispatcher, getRunContext: getRunCtx, realWrites: redaction }),
  );
  // Computational observers belong to native component setup, always inline.
  if (this.configuration.windowStrategy !== undefined) {
    // Folds speak the context vocabulary consumers already subscribe to
    // (`context.evicted` / `context.budget_pressure`) — no new event types.
    // ContextRecorder only dispatches those from writes INSIDE a slot
    // subflow, and the compaction stage is not one, so it emits them and
    // this bridge forwards them (the `contextEvaluatedRecorder` pattern).
    attachObserver(
      new EmitBridge({
        dispatcher,
        id: 'af-compaction-events',
        prefix: ['agentfootprint.context.evicted', 'agentfootprint.context.budget_pressure'],
        getRunContext: getRunCtx,
      }),
    );
  }
  // The InjectionEngine typedEmits context.evaluated; this bridge forwards it
  // to the dispatcher (ContextRecorder handles the write-derived context.*).
  attachObserver(contextEvaluatedRecorder({ dispatcher, getRunContext: getRunCtx }));
  attachObserver(streamRecorder({ dispatcher, getRunContext: getRunCtx }));
  // agentRecorder feeds the run-checkpoint tracker (iteration_end →
  // history snapshot), which is read ONLY in run()'s catch — after the
  // engine's terminal flush at the reject boundary — so deferral is safe
  // (pinned by test: crash checkpoints stay complete under 'deferred').
  attachObserver(agentRecorder({ dispatcher, getRunContext: getRunCtx }));
  // Terminal-failure bridge: footprintjs onRunFailed → typed error.fatal,
  // so a thrown run clears in-flight live state + flips monitor status.
  // Deferral-safe: the reject-boundary terminal flush delivers error.fatal
  // before the rejection reaches the caller.
  attachObserver(errorBridge({ dispatcher, getRunContext: getRunCtx }));
  // The cost bridge is ALWAYS attached since 8.14.0. It used to be gated on
  // `pricingTable`, which was right while `cost.*` only ever meant money:
  // `emitCostTick` returns on its first line without a table, so the gate
  // could not hide anything. `cost.limit_hit { kind: 'max_iterations' }`
  // broke that assumption — an iteration limit has no price and fires on any
  // agent, and behind the old gate it would have reached the dispatcher only
  // for agents that happened to be costing themselves. The bridge drops
  // events with no listener, so an agent that subscribes to nothing pays
  // nothing for it.
  attachObserver(costRecorder({ dispatcher, getRunContext: getRunCtx }));
  if (this.configuration.permissionChecker) {
    attachObserver(permissionRecorder({ dispatcher, getRunContext: getRunCtx }));
  }
  // Always-on bridges for consumer-emitted domain events.
  attachObserver(evalRecorder({ dispatcher, getRunContext: getRunCtx }));
  attachObserver(memoryRecorder({ dispatcher, getRunContext: getRunCtx }));
  // Embedding cost telemetry (8.9.0). The domain had a payload, a registry
  // entry and a DomainWildcard arm since 2.x and NO bridge, so the event
  // could not have arrived however correctly it was fired. Zero-cost when
  // the agent embeds nothing.
  attachObserver(embeddingRecorder({ dispatcher, getRunContext: getRunCtx }));
  attachObserver(skillRecorder({ dispatcher, getRunContext: getRunCtx }));
  attachObserver(toolsRecorder({ dispatcher, getRunContext: getRunCtx }));
  // Tool-args validation events (#9) — always-on; zero-cost when no
  // validation event fires.
  attachObserver(validationRecorder({ dispatcher, getRunContext: getRunCtx }));
  // Credential lifecycle (9.4.0). The domain has emitted since 6.11.0 with no
  // bridge, so `agent.on('agentfootprint.credential.failed', …)` observed
  // nothing however correctly the event fired — which is how an identity
  // adapter that failed every call did so in a silence that read like health.
  // Always-on and zero-cost: the bridge drops an event nobody listens for.
  attachObserver(credentialRecorder({ dispatcher, getRunContext: getRunCtx }));
  // Map engagement (9.58.0). Shipped WITH the domain, same lesson as above.
  attachObserver(mapRecorder({ dispatcher, getRunContext: getRunCtx }));
  // Context Integrity findings (9.60.0). Same lesson, applied again.
  attachObserver(integrityRecorder({ dispatcher, getRunContext: getRunCtx }));
  // Artifact lifecycle (9.21.0). Shipped WITH the domain — the credential
  // bridge above is the record of what waiting costs. Always-on and
  // zero-cost: with no store attached nothing emits, and the bridge drops
  // an event nobody listens for.
  attachObserver(artifactsRecorder({ dispatcher, getRunContext: getRunCtx }));
  // Reliability telemetry (rules-loop fail_fast / retried / recovered).
  // Always-on, but zero-cost when no .reliability() config fires events.
  attachObserver(reliabilityRecorder({ dispatcher, getRunContext: getRunCtx }));
  // Provider-decorator telemetry (withFallback / withRetry reports,
  // translated in-run by `resilienceHooks`). Always-on, but zero-cost
  // when the configured provider is undecorated or never fails. Also
  // covers a `.reliability()` run: that path is `executeWithReliability`
  // driving `singleProviderCall` inside the SAME call-llm stage
  // (callLLM.ts), so the decorator's reports ride this bridge too. (It
  // is NOT the `buildReliabilityGateChart` subflow — the Agent never
  // mounts that chart; nothing shipped does.)
  attachObserver(resilienceRecorder({ dispatcher, getRunContext: getRunCtx }));
  // Check-in events bridge (evidence-carrying human consent). Always-on;
  // forwards checkin.request/decision $emits to the dispatcher so
  // `agent.on('agentfootprint.checkin.*')` fires. Zero-cost until a tool with
  // `checkIn` trips.
  attachObserver(checkInEventsBridge({ dispatcher, getRunContext: getRunCtx }));
  // Same wiring for `agentfootprint.middleware.*` — the governance chains'
  // one event. Attached only when a chain exists: an agent without middleware
  // gains no bridge, no listener and no per-event work.
  if (
    this.configuration.toolMiddleware.length > 0 ||
    this.configuration.messageMiddleware.length > 0
  ) {
    attachObserver(
      new EmitBridge({
        id: 'agentfootprint.middleware-bridge',
        prefix: 'agentfootprint.middleware.',
        dispatcher,
        getRunContext: getRunCtx,
      }),
    );
  }
  // Same wiring for `agentfootprint.findings.*` (9.101.0) — the ledger's
  // events, filed by `recordFindings` on scope. An unarmed agent gains
  // no bridge, no listener and no
  // per-event work, and `agent.on('agentfootprint.findings.*')` can only
  // ever fire on an agent that could have filed a row.
  // Also under the inputs layer (honesty layer 2): its `argument` rows are
  // filed through the same writer and ride the same domain — and under the
  // results layer (honesty layer 3), whose `period` rows do the same.
  // Negative claims also file prose warnings, independently of those layers.
  if (
    this.configuration.findingsOptions !== undefined ||
    this.inputsLayerArmed ||
    this.resultsLayerArmed ||
    this.configuration.negativeClaimsConfig !== undefined
  ) {
    attachObserver(
      new EmitBridge({
        id: 'agentfootprint.findings-bridge',
        prefix: 'agentfootprint.findings.',
        dispatcher,
        getRunContext: getRunCtx,
      }),
    );
  }
  // Same wiring for `agentfootprint.answer.*` (honesty layer 4) — the one
  // event the answer layer's stage fires per answer. Attached only under
  // `.answerLayer()`, shipped WITH the domain (the credential.* lesson).
  if (this.configuration.answerLayerOption !== undefined) {
    attachObserver(
      new EmitBridge({
        id: 'agentfootprint.answer-bridge',
        prefix: 'agentfootprint.answer.',
        dispatcher,
        getRunContext: getRunCtx,
      }),
    );
  }
  // Same wiring for `agentfootprint.tool_choice.*` (9.105.0) — the three
  // events `recordToolChoice` files on scope. Attached only under
  // `.toolChoice()`, for the same reason.
  if (this.configuration.toolChoiceOptions !== undefined) {
    attachObserver(
      new EmitBridge({
        id: 'agentfootprint.tool-choice-bridge',
        prefix: 'agentfootprint.tool_choice.',
        dispatcher,
        getRunContext: getRunCtx,
      }),
    );
  }
  // Same wiring for `agentfootprint.ontology.*` (9.106.0) — the one event
  // `callLLM` emits when the declared map is served. Attached only under
  // `.ontology()`, for the same reason.
  if (this.configuration.ontology !== undefined) {
    attachObserver(
      new EmitBridge({
        id: 'agentfootprint.ontology-bridge',
        prefix: 'agentfootprint.ontology.',
        dispatcher,
        getRunContext: getRunCtx,
      }),
    );
  }
  for (const r of this.native.attachedRecorders) {
    // A recorder's OWN `delivery` field is more specific than the
    // agent-level default — footprintjs's options bag would override the
    // field, so recorders that declare a tier are attached bare (their
    // field rules). This gives consumers a per-recorder escape hatch:
    // `{ id, delivery: 'inline', ...hooks }` stays inline under an
    // observerDelivery: 'deferred' agent, and vice versa.
    if (r.delivery !== undefined) attachments.push({ recorder: r });
    else attachObserver(r);
  }
  return {
    setup: {
      redaction: redaction.recordPolicy,
      narrative: {},
      attachments,
      onOrigin: () => {
        // Native is the only ID/clock authority. Remaining domain consumers
        // still migrate to captured component values; no private ID is minted.
        this.native.bindRunServing(invocation);
        this.emitRunManifest(invocation.context());
        this.emitSkillGraphDeclared(invocation.context());
      },
    },
    binding: {
      metadata,
      bindScope: (scope, context) => {
        redaction.bindScope(scope, context);
      },
    },
  };
}
