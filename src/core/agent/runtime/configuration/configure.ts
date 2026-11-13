import { type AroundTurn } from '../../aroundTurn/index.js';
import { findingsContextBytes } from '../../findings/context.js';
import type { CachePolicy, CacheStrategy } from '../../../../cache/types.js';
import type { ReliabilityConfig } from '../../../../reliability/types.js';
import { cacheStrategyFor } from '../../../../cache/cacheStrategyFor.js';
import { cacheRequestedWithoutSupport } from '../../cacheSupport.js';
import { registerConsentLedger, registerConsentRules } from '../../../consentRequest.js';
import { assertArtifactPlacement } from '../../../../artifacts/placement.js';
import { assertRedactionPolicy } from '../../../../redaction/policy.js';
import { declareRedaction } from '../../../../redaction/declared.js';
import { TOOL_TEARDOWN_TIMEOUT_MS } from '../../../../tools/toolSessions.js';
import type { SkillGraphDeclaredMap } from '../../skillGraphDeclared.js';
import type { AppliedRecipe } from '../../../../recipes/types.js';
import { requireKeepLastToolResults } from '../../window/options.js';
import type { WindowStrategy } from '../../window/strategy.js';
import { resolveCheckInConfig, type CheckInBuilderOptions } from '../../../checkin.js';
import { assertCostBudgetHasPricing, resolveCostBudget } from '../../../cost.js';
import type { MemoryDefinition } from '../../../../memory/define.types.js';
import type { ResolvedEvidenceGate } from '../../evidence/types.js';
import type { ResolvedScriptTravel } from '../../scripts/types.js';
import type { Injection, InjectionContext } from '../../../../injection-engine/types.js';
import type {
  CursorMove,
  EntryScoring,
  TurnRoutingPlan,
} from '../../../../injection-engine/skillGraph.js';
import { type ResolvedOutputFallback } from '../../../outputFallback.js';
import { type OutputSchemaParser } from '../../../../answer-validation/outputSchema.js';
import { readTimeOptions } from '../../../../time/clock.js';
import type { ResolvedOutputEnforcement } from '../../outputEnforcement.js';
import type { ToolRegistryEntry } from '../../../../tools/tools.js';
import type { ToolProvider } from '../../../../tools/toolProvider.js';
import {
  clampIterations,
  validateMemoryIdUniqueness,
  validateToolNameUniqueness,
} from '../../validators.js';
import type { AgentOptions, RunConfigFn } from '../../types.js';
import type { ResolvedNegativeClaims } from '../../negativeClaims/config.js';
import {
  type ResolvedAnswerValidation,
  resolveAnswerValidation,
} from '../../../../answer-validation/index.js';
import type { MessageMiddleware, ToolMiddleware } from '../../middleware/types.js';
import { readInputsLayerOption } from '../../honesty/armed.js';
import { readsMessageFrom } from '../../../messageFrom.js';
import { readsParentRun } from '../../../memberRun.js';
import { assertMaxToolResultChars } from '../../toolResultCap.js';
import { thinkingForProviders } from '../../../../thinking/dispatch.js';
import type { ThinkingHandler } from '../../../../thinking/types.js';
import { requireKeepLedgerFacts, resolveKeepLedgerFacts } from '../../run/ledgerFacts.js';
import type { Runner } from '../../../runner.js';
import type { AgentConfigurationValues } from './values.js';

/** Public identity remains on the original runner, at its existing construction points. */
interface AgentIdentity {
  name: string;
  id: string;
  appName: string;
  commentaryTemplates: Readonly<Record<string, string>>;
  thinkingTemplates: Readonly<Record<string, string>>;
}

