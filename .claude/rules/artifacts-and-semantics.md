---
paths:
  - "src/artifacts/**"
  - "src/lib/semantics/**"
  - "src/core/codeRunnerTool.ts"
  - "src/**/*code*"
---
# Artifacts, code runners and semantic results — seams and blast radius

Loaded only when you work on the paths above — moved verbatim out of the root CLAUDE.md so it costs context only where it applies. **Trust the code** where this disagrees.

## Extension points
- **Recordings as artifacts (9.26.0)**: `artifacts: { store, recordings: true | { label } }`. `Agent.startRunRecording()` calls the SAME `recordRun` (before `createExecutor` — `attach()` collects for the executor not yet built); `fileRunRecording` mints AFTER `finalizeResult`, awaited, every failure contained to `artifacts.refused`. Pure half in artifacts/recordingArtifact.ts; payload is the recording's JSON TEXT (a live snapshot handed to an in-process store would be a live view into a finished run). No new wire op — `artifact-get` serves it.
- **Code staging-in (9.26.0)**: `CodeSession.stageInputs?(inputs) → StagedCodeInput[]` — OPTIONAL, feature-detected via `canStageCodeInputs`, and its contract is TWO promises: the payloads are readable at the returned paths, AND every later `execute` exposes the manifest as `STAGED_INPUTS_ENV` (`AF_STAGED_INPUTS`, `name → path`). `CodeInput.name` is the MANIFEST KEY (the wants arg name, so a static description can name it) and `fileName` is the on-disk name — separate fields so the two cannot drift. `codeRunnerTool({ wants })` composes the schema properties + the description clause and refuses BY NAME on a non-staging runner. Implemented by localCodeRunner only.

## Change-impact map
- **Semantic tool results** (9.53.0) → ONE vocabulary leaf `lib/semantics/types.ts` (the toolOutcome precedent; type-only imports of coverage types — absorbed, never duplicated) + ONE rule set `semanticIssues` serving three doors: `semantic()` mint refusals, `readSemantics` strict recognition (any fault ⇒ data path byte-for-byte + dev warn — never half-applied), and `checkSemantics` findings (same codes). Dispatch wiring is the coverage/ceiling radius verbatim: `declareSemantics` closure at BOTH execute boundaries in toolCalls.ts, ordered declareCoverage → declareSemantics → refuseOverCeiling — the coverage funnel (`readCoverageResult`) grew a semantic arm so the envelope's `coverage` field flows the coverage() channel with zero boundary edits, the FULL envelope rides `tools.semantics_declared` (structuredClone-detached) BEFORE the ceiling (caveats survive an oversized refusal), and the ceiling measures the PROJECTION (`semanticsForModel`: drops marker/render/coverage-detail, composes `not_covered` FROM coverage) because that is what the model reads. `Tool.resultClass` ('triage'|'inventory', closed) validated at defineTool (`assertResultClass`, the assertResultCeiling law) and consumed ONLY by the gate. Gate = tool-lint humble-shell verbatim: core in lib/semantics/{check,format,cli}.ts, bin `agentfootprint-check-semantics.mjs`, exit 0/1/2, judges SAMPLE results (mock returns) — never executes tools. Deliberately UNCHANGED: no new scope key (the envelope is per-attempt ⇒ event channel; coverage rows reuse `coverageDeclared`), no status word, no gate flag, pause-answer paths not recognized (human values are not envelopes).
