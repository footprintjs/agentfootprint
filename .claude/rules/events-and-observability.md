---
paths:
  - "src/events/**"
  - "src/events.ts"
  - "src/recorders/**"
  - "src/observability/**"
  - "src/strategies/**"
  - "src/bridge/**"
  - "src/conventions.ts"
  - "src/observe.ts"
  - "src/debug/**"
  - "src/lib/context-bisect/**"
  - "src/lib/trace-toolpack/**"
  - "src/lib/context-ledger/**"
---
# Events, recorders and observability — seams and blast radius

Loaded only when you work on the paths above — moved verbatim out of the root CLAUDE.md so it costs context only where it applies. **Trust the code** where this disagrees.

## Extension points
- **Recorder, 3 layers**: (1) raw footprintjs CombinedRecorder via `agent.attach()` (RunnerBase.ts:474 — NOT idempotent); (2) typed stream `agent.on(type|'*')`; (3) new built-in = factory taking `{dispatcher, getRunContext}`, registered in the attach block inside `Agent.run()` (Agent.ts:807-845), barreled in src/observe.ts.
- **New typed event (3-step)**: payload interface in events/payloads.ts + entry in `AgentfootprintEventMap` (registry.ts:198) + append to `ALL_EVENT_TYPES` (registry.ts:488, count-asserted by tests). New DOMAIN also needs a bridge attach in Agent.createExecutor or emits never reach the dispatcher — AND a hand-edit to `DomainWildcard` (dispatcher.ts:67-90; still missing validation/reliability). **9.4.0 worked example of BOTH halves missing at once**: `credential.*` had payloads, registry entries and live emit sites since 6.11.0 with no bridge and no wildcard, so `agent.on('agentfootprint.credential.failed')` observed nothing for eight minors — the silence in which an identity adapter failed 100% of its calls. Fixed by `credentialRecorder` (recorders/core/CredentialRecorder.ts) + the wildcard arm.
- **Strategy (vendor sink)**: shapes in strategies/types.ts (Observability :130, Cost :169, LiveStatus :201, Lens :234); attach by INSTANCE only — `agent.enable.observability({ strategy })` (strategies/attach.ts). There is no by-name/`vendor` path: `strategies/registry.ts` declared one for years, nothing ever called it, and it was deleted rather than finished. Do NOT model this on `registerCacheStrategy` (cache/strategyRegistry.ts), which is real — a cache vendor self-registers on side-effect import, so a name is the only handle a consumer has there. New vendor = export from observability-providers.ts, NOT a new subpath.
- **Finder** (context-error localization): conform to `Finder` (observability/contextError/finders/types.ts:92); NO registry by design — one file + barrel line. Pluggable `InfluenceScorer` via `localizeContextBug({scorer})` (lib/context-bisect/localize.ts:340).

## Change-impact map
- **conventions.ts** (STAGE_IDS/SUBFLOW_IDS/INJECTION_KEYS) → chart builders that mount by id, ContextRecorder slot attribution, localizer loop-head detection (lib/context-bisect/trajectory.ts:17-33), `stageRole`/`milestoneFor` (Lens contract), BoundaryRecorder. Renaming an id is the whole blast radius.
- **BoundaryRecorder wiring is THREE connections, all at record time**: `runner.attach` (boundaries), `.subscribe(runner)` (what's inside them), `{getCommitCount}` (where each sits on the commit axis). The third fails SILENTLY — every event stamps `commitIdxBefore: 0`, `boundaryIndex` stays empty by design, and an offline step strip has nothing to place. Unrecoverable after the run (the commit log never records WHEN a boundary was crossed). Wired by `attachFlowchart` (which `enable.flowchart`/`enable.localObservability` both go through) and by `recordRun`; a new entry point must pass all three.
- **events/** → 121 typed events across 27 domains (counts anti-drift-tested against this file — update BOTH when adding events): ALL_EVENT_TYPES exhaustiveness tests, DomainWildcard hand-list, ~42 importers (recorders, strategies, stream, commentary).
- **`EventMeta`** → shape is copied in THREE places in lockstep: `events/types.ts` (the type), `bridge/eventMeta.ts` `RunContext` + `buildEventMeta` (the builder), and the per-runner run-context literal (Agent.createExecutor, LLMCall). A field added to the type alone silently never appears. `sessionId` (9.4.0) rides the `AgentRunOptions` → `currentRunContext` path that `correlationId`/`traceId` already use, and `standingAgent` is the only shipped caller that knows one. **`principal`/`tenant` (9.11.0)** ride the same three sites, sourced ONLY from `runOptions?.identity ?? this.lastRunIdentity` (the EXPLICIT identity) — never `scope.runIdentity`, and `conversationId` is deliberately not carried. FOURTH site for this one: a sink that MAPS rather than serializes must place it by hand (otel turn_start does; xray does not — stated in docs, not implied). `file`/`cloudwatch`/`agentcore`/`audit` all `JSON.stringify(event)` and inherit any meta field free.
