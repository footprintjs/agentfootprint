import { projectSourceInstructions } from '../../sourceContract.js';
import { recordModelContext } from '../../../../recorders/core/recordModelContext.js';
import type { CallLLMStageDeps } from './types.js';
import { servedRequestRecorder } from './servedRequest.js';
import { selectionAtRequest } from './selectionAtRequest.js';
import type { TypedScope } from 'footprintjs';
import { iterationsRemainingOf } from '../../../../lib/iterationBudget.js';
import type { LLMMessage, LLMToolSchema } from '../../../../provider-contract/types.js';
import type { CacheMarker } from '../../../../cache/types.js';
import { cacheStrategyFor } from '../../../../cache/cacheStrategyFor.js';
import { typedEmit } from '../../../../recorders/core/typedEmit.js';
import { danglingReferencesOf } from '../../../../integrity/dangling-reference/check.js';
import { toolNameOfMessage } from '../../window/toolNames.js';
import { evidenceRecoveryPiece } from '../../evidence/recovery.js';
import { joinSystemPrompt, stripFrameworkFields, toolsWithheld } from '../../composeRequest.js';
import { recoveryFeedback, requestOnlyMessages } from './requestOnly.js';
import {
  assertForcedRequestSupported,
  detachProviderInput,
  receiptProviderRequest,
  selectOutputFormat,
} from './providerRequest.js';
import { buildReceipt, receiptPieces } from '../../receipt/receipt.js';
import { RECEIPT_KEY } from '../../../../lib/conventions.js';
import { fileIntegrityFindings } from '../../integrityFindings.js';
import type { InjectionRecord } from '../../../../recorders/core/types.js';
import { collapseJudged } from '../../findings/serve.js';
import type { FindingsLedger } from '../../findings/types.js';
import { replayCacheMarkers } from '../../requestTurn/replayPrefix.js';
import { projectCallHistory } from './requestProjection.js';
import { prepareCitationProjection } from './citationProjection.js';
import type { OntologyPiece } from '../../../../ontology/serve.js';
import type { OntologyRecord } from '../../../../ontology/types.js';
import type { AgentState } from '../../types.js';

/** The wrap-up call's tool list (9.56.0). A frozen module constant so the
 *  withholding allocates nothing on the one call it applies to. */
const EMPTY_TOOL_SCHEMAS: readonly LLMToolSchema[] = Object.freeze([]);