/** Resolve and validate constructor inputs in their original evaluation order. */
export function configureAgent(
  config: AgentConfigurationValues,
  runner: Runner & AgentIdentity,
  opts: AgentOptions,
  systemPromptValue: string,
  registry: readonly ToolRegistryEntry[],
  voice: {
    readonly appName: string;
    readonly commentaryTemplates: Readonly<Record<string, string>>;
    readonly thinkingTemplates: Readonly<Record<string, string>>;
  },
  injections: readonly Injection[] = [],
  memories: readonly MemoryDefinition[] = [],
  outputSchemaParser?: OutputSchemaParser<unknown>,
  toolProvider?: ToolProvider,
  systemPromptCachePolicy: CachePolicy = 'always',
  cachingDisabled = false,
  cacheStrategy?: CacheStrategy,
  outputFallbackCfg?: ResolvedOutputFallback<unknown>,
  reliabilityConfig?: ReliabilityConfig,
  thinkingHandlerValue?: ThinkingHandler | null,
  thinkingBudgetValue?: number,
  skillGraphNextSkill?: (ctx: InjectionContext) => string | undefined,
  skillGraphReachable?: (currentSkillId?: string) => readonly string[],
  skillGraphScoreEntries?: (ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring>,
  checkInOptions?: CheckInBuilderOptions,
  runConfigFn?: RunConfigFn,
  windowStrategy?: WindowStrategy,
  toolMiddleware?: readonly ToolMiddleware[],
  messageMiddleware?: readonly MessageMiddleware[],
  outputEnforcement?: ResolvedOutputEnforcement,
  skillGraphEdgeTargets?: readonly string[],
  skillGraphExplainNextSkill?: (ctx: InjectionContext) => CursorMove,
  skillGraphIsTree?: boolean,
  skillGraphSupersededEntries?: (ctx: InjectionContext) => readonly string[],
  skillGraphCascade?: {
    readonly turnRouting?: TurnRoutingPlan;
    readonly strictness: 'assist' | 'guard' | 'rails';
    readonly continuity: 'turn' | 'conversation';
    readonly nodeIds: ReadonlySet<string>;
  },
  skillBrains?: import('../../skillBrains.js').FoldedSkillBrains,
  evidenceGate?: ResolvedEvidenceGate,
  limitsTravelWithTheAnswer?: boolean,
  recipes?: readonly AppliedRecipe[],
  skillGraphDeclared?: SkillGraphDeclaredMap,
  mapsPlan?: import('../../../../maps/engagement/types.js').EngagementPlan,
  claimContract?: readonly import('../../../../integrity/unsupported-claim/check.js').DeclaredClaim[],
  answerValidationConfig?: ResolvedAnswerValidation,
  systemPromptCacheExplicit = false,
  negativeClaimsConfig?: ResolvedNegativeClaims,
  scriptTravel?: ResolvedScriptTravel,
  aroundTurn?: AroundTurn,
): void {
  config.negativeClaimsConfig = negativeClaimsConfig;
  config.typedNegativeClaimsConfig =
    negativeClaimsConfig?.mode === 'typed' ? negativeClaimsConfig : undefined;
  config.applicationAnswerValidation = answerValidationConfig !== undefined;
  config.answerValidationConfig =
    answerValidationConfig ??
    (config.typedNegativeClaimsConfig === undefined
      ? undefined
      : resolveAnswerValidation({
          id: 'negative-claims',
          version: '1',
          mode: 'observe',
          validate: () => ({ checks: [] }),
        }));
  config.provider = opts.provider;
  runner.name = opts.name ?? 'Agent';
  runner.id = opts.id ?? 'agent';
  if (opts.id !== undefined) config.explicitId = opts.id;
  config.model = opts.model;
  config.temperature = opts.temperature;
  config.maxTokens = opts.maxTokens;
  config.maxIterations = clampIterations(opts.maxIterations ?? 10);
  config.structureRecorders = opts.structureRecorders;
  config.agentGroupTranslator = opts.groupTranslator;
  config.reactMode = opts.reactMode ?? 'dynamic';
  config.systemPromptValue = systemPromptValue;
  config.systemPromptCachePolicy = systemPromptCachePolicy;
  config.cachingDisabledValue = cachingDisabled;
  // The strategy the provider's DECLARED prompt caching selects, unless the
  // caller overrides it — never one looked up by `provider.name`, which a
  // renaming decorator (`withRetry`, an app's own wrapper) rewrites. A
  // provider that declares nothing gets the no-op strategy.
  config.cacheStrategy = cacheStrategy ?? cacheStrategyFor(opts.provider, opts.model);
  config.cacheStrategyIsOverride = cacheStrategy !== undefined;
  config.cacheUnsupported = cacheRequestedWithoutSupport({
    strategy: config.cacheStrategy,
    providerName: opts.provider.name,
    systemPrompt: systemPromptValue,
    systemPolicy: systemPromptCachePolicy,
    systemExplicit: systemPromptCacheExplicit,
    modelAwareUnavailable:
      cacheStrategy === undefined &&
      typeof opts.provider.promptCaching === 'function' &&
      config.cacheStrategy.name === 'none',
    injections,
    disabled: cachingDisabled,
  });
  config.registry = registry;
  config.injections = injections;
  config.skillGraphNextSkill = skillGraphNextSkill;
  config.skillGraphReachable = skillGraphReachable;
  config.skillGraphScoreEntries = skillGraphScoreEntries;
  config.skillGraphEdgeTargets = new Set(skillGraphEdgeTargets ?? []);
  config.skillGraphExplainNextSkill = skillGraphExplainNextSkill;
  config.skillGraphSupersededEntries = skillGraphSupersededEntries;
  config.skillGraphIsTree = skillGraphIsTree ?? false;
  config.skillGraphCascade = skillGraphCascade;
  config.skillBrains = skillBrains;
  // Under an enforcing answer validation the gate's revision calls no tools
  // (`ResolvedEvidenceGate.toolsOffAfterRevision`): one fact on the one gate
  // every reader is already handed.
  config.evidenceGate =
    evidenceGate !== undefined &&
    evidenceGate.posture !== 'assist' &&
    (answerValidationConfig?.mode === 'enforce' || config.typedNegativeClaimsConfig !== undefined)
      ? { ...evidenceGate, toolsOffAfterRevision: true }
      : evidenceGate;
  config.limitsTravelWithTheAnswerValue = limitsTravelWithTheAnswer === true;
  config.scriptTravel = scriptTravel;
  config.appliedRecipes = recipes;
  config.skillGraphDeclared = skillGraphDeclared;
  config.mapsPlan = mapsPlan;
  config.claimContract = claimContract;
  if (opts.recordSystemPrompt === true) config.recordSystemPromptValue = true;
  // The receipt's OFF SWITCH (9.88.0). Default ON, so only an explicit
  // `false` is remembered and every other agent's dep bag is byte-identical.
  if (opts.recordReceipt === false) config.recordReceiptValue = false;
  config.memories = memories;
  config.outputSchemaParser = outputSchemaParser;
  config.outputEnforcement = outputEnforcement;
  config.outputFallbackCfg = outputFallbackCfg;
  config.externalToolProvider = toolProvider;
  // Eager validation: tool names must be unique across .tool() +
  // every Skill.inject.tools — the LLM dispatches by name. Runs in
  // constructor so `Agent.build()` throws immediately on collision,
  // not at first run().
  validateToolNameUniqueness(registry, injections);
  // Eager validation: memory ids must be unique so per-id scope keys
  // (`memoryInjection_${id}`) don't collide.
  validateMemoryIdUniqueness(memories);
  // A dial without its switch — refused rather than run as a no-op (8.13.0).
  // Same policy as `observerDeliveryOptions` below; the message and the check
  // are shared with LLMCall, which takes the identical pair.
  assertCostBudgetHasPricing('Agent', opts.pricingTable, opts.costBudget);
  if (opts.pricingTable) config.pricingTable = opts.pricingTable;
  // Normalized once, at build: `onExceed` decides whether the Route decider
  // stops the loop, and a policy resolved per-run could differ per-run.
  const resolvedCostBudget = resolveCostBudget('Agent', opts.costBudget);
  if (resolvedCostBudget !== undefined) config.costBudget = resolvedCostBudget;
  if (opts.contextBudget !== undefined) config.contextBudget = opts.contextBudget;
  if (opts.permissionChecker) config.permissionChecker = opts.permissionChecker;
  if (opts.toolArgValidation !== undefined) config.toolArgValidation = opts.toolArgValidation;
  if (opts.findings !== undefined)
    config.findingsOptions = {
      ...opts.findings,
      maxContextBytes: findingsContextBytes(opts.findings.maxContextBytes),
    };
  // The inputs layer's door (honesty layer 2): `true`, or `{ argumentSources }`
  // — either form mounts the layer; the object form may also arm declared
  // sources without the findings ledger.
  const inputsLayer = readInputsLayerOption(opts.inputsLayer);
  if (inputsLayer !== undefined) config.inputsLayerOption = true;
  if (opts.resultsLayer === true) config.resultsLayerOption = true;
  if (opts.answerLayer === true) config.answerLayerOption = {};
  else if (typeof opts.answerLayer === 'object' && opts.answerLayer !== null) {
    // The builder judged the option (`assessment/answerLayerOptions.ts` · `answerLayerArm`); `true` is 'always'.
    const line = opts.answerLayer.standingLine;
    config.answerLayerOption =
      line === true
        ? { standingLine: 'always' }
        : typeof line === 'object' && line !== null
        ? { standingLine: line.when }
        : {};
  }
  // The time layer's door (`.time()` / `AgentOptions.time`): `true` or the
  // options, read once; a malformed zone is refused here, at build.
  if (opts.time !== undefined) {
    const read = readTimeOptions(opts.time === true ? undefined : opts.time);
    if ('problem' in read) throw new Error(`Agent: time ${read.problem}.`);
    config.timeOptions = read.value;
    // The reader reads only a person's message — a composition hands the
    // `messageFrom: 'composed'` marker only to a runner that reads it.
    if (read.value.reader !== undefined) readsMessageFrom(runner);
  }
  if (opts.findings?.argumentSources === true || inputsLayer?.argumentSources === true) {
    config.argumentSourcesArmed = true;
    // Declared sources read `AgentInput.messageFrom` — a composition hands
    // the marker only to a runner that reads it.
    readsMessageFrom(runner);
  }
  // A member runs for the run that mounted it: a composition hands it that
  // run as `parentRun` (`core/memberRun.ts`).
  readsParentRun(runner);
  if (opts.argumentAskContext !== undefined) config.argumentAskContext = opts.argumentAskContext;
  if (opts.toolChoice !== undefined) config.toolChoiceOptions = opts.toolChoice;
  if (opts.ontology !== undefined) config.ontology = opts.ontology;
  // The tool-result ceiling (9.11.0). Refused HERE, naming the value, rather
  // than at the first tool call of the first run — a dial that cannot cap
  // anything is a configuration mistake, not a runtime condition.
  assertMaxToolResultChars('Agent', opts.maxToolResultChars);
  if (opts.maxToolResultChars !== undefined) config.maxToolResultChars = opts.maxToolResultChars;
  // Resolve check-in config once. Always present (default: standard evidence
  // + lexical scorer) so a `checkIn`-declaring tool works even without a
  // `.checkIn()` call; the gate only fires for tools that declared `checkIn`.
  config.checkInConfig = resolveCheckInConfig(checkInOptions);
  // Refused HERE, not at the first resume: a ledger that cannot spend would
  // refuse every decision, and that is a configuration mistake.
  if (opts.decisionLedger !== undefined) {
    if (typeof (opts.decisionLedger as { spend?: unknown } | null)?.spend !== 'function') {
      throw new TypeError(
        'Agent: `decisionLedger` must have a `spend(requestId)` method — see ' +
          "`DecisionLedger`, or omit it for this process's in-memory ledger.",
      );
    }
    config.decisionLedger = opts.decisionLedger;
  }
  if (runConfigFn !== undefined) config.runConfigFn = runConfigFn;
  // `.window()` / `.compaction()`: the meter is created ONCE per agent
  // (attached per run, cleared between runs like every other recorder)
  // because the window stage closes over it at chart-build time — and the
  // chart is built once.
  if (windowStrategy !== undefined) config.windowStrategy = windowStrategy;
  // The two governance chains. Empty arrays (not undefined) so every read
  // site is a plain `.length > 0` test rather than an optional dance.
  config.toolMiddleware = toolMiddleware ?? [];
  // What an ask's approval holds to, for a host that keeps this agent's
  // pauses and must tell one no answer can reach (`consentRequest.ts`).
  registerConsentRules(runner, () => config.toolMiddleware.map((link) => link.name));
  // …and the ledger it spends decisions in, so that host can tell a paused
  // call that provably never ran from one whose outcome is not known.
  registerConsentLedger(runner, config.decisionLedger);
  config.messageMiddleware = messageMiddleware ?? [];
  config.aroundTurnPort = aroundTurn;
  // Default 'summary' — measurement-gated (#18): stageReads values have
  // zero consumers across af/lens/eui, and 'full' clones ~18MB of unread
  // data per 200 iterations. Consumers opt into 'full' explicitly.
  config.readTracking = opts.readTracking ?? 'summary';
  // Default 'delta' — the accepted #13c-B design: agentfootprint opts in
  // immediately (the agent's history-append workload is exactly the case
  // the verb exists for; reconstruction stays lossless via commitValueAt).
  config.commitValues = opts.commitValues ?? 'delta';
  // Default 'off' — the debugging dial is opt-in: on, every write also
  // records the keys read before it, which is what upgrades `traceVariable`
  // to `coverage: 'exact'` and lets `walkToRoot` hop by recorded dataflow
  // instead of embedding similarity.
  config.writeProvenance = opts.writeProvenance ?? 'off';
  // The redaction door: refused here, where it was declared, when it is not
  // a policy footprintjs can apply — then declared for every run of this
  // agent and of any composition that mounts it (`src/redaction/declared.ts`).
  if (opts.redact !== undefined) {
    assertRedactionPolicy(opts.redact, 'Agent.create');
    declareRedaction(runner, opts.redact);
  }
  // RFC-001 Block 10 — observer delivery tier. Fail fast on the dials
  // without the switch (no silently-ignored combinations; same policy
  // that merged reactMode/reactStructure in 6.0.0).
  config.observerDelivery = opts.observerDelivery ?? 'inline';
  if (opts.observerDeliveryOptions !== undefined && config.observerDelivery !== 'deferred') {
    throw new Error(
      "Agent: observerDeliveryOptions requires observerDelivery: 'deferred' — " +
        'the dials configure the deferred capture queue and have no meaning inline.',
    );
  }
  config.observerDeliveryOptions = opts.observerDeliveryOptions;
  if (opts.credentials) config.credentialProvider = opts.credentials;
  // Kept only when it says something: `undefined` and `true` are the same
  // default, and storing `true` would make the thread-when-off rule below
  // read as a coincidence.
  if (opts.repeatedCallNudge === false) config.repeatedCallNudge = false;
  // Same discipline (9.56.0): `undefined` and `true` are the same default, so
  // only a deliberate opt-out is stored — which keeps the conditional mount
  // below reading as the decision it is.
  if (opts.wrapUpAtMaxIterations === false) config.wrapUpAtMaxIterations = false;
  // Same discipline (9.57.0): the default is 2, so only a value the
  // operator actually named is stored — which keeps the value-conditional
  // thread into the window stage reading as the decision it is. Refused at
  // construction, never mid-run.
  if (opts.keepLastToolResults !== undefined) {
    requireKeepLastToolResults(opts.keepLastToolResults, 'Agent');
    config.keepLastToolResults = opts.keepLastToolResults;
  }
  // Its content-aware sibling (9.102.0). The top-level door is refused
  // HERE, whether or not `.findings()` is on — a dial that is silently
  // ignored is a configuration mistake, not a runtime condition (the
  // `.findings()` door was refused by the builder). The value is resolved
  // ONCE, under the arm only: the `.findings()` door wins when both are
  // given, `false` is `0`, nothing named is the default. Without
  // `.findings()` there is no ledger to hold facts from, so the option is
  // accepted and does nothing — the keepLastToolResults-without-a-window
  // precedent.
  if (opts.keepLedgerFacts !== undefined) requireKeepLedgerFacts(opts.keepLedgerFacts, 'Agent');
  if (config.findingsOptions !== undefined) {
    // Keep the supported findings execution modes explicit. This change
    // restores prefix caching; it does not add findings support to classic.
    if (config.reactMode === 'classic') {
      throw new Error(
        "Agent: .findings() is supported in 'dynamic' and 'dynamic-grouped' modes only; reactMode 'classic' is not supported.",
      );
    }
    config.keepLedgerFacts = resolveKeepLedgerFacts(
      config.findingsOptions.keepLedgerFacts ?? opts.keepLedgerFacts,
    );
  }
  // Tool choice by classifier (9.105.0) needs the same per-call recomposition
  // the ledger does — the pick is made where the served list is built, and
  // a narrowed list committed on turn 1 would be served on every later call
  // with no pick behind it. The same refusal, at the same place.
  if (config.toolChoiceOptions !== undefined && config.reactMode === 'classic') {
    throw new Error(
      "Agent: .toolChoice() requires per-iteration slot recomposition — reactMode 'classic' " +
        'caches the tools slot on turn 1, so the classifier would be asked once and a narrowed ' +
        "list would be served on every later call. Use the default 'dynamic' mode (or " +
        "'dynamic-grouped').",
    );
  }
  // Refused at construction, never mid-run — a misspelled posture that was
  // ignored would leave the liveness theorems switched off in an agent
  // that believes they are on (the concurrency-mode precedent).
  if (opts.integrityPosture !== undefined) {
    if (opts.integrityPosture !== 'observe' && opts.integrityPosture !== 'dev') {
      throw new Error(
        `Agent: integrityPosture must be 'observe' or 'dev', got ` +
          `${JSON.stringify(opts.integrityPosture)}.`,
      );
    }
    config.integrityPosture = opts.integrityPosture;
  }
  // The external-ground door (9.72.0) — refused at construction, never
  // mid-run: a non-function here would otherwise fail on the first LLM call
  // of the first armed run, far from the line that caused it.
  if (opts.externalGrounds !== undefined) {
    if (typeof opts.externalGrounds !== 'function') {
      throw new Error(
        `Agent: externalGrounds must be a function returning {value, source} entries, got ` +
          `${typeof opts.externalGrounds}.`,
      );
    }
    config.externalGrounds = opts.externalGrounds;
  }
  // The write-seam advisory's dial (9.77.0) — refused at construction for
  // the same reason as the posture above: a truthy non-boolean here (a
  // string, a number) would silently arm a check the author only half
  // asked for, and the arming is what decides whether a run is
  // byte-identical to the one before it.
  if (opts.noticeEmptyLookups !== undefined) {
    if (typeof opts.noticeEmptyLookups !== 'boolean') {
      throw new Error(
        `Agent: noticeEmptyLookups must be a boolean, got ` +
          `${JSON.stringify(opts.noticeEmptyLookups)}. It arms the write-seam 'empty-lookup' ` +
          `advisory — a lookup for a value this run itself produced coming back empty. ` +
          `Omit it (or pass false) and no such advisory is ever filed.`,
      );
    }
    config.noticeEmptyLookups = opts.noticeEmptyLookups;
  }
  // The claim seam's recency dial (9.83.0) — refused at construction for
  // the same reason as the write-seam one above: a truthy non-boolean here
  // would silently arm a check the author only half asked for, and the
  // arming is what decides whether a run is byte-identical to the one
  // before it.
  if (opts.noticePriorTurnEvidence !== undefined) {
    if (typeof opts.noticePriorTurnEvidence !== 'boolean') {
      throw new Error(
        `Agent: noticePriorTurnEvidence must be a boolean, got ` +
          `${JSON.stringify(opts.noticePriorTurnEvidence)}. It arms the claim-seam ` +
          `'prior-turn-evidence' advisory — a final answer whose every value was last served ` +
          `before this turn — and it needs \`.namesAndNumbersFromEvidence()\` armed beside ` +
          `it, because that gate owns the extractor that decides which tokens are values. ` +
          `Omit it (or pass false) and no such advisory is ever filed.`,
      );
    }
    config.noticePriorTurnEvidence = opts.noticePriorTurnEvidence;
  }
  // The column-type contract's dial (9.78.0) — refused at construction for
  // the same reason as the postures above, and with one more: `'enforce'`
  // REFUSES tool results, so a misspelling silently downgraded to off would
  // leave an operator believing a boundary is held that nothing is holding.
  if (opts.checkColumnTypes !== undefined) {
    if (
      opts.checkColumnTypes !== 'off' &&
      opts.checkColumnTypes !== 'warn' &&
      opts.checkColumnTypes !== 'enforce'
    ) {
      throw new Error(
        `Agent: checkColumnTypes must be 'off', 'warn' or 'enforce', got ` +
          `${JSON.stringify(opts.checkColumnTypes)}. It reads each tool's declared ` +
          `\`resultColumns\` and judges the rows it returns: 'warn' files findings and ` +
          `changes nothing the model reads; 'enforce' refuses the rows and hands the model a ` +
          `teaching sentence instead. Omit it (or pass 'off') and nothing is ever measured.`,
      );
    }
    config.checkColumnTypes = opts.checkColumnTypes;
  }
  // The claim-check seam (9.21.0). One store per agent, attached at
  // construction — idempotent by shape: there is no second door to attach a
  // competing one through, so "one per agent" is a fact of the type rather
  // than a runtime check. Since 9.22.0 the option also takes the object
  // form `{ store, placement? }` — normalized HERE so every downstream
  // reader keeps seeing exactly one store and one optional dial.
  if (opts.artifacts) {
    if ('store' in opts.artifacts) {
      // The object form. A shape with `placement` but no store cannot be
      // SPELLED in TypeScript, but plain JavaScript can hand us one — and a
      // threshold with nowhere to put what it catches is configuration
      // that lies, so it is refused by name rather than half-read.
      if (opts.artifacts.store === undefined || opts.artifacts.store === null) {
        throw new Error(
          'Agent: artifacts was passed in its object form without a `store`. The placement ' +
            'threshold refs results INTO the store, so it cannot exist without one — pass ' +
            '`artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars } }` (or ' +
            'fileArtifacts / sqliteArtifacts / any ArtifactStore), or drop `artifacts`.',
        );
      }
      assertArtifactPlacement('Agent', opts.artifacts.placement);
      config.artifactStore = opts.artifacts.store;
      if (opts.artifacts.placement !== undefined) {
        config.artifactPlacement = opts.artifacts.placement;
      }
      // The recordings dial (9.26.0). `true` and `{ … }` normalize to ONE
      // shape here, so every downstream reader asks a single question
      // ("is there a recordings option?") rather than re-deriving the union.
      if (opts.artifacts.recordings === true) {
        config.artifactRecordings = {};
      } else if (
        typeof opts.artifacts.recordings === 'object' &&
        opts.artifacts.recordings !== null
      ) {
        config.artifactRecordings = opts.artifacts.recordings;
      }
    } else {
      config.artifactStore = opts.artifacts;
    }
  }
  // The third dial-without-its-switch (8.13.0). `onAuthorizationRequired` is
  // read at exactly one place — the tool-dispatch loop, AFTER
  // `credentials.getCredential` came back `authorization-required`. With no
  // provider that call never returns at all: the fail-closed stand-in
  // (`unconfiguredCredentialProvider`) rejects, so the branch this option
  // governs is unreachable and the setting decides nothing.
  if (opts.onAuthorizationRequired !== undefined && opts.credentials === undefined) {
    throw new Error(
      'Agent: onAuthorizationRequired was set without a `credentials` provider, so it can ' +
        'never be reached — it decides what happens when a DECLARED credential comes back ' +
        "'authorization-required', and with no provider no credential is ever requested (the " +
        'fail-closed stand-in throws instead). Pass `credentials` — agentCoreIdentity({ ' +
        'region }), staticTokens({ … }), or any CredentialProvider from ' +
        "'agentfootprint/security' — or drop `onAuthorizationRequired`.",
    );
  }
  // 8.6.0 — default `'pause'`: consent is work waiting on a person, and the
  // model is the one party that cannot click a link.
  config.onAuthorizationRequired = opts.onAuthorizationRequired ?? 'pause';
  // 9.7.0 — teardown is on the SIGTERM path, so it is bounded by default.
  config.toolTeardownTimeoutMs = opts.toolTeardownTimeoutMs ?? TOOL_TEARDOWN_TIMEOUT_MS;
  if (reliabilityConfig !== undefined) config.reliabilityConfig = reliabilityConfig;
  // v2.14 — Resolve thinking handler. Three states:
  //   - thinkingHandlerValue === undefined → the provider's DECLARED handler
  //   - thinkingHandlerValue === null      → opt out (no handler)
  //   - thinkingHandlerValue: ThinkingHandler → explicit override
  // A provider that declares none gets no subflow at chart build time.
  // Never chosen by `provider.name`: a renaming wrapper that forwards the
  // declaration keeps it.
  const handler = thinkingForProviders(
    opts.provider,
    reliabilityConfig?.providers?.map((entry) => entry.provider),
    thinkingHandlerValue,
  );
  if (handler !== undefined) config.thinkingHandler = handler;
  if (thinkingBudgetValue !== undefined) config.thinkingBudget = thinkingBudgetValue;
  runner.appName = voice.appName;
  runner.commentaryTemplates = voice.commentaryTemplates;
  runner.thinkingTemplates = voice.thinkingTemplates;
}
