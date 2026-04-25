# v1 → v2 Migration Plan (phased)

State: working tree has v1 at `src/<dir>/...` (release v1.23.0 via reflog
restore) AND v2 alongside at `src/v2/...` (recovered from reflog after
the botched first attempt was reset).

End state: flat `src/` — v2's redesigned modules at the top, v1's
salvageable additive modules preserved alongside, the dead v1 internals
gone.

Each phase below = one commit. Pause for review after each.

---

## Phase 1 — drop dead v1 internals

These are v1-only and have NO v2 use. Pure delete.

**Directories:**
- `src/lib/` (47 files — internal utilities)
- `src/executor/` (2 — superseded by v2 Runner pipeline)
- `src/scope/` (3 — v2 has new scope model)
- `src/stages/` (8 — v2 redesigned stage helpers)
- `src/streaming/` (5 — v2 has provider.stream)
- `src/subflows/` (1 — v2 doesn't need)
- `src/models/` (4 — v2 doesn't centralize models)
- `src/types/` (10 — v2 distributes types)

**Files:**
- `src/explain.barrel.ts`, `observe.barrel.ts`, `instructions.barrel.ts`,
  `memory.barrel.ts`, `patterns.barrel.ts`, `providers.barrel.ts`,
  `resilience.barrel.ts`, `security.barrel.ts`, `skills.barrel.ts`,
  `stream.barrel.ts`, `test-barrel.ts`
- `src/exportTrace.ts`

**Tests:** drop any test/ dir that exclusively tests these (audit at
execution time; some tests may belong to KEPT modules).

Commit: `chore: drop v1-only internal modules (lib/executor/scope/...)`

---

## Phase 2 — drop redesigned v1 modules (v2 has equivalents)

These v1 dirs have direct v2 replacements; delete v1, rely on v2.

- `src/concepts/` → replaced by v2 `src/v2/core/`
  Files: `Agent.ts`, `LLMCall.ts`, `Conditional.ts`, `Parallel.ts`,
         `RAG.ts`, `Swarm.ts`, `FlowChart.ts`, `index.ts`, `specIcons.ts`
- `src/compositions/` → replaced by v2 `src/v2/core-flow/` (4 files)
- `src/core/` → replaced by v2 `src/v2/core/` (4 files)
- `src/patterns/` → replaced by v2 `src/v2/patterns/` (5 files)

Commit: `chore: drop v1 primitives/compositions/patterns (replaced by v2)`

---

## Phase 3 — promote v2 modules to top-level

Move v2 dirs UP from `src/v2/<X>/` to `src/<X>/`.

- `src/v2/core/` → `src/core/`
- `src/v2/core-flow/` → `src/core-flow/`
- `src/v2/patterns/` → `src/patterns/`
- `src/v2/events/` → `src/events/`
- `src/v2/bridge/` → `src/bridge/`
- `src/v2/conventions.ts` → `src/conventions.ts`
- `src/v2/index.ts` → `src/index.ts` (overwrite v1 entry)
- `src/v2/README.md` → `src/README.md`

Test/example trees move similarly:
- `test/v2/<X>/` → `test/<X>/`
- `examples/v2/<X>/` → `examples/<X>/`

Update import paths in test/ + examples/ to drop the `v2/` segment.

Commit: `feat: promote v2 modules to top-level src/`

---

## Phase 4 — merge adapters (v2 types + v1 real providers)

Goal: keep v1's real adapter implementations, but make them implement
v2's `LLMProvider` interface.

**Replace:**
- `src/adapters/types.ts` ← `src/v2/adapters/types.ts` (v2 has the new
  `LLMProvider.complete()` shape; v1's `chat()` shape goes away)

**Add (from v2):**
- `src/v2/adapters/llm/MockProvider.ts` → `src/adapters/llm/MockProvider.ts`
  (note: v1 has `src/adapters/mock/MockAdapter.ts` — different class,
  different shape; we DROP v1 MockAdapter and keep v2 MockProvider)

**Keep (from v1, will be ported in Phase 5):**
- `src/adapters/anthropic/AnthropicAdapter.ts` (418 LOC)
- `src/adapters/openai/OpenAIAdapter.ts` (426 LOC)
- `src/adapters/bedrock/BedrockAdapter.ts` (432 LOC)
- `src/adapters/browser/BrowserAnthropicAdapter.ts` (481 LOC)
- `src/adapters/browser/BrowserOpenAIAdapter.ts` (445 LOC)
- `src/adapters/browser/index.ts`
- `src/adapters/createProvider.ts` (115 LOC)
- `src/adapters/fallbackProvider.ts` (110 LOC)
- `src/adapters/resilientProvider.ts` (114 LOC)
- `src/adapters/createAdapterSubflow.ts` (76 LOC) — review whether v2 still needs

**Defer (lower priority):**
- `src/adapters/mcp/mcpToolProvider.ts` (75 LOC) — keep, port later
- `src/adapters/a2a/a2aRunner.ts` (61 LOC) — keep, port later

**Drop:**
- `src/adapters/mock/MockAdapter.ts` (replaced by v2 MockProvider)
- `src/adapters/mock/MockRetriever.ts` (v1-specific)

After this phase the v1 adapters STILL use the old `chat()` signature —
that gets ported in Phase 5. Build will be broken until then; OK because
each phase is its own commit and we only verify at the end.

Commit: `chore: replace adapter types with v2 LLMProvider; preserve v1 implementations`

---

## Phase 5 — port v1 real adapters to v2 LLMProvider shape

Per adapter, rewrite the public surface from:
```ts
class XAdapter {
  async chat(messages, options) { ... }   // v1
}
```
to:
```ts
class XAdapter implements LLMProvider {    // v2
  readonly name = 'X';
  async complete(req: LLMRequest): Promise<LLMResponse> { ... }
  stream?(req: LLMRequest): AsyncIterable<LLMChunk> { ... }
}
```

Internal HTTP/fetch code, tool-call parsing, error handling — reusable
mostly verbatim. The change is at the surface (`req` shape, response
shape, tool-call payload).

Order: BrowserAnthropic → BrowserOpenAI → AnthropicAdapter →
OpenAIAdapter → BedrockAdapter → fallback/resilient/createProvider.

Commit: `feat: port real LLM adapters to v2 LLMProvider.complete()`

---

## Phase 6 — keep memory subsystem (additive)

`src/memory/` (52 files) is largely runner-independent. Pipelines
emit `InjectionRecord[]` — already v2's currency. Imports from v1
internals (`src/lib/`, `src/types/`) need rewiring to v2.

Audit + fix imports in:
- `src/memory/pipeline/*` — 5 pipelines
- `src/memory/beats/*` — narrative beat extraction
- `src/memory/facts/*` — fact extraction
- `src/memory/embedding/*` — embeddings
- `src/memory/stages/*`, `entry/*`, `identity/*`

If memory imports something we dropped in Phase 1/2, replace with v2
equivalent OR drop the broken file.

Commit: `feat: preserve v1 memory subsystem (pipelines, beats, facts, embedding)`

---

## Phase 7 — keep tools/providers helpers

`src/tools/` (6 files) and `src/providers/` (22 files) — utilities used
by examples and live-chat configs.

Review each:
- `src/tools/defineTool.ts` — KEEP (no v2 equivalent)
- `src/tools/ToolRegistry.ts` — KEEP
- `src/tools/gatedTools.ts`, `compositeTools.ts` — KEEP

- `src/providers/instructions/*` — KEEP (DSL for system prompts)
- `src/providers/messages/*` — KEEP (slidingWindow, charBudget,
  appendMessage, userMessage, assistantMessage, etc.)
- `src/providers/prompts/*` — KEEP (staticPrompt, templatePrompt,
  compositePrompt)
- `src/providers/tools/*` — review for overlap with tools/

Fix imports as in Phase 6.

Commit: `feat: preserve v1 tools/providers helpers`

---

## Phase 8 — merge recorders

v2 has `src/v2/recorders/core/*` (small, foundational set).
v1 has `src/recorders/*` (production observability).

**Promote from v2:**
- `src/v2/recorders/core/*` → `src/recorders/core/`
- `src/v2/recorders/observability/*` → `src/recorders/observability/`

**Keep from v1 (production):**
- `src/recorders/CostRecorder.ts`
- `src/recorders/TokenRecorder.ts`
- `src/recorders/TurnRecorder.ts`
- `src/recorders/ToolUsageRecorder.ts`
- `src/recorders/QualityRecorder.ts`
- `src/recorders/PermissionRecorder.ts`
- `src/recorders/GuardrailRecorder.ts`
- `src/recorders/OTelRecorder.ts`
- `src/recorders/ExplainRecorder.ts`
- `src/recorders/CompositeRecorder.ts`
- `src/recorders/RecorderBridge.ts` (verify still useful)

**Drop from v1:**
- `src/recorders/AgentTimelineRecorder.ts` (replaced by Lens v2)
- `src/recorders/agentObservability.ts` (v1 turnkey bundle)
- `src/recorders/attachRecorderHelper.ts` (v2 has different attach pattern)
- `src/recorders/forwardEmitRecorders.ts` (v2 uses dispatcher)
- `src/recorders/ContextEngineeringRecorder.ts` — verify if v2 has
  equivalent in `recorders/core/ContextRecorder.ts`; likely DROP v1

Commit: `feat: merge v2 recorders/core alongside v1 production recorders`

---

## Phase 9 — drop src/v2/ remnants + update imports

After all v2 modules promoted, `src/v2/` is empty or redundant. Delete.

Update import paths everywhere:
- `'../v2/<X>'` → `'../<X>'`
- `'agentfootprint/v2'` → `'agentfootprint'`
- Any remaining `src/v2/` references in JSDoc comments

Commit: `chore: drop src/v2/ — all modules promoted`

---

## Phase 10 — package.json + tsconfig + final verification

- `package.json`:
  - `main`/`module`/`types` to flat `dist/index.js` paths
  - Drop `./v1` export, drop barrel exports for dropped modules
  - Keep barrel exports for KEPT modules (memory, providers, tools,
    recorders) if we want subpath imports
- `examples/tsconfig.json`: align paths
- `tsconfig.json`: verify includes/excludes
- Run `npm run build` (must be clean)
- Run `npm test` (full suite must pass)

Commit: `chore: finalize package.json + tsconfig for flat src/ layout`

---

## Risk register

| Risk | Mitigation |
|---|---|
| v1 memory/ imports `src/lib/` we dropped | Phase 6 audit; replace or drop |
| v1 adapters import scrubbed types | Phase 5 port resolves |
| Test suite has v1-only test files | Drop in Phase 1/2 alongside source |
| examples/ has v1-only samples | Already clean from earlier work — verify |
| Linked agent-playground breaks mid-migration | Build only at Phase 10; agent-playground build is independent |

## Rollback

Any phase: `git reset --hard HEAD~1` reverts that phase's commit.
End-to-end: `git reset --hard c6e11d0` returns to release v1.23.0.

---

## Summary

11 commits total (1 reset + 10 phases). Side-by-side v1+v2 state holds
through Phase 4; Phases 5-9 progressively unify into the flat layout;
Phase 10 verifies.

Each phase is independently reviewable and revertable.
