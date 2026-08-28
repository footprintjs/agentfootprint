/**
 * callLLM — the LLM-invocation stage of the agent's chart.
 *
 * Reads the assembled prompt + messages from scope (populated by the
 * upstream slot subflows: SystemPrompt, Messages, Tools, CacheDecision,
 * CacheGate). Calls `provider.stream()` if available (token streaming
 * with per-chunk events) else falls back to `provider.complete()`.
 * Writes the response to scope (`llmLatestContent`, `llmLatestToolCalls`,
 * cumulative tokens) for the downstream Route decider to read.
 *
 * Emits `agentfootprint.stream.llm_start` + `llm_end` brackets for
 * observability adapters and per-chunk `stream.token` events during
 * streaming. Emits `cost.tick` via `emitCostTick` when a `pricingTable`
 * is configured.
 *
 * Factory signature so the chart-build-time provider/model/etc. deps
 * are explicit. The `toolSchemas` value is late-bound via a getter
 * because tool schema composition completes after the seed factory is
 * built but before the chart actually runs.
 */

import type { TypedScope } from 'footprintjs';
import { iterationsRemainingOf } from '../../../lib/iterationBudget.js';
import type {
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolSchema,
  PricingTable,
} from '../../../adapters/types.js';
import type { CacheMarker, CacheStrategy } from '../../../cache/types.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import { wireViolationsOf } from '../../../integrity/invariant-violation/wire.js';
import { danglingReferencesOf } from '../../../integrity/dangling-reference/check.js';
import {
  declaredEnumValuesOf,
  unsupportedArgumentsOf,
  type ExternalGround,
} from '../../../integrity/unsupported-argument/check.js';
import { toolNameOfMessage } from '../window/toolNames.js';
import { findStagedRefs, stagedRefsNudgeLine } from '../stagedRefs.js';
import { contextErrorIdentity, type ContextError } from '../../../integrity/finding/types.js';
import { resilienceHooks } from '../../../recorders/core/resilienceHooks.js';
import type { InjectionRecord } from '../../../recorders/core/types.js';
import { emitCostTick, type ResolvedCostBudget } from '../../cost.js';
import type { ReliabilityConfig } from '../../../reliability/types.js';
import { applyOutputSchema, type OutputSchemaParser } from '../../outputSchema.js';
import { readSchemaToolAnswer } from '../outputEnforcement.js';
import {
  executeWithReliability,
  ValidationFailure,
  type OutputSchemaValidator,
} from './reliabilityExecution.js';
import type { AgentState } from '../types.js';

/**
 * Drop the fields that exist for the library and never for the model.
 *
 * Today that is exactly one: `injectedBy`, the delivery marker (7.21).
 * Messages without it pass through by reference, so an agent that delivers
 * nothing allocates nothing — and the array's length and order are untouched
 * either way, which is what keeps `CacheMarker{field:'messages'}` honest.
 */
/** The wrap-up call's tool list (9.56.0). A frozen module constant so the
 *  withholding allocates nothing on the one call it applies to. */
const EMPTY_TOOL_SCHEMAS: readonly LLMToolSchema[] = Object.freeze([]);

/**
 * File integrity findings on the shared seen-list rail (9.60.0): identity
 * dedup across passes — freshest copy first, since the tools slot may have
 * extended the list earlier THIS pass — so one defect emits ONE
 * `integrity.context_error` per run, however many calls re-detect it.
 * Every seam in this stage files through here; a second copy of this loop
 * would eventually disagree with the first about what "already filed" means.
 */
function fileIntegrityFindings(
  scope: TypedScope<AgentState>,
  findings: readonly ContextError[],
  iteration: number,
): void {
  if (findings.length === 0) return;
  const seenIds =
    (scope.$getValue('integrityFindingIds') as readonly string[] | undefined) ??
    (scope.$getValue('priorIntegrityFindingIds') as readonly string[] | undefined) ??
    [];
  const newIds: string[] = [...seenIds];
  for (const f of findings) {
    const id = contextErrorIdentity({ ...f, epoch: undefined });
    if (newIds.includes(id)) continue;
    newIds.push(id);
    typedEmit(scope, 'agentfootprint.integrity.context_error', { ...f, iteration });
  }
  if (newIds.length > seenIds.length) scope.$setValue('integrityFindingIds', newIds);
}

/**
 * Consult the app's external-ground provider, throw-proof by law (9.72.0): a
 * provider that throws, or returns anything but an array, contributes
 * nothing — the check then runs on exactly what the run itself served, as if
 * the door were closed. An accounting door must never change a run's
 * outcome (the fileIntegrityDisposition rule, one tier down). Entry-level
 * hygiene — dropping blank values and unlabeled sources — lives in the
 * check itself, beside the fences it joins.
 */
