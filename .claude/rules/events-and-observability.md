---
paths:
  - "src/events/**"
  - "src/events.ts"
  - "src/recorders/**"
  - "src/observability/**"
  - "src/strategies/**"
  - "src/bridge/**"
  - "src/lib/conventions.ts"
  - "src/observe.ts"
  - "src/debug/**"
  - "src/context-bisect/**"
  - "src/trace-toolpack/**"
  - "src/lib/traceToolNames.ts"
  - "src/context-ledger/**"
---
# Events, recorders and observability — seams and blast radius

Loaded only when you work on the paths above — moved verbatim out of the root CLAUDE.md so it costs context only where it applies. **Trust the code** where this disagrees.

## Extension points
- **Recorder, 3 layers**: (1) raw footprintjs CombinedRecorder via `agent.attach()` (RunnerBase.ts:474 — NOT idempotent); (2) typed stream `agent.on(type|'*')`; (3) new built-in = factory taking `{dispatcher, getRunContext}`, registered in the attach block inside `Agent.run()` (Agent.ts:807-845), barreled in src/observe.ts.
- **New typed event (3-step)**: payload interface in events/payloads.ts + entry in `AgentfootprintEventMap` (registry.ts:198) + append to `ALL_EVENT_TYPES` (registry.ts:488, count-asserted by tests). New DOMAIN also needs a bridge attach in admitted Agent setup or emits never reach the dispatcher — AND a hand-edit to `DomainWildcard` (dispatcher.ts:67-90; still missing validation/reliability). **9.4.0 worked example of BOTH halves missing at once**: `credential.*` had payloads, registry entries and live emit sites since 6.11.0 with no bridge and no wildcard, so `agent.on('agentfootprint.credential.failed')` observed nothing for eight minors — the silence in which an identity adapter failed 100% of its calls. Fixed by `credentialRecorder` (recorders/core/CredentialRecorder.ts) + the wildcard arm.
- **Strategy (vendor sink)**: shapes in strategies/types.ts (Observability :130, Cost :169, LiveStatus :201, Lens :234); attach by INSTANCE only — `agent.enable.observability({ strategy })` (strategies/attach.ts). There is no by-name/`vendor` path: `strategies/registry.ts` declared one for years, nothing ever called it, and it was deleted rather than finished. Do NOT model this on `registerCacheStrategy` (cache/strategyRegistry.ts), which is real — a cache vendor self-registers on side-effect import, so a name is the only handle a consumer has there. New vendor = export from observability-providers.ts, NOT a new subpath.
- **Finder** (context-error localization): conform to `Finder` (observability/contextError/finders/types.ts:92); NO registry by design — one file + barrel line. Pluggable `InfluenceScorer` via `localizeContextBug({scorer})` (context-bisect/localize.ts:340).

## Change-impact map
- **conventions.ts** (STAGE_IDS/SUBFLOW_IDS/INJECTION_KEYS) → chart builders that mount by id, ContextRecorder slot attribution, localizer loop-head detection (context-bisect/trajectory.ts:17-33), `stageRole`/`milestoneFor` (Lens contract), BoundaryRecorder. Renaming an id is the whole blast radius.
- **BoundaryRecorder wiring is THREE connections, all at record time**: `runner.attach` (boundaries), `.subscribe(runner)` (what's inside them), `{getCommitCount}` (where each sits on the commit axis). The third fails SILENTLY — every event stamps `commitIdxBefore: 0`, `boundaryIndex` stays empty by design, and an offline step strip has nothing to place. Unrecoverable after the run (the commit log never records WHEN a boundary was crossed). Wired by `attachFlowchart` (which `enable.flowchart`/`enable.localObservability` both go through) and by `recordRun`; a new entry point must pass all three.
- **events/** → 130 typed events across 27 domains (counts anti-drift-tested against this file — update BOTH when adding events): ALL_EVENT_TYPES exhaustiveness tests, DomainWildcard hand-list, ~42 importers (recorders, strategies, stream, commentary).
- **`EventMeta`** → the type lives in `events/types.ts`; `bridge/eventMeta.ts` builds it from captured `RunnerExecution` native origin and metadata. Host identity/request data is copied under admission or taken from the actual native parent scope, never a latest-run fallback. Private component computation happens before one served native emit; deferred public delivery cannot become a component's accumulator. Sinks that map fields must still add new fields explicitly.


## Module contract: recorders/core/

bridges footprintjs events → typed EventDispatcher (ContextRecorder, EmitBridge, typedEmit) — attached by admitted Agent run setup; most factories also exported via `/observe` for manual wiring (EmitBridge itself stays internal)


## Module contract: recorders/observability/

consumer recorders over the typed stream (RunStepRecorder, FlowchartRecorder, Status, Trace replay) + `recordRun` — THE producer of a recording `{snapshot, events, structure}` (the shape lens's `observeRecording` consumes; `structure` = `getSpec().buildTimeStructure`, which no snapshot carries). Anything that saves a run goes through it


## Module contract: context-bisect/

localizeContextBug, toBacktrackTrace + sliceToBacktrackTrace — the reader's board serializers


## Module contract: context-ledger/

which pieces EARNED their tokens — post-run offers/uses/outcomes bookkeeping + demote-never-starve gates `ledgerToolGate`/`ledgerEntryScorer`/`ledgerGated`; grouped-mode folds sf-llm-call inner logs, unmeterable runs → undefined; /observe


## Module contract: influence-core/

the ONE embedding-based scoring engine (`scoreInfluence`, `scoreMargin`, `scoreContrastiveInfluence`, the shared embedding cache): every score a deterministic PROXY, never causal attribution; read by the finders, ToolChoiceRecorder and context-bisect


## Module contract: tool-lint/

the build-time tool-catalog confusability lint (`analyzeToolCatalog`, `/observe`); `bin/agentfootprint-lint-tools.mjs` loads `dist/esm/tool-lint/cli.js`


## Module contract: trust-boundaries/

the opt-in trust-boundary capture (`trustBoundaryRecorder`, `/observe`): selected typed events admitted live into a bounded window; `recordRun` can own one


## Module contract: trace-toolpack/

selfExplain — reached by the builder only through core/agent/selfExplainPort.ts, registered by selfExplainHost.ts (listed in package.json `sideEffects`), the module the root door takes `Agent` from (and traceDebugAgent builds from, for /observe); 6 tools incl. variable-first `backtrack(variable, element?)`


## Module contract: time-travel/

where a reader of a finished run may stop (`milestoneStops`, main barrel) and what the model was handed there (`servedView.ts`), both from the recorded commit log only — the reader half of the receipt law (the writer is core/agent/receipt/)


## Module contract: answer-account/

"Explain this answer": `accountForAnswer` (/observe) reads one answer's recording back as vouched sentences, each fact with who vouches for it and where it lives in the record


## Module contract: events/

EventDispatcher (wildcard subs), registry (EVENT_NAMES, AgentfootprintEventMap), payloads