export async function prepareCall(scope: TypedScope<AgentState>, deps: CallLLMStageDeps) {
  if (deps.servedTools?.selection?.accepted) delete deps.servedTools.selection.accepted;
  // The answer-text scanner (`findings/peel.ts`), loaded ONCE per call and
  // only under `.findings()` — the optional-family law of docs-next's site
  // budget: an unarmed agent never loads the module. Every armed use below
  // reads this binding; `undefined` IS the unarmed path.
  const peel = deps.findings === true ? await import('../../findings/peel.js') : undefined;
  const systemPromptInjections = (scope.systemPromptInjections as readonly InjectionRecord[]) ?? [];
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
  const firstReliabilityProvider = deps.reliability?.providers?.[0];
  const provider = firstReliabilityProvider?.provider ?? brain?.provider ?? deps.provider;

  // The model for this run. `.configure()` resolved it at seed and
  // COMMITTED it to scope, so what gets called, what the `llm_start`
  // event reports and what cost is priced against are all one value —
  // the one the trace records. Without `.configure()` this is the
  // build-time model and scope is never touched. A winning brain rung
  // (9.19.0) outranks both — the stated precedence chain.
  const model =
    firstReliabilityProvider?.model ??
    brain?.model ??
    (deps.runConfigured ? (scope.resolvedModel as string | undefined) : undefined) ??
    deps.model;
  // A configured/skill model can differ from the build default. Resolve the
  // adapter's same capability for the model actually being sent, while a
  // host's explicit strategy remains authoritative.
  const cacheStrategy =
    deps.cacheStrategyIsOverride === true && provider === deps.provider
      ? deps.cacheStrategy
      : typeof provider.promptCaching === 'function'
      ? cacheStrategyFor(provider, model)
      : brain?.cacheStrategy ?? deps.cacheStrategy;

  // Per-iteration boundary marker (was a dedicated `IterationStart` stage —
  // folded here since emitting is passive observability, not work that needs
  // its own execution stage). Fires FIRST, before the LLM call, so recorders
  // still bracket each ReAct iteration. Payload unchanged (turnIndex reserved
  // for future multi-turn; iterIndex is the per-iteration counter).
  typedEmit(scope, 'agentfootprint.agent.iteration_start', {
    turnIndex: 0,
    iterIndex: iteration,
  });

  // ── the system-prompt join ────────────────────────────────────────
  // The pieces are committed (`systemPromptInjections`); THIS STRING IS NOT.
  // It lives and dies inside this stage, which is why the join is one
  // exported function rather than four lines here — a reader rebuilding what
  // the model was served has to apply the identical rule to the identical
  // records (`composeRequest.ts` · `joinSystemPrompt`).
  const trustedSystemPrompt = joinSystemPrompt(systemPromptInjections);
  const recoveryPiece =
    deps.hasEvidenceRecovery === true
      ? evidenceRecoveryPiece(scope.evidenceRecovery, scope.evidenceRecoveryUsed, iteration)
      : undefined;

  // Read the LLM message stream from `scope.history` directly. The
  // `messagesInjections` projection is for observability — it
  // flattens InjectionRecords for event reporting and doesn't carry
  // the full LLM-protocol shape (assistant `toolCalls[]`, etc.). For
  // Anthropic's API contract we need the original LLMMessage with
  // `toolCalls` intact so tool_use → tool_result correlation survives.
  // `stripFrameworkFields` takes off `injectedBy` — the marker the delivery
  // stage stamps so the messages slot can say WHO put a message here — and
  // `notDispatched`, the batch settlement's marker (9.113.0). Both are
  // framework bookkeeping, not conversation, and are removed BEFORE the
  // request exists rather than trusted to be ignored: a consumer-authored
  // adapter that serializes a message wholesale would otherwise put library
  // internals on someone's wire. Stripping removes a FIELD, never a message,
  // so `messages[i]` is still the message the cache marker's index names.
  // `committed` keeps both markers for the readers below that must see them.
  const committed = (scope.history as readonly LLMMessage[] | undefined) ?? [];
  const projected = stripFrameworkFields(committed, true);
  // Receipt assembly keeps a stable list even when stripping returns a live array.
  const history = projected === committed ? [...projected] : projected;

  // ── the findings ledger, served (9.101.0, step 3) ──────────────────
  // ONE gated read of the committed key, used twice. The COLLAPSE rewrites,
  // on the wire only, the `content` of `role: 'tool'` messages the model
  // has already judged noise or ruled-out (facts too under the bench-gated
  // `'ledger-only'`) to a ticket with no model words in it — the
  // `placedToolResult` precedent. It runs HERE, before the staged-refs
  // nudge and before the receipt mint, so `findStagedRefs` reads the
  // conversation the model reads and the receipt hashes what was sent.
  // Count, order, `toolCallId` and `toolName` are unchanged, so
  // `messages[i]` is still the message the cache marker's index names and
  // The tool_use/tool_result pair remains valid. Collapse changes only the
  // wire copy, never committed history. Current declarations and advisory
  // IDs are composed later as request-only DATA, outside the cached prefix.
  // Both DATA and collapse read the committed twin, whose notDispatched
  // marker distinguishes a settlement notice from an actual result.
  const ledger =
    deps.hasFindingsLedger === true
      ? (scope.findingsLedger as FindingsLedger | undefined)
      : undefined;
  const collapsed =
    deps.hasFindingsLedger === true
      ? collapseJudged(committed, ledger, deps.findingsServe ?? 'ledger-and-facts')
      : committed;
  const rendered = collapsed === committed ? history : stripFrameworkFields(collapsed, true);
  // ── the declared ontology, served (9.106.0) ──────────────────────────
  // ONE gated read of the run constant seed wrote; the piece is a pure
  // function of the spec and nothing else (no call number, no clock — the
  // cached system-prefix contract), so an unchanged map serves unchanged bytes
  // on every call of the run. The composer is loaded through `import()` —
  // the optional-family law of docs-next's site budget (`toolCalls/evidence/judgeLanded.ts ·
  // judgeLanded`): an unarmed agent never loads the module. The event
  // carries identities and counts only.
  let ontologyPieceRecord: OntologyPiece | undefined;
  if (deps.ontology === true) {
    const record = scope.ontology as OntologyRecord | undefined;
    if (record !== undefined) {
      const { ontologyPiece } = await import('../../../../ontology/serve.js');
      // The join (9.108.0): the record's tool → skills map and this
      // iteration's hidden skill ids — the same filter every model-facing
      // sentence applies, so the piece names no skill the caller may not see.
      const hidden = scope.hiddenSkillIds as readonly string[] | undefined;
      ontologyPieceRecord = ontologyPiece(record.spec, {
        ...(record.tools !== undefined && { tools: record.tools }),
        ...(hidden !== undefined && { hiddenSkillIds: hidden }),
      });
      typedEmit(scope, 'agentfootprint.ontology.served', {
        iteration,
        id: record.id,
        version: record.version,
        hash: record.hash,
        nodes: Object.keys(record.spec.nodes).length,
        sources: Object.keys(record.spec.sources).length,
        edges: record.spec.edges.length,
      });
    }
  }
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
  //
  // The same seam withholds them once the evidence gate asked for its
  // revision under an ENFORCING answer validation
  // (`AgentState.toolsOffAfterRevision`): the answer may yet be withheld, so
  // no tool that writes or sends may run again, and the library cannot tell
  // one that only reads. Route refuses any call the model returns anyway.
  const withheld = toolsWithheld(
    scope.wrapUpAsked,
    deps.toolsOffAfterRevision === true ? scope.toolsOffAfterRevision : undefined,
  );
  const registeredToolSchemas =
    withheld !== null
      ? EMPTY_TOOL_SCHEMAS
      : (scope.dynamicToolSchemas as readonly LLMToolSchema[] | undefined) ?? deps.toolSchemas;
  const { replayFrames, closure, continuing, messages } = projectCallHistory(
    scope,
    history,
    rendered,
    recoveryPiece !== undefined && withheld !== null,
  );
  // The forced schema rides on the wire and in `llm_start`. Offered contracts
  // specialize the findings instruction in request-only copies that replay rebuilds.
  const recoveryNote =
    recoveryPiece !== undefined && continuing !== undefined && withheld === null
      ? recoveryFeedback(recoveryPiece.rawContent)
      : undefined;
  const systemRecovery = recoveryNote === undefined ? recoveryPiece : undefined;
  const systemPieces = projectSourceInstructions(
    systemRecovery === undefined && ontologyPieceRecord === undefined
      ? systemPromptInjections
      : [
          ...systemPromptInjections,
          ...(systemRecovery === undefined ? [] : [systemRecovery]),
          ...(ontologyPieceRecord === undefined ? [] : [ontologyPieceRecord]),
        ],
    registeredToolSchemas,
  );
  const systemPrompt = joinSystemPrompt(systemPieces);
  const activeToolSchemas = deps.schemaTool
    ? [...registeredToolSchemas, deps.schemaTool]
    : registeredToolSchemas;

  const freshNotes = requestOnlyMessages(scope, deps, {
    iteration,
    committed,
    messages,
    ledger,
    registeredToolSchemas,
    withheld,
  });
  const recoveryContext = closure ?? recoveryNote;
  const tail = recoveryContext === undefined ? freshNotes : [recoveryContext, ...freshNotes];
  const prefixWire = continuing?.wire ?? messages;
  const wireMessages =
    tail.length === 0 ? prefixWire : [...prefixWire, ...tail.map(({ message }) => message)];
  const requestOnly =
    continuing === undefined
      ? tail
      : [
          ...continuing.additions.map(({ message, reason, wireIndex }) => ({
            message,
            reason: `native-turn-prefix:${wireIndex}:${reason}`,
          })),
          ...tail,
        ];

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
  // Auto follows the actual provider/model, including cache-selected models
  // and each reliability fallback. Explicit strategies retain their refusals.
  const baseRequest = selectOutputFormat(
    {
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
      ...(deps.outputFormat !== undefined && { outputFormat: deps.outputFormat }),
    },
    provider,
    deps.nativeOutputAuto === true,
    deps.outputFormat,
  );
  // v2.6+ — call cache strategy to attach provider-specific cache
  // hints. CacheGate has already routed (apply-markers / no-markers)
  // and populated scope.cacheMarkers accordingly. Strategy.prepareRequest
  // is a pass-through for empty markers.
  // A custom strategy can create remote cache handles, so refuse a known
  // unsupported effective request before even that preparation does I/O.
  assertForcedRequestSupported(provider, baseRequest);
  const cacheMarkers = replayCacheMarkers(
    (scope.cacheMarkers as readonly CacheMarker[] | undefined) ?? [],
    continuing,
  );
  const detached = detachProviderInput(baseRequest, cacheMarkers, deps.outputFormat);
  const citations = prepareCitationProjection(
    scope,
    deps.offerCitations === true &&
      continuing === undefined &&
      deps.outputSchemaParser === undefined &&
      deps.outputFormat === undefined,
    committed,
    wireMessages,
    detached.request.messages,
  );
  const selection =
    deps.servedTools?.selection &&
    selectionAtRequest(deps, iteration, scope.$attempt?.(), baseRequest, withheld !== null);
  const serving =
    deps.recordReceipt === false
      ? undefined
      : servedRequestRecorder(scope, committed, messages, wireMessages, detached);
  const cachePrepared = await cacheStrategy.prepareRequest(detached.request, detached.markers, {
    iteration,
    iterationsRemaining: iterationsRemainingOf(deps.maxIterations, iteration),
    recentHitRate: scope.recentHitRate,
    cachingDisabled: scope.cachingDisabled ?? false,
  });
  const llmRequest = selectOutputFormat(
    cachePrepared.request,
    provider,
    deps.nativeOutputAuto === true,
    detached.outputFormat,
  );
  // Judge the final request on the effective brain/configured model, not
  // the agent's build-time default. This is before provider I/O and outside
  // the reliability loop: retrying cannot repair an unsupported contract.
  assertForcedRequestSupported(provider, llmRequest);

  // ── THE RECEIPT ──────────────────────────────────────────────────────
  // Written HERE, immediately before the provider is called, so it is
  // committed in the call-llm bundle that already exists — the llm-turn stop
  // a reader already scrubs to. Before rather than after on purpose: the
  // stage commits on the error path too, so a call that throws still leaves
  // the record of what it was about to send.
  //
  // Hashes and references only. Every law this record obeys — no bytes, no
  // authority omissions, run-salted digests — is stated once, at
  // `receipt.ts` · `Receipt`, and enforced by the shape it fills in.
  //
  // `omittedForAttention` comes from the WINDOW, through `deps.evictedTurns`
  // (9.93.0) — never from a scope read. The slots were the first place this
  // was looked for, and they drop nothing; the one measured pass that read
  // `slotCompositions` here put a tracked get of an always-absent key on
  // every call-llm stage's read set, which gave `trajectory.ts` a phantom
  // context source per loop and moved the localizer's ranking. The window's
  // `compactions` key is absent on every run without a window and would do
  // the same. A receipt records what the run knows; it does not go looking —
  // so the window hands the turns across, and an agent with no window hands
  // nothing.
  if (deps.recordReceipt !== false) {
    const evictedForAttention = deps.evictedTurns?.read(iteration) ?? [];
    const hostStrategy =
      deps.cacheStrategyIsOverride === true && cacheStrategy === deps.cacheStrategy;
    scope[RECEIPT_KEY] = buildReceipt(
      {
        runId: deps.getRunId?.() ?? '',
        epoch: iteration,
        model,
        provider: provider.name,
        systemText: systemPrompt,
        systemPieces: receiptPieces(systemPieces),
        messages,
        requestOnly,
        tools: activeToolSchemas,
        forced: deps.schemaTool?.name ?? null,
        // Read as it always was; the revision's rule rides `withheld`.
        withheld: scope.wrapUpAsked === true ? 'wrap-up' : withheld,
        baseRequest,
        preparedRequest: receiptProviderRequest(
          llmRequest,
          detached.request,
          baseRequest,
          hostStrategy,
        ),
        // The breakpoints the strategy really APPLIED, not the candidates it
        // was offered. `scope.cacheMarkers` already records the offer; which of
        // them survived the provider's clamp is the half that decides the bill,
        // and it existed only in this local until now.
        markersApplied: cachePrepared.markersApplied,
        // WHICH strategy the request went through — its `name`, which for the
        // built-ins is the capability the provider declared (`'breakpoints'`,
        // `'automatic'`, `'none'` for the pass-through). Every agent has one,
        // so this is never `null` here; the charts that run none say `null` at
        // their own mints. A strategy handed in past the type with no `name`
        // is still a strategy, and is recorded as one under the empty name
        // rather than denied.
        strategy: typeof cacheStrategy.name === 'string' ? cacheStrategy.name : '',
        ...(evictedForAttention.length > 0 && { omittedForAttention: evictedForAttention }),
      },
      // Host strategies can reissue their own objects with nested edits.
      hostStrategy ? undefined : deps.receiptDigests,
    );
  }

  recordModelContext(scope, () => ({
    iteration,
    systemPieces,
    tools: activeToolSchemas,
    requestOnly: freshNotes,
  }));

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
      // The frame's tool messages, named from `committed` — the stage's ONE
      // read of `scope.history`, at its top — rather than
      // `llmRequest.messages`: the same messages in the same order
      // (stripping removes a FIELD, never a message; the collapse rewrites
      // `content` only; the staged-refs nudge is a `role: 'user'` line that
      // names no tool), but the wire has lost the batch settlement's marker
      // (9.113.0), and a settled sentence is no fresh result — the helper
      // says so only when it can see `LLMMessage.notDispatched`
      // (`window/toolNames.ts` · "A settled message is not a result at
      // all"). Never a second `scope.history` read: every tracked read is a
      // narrative step, and one more here renumbered every step after it on
      // runs that never settle anything (pinned by
      // `src/integrity/dangling-reference/danglingReference.test.ts` · "the narrative").
      const frame = committed;
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
      fileIntegrityFindings(scope, danglingFindings, iteration, deps.integrityLedger);
    } else {
      // No grounded tool served, or nothing has dropped: nothing this call
      // could violate — stated, never silence.
      deps.integrityLedger?.current?.note('dangling-reference', 'compose', 'not-applicable');
    }
  }

  return {
    citations,
    baseRequest,
    peel,
    systemPromptInjections,
    systemPieces,
    iteration,
    provider,
    model,
    recoveryPiece,
    committed,
    history,
    systemRecovery,
    systemPrompt,
    trustedSystemPrompt,
    activeToolSchemas,
    tail,
    continuing,
    wireMessages,
    replayFrames,
    detached,
    selection,
    serving,
    llmRequest,
    startMs,
    messages,
  };
}

export type PreparedCall = Awaited<ReturnType<typeof prepareCall>>;