function readExternalGrounds(
  provider: (() => readonly ExternalGround[]) | undefined,
): readonly ExternalGround[] {
  if (provider === undefined) return [];
  try {
    const entries = provider();
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

function stripFrameworkFields(messages: readonly LLMMessage[]): readonly LLMMessage[] {
  if (!messages.some((m) => m.injectedBy !== undefined)) return messages;
  return messages.map((m) => {
    if (m.injectedBy === undefined) return m;
    const { injectedBy: _marker, ...wire } = m;
    void _marker;
    return wire;
  });
}

export interface CallLLMStageDeps {
  /** The LLM provider to invoke. */
  readonly provider: LLMProvider;
  /** Model identifier passed to provider.complete/stream. */
  readonly model: string;
  /** Optional sampling temperature. */
  readonly temperature?: number;
  /** Optional max output tokens. */
  readonly maxTokens?: number;
  /** Optional pricing adapter for cost tracking. */
  readonly pricingTable?: PricingTable;
  /** Optional cumulative USD cap per run. */
  readonly costBudget?: ResolvedCostBudget;
  /** Hard ReAct iteration cap (used to compute iterationsRemaining for
   *  the cache strategy's prepareRequest hook). */
  readonly maxIterations: number;
  /** Cache strategy (provider-aware; v2.6+). Pass-through if no markers. */
  readonly cacheStrategy: CacheStrategy;
  /** Static tool schemas, late-bound (see seed.ts for the same
   *  pattern — toolSchemas is computed AFTER stage factories are
   *  built). The getter resolves the eventual value at run time. */
  readonly toolSchemas: readonly LLMToolSchema[];
  /**
   * The declared argument-ground edges (`Tool.argumentsFrom`), by tool name
   * (9.60.0). Present only when at least one registered tool declared one;
   * absent → neither the dangling-reference check nor the unsupported-argument
   * check runs, byte-identical.
   *
   * ONE DECLARATION, TWO SEAMS (9.63.0). `dangling-reference` asks, at request
   * assembly, whether the ground is still in reach while the tool is OFFERED;
   * `unsupported-argument` asks, after the response lands, whether the value
   * the model chose came from that ground when the tool was CALLED.
   */
  readonly toolGrounding?: ReadonlyMap<string, readonly string[]>;
  /**
   * The app's external-ground provider (9.72.0) — see
   * `AgentOptions.externalGrounds`. Consulted once per response with an armed
   * call; its entries join the choice-seam corpus and each excusal files
   * `agentfootprint.integrity.external_ground_used` with the entry's source
   * label. Absent → the corpus is exactly what it always was.
   */
  readonly externalGrounds?: () => readonly ExternalGround[];
  /**
   * The staged-refs nudge's harvest (`.namesAndNumbersFromEvidence({ nudge:
   * true })`) — `Tool.wants` by tool name, present ONLY when the dial is on
   * AND at least one registered tool declares `wants`; absent → this stage
   * reads nothing new and every request keeps its exact bytes.
   *
   * When present, an iteration whose conversation holds placed artifact
   * tickets a currently-served spender can consume gets ONE extra `role:
   * 'user'` line appended at request assembly — never written to history —
   * naming the refs and the spender: derived numbers come from the tool, not
   * from mental arithmetic. Appended HERE for the wrap-up's reason (this is
   * the one seam that decides what goes on the wire) and at the END for the
   * measured reason: the failure this closes was recency — the app's own
   * "use the compute tool" prose sat at the top of the context, the numbers
   * at the bottom, and the model summed them in its head.
   */
  readonly toolWants?: ReadonlyMap<string, readonly string[]>;
  /**
   * The per-run disposition ledger, by REFERENCE (9.60.0) — plumbing shared
   * through the build closure like ProviderToolCache, never scope state.
   * Every check in this stage notes one disposition per encounter here, so
   * silence is auditable at the run boundary.
   */
  readonly integrityLedger?: {
    current: import('../../../integrity/disposition/ledger.js').DispositionLedger | undefined;
  };
  /** Optional rules-based reliability config (v2.11.5+). When set,
   *  the call is wrapped in a retry/fallback/fail-fast loop driven
   *  by `config.preCheck` and `config.postDecide` rules. Streaming
   *  is preserved; mid-stream failures use first-chunk arbitration —
   *  see `reliabilityExecution.ts` and the streaming + reliability
   *  design memo. */
  readonly reliability?: ReliabilityConfig;
  /** Optional output-schema parser (v2.13+). When set AND `reliability`
   *  is also set, the loop validates the LLM response against this
   *  parser on terminal turns (no toolCalls). Failures classify as
   *  `errorKind: 'schema-fail'` so PostDecide rules can route to
   *  retry-with-feedback (Instructor pattern). When `reliability` is
   *  NOT set, validation only happens at `agent.parseOutput()` boundary
   *  (existing v2.4 behavior). */
  readonly outputSchemaParser?: OutputSchemaParser<unknown>;
  /**
   * The synthetic tool the `'tool-forced'` output strategy puts on the wire
   * (7.26). Present ONLY under that strategy; under `'instruct'` — the
   * default — this is undefined and not one line below it runs.
   *
   * When present, the tool is appended to the request's tool list and the
   * request carries `toolChoice`, so the provider constrains generation to
   * this shape instead of the model being asked in prose to comply. It is
   * added HERE, at request assembly, and nowhere else: that is what keeps it
   * off `.tools()`, out of the tools slot and its `tools.offered` event, off
   * any MCP server's served list, and away from the dispatcher that runs
   * tools and files middleware rows. It is the strategy's mechanism, not the
   * agent's surface.
   */
  readonly schemaTool?: LLMToolSchema;
  /** v2.14+ — request-side thinking budget. When set, every LLMRequest
   *  carries `thinking: { budget }` so the provider activates extended
   *  thinking. Undefined = no activation (default). */
  readonly thinkingBudget?: number;
  /**
   * True when the agent was built with `.configure()`. Only then does this
   * stage read `scope.resolvedModel` — the per-run model seed committed.
   * Gating on a build-time flag (rather than always reading and falling
   * back) keeps an unconfigured agent's recorded reads unchanged, which is
   * what "absent option = byte-identical" has to mean for a library whose
   * product is the recording.
   */
  readonly runConfigured?: boolean;
  /**
   * "The cursor picks the brain" (9.19.0). Consulted ONCE at the top of the
   * stage with the ADVANCED cursor — `scope.nextSkillCursor ??
   * scope.currentSkillId`, correct in BOTH chart shapes: inside
   * `sf-llm-call` the boundary's `currentSkillId` is a readonly input still
   * holding the previous iteration's cursor and the advanced one lives
   * under `nextSkillCursor`; in the flat chart the engine's outputMapper
   * has already written `currentSkillId` to the advanced value — and with
   * the run's escalation flag (`scope.skillEscalated`, threaded across the
   * `sf-llm-call` boundary by the grouped chart's mappers). The result
   * resolves field by field down the STATED precedence chain:
   *
   *   **escalation > per-skill brain > `.configure()` `resolvedModel` >
   *   build-time default** — `provider = brain?.provider ?? deps.provider`;
   *   `model = brain?.model ?? (runConfigured ? scope.resolvedModel :
   *   undefined) ?? deps.model`; `cacheStrategy = brain?.cacheStrategy ??
   *   deps.cacheStrategy`. A brain naming only a model inherits the agent's
   *   provider; a foreign provider without a model was refused at build.
   *
   * Undefined — no brain declared anywhere — and this stage reads no new
   * scope key, resolves exactly as before, and `llm_start` keeps its exact
   * bytes (the additive `brain` field appears only when a rung won).
   */
  readonly brainFor?: import('../skillBrains.js').BrainFor;
  /**
   * `AgentOptions.recordSystemPrompt` (9.50.0) — opt-in, threaded
   * value-conditionally so an agent that never asked emits byte-identical
   * `llm_start` events. When true, the event carries `systemPromptText`: the
   * assembled prompt verbatim as sent. The privacy story lives on the option
   * and on the payload field; this dep only obeys it.
   */
  readonly recordSystemPrompt?: boolean;
}

/**
 * Build the callLLM stage function. Captures the LLM provider + model
 * config + cache strategy via the deps object; everything per-iteration
 * comes from scope.
 */
export function buildCallLLMStage(
  deps: CallLLMStageDeps,
): (scope: TypedScope<AgentState>) => Promise<void> {
  return async (scope) => {
    const systemPromptInjections =
      (scope.systemPromptInjections as readonly InjectionRecord[]) ?? [];
    // `scope.messagesInjections` is read by ContextRecorder for
    // observability; the LLM-wire path now reads scope.history directly.
    const iteration = scope.iteration;

    // "The cursor picks the brain" (9.19.0) — ONE consult, at the top, with
    // the advanced cursor and the escalation flag. Gated on `deps.brainFor`
    // so an agent without brains reads no new scope key and resolves on the
    // exact line it always did.
    const brain = deps.brainFor
      ? deps.brainFor(
          (scope.nextSkillCursor ?? scope.currentSkillId) as string | undefined,
          scope.skillEscalated === true,
        )
      : undefined;
    const provider = brain?.provider ?? deps.provider;
    const cacheStrategy = brain?.cacheStrategy ?? deps.cacheStrategy;

    // The model for this run. `.configure()` resolved it at seed and
    // COMMITTED it to scope, so what gets called, what the `llm_start`
    // event reports and what cost is priced against are all one value —
    // the one the trace records. Without `.configure()` this is the
    // build-time model and scope is never touched. A winning brain rung
    // (9.19.0) outranks both — the stated precedence chain.
    const model =
      brain?.model ??
      (deps.runConfigured ? (scope.resolvedModel as string | undefined) : undefined) ??
      deps.model;

    // Per-iteration boundary marker (was a dedicated `IterationStart` stage —
    // folded here since emitting is passive observability, not work that needs
    // its own execution stage). Fires FIRST, before the LLM call, so recorders
    // still bracket each ReAct iteration. Payload unchanged (turnIndex reserved
    // for future multi-turn; iterIndex is the per-iteration counter).
    typedEmit(scope, 'agentfootprint.agent.iteration_start', {
      turnIndex: 0,
      iterIndex: iteration,
    });

    const systemPrompt = systemPromptInjections
      .map((r) => r.rawContent ?? '')
      .filter((s) => s.length > 0)
      .join('\n\n');

    // Read the LLM message stream from `scope.history` directly. The
    // `messagesInjections` projection is for observability — it
    // flattens InjectionRecords for event reporting and doesn't carry
    // the full LLM-protocol shape (assistant `toolCalls[]`, etc.). For
    // Anthropic's API contract we need the original LLMMessage with
    // `toolCalls` intact so tool_use → tool_result correlation survives.
    // `stripFrameworkFields` takes off `injectedBy` — the marker the delivery
    // stage stamps so the messages slot can say WHO put a message here. It is
    // framework bookkeeping, not conversation, and it is removed BEFORE the
    // request exists rather than trusted to be ignored: a consumer-authored
    // adapter that serializes a message wholesale would otherwise put library
    // internals on someone's wire. Stripping removes a FIELD, never a message,
    // so `messages[i]` is still the message the cache marker's index names.
    const messages = stripFrameworkFields(
      (scope.history as readonly LLMMessage[] | undefined) ?? [],
    );

    // Dynamic schemas — registry tools + injection-supplied tools (Skills'
    // `inject.tools` when their Injection is active). Falls back to the static
    // schemas at startup before the tools slot has run. Computed BEFORE the
    // llm_start emit so the event reports what the model ACTUALLY saw this call
    // (count + the name/description catalog), not the static startup set.
    //
    // 9.56.0 — unless this is the WRAP-UP call, in which case the tools come
    // OFF. They are withheld HERE, at request assembly, for the same reason
    // the schema tool is ADDED here: this is the one seam that decides what
    // goes on the wire, so the change never has to be known by the tools slot,
    // the registry, `tools.offered`, an MCP server's served list or the
    // dispatcher that runs tools. Nothing downstream learns a new mode — the
    // model is simply handed a request with no tools, which is what makes the
    // wrap-up terminal by construction rather than by another rule.
    //
    // `llm_start` reports the truth (`toolsCount: 0`, no catalog), because its
    // whole claim is what the model actually saw this call.
    const registeredToolSchemas =
      scope.wrapUpAsked === true
        ? EMPTY_TOOL_SCHEMAS
        : (scope.dynamicToolSchemas as readonly LLMToolSchema[] | undefined) ?? deps.toolSchemas;
    // Under `'tool-forced'` the schema rides along as one more tool ON THE
    // WIRE. It is reported in `llm_start` too, and deliberately: that event's
    // whole claim is "what the model actually saw this call", and a tool the
    // model was forced to use is the last thing to leave out of it.
    const activeToolSchemas = deps.schemaTool
      ? [...registeredToolSchemas, deps.schemaTool]
      : registeredToolSchemas;

    // THE STAGED-REFS NUDGE (`nudge: true` on the evidence gate). Judged on
    // `registeredToolSchemas` — the tools REALLY served this call, so the
    // wrap-up's withheld surface arms nothing and a synthetic schema tool is
    // never named a spender. The line is request-only: `scope.history` is
    // untouched, so it never enters the exempt corpus and never persists —
    // recomposed each iteration, present exactly while both conditions hold.
    let wireMessages = messages;
    if (deps.toolWants !== undefined) {
      const match = findStagedRefs(
        messages,
        deps.toolWants,
        new Set(registeredToolSchemas.map((t) => t.name)),
      );
      if (match !== undefined) {
        wireMessages = [...messages, { role: 'user', content: stagedRefsNudgeLine(match) }];
        typedEmit(scope, 'agentfootprint.agent.grounding_nudged', {
          iteration,
          refs: match.refs.map((r) => ({ ref: r.ref, kind: r.kind })),
          ...(match.refsOmitted > 0 && { refsOmitted: match.refsOmitted }),
          tools: [...match.tools],
        });
      }
    }

    typedEmit(scope, 'agentfootprint.stream.llm_start', {
      iteration,
      provider: provider.name,
      model,
      systemPromptChars: systemPrompt.length,
      // Opt-in (9.50.0): the assembled prompt VERBATIM, exactly the string
      // handed to the provider below — never re-joined by a consumer.
      ...(deps.recordSystemPrompt === true && { systemPromptText: systemPrompt }),
      messagesCount: wireMessages.length,
      toolsCount: activeToolSchemas.length,
      // WHICH BRAIN answered (9.19.0) — stamped ONLY when a brain rung won,
      // so configured/default runs keep byte-identical events.
      ...(brain !== undefined && {
        brain: {
          via: brain.via,
          ...(brain.skillId !== undefined && { skillId: brain.skillId }),
        },
      }),
      ...(activeToolSchemas.length > 0 && {
        tools: activeToolSchemas.map((t) => ({
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
        })),
      }),
      ...(deps.temperature !== undefined && { temperature: deps.temperature }),
    });

    const startMs = Date.now();
    const baseRequest = {
      ...(systemPrompt.length > 0 && { systemPrompt }),
      messages: wireMessages,
      ...(activeToolSchemas.length > 0 && { tools: activeToolSchemas }),
      model,
      ...(deps.temperature !== undefined && { temperature: deps.temperature }),
      ...(deps.maxTokens !== undefined && { maxTokens: deps.maxTokens }),
      ...(deps.thinkingBudget !== undefined && {
        thinking: { budget: deps.thinkingBudget },
      }),
      ...(deps.schemaTool !== undefined && {
        toolChoice: { type: 'tool' as const, name: deps.schemaTool.name },
      }),
    };
    // v2.6+ — call cache strategy to attach provider-specific cache
    // hints. CacheGate has already routed (apply-markers / no-markers)
    // and populated scope.cacheMarkers accordingly. Strategy.prepareRequest
    // is a pass-through for empty markers.
    const cacheMarkers = (scope.cacheMarkers as readonly CacheMarker[] | undefined) ?? [];
    const cachePrepared = await cacheStrategy.prepareRequest(baseRequest, cacheMarkers, {
      iteration,
      iterationsRemaining: iterationsRemainingOf(deps.maxIterations, iteration),
      recentHitRate: scope.recentHitRate,
      cachingDisabled: scope.cachingDisabled ?? false,
    });
    const llmRequest = cachePrepared.request;

    // THE CLOSURE CHECK (9.60.0, dangling-reference). At assembly, BEFORE the
    // call — the composition defect exists whether or not the call lands. A
    // served tool whose declared argument ground (`Tool.argumentsFrom`) has
    // left the window (the union of every visit's droppedObservations) and
    // has no fresh result in the frame is being offered without its evidence.
    // Both fences live in the check: never-dropped is silent (not-yet-grounded
    // is legitimate sequencing) and a re-fetched ground is silent.
    //
    // ONE HELPER, BOTH SIDES. The dropped side is the window ledger, which
    // names a result with `toolNameOfMessage` — the helper that recovers the
    // name from the assistant turn that asked when the result itself carries
    // no `toolName`. The present side asks the SAME helper the SAME question,
    // because `LLMMessage.toolName` is optional and a conversation restored
    // from an older release (or a host that speaks only the wire shape) names
    // its tools through `toolCalls[].id` alone. Reading `m.toolName` here
    // instead made the same message evidence-that-left on one side and
    // not-present on the other, and the check then accused a window that had
    // been RE-GROUNDED — a legitimate re-fetch reported as a dangling
    // reference. A false accusation is this family's unrecoverable failure.
    if (deps.toolGrounding !== undefined && deps.toolGrounding.size > 0) {
      const grounding = deps.toolGrounding;
      const servedGrounded = (llmRequest.tools ?? [])
        .filter((t) => grounding.has(t.name))
        .map((t) => ({ name: t.name, argumentsFrom: grounding.get(t.name)! }));
      const windowVisits =
        (scope.compactions as readonly { droppedObservations?: readonly string[] }[] | undefined) ??
        [];
      const droppedResults = new Set(windowVisits.flatMap((v) => v.droppedObservations ?? []));
      if (servedGrounded.length > 0 && droppedResults.size > 0) {
        const frame = llmRequest.messages;
        const presentResults = new Set(
          frame
            .map((m) => toolNameOfMessage(m, frame))
            .filter((name): name is string => name !== undefined),
        );
        const danglingFindings = danglingReferencesOf(
          servedGrounded,
          droppedResults,
          presentResults,
          iteration,
        );
        deps.integrityLedger?.current?.note(
          'dangling-reference',
          'compose',
          danglingFindings.length > 0 ? 'checked-fail' : 'checked-pass',
          danglingFindings.length > 0 ? Date.now() : undefined,
        );
        fileIntegrityFindings(scope, danglingFindings, iteration);
      } else {
        // No grounded tool served, or nothing has dropped: nothing this call
        // could violate — stated, never silence.
        deps.integrityLedger?.current?.note('dangling-reference', 'compose', 'not-applicable');
      }
    }

    // Streaming-first: when the provider implements `stream()` we
    // consume chunk-by-chunk so consumers see tokens as they arrive
    // instead of waiting for the full LLM call to finish. Each
    // non-terminal chunk fires `agentfootprint.stream.token`. The
    // terminal chunk SHOULD carry the authoritative `LLMResponse`;
    // when it doesn't (older providers, partial implementations) we
    // fall back to `complete()` for the authoritative payload —
    // keeping the ReAct loop deterministic.
    //
    // `singleProviderCall` is the per-attempt call function. Used
    // directly when reliability is OFF; passed into `executeWithReliability`
    // when reliability is configured (the helper invokes it once per
    // retry-loop iteration).
    //
    // `providerHooks` is the resilience-report channel handed to the
    // provider on every call. When `deps.provider` is decorated
    // (withFallback / withRetry / withCircuitBreaker) its reports become
    // in-run typed events with this stage's real runtimeStageId. Built
    // once per stage — stateless, reused across reliability-loop
    // iterations. Named to avoid shadowing `singleProviderCall`'s own
    // `hooks` parameter, which is the unrelated `{ onFirstChunk }` bag.
    const providerHooks = resilienceHooks(scope);
    const singleProviderCall = async (
      req: LLMRequest,
      hooks: { onFirstChunk?: () => void },
    ): Promise<LLMResponse> => {
      let resp: LLMResponse | undefined;
      let firstChunkFired = false;
      if (provider.stream) {
        for await (const chunk of provider.stream(req, providerHooks)) {
          if (chunk.done) {
            if (chunk.response) resp = chunk.response;
            break;
          }
          // A provider is a port anyone can implement, and a non-terminal
          // chunk that carries no `content` used to die on the next line as
          // `Cannot read properties of undefined (reading 'length')` —
          // naming neither the provider nor the contract it missed. The
          // commonest shape of the mistake is a chunk that ends the stream
          // with its own marker instead of `done: true`, which is why the
          // refusal says what the terminal chunk looks like.
          if (typeof (chunk.content as unknown) !== 'string') {
            throw new TypeError(
              `provider '${provider.name}' yielded a stream chunk whose \`content\` is ` +
                `${chunk.content === undefined ? 'missing' : `a ${typeof chunk.content}`}. ` +
                `Every chunk from LLMProvider.stream() is ` +
                `{ tokenIndex: number, content: string, done: boolean }, and the LAST one is ` +
                `{ content: '', done: true, response } — the response payload rides the ` +
                `terminal chunk. A chunk that ends the stream any other way is not seen as ` +
                `terminal, and its missing content stops the run here.`,
            );
          }
          if (chunk.content.length > 0) {
            if (!firstChunkFired) {
              firstChunkFired = true;
              hooks.onFirstChunk?.();
            }
            typedEmit(scope, 'agentfootprint.stream.token', {
              iteration,
              tokenIndex: chunk.tokenIndex,
              content: chunk.content,
            });
          }
        }
      }
      if (!resp) {
        // No `stream()` OR stream finished without a response payload.
        // Raw errors propagate so the reliability loop can classify them;
        // friendly translation happens at the terminal ErrorBridge.
        //
        // Hooks are passed to BOTH phases. A decorated provider that falls
        // back in each reports twice — deliberately NOT deduped, because
        // those are two genuinely billed calls and collapsing them would
        // hide real double-billing. (That this branch can re-call at all
        // after a stream is a pre-existing quirk; see MENTAL_MODEL §14.)
        resp = await provider.complete(req, providerHooks);
      }
      // `'tool-forced'`: the answer arrived as the synthetic tool's ARGUMENTS,
      // so it is moved into `content` and the call is taken off the list here,
      // at the single seam every later reader goes through. Everything
      // downstream — the reliability validator, the scope writes, the Route
      // decider, the retry loop — then sees the response it would have seen
      // under `'instruct'`: a final answer that is a JSON string, and no tool
      // calls. One normalization, no second code path, and nothing further
      // down has to know which strategy is in force.
      const forcedName = deps.schemaTool?.name;
      if (forcedName !== undefined) {
        const answer = readSchemaToolAnswer(resp);
        if (answer !== undefined) {
          resp = {
            ...resp,
            content: answer,
            toolCalls: resp.toolCalls.filter((tc) => tc.name !== forcedName),
          };
        }
      }
      return resp;
    };

    // v2.13 — build the output-schema validator hook when both
    // reliability + outputSchemaParser are configured. The reliability
    // loop applies the validator only on terminal turns (toolCalls
    // empty) so tool-using turns aren't rejected for failing the final-
    // answer schema. ValidationFailure carries `stage` + `path` for the
    // typed event payload.
    let postValidate: OutputSchemaValidator | undefined;
    if (deps.outputSchemaParser !== undefined) {
      const parser = deps.outputSchemaParser;
      postValidate = (response) => {
        try {
          applyOutputSchema(response.content, parser);
        } catch (err) {
          // applyOutputSchema throws OutputSchemaError with
          // {stage, rawOutput, cause}. Convert to ValidationFailure for
          // the gate's typed handling. Pull a `path` if the underlying
          // cause exposes Zod-style issues. Use the cause's message
          // (the actual parser error) when available, falling back to
          // the wrapper's message for parsers without a cause.
          const e = err as {
            message: string;
            stage?: 'json-parse' | 'schema-validate';
            rawOutput?: string;
            cause?: {
              message?: string;
              issues?: ReadonlyArray<{ path?: ReadonlyArray<string | number> }>;
            };
          };
          let path: string | undefined;
          const firstIssue = e.cause?.issues?.[0];
          if (firstIssue?.path && firstIssue.path.length > 0) {
            path = firstIssue.path.join('.');
          }
          // Use cause message when present (parsers like Zod attach the
          // real error as cause); fall back to wrapper message.
          const message = e.cause?.message ?? e.message;
          throw new ValidationFailure({
            message,
            stage: e.stage ?? 'schema-validate',
            ...(path !== undefined && { path }),
            ...(e.rawOutput !== undefined && { rawOutput: e.rawOutput }),
          });
        }
      };
    }

    let response: LLMResponse | undefined;
    if (deps.reliability) {
      response = await executeWithReliability(
        scope,
        llmRequest,
        deps.reliability,
        provider,
        provider.name,
        model,
        singleProviderCall,
        postValidate,
      );
      // `executeWithReliability` returns `undefined` when it took the
      // fail-fast path. It already wrote scope state and called
      // `$break(reason)` — `Agent.run()` translates the propagated
      // break into a `ReliabilityFailFastError` at the API boundary.
      // Skip the post-call state writes; there is no response to commit.
      if (response === undefined) return;
    } else {
      response = await singleProviderCall(llmRequest, {});
    }
    const durationMs = Date.now() - startMs;

    scope.totalInputTokens = scope.totalInputTokens + response.usage.input;
    scope.totalOutputTokens = scope.totalOutputTokens + response.usage.output;
    scope.llmLatestContent = response.content;
    scope.llmLatestToolCalls = response.toolCalls;
    // v2.14 — hand provider-specific raw thinking data to the
    // NormalizeThinking sub-subflow (the next stage in sf-call-llm
    // when a ThinkingHandler is configured). Undefined when the
    // provider has no thinking content for this call (most calls).
    if (response.rawThinking !== undefined) {
      (scope as TypedScope<AgentState> & { rawThinking: unknown }).rawThinking =
        response.rawThinking;
    }

    typedEmit(scope, 'agentfootprint.stream.llm_end', {
      iteration,
      content: response.content,
      toolCallCount: response.toolCalls.length,
      usage: response.usage,
      stopReason: response.stopReason,
      durationMs,
    });

    // THE WIRE SEAM (9.60.0). The compose backstop reads the merged frame;
    // this reads what the ADAPTER says actually crossed — the manifest read
    // back from the serialized body — against the schemas this very call
    // assembled. The recorded defect lived exactly in that gap: a clean
    // frame, four retained schemas on the wire. No manifest stated → the
    // call is incomparable and nothing is guessed. Same seen-list rail as
    // the compose backstop, freshest copy first, so one defect files once
    // per run however many calls re-detect it.
    // The composed side is llmRequest — the exact object HANDED TO the
    // adapter, after the cache strategy's transform — so a strategy edit
    // is never blamed on the adapter.
    const wireFindings = wireViolationsOf(
      {
        names: (llmRequest.tools ?? []).map((t) => t.name),
        provenance: 'callLLM (assembled request)',
      },
      response.wireManifest === undefined
        ? undefined
        : { names: response.wireManifest.toolNames, provenance: provider.name },
      iteration,
    );
    // The disposition: a provider stating no manifest leaves this call
    // UNREACHABLE — the check could not see the wire, which is a different
    // fact from "the wire was clean", and the ledger keeps them apart.
    deps.integrityLedger?.current?.note(
      'invariant-violation',
      'wire',
      response.wireManifest === undefined
        ? 'unreachable'
        : wireFindings.length > 0
        ? 'checked-fail'
        : 'checked-pass',
      wireFindings.length > 0 ? Date.now() : undefined,
    );
    fileIntegrityFindings(scope, wireFindings, iteration);

    // THE CHOICE SEAM (9.63.0, unsupported-argument). The wire check above
    // asks what the library put in front of the model; this asks what the
    // model did with it. For every call to an ARMED tool (one whose author
    // declared `argumentsFrom`), each identifier-like string argument must
    // appear somewhere in the frame this very call was assembled from.
    //
    // THE CORPUS IS SPLIT, and the split is the whole check. The system
    // prompt, every user message and every tool result are things the RUN
    // served. The assistant turns are things the MODEL wrote — deliberately
    // not ground, because a value whose only source is the model's own
    // rendered prose has been re-derived from a rendering instead of read
    // from evidence. That is the recorded failure exactly: a truncated job
    // name mined out of a prior answer, passed as a machine name, answered
    // with an honest "nothing found", reported to a person as fact.
    //
    // `llmRequest` is the frame — the object handed to the adapter, after the
    // cache strategy's transform — so the check judges the choice against
    // what the model actually saw, never against scope history it did not.
    if (deps.toolGrounding !== undefined && deps.toolGrounding.size > 0) {
      const grounding = deps.toolGrounding;
      const armedCalls = response.toolCalls.filter((c) => grounding.has(c.name));
      if (armedCalls.length > 0) {
        const schemaOf = new Map(
          (llmRequest.tools ?? []).map((t) => [t.name, t.inputSchema] as const),
        );
        const frameMessages = llmRequest.messages;
        // THE EXTERNAL-GROUND DOOR (9.72.0). The app may vouch for values the
        // run never served — a human clicked a row, the app verified the
        // clicked cells against the artifact the panel renders — and those
        // entries join the grounded corpus for THIS response only, consulted
        // fresh each time because the selection moves between turns. The
        // library records what the app asserts; the source label rides every
        // excusal so a reader can audit the chain.
        const external = readExternalGrounds(deps.externalGrounds);
        const { findings: argumentFindings, externalGroundings } = unsupportedArgumentsOf(
          armedCalls.map((c) => ({
            toolName: c.name,
            toolCallId: c.id,
            args: c.args,
            argumentsFrom: grounding.get(c.name) ?? [],
            declaredEnums: declaredEnumValuesOf(schemaOf.get(c.name)),
          })),
          {
            grounded: [
              ...(llmRequest.systemPrompt === undefined ? [] : [llmRequest.systemPrompt]),
              ...frameMessages.filter((m) => m.role !== 'assistant').map((m) => m.content),
            ],
            assistant: frameMessages.filter((m) => m.role === 'assistant').map((m) => m.content),
            ...(external.length > 0 && { external }),
          },
          iteration,
        );
        deps.integrityLedger?.current?.note(
          'unsupported-argument',
          'choice',
          argumentFindings.length > 0 ? 'checked-fail' : 'checked-pass',
          argumentFindings.length > 0 ? Date.now() : undefined,
        );
        fileIntegrityFindings(scope, argumentFindings, iteration);
        // Each excusal is a per-attempt fact and rides the emit channel —
        // deliberately NOT deduplicated the way findings are: a repeated call
        // is a fresh choice, and each excusal names the assertion that stood
        // between that choice and a finding.
        for (const g of externalGroundings) {
          typedEmit(scope, 'agentfootprint.integrity.external_ground_used', {
            toolName: g.toolName,
            toolCallId: g.toolCallId,
            path: g.path,
            value: g.value,
            source: g.source,
            iteration,
          });
        }
      } else {
        // No armed tool was called this turn — a response with nothing this
        // check could be about. Stated, never silence.
        deps.integrityLedger?.current?.note('unsupported-argument', 'choice', 'not-applicable');
      }
    }

    // `provider` here is the EFFECTIVE one — a per-skill `brain` overrides the
    // agent's, and the bill follows the call, not the configuration.
    emitCostTick(
      scope,
      deps.pricingTable,
      deps.costBudget,
      { provider: provider.name, model },
      response.usage,
    );
  };
}
