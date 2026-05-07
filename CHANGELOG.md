# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.14.2]

### Added — `LiveStateRecorder` — O(1) "what's happening RIGHT NOW" reads

A live-state recorder built on the new footprintjs **`BoundaryStateTracker<TState>`** storage primitive (v4.17.2). Three bracket-scoped trackers + one façade answer "is something in flight, and what's the partial?" without folding the event log.

**The three trackers:**

| Tracker | Boundary | Key | Tracks |
| --- | --- | --- | --- |
| `LiveLLMTracker` | `llm_start` ↔ `llm_end` | `runtimeStageId` | partial content (token-stream accumulation), tokens, iteration, provider, model, startedAtMs |
| `LiveToolTracker` | `tool_start` ↔ `tool_end` | `toolCallId` | toolName, args, toolCallId, startedAtMs |
| `LiveAgentTurnTracker` | `turn_start` ↔ `turn_end` | `String(turnIndex)` | turnIndex, userPrompt, startedAtMs |

**The façade — `LiveStateRecorder`:** bundles all three with one subscribe call, exposes O(1) convenience reads:

```ts
import { liveStateRecorder } from 'agentfootprint';

const live = liveStateRecorder();
live.subscribe(agent);   // wires all 3 trackers to the agent's dispatcher

await agent.run({ message: input });

// Read live, O(1), at any moment during the run:
live.isLLMInFlight();           // true between llm_start ↔ llm_end
live.getPartialLLM();           // accumulated tokens of latest active call
live.isToolExecuting();         // true between tool_start ↔ tool_end
live.getExecutingToolNames();   // names of currently-executing tools
live.isAgentInTurn();           // true between turn_start ↔ turn_end
live.getCurrentTurnIndex();     // most-recent active turn (-1 if none)

live.unsubscribe();
```

Each tracker is also independently usable when a consumer only needs one slice (e.g., a CLI status line that only cares about LLM streaming):

```ts
import { LiveLLMTracker } from 'agentfootprint';

const llm = new LiveLLMTracker();
llm.subscribe(agent);
llm.isInFlight();
llm.getLatestPartial();
```

**Mental model:**

> Existing recorder *interfaces* (`Recorder` / `FlowRecorder` / `EmitRecorder` / `CombinedRecorder`) are **observers**. Storage primitives (`SequenceRecorder<T>` / `KeyedRecorder<T>` / **`BoundaryStateTracker<TState>` 🆕**) are **bookkeeping shelves**. A real recorder picks ONE observer interface AND ONE storage shelf via `extends + implements`. `LiveLLMTracker` extends the new `BoundaryStateTracker` shelf and subscribes to typed events from the agentfootprint dispatcher.

**Subscribe semantics:** `live.subscribe(runner)` is idempotent — calling twice unsubscribes the prior subscription before re-attaching, so consumers don't have to track state. `live.clear()` resets transient state across all three trackers without unsubscribing.

**Tier 1 (live) only.** Past states are not stored — when a boundary closes, its transient state clears. For time-travel queries ("what was the LLM partial at slider step N?"), snapshot to a `SequenceRecorder<TState>`. See the `BoundaryStateTracker` JSDoc on the footprintjs side for the rationale.

**Multi-consumer story:**

- Lens / UI live commentary (the "Chatbot is responding: …" line)
- CLI live monitor (stdout status line)
- Sentry breadcrumb capture ("agent in flight at exception time")
- Test harness (`await waitForLLMIdle()`)

Each consumer reads `live.*` getters in O(1) — no per-render fold over the event log.

**Tests:** 27 new tests across 7 tiers (unit / scenario / integration / property / perf / security / ROI). Total suite 2044/2044.

**Example:** [examples/features/13-live-state.ts](examples/features/13-live-state.ts) — full ReAct turn with mid-stream peeks demonstrating the transient state evolving and clearing.

**Public exports:** main barrel `'agentfootprint'` + `'agentfootprint/observe'` subpath:

- `LiveStateRecorder` / `liveStateRecorder()` factory
- `LiveLLMTracker` / `LiveToolTracker` / `LiveAgentTurnTracker`
- `LLMLiveState` / `ToolLiveState` / `AgentTurnLiveState` (state shape types)
- `LiveStateRunnerLike` (minimal Runner shape required by `subscribe`)

### Bumped — peer dependency on footprintjs to `>=4.17.2`

`LiveStateRecorder` extends `BoundaryStateTracker<TState>` which lands in footprintjs v4.17.2. Existing v4.17.1 consumers will see a peer-dep warning until they bump. No breaking changes in either library.

## [2.14.1]

### Added — `StepNode` payload fields for ReAct steps

`StepNode` now carries the actual data crossing each ReAct boundary, not just metadata. Three new optional fields populated during `buildStepGraph`:

- `assistantText` — LLM's text content. Set on `llm->tool` (the reasoning emitted alongside `tool_use` blocks) and on `llm->user` (the terminal answer).
- `toolArgs` — tool input arguments the LLM produced. Set on `llm->tool` from the matching `tool.start` event payload.
- `toolResult` — tool result returned to the LLM. Set on `tool->llm` from the preceding `tool.end` event payload.

Lets renderers (e.g. agentfootprint-lens NodeDetailPanel) surface "what arrived / what was produced" per ReAct step without consumer-side correlation.

### Fixed — `SUBFLOW_IDS.FINAL` now matches the route-branch key

`SUBFLOW_IDS.FINAL` was `'sf-final'` but the Agent mounts the final-answer composition via `addSubFlowChartBranch('final', ...)` — the branch key IS the subflow id, no `sf-` prefix. The mismatch leaked the final subflow into the user-facing StepGraph as a phantom "step". Now `SUBFLOW_IDS.FINAL = 'final'`, and `BoundaryRecorder`'s `AGENT_INTERNAL_LOCAL_IDS` correctly skips it.

### Added — `SUBFLOW_IDS.THINKING` registered + filtered

The v2.14 thinking-normalize subflow (`sf-thinking`) and its inner handler subflows (`thinking-anthropic`, `thinking-openai`) are now declared in `SUBFLOW_IDS` and filtered from the StepGraph via `AGENT_INTERNAL_LOCAL_IDS` plus a new `thinking-` prefix matcher in `isAgentInternalId()`. The wrapping LLM step's `assistantText`/`toolArgs`/`toolResult` already carry the relevant info, so the inner subflows don't surface as separate user-facing steps.

## [2.14.0]

### Added — Extended-thinking subsystem (Anthropic + OpenAI o1/o3)

When the LLM emits reasoning blocks (Anthropic extended thinking, OpenAI o1/o3 `reasoning_summary`), v2.14 normalizes them into a provider-agnostic `ThinkingBlock[]`, persists the assistant message with byte-exact signature for the round-trip the next turn requires, and surfaces them on the typed-event stream so live UIs can render reasoning per iteration without post-walking `scope.history`.

**Two-layer architecture:**

- **CONSUMER-FACING:** `ThinkingHandler` — a small function-pair `{id, providerNames, normalize, parseChunk?}`. Provider authors and custom-LLM consumers implement this shape. Auto-wired by `provider.name` via the registry.
- **FRAMEWORK-INTERNAL:** each handler is auto-wrapped in a real footprintjs subflow at chart build time. The subflow gets its own `runtimeStageId`, narrative entry, and InOutRecorder boundary — full trace observability for free without consumers writing flowchart code.

Same pattern as v2.6 caching, v2.11.5 reliability, v2.11.6 tool-providers: a small typed surface for the consumer, a real subflow for the framework.

**Pre-implementation 7-panel review** (Anthropic + OpenAI + Architect + footprintjs + SRE + Security + QA, each with architect + coder dual lens) ran before EVERY phase. **Post-implementation 7-panel review** at the end of every phase, with must-fixes folded in before the next phase opened. Each phase shipped its own 7-pattern test matrix (unit · scenario · integration · property · security · performance · ROI).

#### Builder surface

```ts
// Request-side: ASK the model to think.
//   Anthropic: sets thinking: { type: 'enabled', budget_tokens } on the wire.
//   OpenAI:    no-op (o1/o3 reasoning is selected at the model id level).
Agent.create({ provider: anthropic({...}), model: 'claude-sonnet-4-5' })
  .thinking({ budget: 5000 })
  .build();

// Response-side: NORMALIZE the response (auto-wired by provider.name).
// Override per-agent when you need custom normalization or opt out:
agent.thinkingHandler(myCustomHandler);  // override
agent.thinkingHandler(null);             // opt out
```

`max_tokens` is auto-bumped to `budget + 1024` when the resolved value would violate Anthropic's `max_tokens > thinking.budget_tokens` invariant. Consumers who explicitly set `maxTokens` keep their choice.

#### Round-trip integrity (Anthropic)

Anthropic's signed thinking blocks must echo back BYTE-EXACT in subsequent assistant turns or the API rejects with HTTP 400. `LLMMessage.thinkingBlocks` (PERSISTED — different from `ephemeral`) carries the signature through `scope.history`; `AnthropicProvider.toAnthropicMessages` serializes them first in the assistant content array (Anthropic's wire-format ordering rule). Tested with tricky base64 + padding + trailing-whitespace signatures across the full pipeline.

#### Live event stream — collect during traversal

Per-iteration thinking content lands on `agentfootprint.stream.thinking_end.payload.blocks`. Live UIs subscribe once, accumulate as iterations complete — no post-walking `scope.history`:

```ts
agent.on('agentfootprint.stream.thinking_end', (e) => {
  // e.payload.blocks: readonly ThinkingBlock[]
  // e.payload.iteration: which agent loop iteration produced these
  // e.payload.totalChars / blockCount / tokens: metadata
});
```

Same data the framework persists to `LLMMessage.thinkingBlocks` (post-`providerMeta` strip). Privacy: wildcard (`*`) recorders piping to external sinks (Datadog, CloudWatch, OTel) will see reasoning content — same risk profile as `stream.token`.

#### Three new typed events (count 52 → 55)

- `agentfootprint.stream.thinking_delta` — per-chunk streaming reasoning fragments (Anthropic streams these; OpenAI doesn't, as of early 2026)
- `agentfootprint.stream.thinking_end` — per-call summary with full blocks (use this for live per-iteration UIs)
- `agentfootprint.agent.thinking_parse_failed` — graceful-failure signal when a handler's `normalize()` throws; framework drops the blocks and continues, same pattern as v2.11.6 `tools.discovery_failed`

#### Three shipped handlers

- `anthropicThinkingHandler` (`'anthropic'` + `'browser-anthropic'`) — Anthropic + browser direct-fetch, byte-exact signature
- `openAIThinkingHandler` (`'openai'`) — o1 string + o3+ structured `reasoning_summary` array; all blocks marked `summary: true`
- `mockThinkingHandler` (`'mock'`) — canonical reference implementation; defensive `isMockRaw` guard against malformed shapes

Future provider authors implement `ThinkingHandler` and append to `SHIPPED_THINKING_HANDLERS`; the cross-cutting contract test (`test/thinking/cross-cutting.test.ts`) iterates the registry and pins invariants for every handler.

#### `providerMeta` strip — defense in depth

`ThinkingBlock.providerMeta` is documented as "escape hatch for fields the normalized shape doesn't model." The framework strips it from blocks before persisting to `scope.thinkingBlocks` (which feeds `LLMMessage.thinkingBlocks` → audit logs and the event payload). Type doc declared this; Phase 6 enforced it via test + source fix.

#### Phase summary

- **Phase 1** — types foundation (`ThinkingBlock`, `ThinkingHandler`, registry, mock)
- **Phase 2** — three typed events (`thinking_delta`, `thinking_end`, `thinking_parse_failed`)
- **Phase 3** — framework wiring: `buildThinkingSubflow` + auto-wire by `provider.name` + build-time conditional mount (zero overhead for non-thinking agents)
- **Phase 4a** — `AnthropicThinkingHandler` (response normalization, byte-exact signature)
- **Phase 4b** — `AnthropicProvider` serialization (request → response → round-trip on second turn)
- **Phase 5** — `OpenAIThinkingHandler` (string + structured array shapes)
- **Phase 6** — cross-cutting: registry-iterating contract test + E2E 2-turn signature round-trip + `providerMeta` non-leak. Source fixes for `MockThinkingHandler` defensive guard and `providerMeta` strip in `buildThinkingSubflow`
- **Phase 6.5** — request-side activation: `LLMRequest.thinking?: { budget }`, `AgentBuilder.thinking({budget})`, plumbed through `callLLM`. `AnthropicProvider` translates to wire format; OpenAI ignores
- **Phase 6.5b** — `BrowserAnthropicProvider` reaches v2.14 parity (request body + response + streaming `thinking_delta` + `signature_delta` accumulation). `max_tokens` auto-bump in both providers
- **Phase 6.6** — `StreamThinkingEndPayload.blocks` for live per-iteration consumers; closes the "post-walk scope.history" anti-pattern

Test suite: 2017/2017 (was 1862 before v2.14). Build clean (CJS + ESM). Lint clean. Format clean.

## [2.13.0]

### Added — Instructor-style schema retry on the reliability gate

When the LLM emits valid JSON that fails your `outputSchema` (e.g. `amount` came back as `"USD 50"` instead of `50`), v2.13 re-prompts the same model with the validation error — within the SAME turn — for up to N retries. Each retry's feedback is an ephemeral message: visible to the model, never persisted to memory or audit logs. Composes on top of the existing v2.11.5 reliability gate; no new factory.

**Pattern parallels v2.11.6 `discoveryProvider` + v2.12 `sequencePolicy`:** the library extends primitives, ships a recipe; consumers build the convenience layer in user-land. Avoids API lock-in before real usage shapes the right factory.

**Pre-implementation 7-panel review** (Anthropic + OpenAI + tool-dispatch + architect + footprintjs + SRE + security + QA) surfaced 7 must-fix items + 10 doc notes; all folded in before code landed. **Post-implementation 7-panel review** in CHANGELOG section below.

#### `ReliabilityScope` extension

```ts
interface ReliabilityScope {
  // existing
  attempt, providerIdx, response?, error?, errorKind, latencyMs, ...

  // NEW in v2.13
  validationError?: { message: string; path?: string; rawOutput?: string };
  validationErrorHistory: readonly string[];   // accumulates across retries
}
```

Rules read these to drive `retry`/`fail-fast` on schema-fail outcomes.

#### `ReliabilityRule.feedbackForLLM`

```ts
interface ReliabilityRule {
  // existing
  when, then, kind, label?

  // NEW in v2.13
  feedbackForLLM?: string | ((s: ReliabilityScope) => string | Promise<string>);
}
```

When a rule fires with `then: 'retry'` (or `'retry-other'`) AND `feedbackForLLM` is set, the gate appends an ephemeral user message to the next request. Sync OR async (callback may return Promise). Throwing callbacks are caught and fall back to a generic message — never abort the run.

#### `LLMMessage.ephemeral` (persistence flag)

```ts
interface LLMMessage {
  // existing
  role, content, toolCallId?, toolName?, toolCalls?

  // NEW in v2.13 — persistence flag (NOT a visibility flag)
  ephemeral?: boolean;
}
```

Critical clarification (v2.13 7-panel security reviewer's concern): `ephemeral` is a PERSISTENCE flag, not a VISIBILITY flag. Ephemeral messages:

- ✅ ARE sent to the LLM in the next request (visible to the model, count toward context window)
- ✅ ARE observable via narrative / recorders / typed events (visible to humans for debugging + forensics)
- ❌ NOT persisted to `scope.history` (so memory writes / `getNarrative()` snapshots don't include them)

An attacker cannot use the ephemeral marker to construct audit-invisible prompts.

#### `ValidationFailure` sentinel + `OutputSchemaValidator` hook

```ts
class ValidationFailure extends Error {
  readonly stage: 'json-parse' | 'schema-validate';
  readonly path?: string;
  readonly rawOutput?: string;
}

type OutputSchemaValidator = (response: LLMResponse) => void;
```

Caller-supplied validators throw `ValidationFailure` to signal schema-fail to the reliability loop. The framework auto-builds a validator from `outputSchemaParser` when both `outputSchema()` AND `reliability()` are configured on the same agent — consumers don't need to write their own validator for the common case.

#### `defaultStuckLoopRule` + `lastNValidationErrorsMatch` helpers

```ts
import { defaultStuckLoopRule, lastNValidationErrorsMatch } from 'agentfootprint/reliability';

// Drop in BEFORE retry rules:
.reliability({
  postDecide: [
    defaultStuckLoopRule,                // ← fail-fast on 2 identical errors
    { when: ..., then: 'retry', feedbackForLLM: ..., ... },
    { when: ..., then: 'fail-fast', ... },
  ],
})
```

Stuck-loop detection is a built-in rule (must-fix #4 from 7-panel review). `kind: 'schema-stuck-loop'` surfaces on `ReliabilityFailFastError.kind` for caller branching. Custom n: `lastNValidationErrorsMatch(scope, 3)`.

#### `agentfootprint.agent.output_schema_validation_failed` event

```ts
interface AgentOutputSchemaValidationFailedPayload {
  message: string;
  stage: 'json-parse' | 'schema-validate';
  path?: string;
  rawOutput?: string;
  attempt: number;
  cumulativeRetries: number;          // leading indicator for model drift
}
```

**Naming clarification** (security reviewer's concern): the event lives in the `agent.*` domain (parallel to `agent.turn_end`), NOT `eval.*` — because "schema" is overloaded in agentfootprint and `output_schema` makes the scope unambiguous. Tool-input schema validation is a different concern handled at the provider layer.

Fires BEFORE PostDecide rules evaluate, so observability sees every validation failure even if a buggy rule routes to fail-fast or swallows it (must-fix #2). Payload includes `attempt` + `cumulativeRetries` for SRE dashboards (must-fix #3).

Total event count: 51 → 52.

#### Validation only fires on terminal turns (must-fix #1)

When the LLM returns `toolCalls.length > 0` (a tool-using turn, not a final answer), validation is skipped. Tool-call turns aren't terminal output; validating them would be premature and break the agent loop. This guard is enforced in `callLLM.ts`; consumers writing custom validators should mirror it.

#### Implementation

- **`src/adapters/types.ts`** — `LLMMessage.ephemeral` field; widened `PermissionChecker.check()` (was already widened in v2.12).
- **`src/reliability/types.ts`** — `ReliabilityScope.validationError` + `validationErrorHistory`; `ReliabilityRule.feedbackForLLM`.
- **`src/core/agent/stages/reliabilityExecution.ts`** — validation hook in retry loop; ephemeral feedback append via `applyFeedback` helper; `lastNValidationErrorsMatch` + `defaultStuckLoopRule` exports.
- **`src/core/agent/stages/callLLM.ts`** — `outputSchemaParser` dep; auto-builds `postValidate` hook from parser; passes through to `executeWithReliability`. Guards on `toolCalls.length === 0` (must-fix #1). Extracts `path` from Zod-style `.issues` when present.
- **`src/core/Agent.ts`** — passes `outputSchemaParser` through to `callLLM` deps when both reliability + outputSchema are configured.
- **`src/events/payloads.ts`** + **`src/events/registry.ts`** — `AgentOutputSchemaValidationFailedPayload`; new entry in `ALL_EVENT_TYPES` (count 51 → 52).
- **`src/reliability/index.ts`** — export `ValidationFailure`, `lastNValidationErrorsMatch`, `defaultStuckLoopRule`, `OutputSchemaValidator`.

#### Tests (16 new in `test/reliability/strict-output.test.ts` — full 7-pattern matrix)

| Pattern | Coverage |
|---|---|
| 1. Unit | `lastNValidationErrorsMatch` (4 tests); `defaultStuckLoopRule` (2 tests) |
| 2. Scenario | Model fails once → retry with feedback → succeeds (1 test) |
| 3. Integration | `runTyped()` returns parsed value after retry (1 test); throws `ReliabilityFailFastError` when exhausted (1 test) |
| 4. Property | Random fail counts 0..3 preserve dispatch invariant (1 test) |
| 5. Security | Throwing `feedbackForLLM` falls back to generic + run continues (1 test); ephemeral messages never leak to `scope.history` (1 test) |
| 6. Performance | 50 successful runs without validation fail under 5s (overhead bound, 1 test) |
| 7. ROI | RefundBot stuck-loop guard fires before retry exhaustion (1 test); event payload carries the right fields (1 test); validation does NOT fire on tool-call turns (1 test, must-fix #1 verification) |

Running total: 1862/1862 tests across the suite.

#### Recipe + example

- **`examples/features/12-strict-output.ts`** — `strictOutputRules({maxRetries})` factory in user-land (~30 LOC); 3 scenarios (happy, retry-with-feedback, stuck-loop fail-fast).
- **`docs-site/src/content/docs/guides/strict-output.mdx`** — full recipe page using CodeFile region markers; explains why no library factory ships; composition order with reliability + outputFallback; streaming trade-off; anti-patterns including security concerns from the 7-panel review.

#### Backward compatibility

None broken. Existing v2.11.5 reliability rules work unchanged — the new `feedbackForLLM` field is optional and ignored when absent. Existing `outputSchema` consumers (parseOutput / runTyped) work unchanged — validation INSIDE the loop only happens when `reliability` is ALSO configured on the same agent.

#### Pattern locked in across 3 features

| Feature | Library effort | Recipe |
|---|---|---|
| v2.11.6 `discoveryProvider` (async ToolProvider) | ~5 days | docs/tool-discovery.mdx |
| v2.12 `sequencePolicy` (sequence governance) | ~2 days | docs/sequence-governance.mdx |
| v2.13 `strictOutput` (Instructor-style retry) | ~3 days | docs/strict-output.mdx |

Library extends primitives; consumers ship convenience layers; recipes in docs. Avoids API lock-in before real consumer patterns shape the right factory. If 5+ consumers ship the same factory shape over the next quarter, we promote to first-class library export in v3.

## [2.12.1]

### Fixed — 7-pattern test coverage backfill

Project rule: every release ships tests covering all 7 patterns of the matrix (unit · scenario · integration · property · security · performance · ROI). Pre-release reviews of v2.11.6 (`async-provider`) and v2.12 (`policy-halt`) found gaps in the property + performance + ROI columns. This patch release backfills them retroactively. **No source code changes; tests only.**

#### v2.11.6 backfill — `test/tool-providers/async-provider.test.ts` (+6 tests)

- **PROPERTY** — random sync/async/throw provider compositions hold dispatch-shape invariants (sync → non-Promise; async → Promise; sync-throw → throws; async-reject → rejects, drained safely)
- **PROPERTY** — random forbidden-pattern + random sequence runs never silently dispatch a denied tool
- **PERF (sync)** — `staticTools.list()` × 1000 < 250ms (zero-overhead claim, ~50µs/call)
- **PERF (sync)** — `gatedTools(staticTools, pred).list()` × 1000 < 300ms (decorator overhead bound)
- **PERF (async)** — 50 turns × 2 iterations dispatch never doubles `list()` calls (cache contract holds under load)
- **ROI** — Rube-style hub adapter end-to-end: TTL cache + AbortSignal + start/completed events + dispatch all wired together

#### v2.12 backfill — `test/security/policy-halt.test.ts` (+5 tests)

- **PROPERTY** — random safe-name sequences vs random dangerous-name patterns: no false-positive matches
- **PROPERTY** — random-prefix + dangerous-suffix sequences ALWAYS match their dangerous pattern
- **PERF** — `extractSequence(history)` over 1000-message history < 50ms
- **PERF** — `extractSequence` skipping synthetic denies in 1000-message history < 50ms
- **PERF** — sync `permissionChecker.check()` × 1000 < 300ms (overhead bound)

#### Process change

Going forward, every new feature release MUST hit all 7 patterns from the start. The pre-release 7-panel review now includes a Test/QA reviewer who audits the matrix and blocks release if any column is missing.

#### Tests

1846/1846 (1835 pre-backfill + 11 new). No source changes.

## [2.12.0]

### Added — sequence-aware PermissionChecker (the recipe primitive)

Single-call permission (v2.4) answers *"is this tool allowed?"* in isolation. v2.12 enriches the check ctx so consumers can build sequence-aware governance — security (exfil chains), cost (wasteful patterns), correctness (idempotency caps) — over the SAME `PermissionChecker` interface, no new factory required.

**Pattern parallels v2.11.6 `discoveryProvider`:** the library extends a primitive, ships a recipe; consumers build the convenience layer in user-land. Avoids API lock-in before real usage shapes the right factory.

#### `PermissionRequest` enrichment (5 new fields)

```ts
interface PermissionRequest {
  // existing
  capability, actor, target?, context?

  // NEW in v2.12
  sequence?: readonly ToolCallEntry[];   // dispatched calls so far this run
  history?: readonly LLMMessage[];        // full conversation
  iteration?: number;                     // current ReAct iteration
  identity?: { tenant?, principal?, conversationId };
  signal?: AbortSignal;
}
```

The framework derives `sequence` on demand from `scope.history` via `extractSequence()` — single source of truth, survives `agent.resumeOnError(checkpoint)` correctly. No parallel state in scope.

#### `PermissionDecision` extension — `'halt'` + `tellLLM` + `reason`

```ts
interface PermissionDecision {
  // existing
  result: 'allow' | 'deny' | 'gate_open';
  rationale?, policyRuleId?, gateId?

  // NEW in v2.12
  result: ... | 'halt';                   // terminates run via PolicyHaltError
  reason?: string;                        // telemetry tag (machine-readable)
  tellLLM?: ToolResultContent;            // LLM-facing synthetic tool_result
}
```

`'halt'` writes a synthetic tool_result (using `tellLLM`) to history BEFORE throwing — Anthropic / OpenAI tool_use ↔ tool_result protocol stays satisfied; conversation history is consistent for resume.

#### Default `tellLLM` is deliberately generic

Omitted `tellLLM` defaults to `"Tool '${name}' is not available in this context."` — NEVER falls back to `reason` (which is telemetry, e.g. `'security:exfiltration'`). Leaking the reason tag to the LLM teaches it the rule space; consumers who want a richer message provide `tellLLM` explicitly.

#### `PolicyHaltError` typed error

```ts
class PolicyHaltError extends Error {
  reason: string;          // telemetry tag from rule
  tellLLM?: ToolResultContent;
  sequence: readonly ToolCallEntry[];
  iteration: number;
  history: readonly LLMMessage[];
  proposed: { name: string; args: unknown };
  checkerId?: string;
}
```

Parallel to `ReliabilityFailFastError`. Caller branches on `e.reason.startsWith('security:')` etc. for alert routing (PagerDuty / Slack / dashboard).

#### Strict halt ordering (audit-trail completeness)

When `{ result: 'halt' }` fires:
1. Synthetic tool_result appended to `scope.history`
2. `agentfootprint.permission.halt` event emitted
3. Stage commits (commitLog has the entry, runtimeStageId complete)
4. `scope.$break` propagates
5. `Agent.run()` catches at the API boundary, throws `PolicyHaltError`

If anything in the halt path throws, the audit trail is still committed before the run terminates. `agent.run()` exempts `PolicyHaltError` (and `ReliabilityFailFastError`, `PauseSignal`) from the auto-checkpoint wrapping so callers can `instanceof` the typed error directly.

#### One new typed event — `agentfootprint.permission.halt`

```ts
interface PermissionHaltPayload {
  checkerId?: string;
  target: string;
  reason: string;
  tellLLM?: string;
  iteration: number;
  sequenceLength: number;
}
```

Routes via existing `PermissionRecorder` bridge (no new bridge). `PermissionCheckPayload.result` widened to include `'halt'`; `PermissionCheckPayload.reason` field added for telemetry routing on the existing event. Event count: 50 → 51.

#### `extractSequence(history, iteration, options?)` exported helper

Pure function: walks history, returns `readonly ToolCallEntry[]` of dispatched calls in order. Filters out:
- Calls without a matching `tool` message (in-flight from current turn)
- Calls whose tool_result starts with `[permission denied:` (synthetic denies — never executed)

Optional `resolveProviderId(toolName) => string | undefined` for cross-hub policy matching (`'local'` for static tools; provider's `id` for `discoveryProvider` tools).

#### Implementation

- **`src/adapters/types.ts`** — `PermissionRequest` enriched; `PermissionDecision` widened with `'halt'` + `tellLLM` + `reason`; `PermissionChecker.check()` may return `Promise<Decision>` OR `Decision` (sync zero-overhead path); `ToolCallEntry` + `ToolResultContent` types added.
- **`src/security/PolicyHaltError.ts`** (new) — typed error class, `PolicyHaltContext` shape.
- **`src/security/extractSequence.ts`** (new) — pure helper, `SYNTHETIC_DENY_PREFIX` exported for consumer policies that want to filter their own.
- **`src/core/agent/stages/toolCalls.ts`** — pass enriched ctx to `permissionChecker.check()`; handle `'halt'` result with strict ordering (synthetic → event → commit → $break).
- **`src/core/agent/types.ts`** — `AgentState.policyHalt*` fields added.
- **`src/core/Agent.ts`** — halt translation in `finalizeResult()`; `PolicyHaltError` exempted from `RunCheckpointError` wrapping (parallel to `PauseSignal` / `ReliabilityFailFastError`).
- **`src/events/payloads.ts`** + **`src/events/registry.ts`** — `PermissionHaltPayload` + entry; `PermissionCheckPayload.result` widened; `PermissionCheckPayload.reason` field added; `ALL_EVENT_TYPES` count 50 → 51.

#### Tests (14 new in `test/security/policy-halt.test.ts`)

Enriched ctx (sequence + history + iteration + identity) / halt → PolicyHaltError with full context / halt without `tellLLM` defaults to safe generic (NEVER leaks `reason`) / `permission.halt` event / strict ordering (synthetic before throw) / `extractSequence` helper (skips synthetic denies, skips in-flight, custom providerId resolver) / async checker (Promise return) / no regression on `'allow'` / `'deny'` / sequence-aware user-land policies (forbidden-suffix + frequency-limit).

#### Recipe + example

- **`examples/features/11-sequence-policy.ts`** — `sequencePolicy({ forbidden, limits })` factory in user-land (~80 LOC); three scenarios (happy path, cost rule denies + LLM recovers, security rule halts via `PolicyHaltError`).
- **`docs-site/src/content/docs/guides/sequence-governance.mdx`** — full recipe page using CodeFile region markers; explains why no library factory ships (lock-in risk + cost-benefit); composition with `gatedTools`; anti-patterns; deny vs halt decision matrix.

#### Backward compatibility

None broken. Existing v2.4 `PermissionChecker` consumers work unchanged — the new fields are optional reads, the new result is opt-in. The `PermissionDecision.result` widening is a strict superset; existing return types still satisfy the new union.

## [2.11.6]

### Added — async ToolProvider for runtime tool discovery

`ToolProvider.list(ctx)` may now return EITHER `readonly Tool[]` (sync, the 99% case — `staticTools`, `gatedTools`, `skillScopedTools`) OR `Promise<readonly Tool[]>` (async, discovery-style providers backed by tool hubs / MCP registries / per-tenant catalogs). The agent runtime checks `result instanceof Promise` before awaiting, so sync providers pay zero microtask overhead.

```ts
const provider: ToolProvider = {
  id: 'rube',
  async list(ctx) {
    const response = await fetch('/api/tools', { signal: ctx.signal });
    return parseTools(await response.json());
  },
};

const agent = Agent.create({ provider: llm, model: 'claude-sonnet-4-5-20250929' })
  .toolProvider(provider)
  .build();
```

This is what unlocks Rube / Composio / Arcade / custom-hub adapters as user code over the existing `ToolProvider` abstraction — no library API additions required.

#### Type widening

`ToolProvider.list(ctx): readonly Tool[]` → `readonly Tool[] | Promise<readonly Tool[]>`. No code changes needed for existing sync providers; the sync return type is a strict subset of the new union.

#### `ToolDispatchContext.signal`

`ctx` carries the agent's `AbortSignal` (propagated from `agent.run({ env: { signal } })`). Async providers MUST honor it — when the agent run is cancelled, an in-flight catalog fetch should abort instead of holding the run open. Sync providers can ignore.

#### `agentfootprint.tools.discovery_failed` event

A throwing or rejecting provider emits the typed event with `{ providerId, error, errorName, iteration }` and re-throws. Discovery failure is loud by design — silently dropping tools mid-conversation produces non-deterministic agent behavior harder to debug than a crash. For graceful degradation, configure `.reliability(...)` to route discovery failures via retry / fallback / fail-fast.

#### One `list()` call per iteration

The Tools slot caches the resolved `Tool[]` in a closure shared with the toolCalls handler. When the LLM dispatches a tool from your provider, the handler reads from the cache instead of re-invoking `list()` — async providers pay the discovery cost once per turn, not twice. Fresh chart per `agent.run()` ensures concurrent runs don't share cache state.

#### Tools subflow split: Discover → Compose

The Tools slot subflow now exposes two stages instead of one, so async discovery is first-class observable in every recorder/trace surface:

```
sf-tools subflow:
  ├── Discover  ← own runtimeStageId, own InOutRecorder boundary,
  │              own narrative entry. Calls provider.list(ctx).
  │              Emits discovery_started → discovery_completed (or
  │              discovery_failed). When no toolProvider is set,
  │              early-returns in microseconds (no-op fast path).
  └── Compose   ← merges static + provider + per-skill schemas into
                  the slot. Reads providerToolCache.current populated
                  by Discover.
```

Why: with discovery + compose merged into one stage (the v2.5–v2.11.5 shape), async-discovery latency was indistinguishable from compose latency in the trace, the discovery had no dedicated `runtimeStageId` for KeyedRecorder lookups, and InOutRecorder showed one boundary instead of two. The split fixes all three. Sync providers pay zero extra cost — Discover early-returns when no provider is set, and the dynamic `instanceof Promise` check still skips await for sync provider returns.

Two new typed events round it out:

- **`agentfootprint.tools.discovery_started`** — `{ providerId, iteration }`. Fires before `provider.list(ctx)`.
- **`agentfootprint.tools.discovery_completed`** — `{ providerId, iteration, durationMs, toolCount }`. Fires after a successful `list()` resolution. Use the started→completed pair for per-iteration discovery latency.

`tools.discovery_failed` payload now also carries `durationMs` so timeouts are distinguishable from immediate rejections.

Event count: 48 → 50.

#### Implementation

- **`src/tool-providers/types.ts`** — widened `list()` return type; added `signal?: AbortSignal` to `ToolDispatchContext`.
- **`src/core/slots/buildToolsSlot.ts`** — split into Discover + Compose stages; dynamic `instanceof Promise` check (sync fast-path); typed `discovery_started` / `discovery_completed` / `discovery_failed` emits; `ProviderToolCache` written by Discover, read by Compose AND the toolCalls handler.
- **`src/core/agent/stages/toolCalls.ts`** — dispatch reads from `providerToolCache.current`, eliminating the second `provider.list(ctx)` call per iteration.
- **`src/tool-providers/gatedTools.ts`** — propagates async return through the decorator chain via `result instanceof Promise ? result.then(filter) : filter(result)`. A sync inner stays sync; an async inner stays async.
- **`src/recorders/core/ToolsRecorder.ts`** (new) — EmitBridge for `agentfootprint.tools.*`, parallel to `streamRecorder` / `skillRecorder`. Auto-attached in `Agent.run()`.
- **`src/events/payloads.ts`** + **`src/events/registry.ts`** — `ToolsDiscoveryStartedPayload` / `ToolsDiscoveryCompletedPayload` / `ToolsDiscoveryFailedPayload` + 3 entries in `ALL_EVENT_TYPES` (now 50).

#### Tests (15 new in `test/tool-providers/async-provider.test.ts`)

Sync path / async path / sync throw / async reject / signal abort / mixed sync+async chain / no double-discovery (cache contract) / concurrent agents (reentrancy) / discovery_started→discovery_completed ordering with timing / failed discovery emits started→failed (no completed) / no-provider agents emit zero discovery events.

#### Docs + example

- **`docs-site/src/content/docs/guides/tool-discovery.mdx`** — sync vs async contract, TTL caching pattern, signal propagation, failure semantics, concurrency notes.
- **`examples/features/10-discovery-provider.ts`** — `discoveryProvider({ hub, ttlMs })` over a generic `ToolHub` interface; three scenarios (happy + cache hit, cancellation, failure path).
- **`docs-site/src/content/docs/guides/observability.mdx`** — `tools.discovery_failed` listed in event taxonomy; event count bumped to 58.

#### Backward compatibility

None broken. Sync providers (`staticTools`, `gatedTools`, `skillScopedTools` and any custom sync provider) work unchanged. The widened `list()` return type is a strict superset; the new `ctx.signal` is optional. The cache eliminates a redundant `list()` call that was already correct under the v2.11.5 contract.

## [2.11.5]

### Added — reliability gate wired into Agent

The v2.11.1 reliability foundation (`CircuitBreaker`, `classifyError`, `ReliabilityConfig`, `ReliabilityFailFastError`, `buildReliabilityGateChart`) now has a consumer-facing surface inside `Agent`:

```ts
const agent = Agent.create({ provider, model: 'mock' })
  .system('You triage support tickets.')
  .reliability({
    postDecide: [
      { when: (s) => s.errorKind === '5xx-transient' && s.attempt < 3,
        then: 'retry', kind: 'transient-retry' },
      { when: (s) => s.error !== undefined,
        then: 'fail-fast', kind: 'unrecoverable' },
    ],
    circuitBreaker: { failureThreshold: 3 },
  })
  .build();

try {
  await agent.run({ message: 'help' });
} catch (e) {
  if (e instanceof ReliabilityFailFastError) {
    console.log(e.kind, e.reason, e.payload);
  }
}
```

#### Streaming + reliability semantics (first-chunk arbitration)

Streaming and retry don't compose cleanly — a stream that errors after token 5 either replays duplicates or has to buffer the whole stream first (losing progressive UX). LLM providers don't expose resume tokens or per-stream idempotency, so the conflict can't be solved at the boundary today.

agentfootprint adopts **first-chunk arbitration** (the same pattern LangChain uses in `RunnableWithFallbacks`):

- **Pre-first-chunk failures** — full rule set fires (retry, retry-other, fallback, fail-fast).
- **Post-first-chunk failures** — only `ok` and `fail-fast` are honored. Rules wanting retry/retry-other/fallback are escalated to fail-fast with `kind: 'mid-stream-not-retryable'`.

The consumer keeps streaming on or off as their own choice; reliability adapts. See the [reliability gate guide](https://footprintjs.github.io/agentfootprint/guides/reliability-gate/) for the industry-pattern comparison and design rationale.

#### Implementation

- **`src/core/agent/stages/reliabilityExecution.ts`** (new) — JS retry-loop helper invoked by `callLLM` when reliability is configured. Pure function over the LLMCallFn callback; reuses `CircuitBreaker.ts` admit/recordSuccess/recordFailure pure functions; reuses `classifyError` for `errorKind` taxonomy. Closure-local state (attempt, providerIdx, breakerStates, attemptsPerProvider) — closure not scope, because this loop runs WITHIN one footprintjs stage execution.
- **`src/core/agent/stages/callLLM.ts`** — refactored: extracted `singleProviderCall` so the SAME call function feeds both the unconfigured path (single-shot) and the reliability path (retry loop). Streaming chunk emission unchanged; added `onFirstChunk` hook for the arbitration boundary.
- **`src/core/agent/AgentBuilder.ts`** — new `.reliability(config)` method (throws on double-call).
- **`src/core/Agent.ts`** — new constructor parameter + private field; threaded through `buildCallLLMStage`. `finalizeResult` translates fail-fast scope state into typed `ReliabilityFailFastError` at the API boundary.
- **`package.json`** — `./reliability` subpath added to exports map (alongside existing `./security`, `./locales` etc.).

#### Tests + example

- **`test/core/agent-reliability.test.ts`** (new) — 5 integration tests via the public surface: happy path, retry success, post-decide fail-fast, pre-check fail-fast, double-builder rejection.
- **`examples/features/09-reliability-gate.ts`** (new) — three runnable scenarios (happy / retry / fail-fast) with `process.exit(1)` regression guards.
- **`test/core/reliability-gate-example.test.ts`** (new) — integration test wrapping the example so docs-page consumers stay aligned.
- Suite: **1806 / 1806 passing** (was 1805 before this release).

#### Documentation

- **`docs-site/src/content/docs/guides/reliability-gate.mdx`** (new) — design memo covering decision verbs, streaming semantics, industry comparison (Anthropic SDK / OpenAI SDK / LangChain `RunnableRetry` & `RunnableWithFallbacks` / LangGraph Pregel / Strands / LlamaIndex / Llama Stack), and composition with the v2.10.x reliability primitives.

#### Why this design

- **Loop-internal retry** (rather than chart-level loopTo subflow) preserves streaming, cost tracking, and the existing CallLLM event surface unchanged. Retry attempts are one stage execution; richer "every retry as a separate stage" tracing is available today via `buildReliabilityGateChart` for consumers composing raw `LLMCall + gate` patterns directly.
- **Closure state, not scope state** — the retry loop runs inside one footprintjs stage execution. Putting attempt/breakerStates into scope would commit them across iterations of the agent's outer ReAct loop, which is not the intent.
- **Reconstruct cause at the API boundary** — Error instances don't `structuredClone` cleanly through scope; we capture message+name as strings and rebuild the Error in `finalizeResult`. Consumers' `instanceof Error` checks still pass.

## [2.11.4]

### Fixed — actually fix non-null-assertion warnings in src (don't just disable)

v2.11.3 cleaned the CI by turning off `@typescript-eslint/no-non-null-assertion` globally. v2.11.4 walks back the global disable: re-enables the rule for `src/`, fixes each of the 30 source-side warnings either with a proper guard or with a targeted `eslint-disable-next-line` carrying a one-line "why this is safe" reason. Tests stay permissive (`!` is idiomatic in test assertions where the framework guarantees the value).

#### Refactored to proper guards (no `!` retained)

- **`src/recorders/observability/FlowchartRecorder.ts`** — 7 sites: `boundary.onRunStart!(e)` etc. → `boundary.onRunStart?.(e)`. Optional chaining is actually MORE correct because BoundaryRecorder methods are optional on the FlowRecorder interface; the previous `!` would have crashed if a wrapped recorder didn't implement every hook.
- **`src/patterns/SelfConsistency.ts`** — 4 sites in the merge function: `extract(results[id]!)`, `order[0]!`, `tallies.get(best)!`, `tallies.get(vote)!` → guarded by `if (value === undefined) continue`, explicit empty-results throw, and `?? 0` fallbacks.
- **`src/resilience/fallbackProvider.ts`** — 3 sites: `providers[0]!`, `providers[providers.length-1]!`, `providers[i]!` → explicit `head`/`tail` consts with throw-on-unreachable + `if (!cur) continue` loop guard.

#### Suppressed with `eslint-disable-next-line` + intent comment (legitimate post-conditions)

- **`src/adapters/llm/MockProvider.ts`** (2) — cursor bounds-checked above; signal-defined invariant inside onAbort.
- **`src/adapters/observability/otel.ts`** (2) + **`src/adapters/observability/xray.ts`** (2) — `idx >= 0` guard above + 1-element splice result.
- **`src/cache/strategyRegistry.ts`** (1) — `'*'` wildcard set at module load by registerDefaults.
- **`src/core/agent/buildToolRegistry.ts`** (1) — `skills.length > 0` guard left of ternary; assertion only fires on the truthy branch.
- **`src/lib/rag/indexDocuments.ts`** (1) — bounded by `i >= texts.length` early-return.
- **`src/memory/causal/loadSnapshot.ts`** (1) + **`src/memory/embedding/loadRelevant.ts`** (1) — `store.search` required when an embedder is configured (validated upstream by `defineMemory`).
- **`src/recorders/observability/commentary/commentaryTemplates.ts`** (1) — `hasDesc` boolean guarantees `desc` is a non-empty string.
- **`src/resilience/withCircuitBreaker.ts`** (1) — stream method conditionally defined only when `inner.stream` exists.
- **`src/resilience/withRetry.ts`** (1) — guarded by `if (provider.stream)`.
- **`src/strategies/attach.ts`** (1) — caller validates `onHandle` is set when `mode !== 'forget'`.
- **`src/stream.ts`** (1) — `queue.length > 0` guards the shift.

#### `.eslintrc.js`

- `@typescript-eslint/no-non-null-assertion`: `'warn'` (was `'off'` in v2.11.3) for src.
- Test file override now explicitly turns `no-non-null-assertion` off (idiomatic in test assertions).

#### Verification

- `npm run lint` — **0 problems** (was 365 in v2.11.2 → 0 in v2.11.3 via global disable → 0 in v2.11.4 via actual fixes).
- `tsc --noEmit` clean.
- Full suite: **1800 / 1800 passing**, no regressions.
- Release pipeline (8 gates) passes.

## [2.11.3]

### Fixed — CI lint pipeline cleaned to zero warnings

Per-commit CI lint job now passes cleanly (0 warnings) instead of surfacing 365 noisy GitHub Actions annotations on every push. The release script's gate was always tighter (`--max-warnings=99999` tolerated, fixed manually before tagging) — this release brings the per-commit CI in line so PRs and merges stay actionable.

#### Changes

- **`.eslintrc.js`** — turn off `@typescript-eslint/no-non-null-assertion`. 359 of the 365 warnings were this rule firing on idiomatic `!` usage in tests (asserting on values known to exist after a check) and source (post-condition guarantees inside well-typed maps, e.g., `registryByName.get(name)!` after we just put it in). The rule was being routinely ignored — same effective safety from `tsc` + tests; less GitHub annotation noise.
- **`src/events/dispatcher.ts`** — extracted `noopUnsubscribe` const for the already-aborted-signal path; lifts the inline `() => {}` to a named, JSDoc'd intent.
- **`src/memory/define.types.ts`** — `_T` phantom-type-parameter on `ReadonlyMemoryFlowChart<_T>` is intentional (lets consumers write `ReadonlyMemoryFlowChart<MyShape>` for documentation even though the brand erases at runtime); suppressed `no-unused-vars` with explanatory comment.
- **`src/reliability/buildReliabilityGateChart.ts`** — extracted `preContinueNoop` const for the PreCheck `'continue'` branch; lifts the inline `() => {}` to a named, JSDoc'd no-op (matches the rest of the file's pattern of named branch handlers).
- **`src/strategies/attach.ts`** — extracted `noopHostStage` for the detach-executor's host chart; updated `NOOP_UNSUBSCRIBE` to explicit `(): void => undefined`.
- **`src/strategies/compose.ts`** — added intent comment + lint-suppress on the `flush().catch(() => {})` swallow (passive-recorder discipline: flush errors don't propagate to consumer; recorder's own onError is the right channel).

#### Verification

- `npm run lint` — 0 problems (was 365 warnings).
- Full suite: **1800 / 1800 passing**, no regressions.
- `tsc --noEmit` clean.
- Release pipeline (8 gates) passes all gates.

#### What this is NOT

- **No public API changes.** All 7 modified files are either configuration or no-op extractions.
- **No behavior changes.** Lifting an inline `() => {}` to a named const, or swapping `() => {}` for `(): void => undefined`, produces identical runtime behavior.
- **No reliability wiring yet** — that lands in v2.11.4+ (the `buildAgentChart.ts` wiring + agent-builder `.withCircuitBreaker()`/`.withRetry()`/`.withFallback()` methods + `Agent.run()` error translation).

## [2.11.2]

### Refactored — Agent.ts decomposition complete

`core/Agent.ts` reduced from **2249 LOC → 710 LOC (−68%)** by extracting 11 focused files under `src/core/agent/`. **Public API surface is unchanged** — every external import site (28 of them) continues to work via re-exports from `Agent.ts`. Behavior is identical; this is a pure code organization release.

#### Files extracted to `src/core/agent/`

- **`types.ts`** — `AgentOptions`, `AgentInput`, `AgentOutput` (PUBLIC, re-exported from `Agent.ts`) + internal `AgentState`.
- **`validators.ts`** — `validateMemoryIdUniqueness`, `validateToolNameUniqueness`, `clampIterations`, `safeStringify`. Pure helpers, no class state.
- **`AgentBuilder.ts`** — full fluent builder class (547 LOC). Re-exported from `Agent.ts`.
- **`buildToolRegistry.ts`** — pure function composing the 3-source tool registry (static `.tool()` + auto-attached `read_skill` + skill-supplied tools). Handles autoActivate skill scoping + cross-source name uniqueness + same-Tool-reference dedupe across skills.
- **`buildAgentChart.ts`** — the FlowChart composition that wires every stage + slot subflow + memory subflow together. Takes a comprehensive `AgentChartDeps` interface enumerating all dependencies. The reliability gate chart (v2.11.1 foundation) wires into this file in v2.11.3+.
- **`stages/breakFinal.ts`** — terminates the ReAct loop ($break + return finalContent).
- **`stages/iterationStart.ts`** — emits per-iteration marker event.
- **`stages/route.ts`** — decider routing to 'tool-calls' or 'final'.
- **`stages/seed.ts`** — initial scope state. Factory takes `consumePendingResumeHistory` + `getCurrentRunId` accessors so the resume side-channel and current run id remain dynamic.
- **`stages/callLLM.ts`** — the LLM invocation. Factory takes provider/model/cache strategy/pricing. Streaming-first; falls back to `complete()` for the authoritative response.
- **`stages/toolCalls.ts`** — pausable tool-execution handler. Factory takes `registryByName` + optional `externalToolProvider` + optional `permissionChecker`.
- **`stages/prepareFinal.ts`** — captures turn payload for the final-branch subflow.

#### Pattern: factory functions take explicit deps

Every extracted stage that previously closed over `this.X` becomes a `build*(deps)` factory taking explicit dependencies as args. No `this` references in the extracted code; everything is testable in isolation. Per-run mutable accessors (e.g., `consumePendingResumeHistory` for the resumeOnError side-channel) are passed as closure functions so the dynamic behavior survives the move.

#### What's left in `Agent.ts` (710 LOC)

- Agent class declaration + 18 readonly fields (~150 LOC)
- Constructor (validates uniqueness, defaults cache strategy)
- Public methods (toFlowChart, getSpec, run, runOnce, resumeOnError, resume, parseOutputAsync, runTyped, getLastSnapshot, getLastNarrativeEntries)
- Private helpers (createExecutor + recorder attachment, finalizeResult, installCheckpointTracker, detectPause)
- `buildChart()` — now an ~80-line wire-up that captures `this.X` deps as locals, builds 4 slot subflows, builds 6 stage handlers via factories, calls `buildAgentChart()` and returns

#### Why this lands as its own release

1. **Atomic checkpoint.** The decomposition is a clean, behavior-preserving refactor that reviews independently of the v2.11.1 reliability foundation and the upcoming v2.11.3 wiring.
2. **De-risks the next step.** The reliability gate wiring (v2.11.3) touches `buildAgentChart.ts` (250 LOC) instead of a 2249-line monolith. Smaller blast radius, easier review, easier rollback.
3. **Sets the pattern for future subsystems.** Cache layer (v2.6) followed the same shape; reliability (v2.11.x), governance (planned), and any future cross-cutting concern should compose into `buildAgentChart.ts` rather than fight a giant `Agent.ts`.

#### Verification

- Full suite: **1800 / 1800 passing** (no regressions; same count as v2.11.1).
- `tsc --noEmit` clean.
- All 28 external import sites for `Agent`, `AgentBuilder`, `AgentInput`, `AgentOptions`, `AgentOutput` continue to work unchanged via `Agent.ts` re-exports.

#### Coming next (v2.11.3+)

- Wire the v2.11.1 reliability gate chart into `buildAgentChart.ts` via `addSubFlowChartNext('sf-reliability', gateChart)` between `IterationStart` and `CallLLM` when reliability is configured.
- Add agent-builder methods `.withRetry()` / `.withCircuitBreaker()` / `.withFallback()` to `AgentBuilder.ts`; each populates a unified internal `ReliabilityConfig`.
- Wire `Agent.run()` error translation: read `scope.reliabilityFailKind` from snapshot, throw `ReliabilityFailFastError` at the API boundary.
- Integration test exercising all three reliability modes through a real agent run.

## [2.11.1]

### Added — Reliability v2.11 internal foundation + Agent.ts decomposition (step 1)

Internal infrastructure for the rules-based reliability refactor flagged in v2.11.0's "Coming next" section. **Public API surface is unchanged** in this release — the foundation lands first as its own atomic checkpoint; wiring it into the Agent's chart lands in a follow-up patch once the Agent.ts decomposition is complete.

#### Reliability foundation (`src/reliability/`)

- **Multi-stage gate chart** built using footprintjs's native `decide()` DSL via `addDeciderFunction`. Shape: `Init → PreCheck (decider) → CallProvider → PostDecide (decider) → loopTo('pre-check')`. Branches that don't `$break()` fall through to the loopTo target → retry semantics; branches that `$break()` escape the loop with the appropriate scope state (success/failure).
- **`CircuitBreaker` as a pure state machine.** Refactored from a class with instance state to PURE FUNCTIONS (`admitCall`, `recordSuccess`, `recordFailure`, `initialBreakerState`) that take + return a serializable `BreakerState` record. State now lives in scope (round-trippable across gate invocations via inputMapper/outputMapper) instead of closure. Visible in commitLog; ready for v2.12 distributed-state via a future `BreakerStateStore` adapter.
- **`classifyError`** — pure function mapping any thrown error to a coarse `errorKind` taxonomy (`'5xx-transient'`, `'rate-limit'`, `'circuit-open'`, `'schema-fail'`, `'unknown'`) so rules match on a structured field rather than regexing on `error.message`.
- **`ReliabilityRule` / `ReliabilityScope` / `ReliabilityFailFastError` types** with full JSDoc on the three-channel discipline: scope state for runtime data (read by `Agent.run()` at the API boundary), `$emit` for passive observability (CloudWatch/X-Ray/OTel), `$break(reason)` for control flow + human narrative reason.
- **17 7-pattern tests** drive the gate chart end-to-end via real `FlowChartExecutor`, verifying retry, retry-other, fallback, and fail-fast semantics through the decider DSL. Tests pass in isolation; foundation is ready for wiring into the Agent chart in v2.11.2.

#### Agent.ts decomposition (step 1 of N)

Begin breaking up the 2249-LOC `core/Agent.ts`. Step 1 extracts the safe, dependency-free pieces using the **index-file pattern**: extracted modules live under `src/core/agent/`, and `Agent.ts` re-exports them so the 28+ existing import sites stay valid.

- **`src/core/agent/validators.ts`** — 4 pure helpers (`validateMemoryIdUniqueness`, `validateToolNameUniqueness`, `clampIterations`, `safeStringify`).
- **`src/core/agent/types.ts`** — both PUBLIC types (`AgentOptions`, `AgentInput`, `AgentOutput`) and INTERNAL `AgentState`. `Agent.ts` re-exports the public ones for back-compat.
- **`Agent.ts`: 2249 → 2006 LOC** (−243). Behavior unchanged.

Steps 2-N will extract the inline stage functions (seed, iterationStart, callLLM, route, toolCalls, breakFinal, updateSkillHistory, cacheGate) to `src/core/agent/stages/*.ts` and the chart composition to `src/core/agent/buildAgentChart.ts`. Each becomes a `build*(deps)` factory taking explicit dependencies — no `this` references in extracted code. Lands progressively in subsequent v2.11.x patches.

#### Verification

- Full suite: **1800 / 1800 passing** (1783 from v2.11.0 + 17 new reliability foundation tests).
- `tsc --noEmit` clean.
- Three-channel discipline locked into JSDoc as the canonical pattern for downstream subsystems.

#### Coming next (v2.11.2+)

- Complete the Agent.ts decomposition (extract 8 inline stages + chart composition).
- Wire the reliability gate chart into `buildAgentChart.ts` via `addSubFlowChartNext('sf-reliability', gateChart)` + a TranslateFailFast agent-level stage that translates the gate's `$break(reason)` into a typed `ReliabilityFailFastError` at the `Agent.run()` API boundary.
- Update existing builder methods (`.outputFallback()`, plus new `.withRetry()` / `.withCircuitBreaker()` / `.withFallback()` agent-builder methods) to populate the unified internal `ReliabilityConfig`. The existing standalone `withCircuitBreaker(provider, opts)` etc. functions in `agentfootprint/resilience` continue to work unchanged.

## [2.11.0]

### Added — Reliability subsystem documentation

Closes the docs/example gap noted during the v2.10.0 retrospective. v2.10.0 → v2.10.2 shipped the 3 reliability primitives; this minor release ships the unified docs + runnable example + integration test that the patch releases skipped.

- **`examples/features/08-reliability.ts`** — single runnable example covering all 3 reliability primitives end-to-end: `withCircuitBreaker` (vendor outage detection), `outputFallback` (3-tier degradation on schema failure), `resumeOnError` (mid-run failure recovery from JSON-serializable checkpoint). Three demo functions, isolated and copy-pasteable. With regression guards (`process.exit(1)` on any invariant violation).
- **`examples/features/08-reliability.md`** — companion explainer with the consumer-facing "what to copy" table.
- **`test/core/reliability-example.test.ts`** — integration test that imports `run()` from the example, asserts each of the 3 primitives engaged correctly, and pins the checkpoint shape via snapshot bounds. Catches silent example breakage so the docs page never lies.
- **`docs-site/src/content/docs/guides/reliability.mdx`** — new docs site page under Production Concerns sidebar group. Live-imports the example file via `<CodeFile path="..." />` so the docs snippet stays in sync with the runnable file. Covers all 3 primitives with state-machine diagrams, the per-instance vs distributed tradeoff for CircuitBreaker, the fail-open vs fail-closed tradeoff for outputFallback, and the tools-re-execute caveat for resumeOnError.
- **`docs-site/src/content/docs/index.mdx` updates** — "What ships today" list now mentions the Reliability subsystem with link to guide. "Roadmap" table updated through v2.11.0 with checkmarks for completed releases.
- **Sidebar entry** — "Reliability subsystem (v2.10)" added under Production Concerns.

Total project tests: **1783 / 1783 passing** (1781 from v2.10.2 + 2 new integration tests). Docs site builds clean (51 pages).

### Coming next

- **v2.11.1+** — Rules-based reliability refactor. Today's `withCircuitBreaker.shouldCount`, `withRetry.shouldRetry`, `withFallback.shouldFallback`, `outputFallback.fallback` are opaque predicate functions — invisible to the trace. v2.11.1 may refactor these to use footprintjs's `decide()` evidence-capture mechanism so every reliability decision lands in the narrative + commit log automatically (same pattern as the v2.6 cache layer's `CacheDecisionSubflow`). Design memo to follow.

## [2.10.2]

### Added — Reliability subsystem (part 3 of 3 — COMPLETE)

The Reliability subsystem ships its third and final piece. v2.10.0 was CircuitBreaker; v2.10.1 was outputFallback; v2.10.2 closes the trio with **fault-tolerant resume on error**.

- **`agent.resumeOnError(checkpoint)` + `RunCheckpointError` + auto-checkpoint at iteration boundaries.** Today's `agent.run()` throws on mid-run errors (LLM 500, vendor outage, tool throw, container restart) and the consumer must restart from scratch — losing every prior iteration's work. With this release, recoverable errors come wrapped in `RunCheckpointError` carrying a JSON-serializable checkpoint of the conversation history at the last completed iteration:

  ```ts
  import { Agent, RunCheckpointError } from 'agentfootprint';

  try {
    const result = await agent.run({ message: 'long task' });
  } catch (err) {
    if (err instanceof RunCheckpointError) {
      // Persist anywhere — Redis, Postgres, S3, queue, file.
      await checkpointStore.put(sessionId, err.checkpoint);

      // hours / restart / new process / next deploy later:
      const checkpoint = await checkpointStore.get(sessionId);
      const result = await agent.resumeOnError(checkpoint);
    } else {
      throw err; // non-recoverable — propagate
    }
  }
  ```

  **Three new exports** from the main barrel: `RunCheckpointError`, `AgentRunCheckpoint`, and `agent.resumeOnError(checkpoint, options?)`.

  **Auto-checkpoint at iteration boundaries** — the agent listens to its own `agentfootprint.agent.iteration_end` events and snapshots the conversation history into a per-run tracker. On error, the tracker's last snapshot is wrapped in `RunCheckpointError`.

  **Failure-phase classifier** — `RunCheckpointError.checkpoint.failurePoint.phase` is one of `'llm' | 'tool' | 'iteration' | 'unknown'`. Recognizes `CircuitOpenError` from v2.10.0, `AnthropicError` / `OpenAIError` / `BedrockError`. Goes straight into oncall postmortem queries.

  **Conversation-history checkpoint shape** — JSON-serializable, tiny payload, survives process restart. Tradeoff: tools inside the failed iteration **re-execute on resume**. For idempotent tools (read-only DB queries) this is fine; **for non-idempotent tools (charge card, send email) consumers MUST add their own idempotency keys**. Documented prominently. v2.10.3+ may add `toolCallId`-based dedup.

  **`AgentIterationEndPayload.history` field added** (optional, for back-compat).

  13 7-pattern tests covering happy path, error → checkpoint, end-to-end resume cycle, JSON round-trip, forward-compat version guard, missing-field validation, and failure-phase classifier. Total suite: **1781 / 1781 passing, 0 regressions.**

### Reliability subsystem complete

| Piece | Release | What it solves |
|---|---|---|
| **`withCircuitBreaker`** | v2.10.0 | Vendor outage detection; fail-fast in <5µs |
| **`outputFallback`** | v2.10.1 | Schema-validation failure; 3-tier degradation |
| **`resumeOnError`** | v2.10.2 | Mid-run failure recovery; checkpoint + restart |

### Coming next

- **v2.11.0** — Reliability guide on docs site + runnable example covering all 3 primitives end-to-end + integration test with snapshots. Closes the docs/example gap noted in the v2.10.0 retrospective.

## [2.10.1]

### Added — Reliability subsystem (part 2 of 3)

- **`.outputFallback({ fallback, canned })` — 3-tier degradation for output-schema validation failures.** Pairs with `.outputSchema(parser)`. When the LLM's final answer fails schema validation, instead of throwing `OutputSchemaError` to the caller, the agent falls through:

  1. **Primary** — LLM emitted schema-valid JSON. Caller gets the parsed value.
  2. **Fallback** — async `fallback(error, raw)` runs; its return value is re-validated against the schema.
  3. **Canned** — static safety-net value (validated against the schema at builder time so it's *guaranteed* to satisfy). When `canned` is set, the agent **NEVER throws** on output-schema failure — fail-open by construction.

  ```ts
  import { z } from 'zod';
  const Refund = z.object({ amount: z.number().nonnegative(), reason: z.string().min(1) });

  const agent = Agent.create({...})
    .system('You decide refund amounts.')
    .outputSchema(Refund)
    .outputFallback({
      fallback: async (err, raw) => ({
        amount: 0,
        reason: `manual review (LLM output: ${raw.slice(0, 200)})`,
      }),
      canned: { amount: 0, reason: 'unable to process — please retry' },
    })
    .build();

  // Caller never sees OutputSchemaError; gets a typed Refund either way.
  const refund = await agent.runTyped({ message: '...' });
  ```

  **Two typed events** fire on tier transitions for observability:
  - `agentfootprint.resilience.output_fallback_triggered` (tier 2 fired)
  - `agentfootprint.resilience.output_canned_used` (tier 3 fired — fallback also failed)

  **Builder-time `canned` validation** — the canned value is parsed against the schema at `.outputFallback({...})` time. Throws `TypeError` immediately if it doesn't satisfy. Misconfig surfaces in CI / dev, not at 3am when the fallback engages.

  **New method: `agent.parseOutputAsync<T>(raw)`** — async sister of `parseOutput`. Engages the fallback chain. The sync `parseOutput` stays back-compat — always throws on validation failure regardless of fallback config.

  **Fail-open vs fail-closed** is consumer choice:
  - With `canned` → agent NEVER throws on output failure (fail-open)
  - Without `canned` → if `fallback` throws or returns invalid value, the error propagates (fail-closed)

  13 7-pattern tests in `test/core/outputFallback.test.ts` covering all 3 tiers, builder-time validation, double-set guard, and event emission. Total suite: 1768 / 1768 passing, 0 regressions.

### Changed — `withCircuitBreaker` documentation

- **JSDoc note: per-instance scope, NOT distributed.** Each `withCircuitBreaker(...)` call holds its own breaker state in process memory. If you run 100 server replicas, each has its own independent breaker (matches Hystrix default). For cluster-wide coordination, layer your own Redis-backed counter via the `onStateChange` hook + `shouldCount` predicate. Surfaced after the 7-panel review on v2.10.0 — pure docs change, no API change.

### Coming next

- **v2.10.2** — `agent.resumeOnError(checkpoint)` + auto-checkpoint at iteration boundaries + `RunCheckpointError`. Reliability subsystem complete.
- **v2.11.0** — unified Reliability guide page on the docs site + runnable example covering all 3 reliability primitives + integration test.

## [2.10.0]

### Added — Reliability subsystem (part 1 of 3)

The Reliability subsystem was deferred from v2.5 → v2.6 → v2.7 → v2.8 → v2.9. It ships in three pieces — this release is the first.

- **`withCircuitBreaker(provider, options)` — Nygard-style circuit breaker decorator** under `agentfootprint/resilience`. Wraps any `LLMProvider`, tracks consecutive failures, and OPENS after `failureThreshold` failures. Once OPEN, calls fail-fast with `CircuitOpenError` (no network round-trip) until `cooldownMs` elapses. Then enters HALF-OPEN: probe calls run; `halfOpenSuccessThreshold` successes close the breaker; one failure re-opens it.

  ```ts
  import { anthropic, openai } from 'agentfootprint/llm-providers';
  import { withCircuitBreaker, withFallback } from 'agentfootprint/resilience';

  const provider = withFallback(
    withCircuitBreaker(anthropic({ apiKey }), {
      failureThreshold: 5,        // open after 5 consecutive failures
      cooldownMs: 30_000,         // stay open for 30s before probing
      halfOpenSuccessThreshold: 2, // need 2 probe successes to close
    }),
    withCircuitBreaker(openai({ apiKey })),
  );
  ```

  **Why this matters more than `withRetry`** — `withRetry` keeps hammering one provider with backoff during a multi-minute vendor outage. Each request burns 3 retries + backoff = ~3 sec of wasted latency before giving up to the fallback. Multiplied by your QPS, that's a lot of wasted time + tokens. The circuit breaker says "we just saw 5 failures in a row; stop calling for 30 seconds." Subsequent requests fail in <5µs, `withFallback` routes to OpenAI immediately.

  **Three states with explicit transitions:**

  ```
  CLOSED ──[ N consecutive failures ]──► OPEN
     ▲                                    │
     │                                    │ [cooldownMs elapsed]
     │                                    ▼
     └──[ M probe successes ]──── HALF-OPEN
  ```

  - **`shouldCount` predicate** — by default everything except `AbortError` counts toward the threshold. Override to ignore client errors (e.g., 4xx) so a malformed request doesn't trip the breaker for everyone.
  - **`onStateChange(state, reason)` hook** — fires on every transition. Wire to your observability stack (e.g., emit `agentfootprint.resilience.circuit_state_changed`).
  - **Streaming-aware** — `stream()` is decorated identically. A mid-stream error doesn't count toward the threshold (could be a content-filter trip on a single request); only stream failures BEFORE any chunk yields count.
  - **Composable** — wrap inside `withRetry` (per-attempt circuit check) or compose under `fallbackProvider` (which we recommend).

  **Performance:** OPEN-state rejection is sub-µs (10k rejections under 200ms in CI; <5µs/op on a hot core). The wrapped provider isn't called at all when OPEN — that's the whole point.

  12 7-pattern tests in `test/resilience/unit/withCircuitBreaker.test.ts` covering all state transitions (CLOSED → OPEN → HALF-OPEN → CLOSED, HALF-OPEN → OPEN), the `shouldCount` predicate, and composition with `withFallback`. Total suite: 1755 / 1755 passing, 0 regressions.

### Coming next — completing the Reliability subsystem

- **v2.10.1** — 3-tier `outputFallback(primary, fallback, canned)` for structured-output validation: when validation fails after maxIterations, fall through to a fallback output, then to a canned response. Different from provider fallback — this is about the SHAPE of the agent's final answer, not which LLM gets called.
- **v2.10.2** — `agent.resumeOnError(checkpoint)` + auto-checkpoint at iteration boundaries + `RunCheckpointError`. Today's pause/resume only handles intentional pauses (`askHuman`). With this, an LLM 500 mid-iteration throws `RunCheckpointError` carrying the last-known-good checkpoint, which the consumer can persist to Redis/queue/DB and resume hours/days later from a different process. Reliability subsystem complete.

## [2.9.0]

### Added

- **`otelObservability(opts)`** — OpenTelemetry distributed-tracing adapter under `agentfootprint/observability-providers`. The strategically biggest unlock since OTel-compat backends include the entire industry: **Honeycomb**, **Grafana Cloud / Tempo / Mimir**, **AWS Distro for OTel** (alternative to `xrayObservability`), **Datadog APM** via OTLP, **Splunk Observability Cloud**, **New Relic**, **Lightstep / ServiceNow Cloud Observability**, and any custom OTel collector pipeline.

  ```ts
  import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
  import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
  import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
  import { otelObservability } from 'agentfootprint/observability-providers';
  import { microtaskBatchDriver } from 'footprintjs/detach';

  // Set up OTel ONCE at app startup (BYO SDK + exporter).
  const provider = new NodeTracerProvider();
  provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter({
    url: 'https://api.honeycomb.io/v1/traces',
    headers: { 'x-honeycomb-team': process.env.HONEYCOMB_KEY },
  })));
  provider.register();

  agent.enable.observability({
    strategy: otelObservability({ serviceName: 'my-agent' }),
    detach: { driver: microtaskBatchDriver, mode: 'forget' },
  });
  ```

  **BYO SDK contract** — this adapter only takes `@opentelemetry/api` (the small typed API surface) as an OPTIONAL peer dep. The consumer brings the OTel SDK + exporter package(s) for their backend. That's what makes the adapter portable across every OTel-compat destination — we never lock in a particular exporter.

  - **Hierarchical span mapping** — same shape as `xrayObservability`: `agent.turn_start` → root span; `iteration_start` → child; `llm_start` / `tool_start` → leaf children. OTel parent-context propagation via `trace.setSpan(context.active(), parent)`.
  - **OTel GenAI + Tool semantic conventions** — `gen_ai.request.model`, `tool.name`, `iteration.number`, `cost.cumulative_usd` attributes follow OTel semconv where applicable.
  - **Sampling** — `sampleRate` option for per-strategy span dropping (separate from OTel SDK Samplers).
  - **`tool_end` with error sets ERROR span status** (per OTel `SpanStatusCode.ERROR` convention).
  - **`stop()` is leak-safe** — defensively ends any in-flight spans on teardown.
  - **`flush()` is a no-op by design** — OTel SDKs handle their own flushing via `provider.forceFlush()`. Documented in JSDoc; consumer's responsibility on shutdown.

  15 7-pattern tests in `test/observability-providers/otel.test.ts` against a mock tracer. Total suite: 1743 / 1743 passing, 0 regressions.

### Changed

- **Datadog adapter deferred** — `datadogObservability` was on the v2.9 roadmap. Datadog APM accepts OTLP, so consumers can point their OTel SDK at Datadog's OTLP endpoint and `otelObservability` covers the Datadog use case end-to-end. We'll ship a dedicated `dd-trace`-based adapter only if real-world feedback demands the native Datadog APM client.

### Coming next

- **v2.10.0** — first `cost-providers` adapter (`stripeCost`).
- **v2.11.x** — Reliability subsystem (CircuitBreaker / 3-tier fallback / `resumeOnError`) — deferred since v2.5.
- **v2.12.x** — `lens-browser` / `lens-cli` (visual debugger backends).

## [2.8.3]

### Added

- **`xrayObservability(opts)`** — AWS X-Ray distributed-tracing observability adapter under `agentfootprint/observability-providers`. Maps agentfootprint's event taxonomy onto hierarchical X-Ray segment trees:

  ```
  agent.turn_start          ↦  root segment (one trace per turn)
  agent.iteration_start     ↦  push subsegment under root
  stream.llm_start          ↦  push leaf subsegment (model call)
  stream.tool_start         ↦  push leaf subsegment (tool call)
  ```

  Result in the X-Ray Trace Map: a hierarchical timeline of every agent run — turn → iteration → llm-call/tool-call — queryable in X-Ray Insights, joinable with the rest of your AWS distributed trace via `AWSTraceHeader` propagation.

  ```ts
  import { xrayObservability } from 'agentfootprint/observability-providers';
  import { microtaskBatchDriver } from 'footprintjs/detach';

  agent.enable.observability({
    strategy: xrayObservability({
      region: 'us-east-1',
      serviceName: 'my-agent-prod',
      sampleRate: 0.1,                    // 10% sampling — decisions made at turn_start
    }),
    detach: { driver: microtaskBatchDriver, mode: 'forget' },
  });
  ```

  - **Hierarchical segment management**: per-turn stack tracks active segments by `runId` (events for multiple in-flight turns interleave correctly). Defensive `popSegment` matches by name to survive out-of-order `_end` events (e.g., pause/resume mid-turn).
  - **Sampling**: decisions made at `turn_start` and persist for the whole turn — partial traces never reach X-Ray.
  - **Standard X-Ray segment shape**: `name`, `id` (16 hex), `trace_id` (`1-{8hex}-{24hex}` per spec), `parent_id`, `start_time` / `end_time` (unix seconds), `annotations` (queryable in X-Ray Insights), `metadata` (visible but not queryable).
  - **Annotations on segments**: `model` on llm segments, `toolName` on tool segments, `cumulativeCostUsd` from `cost.tick` events lands on the topmost active segment.
  - **Batching**: up to 25 segments per `PutTraceSegments` call (X-Ray hard caps at 50). Default 1s flush window for low-traffic agents.
  - **`flush()` is shutdown-safe**: force-closes any in-flight turn segments so partial traces ship on graceful shutdown.

  Peer dep `@aws-sdk/client-xray` declared as **optional** in `peerDependenciesMeta` — consumers who never call `xrayObservability(...)` don't need the AWS SDK in their lockfile. Lazy-required via `lib/lazyRequire.ts`.

  Unlike `cloudwatchObservability` and `agentcoreObservability` (both share the `_buildCloudWatchObservability` base), X-Ray is a fundamentally different shape (spans + parent/child + sampling) so it doesn't share that base.

  12 7-pattern tests in `test/observability-providers/xray.test.ts`. Total suite: 1728 / 1728 passing, 0 regressions.

### Coming next

- **v2.9.0** — `otelObservability` (industry-standard OpenTelemetry) + `datadogObservability` (most-requested commercial vendor).
- **v2.10.0** — first `cost-providers` adapter (`stripeCost`).

## [2.8.2]

### Added

- **`cloudwatchObservability(opts)`** — generic AWS CloudWatch Logs observability adapter under `agentfootprint/observability-providers`. Same SDK as `agentcoreObservability` but **without** AgentCore-specific defaults. Use when you're shipping agent telemetry to CloudWatch and not running inside Bedrock AgentCore (most common case).

  ```ts
  import { cloudwatchObservability } from 'agentfootprint/observability-providers';
  import { microtaskBatchDriver } from 'footprintjs/detach';

  agent.enable.observability({
    strategy: cloudwatchObservability({
      region: 'us-east-1',
      logGroupName: '/myapp/agent-prod',
      logStreamName: `${process.env.HOSTNAME}/${Date.now()}`,
    }),
    detach: { driver: microtaskBatchDriver, mode: 'forget' },
  });
  ```

  Same peer dep + lazy-require contract as `agentcoreObservability`: `@aws-sdk/client-cloudwatch-logs` is declared **optional** in `peerDependenciesMeta`. Consumers who never call this factory don't need the AWS SDK in their lockfile. Bundlers don't pull the SDK into builds that never use the adapter.

  9 7-pattern tests in `test/observability-providers/cloudwatch.test.ts`. Total suite: 1716 / 1716 passing, 0 regressions.

### Changed

- **`agentcoreObservability` refactored to thin-wrap `cloudwatchObservability`'s shared base.** Both adapters now share one CloudWatch Logs hot-path — improvements (retry, sequence-token handling, metric emission) flow to every CloudWatch-shaped adapter automatically. Behavior-preserving: all 11 existing `agentcoreObservability` tests pass unchanged. The only observable difference between the two adapters is `strategy.name` (`'agentcore'` vs `'cloudwatch'`) — used for registry-lookup and diagnostics.

  Public API for `agentcoreObservability` is unchanged. `AgentcoreObservabilityOptions` is now a type alias for `CloudwatchObservabilityOptions` — kept as a separate type so future AgentCore-specific options (e.g., `agentcoreSessionId` propagation) can be added without a breaking change.

### Coming next

- **v2.8.3** — `xrayObservability` (AWS distributed tracing). Different SDK (`@aws-sdk/client-xray`), different shape (spans not log events), so won't share the CloudWatch base.
- **v2.9.x** — `otelObservability` + `datadogObservability`.

## [2.8.1]

### Added

- **`agentfootprint/observability-providers` — new grouped subpath for vendor observability strategies.** Follows the parallel-providers pattern v2.5 established for `llm-providers` / `tool-providers` / `memory-providers`. Future vendor adapters add an export here, NOT a new subpath — keeps `package.json#exports` from sprawling.

  Ships with one adapter:

  - **`agentcoreObservability(opts)`** — AWS Bedrock AgentCore observability adapter. Ships every `AgentfootprintEvent` to **CloudWatch Logs** in a structured-JSON shape AgentCore's hosted-agent telemetry layer understands. Buffers in `exportEvent` (sync + non-throwing); drains in `flush()` (async batch). Default flush window: 1s OR 10 KB, whichever first.

  ```ts
  import { agentcoreObservability } from 'agentfootprint/observability-providers';
  import { microtaskBatchDriver } from 'footprintjs/detach';

  agent.enable.observability({
    strategy: agentcoreObservability({
      region: 'us-east-1',
      logGroupName: '/agentfootprint/my-agent',
      logStreamName: `${process.env.HOSTNAME}/${Date.now()}`,
    }),
    detach: { driver: microtaskBatchDriver, mode: 'forget' },
  });
  ```

  Peer dep: `@aws-sdk/client-cloudwatch-logs` (declared as **optional** via `peerDependenciesMeta.{name}.optional = true` — only consumers who actually call `agentcoreObservability(...)` need to install it). Lazy-required via `lib/lazyRequire.ts` so bundlers don't pull the AWS SDK into builds that never use the adapter.

  `_client` test injection escape hatch lets tests skip the SDK require entirely. 11 7-pattern tests in `test/observability-providers/agentcore.test.ts`.

### Fixed

- **Roadmap JSDoc in `src/strategies/index.ts` corrected.** v2.8.0 ship notes mistakenly listed the per-vendor subpath naming (`agentfootprint/observability-agentcore`, `observability-cloudwatch`, etc.) — same anti-pattern v2.5 fixed for memory adapters when collapsing 6+ per-vendor subpaths into `memory-providers`. Now lists the correct grouped subpaths: `observability-providers`, `cost-providers`, `lens-providers`. Pure docs change; no code surface affected.

### Coming next

- **v2.8.2** — `cloudwatchObservability` (the same SDK without AgentCore-specific log-group conventions).
- **v2.8.3** — `xrayObservability` (AWS distributed tracing).
- **v2.9.x** — `otelObservability` + `datadogObservability` (industry-standard backends).

All future vendor adapters land under the existing `agentfootprint/observability-providers` subpath — no new subpaths.

## [2.8.0]

### Added

- **Detached observability via `footprintjs/detach` — `enable.observability(...)` and `enable.cost(...)` now accept an opt-in `detach` option** that schedules the strategy's hot-path call (`exportEvent` / `recordCost`) onto a [footprintjs detach driver](https://footprintjs.github.io/footPrint/guides/patterns/detach/) instead of running it inline. The agent loop returns immediately; exports flush on the driver's schedule. Sync inline behavior is unchanged when the option is omitted — full back-compat for every existing consumer.

  Three semantics:
  - `detach: { driver, mode: 'forget' }` — discard the handle. Pure fire-and-forget telemetry. (Default when `mode` omitted.)
  - `detach: { driver, mode: 'join-later', onHandle: (h) => ... }` — driver returns a `DetachHandle`; we deliver it to your callback so you can `await` later (graceful shutdown, tests, backpressure).
  - omitted (default) — sync inline, same as v2.7.x and earlier.

  ```ts
  import { microtaskBatchDriver, flushAllDetached } from 'footprintjs/detach';

  agent.enable.observability({
    strategy: datadogExporter(...),
    detach: { driver: microtaskBatchDriver, mode: 'forget' },
  });

  // Graceful shutdown:
  process.on('SIGTERM', async () => {
    const stats = await flushAllDetached({ timeoutMs: 10_000 });
    process.exit(stats.pending === 0 ? 0 : 1);
  });
  ```

  Pick a driver by environment: `microtaskBatchDriver` (default cross-runtime), `setImmediateDriver` (Node), `setTimeoutDriver` (cross-runtime, configurable delay), `sendBeaconDriver` (browser, survives page-unload), `workerThreadDriver` (CPU-isolated). All from `footprintjs/detach`.

  `enable.thinking` and `enable.lens` deliberately **stay sync** — UI/debugger render must feel responsive and can't be deferred to next microtask.

  9 new 7-pattern tests in `test/strategies/detach-integration.test.ts` (Unit / Boundary / Scenario / Property / Security / ROI). Total suite now 1696 passing, 0 regressions. New runnable example: `examples/features/06-detached-observability.ts`.

### Changed

- **footprintjs peer-dep bumped to `>=4.17.1`** (was `>=4.14.0`). The `detach` option requires the `footprintjs/detach` subpath shipped in 4.17.0 and the publish-pipeline fix shipped in 4.17.1.

## [2.7.3]

**Design memo: `strategy-everywhere.md` — AWS-first vendor adapter
roadmap for v2.8+.**

The v2.6 cache layer proved out a pattern: one DSL, N vendor
strategies, side-effect-import auto-registration, wildcard fallback.
Sonnet Dynamic ReAct dropped 36,322 → 6,535 input tokens (−82%) end
to end. v2.8+ generalizes this as the universal architectural pattern.

This release adds the design memo only — no code changes, no API
surface changes. Implementation lands in v2.8.0+ across separate
minors per vendor adapter.

### What the memo covers

- **Pattern lineage**: Strategy Pattern (GoF) + Bridge + Hexagonal +
  Provider model (.NET) + Algebraic effects (Plotkin/Pretnar). Same
  architectural shape, 5 names.
- **4 groups in scope for v2.8**: `enable.observability`, `enable.cost`,
  `enable.liveStatus`, `enable.lens` — each gets a strategy slot.
- **AWS-first adapter priority**: builds on the existing
  `memory-agentcore` peer-dep precedent. v2.8.1 ships
  `observability-agentcore` (AWS Bedrock AgentCore Observability —
  same SDK consumers already imported for memory). v2.8.2 ships
  `observability-cloudwatch`. v2.8.3 ships `observability-xray`.
  Non-AWS adapters (OTel, Datadog, Pino) follow in v2.9.x.
- **Locked-in design decisions** from a 7-expert panel review (AWS
  IAM, Datadog, OTel, Stripe, Vercel, React, Anthropic): discriminated
  union options, idempotent stop, tier knob with cost-of-on docs,
  sample-rate, dry-run mode for audit, zero-arg defaults, dev/prod
  auto-detect, `compose([...])` combinator.
- **Migration plan**: v2.8.0 additive; v3.0 removes deprecated flat
  `enable.thinking` / `enable.logging` / `enable.flowchart`.
- **Approval gates** before v2.8.0 implementation: strategy interface
  signatures locked, 1 vendor adapter prototyped end-to-end (suggest
  AgentCore as the first), mock-strategy contract test,
  performance baseline (`compose([...])` of 5 children must add ≤ 5%
  overhead).

### Files

- `docs/inspiration/strategy-everywhere.md` (canonical)
- `docs-site/src/content/docs/inspiration/strategy-everywhere.mdx` (mirrored)
- `docs-site/astro.config.mjs` (sidebar entry)
- `docs/inspiration/README.md` (index updated — third pillar after
  Palantir/Liskov: "the scaling spine")

No code change. 1630/1630 tests pass.

## [2.7.2]

**Docs + example for the `agentfootprint/status` subpath.**

The v2.7.0 subpath shipped without a runnable example. v2.7.2 adds:

- **`examples/features/06-status-subpath.ts`** — runnable end-to-end
  example. Subscribes to `'*'` (the global wildcard), feeds events to
  `selectThinkingState`, renders via `renderThinkingLine` with
  per-tool template overrides. Same path Neo's chat-bubble feed uses.
  Now part of the CI sweep — future regressions in the subpath get
  caught before release.
- **`examples/features/06-status-subpath.md`** — companion guide.
  Explains the state machine, the renderer, built-in template vars
  (`{{appName}}` / `{{toolName}}` / `{{toolCallId}}` / `{{partial}}` /
  `{{question}}`), and where consumers need to walk events directly
  for arg-aware templates.
- **README — "Chat-bubble status surface" bullet** in "What ships
  today", linking the high-level `enable.thinking` and low-level
  `agentfootprint/status` paths so consumers see both.

No code change. Tests still 1630/1630.

## [2.7.1]

**Docs fix: `'agentfootprint.*'` is NOT a valid wildcard pattern.**

Four docs incorrectly told consumers to subscribe via
`agent.on('agentfootprint.*', listener)`:

- `CLAUDE.md` line 429
- `AGENTS.md` line 429
- `docs-site/.../debug.mdx` line 12
- `ai-instructions/claude-code/SKILL.md` line 371

The `EventDispatcher` only accepts:

| Pattern | Match |
|---|---|
| `'*'` | every event |
| `'agentfootprint.<domain>.*'` | every event in one domain (15 domains: `agent`, `stream`, `context`, `tools`, `memory`, `cost`, `error`, `pause`, `embedding`, …) |
| Specific type | one event |

`'agentfootprint.*'` (just the namespace, no domain) silently matches
nothing — the dispatcher's wildcard table doesn't include it. TypeScript
catches it via `WildcardSubscription`, but consumers using `as never`
casts (or following these docs verbatim) hit silent zero-match: agent
runs, no events fire on the listener, chat UIs stay frozen on initial
state.

This bit a real consumer (Neo's chat-feed status bubble) — the
listener subscribed via the broken pattern, no events arrived, the
bubble stayed stuck on "Getting started…" through the entire run even
though the agent completed successfully and Lens received its events
through a different (correct) path.

### Fix

All 4 docs updated to:
- Recommend `'*'` for global subscription
- Document `'agentfootprint.<domain>.*'` for per-domain
- Explicitly call out that `'agentfootprint.*'` is invalid

No code change. No behavior change. Tests still 1630/1630.

## [2.7.0]

**New `agentfootprint/status` subpath** — chat-bubble status surface.

Tiny addition (one re-export file + one `package.json` exports entry)
that brings the thinking-state primitives in line with the rest of the
library's subpath organization:

| Subpath | What's in it |
|---|---|
| `agentfootprint/observe` | BoundaryRecorder, StepGraph, FlowchartRecorder |
| `agentfootprint/locales` | composeMessages, validateMessages, defaultThinkingMessages |
| `agentfootprint/status` ← **new** | selectThinkingState, renderThinkingLine, defaultThinkingTemplates, types |
| `agentfootprint/tool-providers` | staticTools, gatedTools, … |

### Why

Consumers building chat UIs / status indicators / Lens-style live
panels can now opt-in explicitly:

```typescript
// Before (still works — back-compat preserved)
import { selectThinkingState, renderThinkingLine } from 'agentfootprint';

// After (preferred for new code)
import { selectThinkingState, renderThinkingLine } from 'agentfootprint/status';
```

The import line is self-documenting (matches `agentfootprint/observe`
and `agentfootprint/locales` naming). Bundler tree-shaking is more
explicit. Future extended-thinking primitives (Anthropic
`thinking_delta` / `redacted_thinking`) will land here too without
inflating the main entry.

### What's exported

- `selectThinkingState(events)` — derive current state (idle / tool /
  streaming / paused / null) from the typed event log
- `renderThinkingLine(state, templates, ctx)` — resolve template +
  substitute vars to a final string
- `defaultThinkingTemplates` — bundled English defaults
- `type ThinkingTemplates` / `ThinkingState` / `ThinkingStateKind` /
  `ThinkingContext`

### Migration

Zero breaking changes. Main `agentfootprint` exports unchanged. New
code uses the subpath; old code keeps working indefinitely.

## [2.6.4]

**Fix: v2.6 cache-layer subflows leaked as fake user-visible steps in
the StepGraph.** When v2.6 introduced `CacheDecisionSubflow` (with
local id `sf-cache-decision`) and the `CacheGate` decider (stage id
`cache-gate`), neither was registered in `BoundaryRecorder`'s
`AGENT_INTERNAL_LOCAL_IDS` set. Result: every iteration of an agent
emitted `subflow.entry` / `subflow.exit` / `decision.branch` events
that weren't tagged `isAgentInternal: true`, so `FlowchartRecorder`
projected them as user-facing `StepNode`s. A 5-iteration run showed
~30 nodes instead of ~14 — every iter contributed 3 fake steps the
user had to scrub past. Same issue (pre-existing) for
`SUBFLOW_IDS.INJECTION_ENGINE`.

### Fix

Three ids added to `AGENT_INTERNAL_LOCAL_IDS` in
`src/recorders/observability/BoundaryRecorder.ts`:

```ts
SUBFLOW_IDS.INJECTION_ENGINE,   // pre-existing oversight
SUBFLOW_IDS.CACHE_DECISION,     // v2.6
STAGE_IDS.CACHE_GATE,           // v2.6 (decider stage id)
```

Plus a comment block warning future contributors: when adding a new
subflow to the Agent's internal flowchart, decide whether it's a
context-engineering moment (leave OUT — it should be a user-visible
step) or pure plumbing (add HERE — it's wiring, not a step).

### Regression guard

New test `test/recorders/observability/internal-ids-coverage.test.ts`
enumerates `SUBFLOW_IDS` and asserts every entry is categorized as
either a slot subflow OR an agent-internal id. The next time someone
adds a new entry to `SUBFLOW_IDS` without categorizing it, the test
fails by NAME so the bug is caught before it leaks into Lens.

### Verified

In the Neo MDS triage browser app (1630/1630 tests passing, lens dist
unchanged):

- 5-iteration run, before fix: 30+ visible step-graph nodes
- 5-iteration run, after fix: 14 nodes (1 Run + per-iter LLM/tool steps + final llm→user)

## [2.6.3]

**README rewrite + new `Inspiration` section in docs/site.** Three docs
moves bundled together:

1. **README rewrite** — leads with the abstraction-lineage framing
   (PyTorch autograd / Express / Prisma / Kubernetes / React → agentfootprint
   for context engineering). Same kind-of-move applied to a new domain.
   The hand-rolled vs declarative code comparison is now the visual hook;
   the differentiator section ("the trace is a cache of the agent's
   thinking") names the unique IP claim.

2. **New "Why it's shaped this way — two pillars" section** in the README.
   - **THE WHY (user-visible win):** Palantir's 2003 thesis applied to
     agent runtime — connect the four classes of agent data (state,
     decisions, execution, memory) so the next token compounds the
     connection instead of paying for it again.
   - **THE HOW (engineering discipline):** Liskov's ADT + LSP work, applied
     to flowcharts. Every framework boundary is LSP-substitutable.
     Subflows are CLU clusters. Locality of reasoning enforced as a
     runtime invariant.

3. **New `docs/inspiration/` section + matching `docs-site/inspiration/`**:
   - `README.md` (index) explaining the two-pillar structure
   - `connected-data-palantir.md` — full Palantir thesis → agentfootprint
     mapping; the four classes of agent data; where we go beyond Palantir
     (emergent vs pre-built ontology)
   - `modularity-liskov.md` — CLU clusters → subflows; LSP examples
     (CacheStrategy / LLMProvider / ToolProvider); locality of reasoning
     → operationalized; where we extend beyond classical Liskov
   - New "💡 Inspiration" sidebar section in the docs site between
     Architecture and Reference

Plus accuracy fixes uncovered during README verification:
- Provider count: 6 → **7** (Anthropic, OpenAI, Bedrock, Ollama,
  Browser-Anthropic, Browser-OpenAI, Mock)
- "47 typed events" → **48+ typed events** (recounted via grep)
- Strengthened the "frameworks that compose state per-node can't recompute
  cache markers in lockstep" claim about other frameworks (less
  combative phrasing, same defensible point)

No code change. 1627/1627 tests pass.

## [2.6.2]

**Docs: tool-dependency framing for Dynamic ReAct + remove application-specific
references.** Two unrelated docs cleanups bundled together:

1. **README — sharper rule for when to use Dynamic ReAct.** The previous
   benchmark-heavy section (4 sub-sections, multi-model token tables,
   parallelization caveats) led with the wrong heuristic ("30+ tools across
   8+ skills"). Replaced with the clearer rule: **use Dynamic ReAct when
   your tools have dependencies — when one tool's output implies which tool
   to call next.** Skills encode that workflow. If tools are independent
   and order doesn't matter, Classic is fine. The side-by-side example +
   "what Dynamic gives you that Classic doesn't" list is preserved; the
   noisy benchmark tables are gone.

2. **Removed all application-specific references.** Earlier docs referred
   to "Neo" (a Cisco MDS Fibre Channel triage agent used internally for
   benchmarking) by name. Generic phrasing now: "production-shaped Skills
   agent (10 skills, 18 tools after dedup)." Affected: README.md,
   CHANGELOG.md (2.6.0 + 2.5.0 entries), docs/guides/caching.md,
   examples/dynamic-react/README.md.

No code change. 1627/1627 tests still pass.

## [2.6.1]

**Lint cleanup + release-pipeline hardening.** v2.6.0 shipped with three
trivial eslint errors (`prefer-const`, `no-inferrable-types`) in cache
files and pre-existing test files. The release script's 8 gates didn't
include lint — only docs / format / build / tests / examples — so the
errors slipped through. Two-part fix:

1. **Source fix** — auto-applied via `eslint --fix`. Three lines changed
   across `src/core/Agent.ts`, `test/core/agent-toolprovider.test.ts`,
   and `test/recorders/contextEngineering.test.ts`. No behavior change.
2. **Process fix** — added Gate 2.85 to `scripts/release.sh`:
   `npm run lint --max-warnings=99999`. Errors fail the gate; warnings
   tolerated for now (334 pre-existing non-null-assertion warnings need
   a separate cleanup pass).

Net: all 1627 tests still pass; CI is green; future releases can't
ship with eslint errors.

## [2.6.0]

**Provider-agnostic prompt caching.** Dynamic ReAct repeats the same
stable prefix (system prompt + tool schemas + active skill body) on
every iteration. Without caching, every iter pays full price for that
duplicated context. v2.6 introduces a unified DSL — `cache:` policy on
each injection flavor — over per-provider strategies, so the right
cache hints land on the wire automatically.

### What's new

- **CacheDecision subflow** walks `activeInjections` each iteration,
  evaluates each injection's `cache:` directive, and emits a
  provider-agnostic `CacheMarker[]`.
- **CacheGate decider** uses footprintjs `decide()` with three rules —
  kill switch (`cachingDisabled`), hit-rate floor (skip when recent
  hit-rate < 0.3), and skill-churn (skip when ≥3 unique skills in the
  last 5 iters). Decision evidence captured for free.
- **5 cache strategies** (auto-registered via side-effect imports):
  - `AnthropicCacheStrategy` — manual `cache_control` on system blocks
    (4-marker clamp; surfaces `cache_creation_input_tokens` +
    `cache_read_input_tokens`)
  - `OpenAICacheStrategy` — pass-through (auto-cache); extracts
    `prompt_tokens_details.cached_tokens` for metrics
  - `BedrockCacheStrategy` — model-aware: Anthropic-style hints when
    modelId matches `^anthropic\.claude`, pass-through otherwise
  - `NoOpCacheStrategy` — wildcard fallback for unknown providers
  - Future: `GeminiCacheStrategy`
- **Per-flavor defaults** (overridable on each `defineX(...)`):
  - `defineSteering` → `'always'`
  - `defineFact` → `'always'`
  - `defineSkill` → `'while-active'`
  - `defineInstruction` → `'never'`
  - `defineMemory` → `'while-active'`
- **`cacheRecorder()`** — high-level observability; dump after a run
  for gate decisions + total markers emitted.
- **`Agent.create({ caching: 'on' | 'off' })`** — top-level kill switch
  (defaults to `'on'`).

### Validated on a production-shaped Skills agent

Same task, same scenario, against the live Anthropic API on a
10-skill / 18-tool agent:

| Mode (Sonnet 4.5) | cache=off | cache=on | Δ |
|---|---|---|---|
| Classic (no skill markdown) | 40,563 | (untested) | — |
| Static (all skill markdowns stuffed) | ~140,000 | 7,640 | **−95%** |
| **Dynamic (smart gating)** | **28,404** | **6,535** | **−77%** |

Cross-model Dynamic cache=on results:

| Model | cache=off | cache=on | Δ |
|---|---|---|---|
| Sonnet 4.5 | 36,322 | **6,535** | −82% |
| Haiku 4.5 | 36,309 | **13,637** | −62% |
| Opus 4.5 | 28,477 | **10,745** | −62% |

### Strategic implication

Pre-v2.6 the only economically sane Dynamic ReAct shape was smart
gating — bind tools and skill markdowns conditionally per iter.
Post-v2.6 you have a real second option: **stuff-and-cache** (put every
skill markdown into the system prompt always, let the cache layer carry
the cost). Both patterns are now first-class. Pick based on your team's
preferences, not on token cost alone.

### Migration

Zero breaking changes. Existing agents get caching for free if they use
Anthropic, Bedrock-Claude, or OpenAI providers. Disable explicitly with
`Agent.create({ caching: 'off' })`.

### Tests / Docs

- +66 tests in `test/cache/` (1627/1627 pass)
- New guide: [docs/guides/caching.md](docs/guides/caching.md) — Caching
  in 60 seconds + per-strategy reference + custom-strategy authoring
  template

## [2.5.1]

**Bug fix release.** v2.5.0 shipped with a single-line bug in the
`Agent.buildChart` InjectionEngine subflow mount: the `outputMapper`
was missing `arrayMerge: ArrayMergeMode.Replace`. Default footprintjs
behavior CONCATENATES arrays from child to parent, so each iteration's
`activeInjections` accumulated instead of replacing. Effect:
8 → 16 → 24 → 32 → 40 → 48 cumulative injections per turn instead
of the intended ~8-per-iter. The 8 always-on injection bodies were
duplicated 5× into the system prompt at iter 5, ballooning Dynamic
ReAct's input-token cost.

### The fix

One line added to the InjectionEngine subflow mount in `Agent.ts`:

```ts
arrayMerge: ArrayMergeMode.Replace,
```

Same fix that was already present on the SystemPrompt / Messages /
Tools subflow mounts. The InjectionEngine mount was missed in v2.5.0.

### Empirical impact (real Anthropic benchmark, 3 models × 2 modes)

| Model       | Dynamic in (v2.5.0) | Dynamic in (v2.5.1) | Δ       |
| ----------- | ------------------: | ------------------: | ------: |
| Haiku 4.5   |              62,571 |              36,341 | **−42%** |
| Sonnet 4.5  |              44,621 |              28,486 | **−36%** |
| Opus 4.5    |              44,590 |              28,401 | **−36%** |

Same scenario, same scripted answers, same iteration count. The
~36–42% drop is purely the system prompt no longer being duplicated.

### Regression tests

Three new tests in `test/core/dynamic-react-loop.test.ts` assert
bounded per-iteration injection counts:

- `activeInjections` ≤ 4 across 5 iterations
- `systemPromptInjections` ≤ 5 across 5 iterations
- `messagesInjections` ≤ 1.5× history length

These would have caught the v2.5.0 bug. Suite: 1490 → 1493.

### v1 marketing claim correction

v2.5.0's README claimed "Dynamic ReAct cuts input tokens 30–70%."
The real-world benchmark above shows this is **not universal** at sub-30-tool
scale. The corrected README now shows the real 3-model comparison
and explains:

- Dynamic provides **predictable cost** (varies <5% across models)
- Classic provides **lowest absolute cost** when the model parallelizes
- Dynamic wins clearly above ~30 tools across 8+ skills
- Dynamic ALWAYS wins on per-call payload size + deterministic routing

### Suite

1490 → 1493 (+3 regression tests).

## [2.5.0]

**Dynamic ReAct primacy + skill-driven tool gating.** This release
makes the Dynamic ReAct loop the load-bearing story: tools and
system-prompt content recompose every iteration, so an agent with
N skills × M tools no longer pays the full tool-list token cost on
every LLM call. Plus eight new builder/runtime features for
production agent surfaces.

### Block A — eight runtime + builder additions

- **A1 `.toolProvider()`** — first-class builder method for dynamic
  tool sources (registry-backed, MCP-mediated, runtime-decided).
- **A2 `PermissionPolicy`** — declarative role/capability allowlists
  on `agent.run({ identity })`. Tool-call recorder consults the
  policy; deny → tool throws `PermissionDeniedError`.
- **A3 `SkillRegistry.toTools()`** — explicit conversion API so
  consumers can opt skill-supplied tools into the static registry
  (gated by autoActivate mode).
- **A4 Builder ergonomics** — `.maxIterations()`, `.recorder()`,
  `.instructions()` on AgentBuilder.
- **A5 `autoActivate: 'currentSkill'`** — runtime tool gating: a
  skill's tools become visible to the LLM only when that skill is
  the most-recently-activated one. Cuts tool-list bloat for agents
  with N skills × M tools.
- **A6 `outputSchema(parser)`** — terminal-contract validation via
  `agent.runTyped()`. Uses footprintjs's schema abstraction
  (Zod-optional, duck-typed). On parse/validation failure throws
  `OutputSchemaError` with `.rawOutput` preserved.
- **A7 `flowchartAsTool(chart)`** — wraps a footprintjs FlowChart
  as an LLM-callable Tool. Inner pause throws with
  `error.checkpoint` attached (full nested-pause integration is on
  the v2.6 backlog).
- **A8 Richer `Skill`** — first-class `metadata`, `inject` shape,
  per-skill activation hooks. Subsumes v2.4 ad-hoc skill factories.

### Block B — `agentfootprint/{llm,tool,memory}-providers` + `/security`

Subpath restructure so consumers don't pay tree-shake costs for
adapters they don't use. v2.4's main barrel pulled every provider;
v2.5 splits them. The genuinely-clean per-adapter subpath
(Drizzle/Lucia pattern) is on the v2.6 backlog.

### Block C — Skills runtime per-mode routing

Closes the v2.4 Phase 4 commitment: `autoActivate` now actually
narrows the tool slot at runtime (was previously a static-only
hint). The Tools slot subflow consults `activatedInjectionIds`
each iteration.

### Block D — Message Catalog Pattern (`agentfootprint/locales`)

i18n-ready prose templates for Lens commentary and chat-bubble
thinking messages. `defaultThinkingMessages`, `composeMessages`,
`validateMessages` exports.

### Block E — examples README auto-generator

`scripts/generate-examples-readme.mjs` walks `examples/`, extracts
title + summary from each file's leading JSDoc, emits a
table-of-contents README. Runs as a release gate.

### Post-run trace accessors

`agent.getLastSnapshot()`, `agent.getLastNarrativeEntries()`,
`agent.getSpec()` — three accessors for post-run UIs (Lens Trace
tab, ExplainableShell, custom dashboards) to pull execution state
without intercepting the run() call site. `enableNarrative()` is
called inside `createExecutor()` so the entries array is populated
for any consumer that asks.

### BrowserAnthropicProvider — streaming-spec fixes

The v1→v2 rewrite regressed the SSE parser. v2.5 restores both:
**tool args via `input_json_delta`** (per-block accumulation, parsed
on `content_block_stop` — was always landing as `{}`) and
**cumulative usage tracking** from `message_start.usage` +
`message_delta.usage` (was always 0).

### Tool dedupe in Tools slot

Three sources can register the same tool name (static registry +
toolProvider + skill injection); LLMs reject duplicates. Tools
slot now dedupes by name + uses `ArrayMergeMode.Replace` on the
subflow output mapping (the documented fix to the documented
anti-pattern).

### Suite

1408 → 1490 (+82).

## [2.4.0]

**We made it impossible for our docs to lie.**

The headline of this release is structural: every code block on the
docs site is now imported from a real, runnable file in `examples/`.
A docs build fails if a referenced example doesn't exist or if a
named region marker is missing. Drift between docs and code becomes
impossible by construction — you can't ship a docs page that
documents an API that isn't there.

Suite: 1229 → 1253 (+24 from new Skills features). Pages: 67% drift
→ ~0%.

### The structural drift fix

- New `<CodeFile path="..." region="..." />` Astro component imports
  code from any file in the repo at docs-build time. Region markers
  in source files (`// #region NAME` / `// #endregion NAME`) let you
  show only the relevant slice.
- New CI job `docs` (`.github/workflows/ci.yml`) runs the docs-site
  build. A missing file → ENOENT. A missing region →
  `RegionNotFoundError`. Either kills CI.
- 35 of 42 docs pages converted to `<CodeFile>` imports. ~25 region
  markers added across `examples/`. Inline code blocks in the docs
  surface now exist only for illustrative anti-examples (the
  "without agentfootprint" 80-line block in the README).

### Skills features — the essay becomes truth

The `skills-explained.mdx` essay was the strongest piece of writing
in the docs and the most aspirational. Three features it described
now ship:

- `defineSkill({ surfaceMode })` — typed `'auto' | 'system-prompt' |
  'tool-only' | 'both'`. Default `'auto'` resolves per provider via
  `resolveSurfaceMode`.
- `defineSkill({ refreshPolicy })` — typed
  `{ afterTokens, via: 'tool-result' }` for re-injecting skill bodies
  past a token threshold. API surface ships today; runtime hook lands
  in v2.5 (long-context attention work) — non-breaking.
- `resolveSurfaceMode(provider, model)` — pure function, exported.
  Per-provider attention-profile defaults match the essay:
  Claude ≥ 3.5 → `'both'`; everywhere else → `'tool-only'`.
- `SkillRegistry` class — centralized governance for shared skill
  catalogs across multiple agents. Methods: `register / replace /
  unregister / get / has / list / size / clear`. Throws on duplicate
  register. Throws on non-Skill flavor inputs.
- `agent.skills(registry)` builder method — bulk-register every skill
  in a registry on an agent. Companion to existing `.skill(t)`.

Today's runtime treats every `surfaceMode` the same (the cross-
provider-correct activation + next-iteration injection pattern the
essay calls right). Full per-mode runtime routing diversity lands in
v2.5 — non-breaking; consumer code written today continues to work.

24 new tests cover the new API surface end-to-end.

### New navigation + 4 new pages

The docs site sidebar restructured around how readers actually
navigate (persona-aware grouping, max 7 items per group):

  Get Started → Mental model → Primitives & compositions →
  Context engineering → Memory → Observability → Production →
  Providers → Memory stores → Architecture → Reference → Resources

Four new pages address the gaps the multi-persona review surfaced:

- `manifesto.mdx` — "How agentfootprint thinks". First-person
  opinionated essay naming what we are, what we're not, what we
  believe, what we ask of you. The framework's perspective made
  tangible. Storyteller's voice.
- `causal-deep-dive.mdx` — researcher-grade snapshot deep-dive.
  Annotated JSON shape of a `RunSnapshot` byte-for-byte. Four
  projection modes documented. Worked Monday→Friday replay with
  cheap-model triage economic argument (Sonnet→Haiku follow-up
  at ~10× lower cost).
- `research/citations.mdx` — bibliography for every shipped pattern
  (ReAct, Reflexion, ToT, Self-Consistency, Debate, Map-Reduce,
  Swarm, Skills) with proper paper references + how the recipe in
  `examples/patterns/` relates to + deviates from each paper. Plus
  the augmented-LM survey as the conceptual root of our Injection
  primitive. Plus a BibTeX entry for citing agentfootprint.
- `architecture/dependency-graph.mdx` — 8-layer DAG diagram for
  senior engineers. Substrate (footprintjs) → events → adapters →
  memory → context engineering → primitives → compositions → public
  barrel. Documents the Hexagonal isolation property + per-layer
  subpath exports + anti-cycle CI enforcement.

### API reference — auto-generated via TypeDoc

- New devDeps: `typedoc` + `typedoc-plugin-markdown`.
- New script: `npm run docs:api`. Reads `src/index.ts`, follows the
  public exports, emits markdown to `docs/api-reference/`.
- Generated tree committed so consumers browsing GitHub can follow
  links to it directly. Five sections: classes/ + functions/ +
  interfaces/ + type-aliases/ + variables/.
- The 7 hand-written API ref pages (which were drifted) consolidated
  to a single `api/agent.mdx` placeholder that points at the
  generated tree.

### Coverage badge

- New devDep: `@vitest/coverage-v8`.
- New script: `npm run test:coverage`.
- New CI job `coverage` (`.github/workflows/ci.yml`) uploads
  `coverage/lcov.info` to Codecov via `codecov-action@v5`. No
  threshold enforcement — badge surfaces the number; consumers
  ratchet up over time.
- README badge added. Initial baseline: 85.75% lines, 83.77%
  statements, 90.30% functions, 73.20% branches across 3962
  statements.

### README rewrite

- Tagline changed: "Context engineering, abstracted."
- New autograd / Express / Prisma / Kubernetes / React framing places
  agentfootprint in the category of credible abstractions — not
  "another agent framework."
- Side-by-side "without (~80 LOC, drifts) vs with agentfootprint
  (~8 LOC, stable)" code blocks.
- "The trace is a cache of the agent's thinking" reframing of
  causal memory with three downstream consumers: audit, cheap-
  model triage, training data.
- "Why exactly four triggers? Because *who decides activation* is
  a closed axis: nobody / dev / system / LLM" — defensibly stable
  surface argument.
- Evergreen sections — no version-specific facts in the README. The
  npm version badge auto-updates from the registry; CHANGELOG carries
  per-release truth. **From now on the README never needs touching
  for a release.**

### Process

- Six 6-persona reviews (one per phase: 1, 2, 3, 4, 6 + Phase 7 final).
  Every review's adjustments folded into the next phase.
- Design memo signed off BEFORE code, per the v2.3 process change.
  No internal panel verdicts in JSDoc — design lives in
  `memory/agentfootprint_v24_design.md`.

### What's next (v2.5)

- Reliability subsystem — `CircuitBreaker`, 3-tier output fallback,
  `agent.resumeOnError(checkpoint, input)`. Deferred from v2.4.
- Skills runtime per-mode routing diversity — suppressing system-
  prompt slot for `'tool-only'`, synthesizing fresh tool-result for
  `refreshPolicy`. The API surface is shipped today; the runtime
  tightening lands in v2.5 non-breaking.

## [2.3.0]

Mock-first development is now a first-class workflow with two new
public surfaces, the first two production memory-store adapters
arrive as peer-deps via subpath imports, and `package.json` declares
every optional SDK in `peerDependenciesMeta`. Suite: 1229 / 1229.

### Added — `mock({ replies })` for scripted multi-turn agents

```typescript
import { Agent, mock, defineTool } from 'agentfootprint';

const provider = mock({
  replies: [
    // Iteration 1: LLM decides to call a tool
    { toolCalls: [{ id: '1', name: 'lookup', args: { topic: 'refunds' } }] },
    // Iteration 2: LLM produces final answer
    { content: 'Refunds take 3 business days.' },
  ],
});
```

Each `complete()` / `stream()` consumes one reply in order. Exhaustion
throws a clear error so a misnumbered script fails the test instead
of silently looping. `provider.resetReplies()` rewinds the cursor for
cross-scenario reuse.

### Added — `mockMcpClient({ tools })` (in-memory MCP server)

Drop-in replacement for `mcpClient(opts)` — same `McpClient` shape,
zero subprocess / network / SDK install. Build the entire MCP
integration offline, swap to real `mcpClient` when ready.

```typescript
import { Agent, mock, mockMcpClient } from 'agentfootprint';

const slack = mockMcpClient({
  name: 'slack',
  tools: [
    {
      name: 'send_message',
      description: 'Post a message to a channel',
      inputSchema: { type: 'object' },
      handler: async ({ text }) => `Posted: ${text}`,
    },
  ],
});

const agent = Agent.create({ provider: mock({ reply: 'ok' }) })
  .tools(await slack.tools())
  .build();
```

The `_client` injection on `mcpClient` is `@internal` because the SDK
shape isn't a stable public surface. `mockMcpClient` is the public,
documented mock entry point.

### Added — `RedisStore` (subpath: `agentfootprint/memory-redis`)

Persistent `MemoryStore` implementation backed by Redis. Lazy-requires
`ioredis`; no runtime cost when another adapter is in use.

```typescript
import { RedisStore } from 'agentfootprint/memory-redis';

const store = new RedisStore({ url: 'redis://localhost:6379' });
const memory = defineMemory({
  id: 'redis-window',
  type: MEMORY_TYPES.EPISODIC,
  strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
  store,
});
```

Implements every `MemoryStore` method except `search()`. `putIfVersion`
is atomic via a small Lua script (real CAS, not emulated). RedisSearch
(vector retrieval) lands as a separate adapter in a future release.

### Added — `AgentCoreStore` (subpath: `agentfootprint/memory-agentcore`)

AWS Bedrock AgentCore Memory adapter. Lazy-requires
`@aws-sdk/client-bedrock-agent-runtime`.

```typescript
import { AgentCoreStore } from 'agentfootprint/memory-agentcore';

const store = new AgentCoreStore({
  memoryId: 'arn:aws:bedrock:us-east-1:...:memory/my-mem',
  region: 'us-east-1',
});
```

Maps the `MemoryStore` interface onto AgentCore's session/event model.
Caveats called out in the JSDoc:

- `putIfVersion` is emulated client-side (read+write) — fine for
  single-writer-per-session deployments.
- `seen` / `feedback` use in-process shadow state (don't survive
  process restart). Use `RedisStore` for durable recognition.
- `search()` is NOT exposed in v2.3 — AgentCore's native retrieve API
  will land as a separate `agentcoreRetrieve()` helper in a future release.

### Changed — `package.json` peer-dep declarations

Every lazy-required SDK is now declared in `peerDependenciesMeta` with
`optional: true` so npm advertises the relationship without auto-installing
or warning:

- `@anthropic-ai/sdk` (was undeclared — silent peer-dep)
- `openai` (was undeclared)
- `@aws-sdk/client-bedrock-runtime` (was undeclared)
- `@aws-sdk/client-bedrock-agent-runtime` (new — AgentCore)
- `@modelcontextprotocol/sdk` (was undeclared)
- `ioredis` (new — Redis)
- `zod` (already declared)

Friendly install hints fire at first call when an SDK is missing — same
pattern as `AnthropicProvider` since v1.

### Examples

- `examples/features/07-mock-multi-turn-replies.ts` — scripted ReAct loop
- `examples/memory/08-redis-store.ts` — RedisStore with mock-injected client
- `examples/memory/09-agentcore-store.ts` — AgentCoreStore with mock-injected client

All run end-to-end via `npm run example <path>`.

### Tests

+66 new tests (1163 → 1229):
- +6 MockProvider replies (consumption order, toolCalls partial, exhaustion, reset, precedence, stream)
- +15 mockMcpClient (lifecycle, handler dispatch, arg coercion, error context, Agent integration, schema fidelity)
- +23 RedisStore (CAS Lua, TTL, multi-tenant isolation, GDPR forget, signatures, feedback)
- +22 AgentCoreStore (emulated CAS, session-keyed isolation, shadow state, GDPR forget)

### Process change — design memo BEFORE release

v2.3 ships with a 9-panel design memo signed off ahead of code, per the
process-change committed in v2.2.x: panel verdicts live in
`memory/agentfootprint_v23_design.md`, not in JSDoc.

## [2.2.0]

Adds MCP (Model Context Protocol) client integration. Connect to any
MCP server, pull its tools as agentfootprint `Tool[]`, register them
on your agent in one builder call. Validates the v2.0 thesis again:
new tool sources slot in via the existing `Tool` interface — no
engine code, no new event types.

### Added — `mcpClient` (Model Context Protocol client)

```typescript
import { Agent, mcpClient } from 'agentfootprint';

const slack = await mcpClient({
  name: 'slack',
  transport: { transport: 'stdio', command: 'npx', args: ['@example/slack-mcp'] },
});

const agent = Agent.create({ provider })
  .tools(await slack.tools())   // bulk-register every tool the server exposes
  .build();

await agent.run({ message: 'Send "deploy succeeded" to #alerts' });
await slack.close();
```

- Transports: `stdio` (local subprocess) and `http` (Streamable HTTP)
- Lazy-required `@modelcontextprotocol/sdk` peer-dep — zero runtime
  cost when MCP isn't used; friendly install hint if missing
- `_client` injection point for testing without the SDK
- Each MCP tool wraps as one agentfootprint `Tool` — `inputSchema`
  preserved verbatim; `callTool()` becomes the wrapped `execute()`
- MCP error responses (`isError: true`) throw with the server's
  message; non-text content blocks (image / resource) summarized as
  `[type]` placeholders (full multi-modal mapping is a future release)

### Added — `Agent.tools(toolArray)` builder method

Bulk-register companion to `.tool(t)`. Pair with
`await mcpClient(...).tools()` for the canonical MCP flow:

```typescript
agent
  .tools(await slack.tools())
  .tools(await github.tools())
  .tools(await db.tools())
  .build();
```

Tool-name uniqueness still validated per-entry across all sources
(MCP servers + manual `.tool()` calls). Duplicates throw at build
time.

### Added — `examples/context-engineering/08-mcp.ts` + `.md`

End-to-end runnable example using an injected mock MCP client. Same
code path as production; only the SDK construction is mocked. Pairs
with the existing 7 context-engineering examples.

### Internal

- 1157 tests (was 1141 — 16 new MCP tests across 7 patterns)
- 35 examples (was 34 — added 08-mcp.ts)
- AI tooling instructions (CLAUDE.md, AGENTS.md, all `ai-instructions/`)
  updated to cover MCP

## [2.1.0]

The first new context-engineering flavor since the v2.0 InjectionEngine
shipped. Validates the v2.0 thesis: "adding the next flavor is one new
factory file." defineRAG is exactly that — composes over the existing
memory subsystem (semantic + top-K + strict threshold), zero engine
changes, zero new event types.

### Added — RAG (`defineRAG` + `indexDocuments`)

Two-function public surface:

- `defineRAG({ id, store, embedder, topK?, threshold?, asRole? })` —
  the read-side factory. Returns a `MemoryDefinition` with RAG-friendly
  defaults (asRole='user', topK=3, threshold=0.7).
- `indexDocuments(store, embedder, documents, options?)` — the seeding
  helper. Embeds each doc, batches into `store.putMany()`. Used at
  application startup to populate the corpus before the first agent run.

Plus `Agent.rag(definition)` builder method — alias for `.memory()` so
consumer intent reads clearly:

```typescript
import {
  defineRAG, indexDocuments,
  InMemoryStore, mockEmbedder,
} from 'agentfootprint';

const embedder = mockEmbedder();
const store = new InMemoryStore();

await indexDocuments(store, embedder, [
  { id: 'doc1', content: 'Refunds processed in 3 business days.' },
  { id: 'doc2', content: 'Pro plan: $20/month.' },
]);

const docs = defineRAG({ id: 'product-docs', store, embedder, topK: 3, threshold: 0.7 });

agent.rag(docs);  // alias for .memory(docs); same plumbing
```

Strict threshold semantics: when no chunk meets the threshold, no
injection happens (no fallback to top-K-anyway). Same panel-decision
rule as defineMemory({strategy: TOP_K}).

Multi-tenant corpora supported via `IndexDocumentsOptions.identity`.

### Added — `examples/context-engineering/07-rag.ts` + `.md`

End-to-end runnable example demonstrating the full RAG flow (seed →
define → query → retrieved-context-injected). Pairs with the existing
6 context-engineering examples.

### Added — AI tooling instructions cover RAG

`CLAUDE.md`, `AGENTS.md`, and every file under `ai-instructions/`
updated to include the RAG section so AI coding tools generate v2.1
code by default.

### Internal

- 1141 tests (was 1121 — 20 new RAG tests)
- 34 examples (was 33 — added 07-rag.ts)
- Public exports: `defineRAG`, `DefineRAGOptions`, `indexDocuments`,
  `IndexDocumentsOptions`, `RagDocument` from top-level barrel

## [2.0.1]

The first npm-published v2 build. v2.0.0 was tagged on GitHub but the
publish workflow failed before reaching `npm publish` because of a
case-sensitive Linux CI failure (`mapReduce.ts` vs `MapReduce.ts`).
2.0.1 carries every v2.0 feature plus the post-tag fixes:

### Fixed
- `src/patterns/mapReduce.ts` → `MapReduce.ts` so case-sensitive Linux
  CI resolves `import '../../../src/patterns/MapReduce.js'`. macOS dev
  hid the issue.
- ESLint `require-yield` violation in
  `test/resilience/unit/withFallback.test.ts` (intentionally-empty
  generator that throws before yielding — suppression added locally).

### Changed
- Release script Gate 5: now runs the in-repo `examples/` sweep
  (`npm run test:examples` → typecheck + tsx end-to-end run) instead
  of the external `../agent-samples` repo. Examples are now the source
  of truth for the consumer surface.
- Root README: tagline reframed to "Building Generative AI applications
  is mostly context engineering" (was "Building agents..."). Quick Start
  leads with `anthropic({...})` not `mock({reply})`. Roadmap split
  into "What v2.0 ships (today)" + "What's next" so v2.0 reads as a
  complete release. "Why a context-engineering framework" comparison
  table moved up — right after the patterns recipes — where the
  contrast lands hardest.
- Root README: 3-line code teaser between install + the pedagogy
  sections so fluent readers see the builder API in 5 seconds.

### AI tooling overhaul
- `CLAUDE.md`, `AGENTS.md`, and every file under `ai-instructions/`
  rewritten for the v2.0 surface. The old contents were stale (copy
  of footprintjs's instructions or v1 agentfootprint patterns), so
  AI coding tools using bundled instructions would generate code
  against APIs that no longer exist. New surface covers:
  - 6-layer mental model
  - All four `define*` factories (Skill / Steering / Instruction / Fact)
  - `defineMemory({ type, strategy, store })` with 4 types × 7 strategies
  - Multi-agent via control flow (no `MultiAgentSystem` class)
  - Anti-patterns naming the v1 vocabulary so tools don't regress
    consumers to old APIs

## [2.0.0]

The release that lands the **6-layer mental model** end-to-end:
2 primitives + 3 compositions + N patterns + Context Engineering +
**Memory** + Production Features. Every layer is pure composition over
the layers below — no hidden primitives.

### Added — InjectionEngine (unified context-engineering primitive)

One `Injection` primitive evaluated by one engine subflow each
iteration, with N typed sugar factories that all reduce to the same
shape:

- `defineSkill(...)` — LLM-activated body + tools (auto-attaches `read_skill`)
- `defineSteering(...)` — always-on system-prompt rule
- `defineInstruction(...)` — predicate-gated, supports `on-tool-return` for Dynamic ReAct
- `defineFact(...)` — developer-supplied data injection

Consumer wires them via `Agent.create(...).skill(...)`, `.steering(...)`,
`.instruction(...)`, `.fact(...)`, or the generic `.injection(...)`. Every
flavor emits `agentfootprint.context.injected` with `source` discriminating
the flavor — Lens / observability surfaces show one chip per active
injection without per-feature special casing.

### Added — Memory subsystem (`defineMemory` factory)

Single factory dispatches `type × strategy.kind` onto the right
pipeline. The 2D mental model:

```
                MEMORY = TYPE × STRATEGY × STORE

  TYPE                       STRATEGY                    STORE
  ──────────────────         ──────────────────          ─────────
  EPISODIC   messages        WINDOW    last N            InMemoryStore
  SEMANTIC   facts        ×  BUDGET    fit-to-tokens  ×  Redis · Dynamo
  NARRATIVE  beats           SUMMARIZE LLM compress      Postgres · …
  CAUSAL ⭐  snapshots       TOP_K     score-threshold   (peer-deps in v2.1+)
                              EXTRACT   distill on write
                              DECAY     recency × access
                              HYBRID    composed
```

- `Agent.memory(definition)` builder method — multiple memories layer
  cleanly via per-id scope keys (`memoryInjection_${id}`)
- `agent.run({ message, identity })` — multi-tenant scope through the
  full `MemoryIdentity` tuple (tenant / principal / conversationId)
- READ subflow runs at `MEMORY_TIMING.TURN_START` (default; `EVERY_ITERATION`
  opt-in for tool-result-sensitive memory)
- WRITE subflow mounts in the Final route branch with `propagateBreak`
  so writes happen reliably before the loop terminates
- Strict TopK threshold semantics — no fallback when nothing matches
  (garbage past context worse than no context)

**Causal memory ⭐ — the differentiator no other library has.**
footprintjs's `decide()` / `select()` capture decision evidence as
first-class events during traversal. Causal memory persists those
snapshots tagged with the original user query; new questions match
against past queries via cosine similarity, injecting decision evidence
into the next turn's context. Cross-run "why did you reject X?"
follow-ups answer from EXACT past facts — zero hallucination. Same data
shape supports SFT/DPO/process-RL training-data export in v2.1+.

### Added — examples folder (33 examples, all runnable end-to-end)

- `examples/core/` — 2 primitives (LLMCall, Agent + tools)
- `examples/core-flow/` — 4 compositions (Sequence, Parallel, Conditional, Loop)
- `examples/patterns/` — 6 canonical patterns (ReAct, Reflexion, ToT, MapReduce, Debate, Swarm)
- `examples/context-engineering/` — 6 InjectionEngine flavors
  (Instruction / Skill / Steering / Fact / Dynamic-ReAct / mixed)
- `examples/memory/` — 7 strategy-organized memory examples
- `examples/features/` — pause-resume, cost, permissions, observability, events

Every example is a runnable end-to-end test (CI runs `npm run test:examples`
which now does both typecheck + sweep). New `npm run example <path>`
wraps tsx with the right runtime tsconfig so consumers don't need
`TSX_TSCONFIG_PATH` env-var gymnastics.

### Added — top-level public exports

```ts
import {
  // Memory
  defineMemory,
  MEMORY_TYPES, MEMORY_STRATEGIES, MEMORY_TIMING, SNAPSHOT_PROJECTIONS,
  InMemoryStore, mockEmbedder, identityNamespace,
  // InjectionEngine
  defineSkill, defineSteering, defineInstruction, defineFact,
  evaluateInjections, buildInjectionEngineSubflow,
  // … (existing core surface unchanged)
} from 'agentfootprint';
```

### Changed — Agent flowchart shape (internal — no consumer impact)

The Agent's main flowchart now has memory READ subflows mounted
between Seed and InjectionEngine, and the `Route → 'final'` branch is
now a sub-chart (`PrepareFinal → memory-write subflows → BreakFinal`)
so memory writes happen reliably before the loop terminates. This is
visible in narrative + Lens but doesn't change the consumer API.

### Changed — top-level scrub

- All `v2` marketing prefixes scrubbed from `src/` JSDoc / READMEs.
  The library is now just "agentfootprint", not "agentfootprint v2".
- Removed redundant `Execution stopped... due to break condition`
  console.info from footprintjs (3 sites — break is already recorded
  via `narrativeGenerator.onBreak`).

### Fixed — example runtime

- `examples/core/02-agent-with-tools.ts` — custom respond extracts
  city from user message instead of returning empty args
- All 33 examples now run end-to-end in CI; previously only typecheck
  was verified

### Internal — test counts

- agentfootprint: **1121 tests** (was 1044 in 1.23.0; +77 new memory tests)
- footprintjs (peer dep): 2436 tests pass after the leaked-log fix

### Roadmap (next minor releases)

| Release | Focus |
|---|---|
| v2.1 | Reliability subsystem (3-tier fallback, CircuitBreaker, auto-retry, fault-tolerant resume) + Redis store adapter |
| v2.2 | Governance subsystem (Policy, BudgetTracker, access levels) + DynamoDB adapter |
| v2.3 | Causal training-data exports (`exportForTraining({format})`) + RLPolicyRecorder |
| v2.4+ | MCP integration, Deep Agents, A2A |

## [1.23.0]

### BREAKING — but no users yet, shipped as minor

`AgentTimelineRecorder` redesigned around an event stream + selectors + pluggable humanizer. `getTimeline()` method + the `AgentTimeline` bundle interface are removed. Consumers compose typed selectors directly (or use a thin helper like Lens's `timelineFromRecorder`). Three-layer architecture:

```
EVENT STREAM              (structured, canonical — single source of truth)
    ↓
SELECTORS                 (typed, memoized, lazy, composable — THE API)
    ↓
VIEWS                     (renderer plugs in: React / Vue / Angular / CLI / Grafana)
```

### Added — new selector API on `AgentTimelineRecorder`

- `getEvents(): readonly AgentEvent[]` — raw structured event stream
- `selectAgent()`, `selectTurns()`, `selectMessages()`, `selectTools()`, `selectSubAgents()`, `selectFinalDecision()` — classic slices
- `selectTopology()` — composition graph for flowchart renderers (engineer view)
- `selectCommentary(cursor?)` — humanized narrative, one line per event (analyst view)
- `selectActivities(cursor?)` + `selectStatus(cursor?)` — breadcrumb + typing-bubble (end-user view)
- `selectRunSummary()` — tokens, tool counts, duration, skills activated
- `selectIterationRanges()` — iter ↔ event-index map for scrubbers
- `selectContextBySource(cursor?)` — per-slot injection ledger grouped by source (rag / skill / memory / instructions / ...) — powers slot-row badges in Lens and the "teach context engineering" pedagogical surface
- `setHumanizer(Humanizer)` — pluggable domain phrasings. Library defaults ("Thinking", "Running ${toolName}", "Got result") override per-tool for domain-friendly text ("Checking port status on switch-3"). Translation, localization, UX tone = humanizer swap, NOT data change.

### Added — new exported types

`AgentEvent` (discriminated union — the canonical contract), `Activity`, `StatusLine`, `CommentaryLine`, `RunSummary`, `IterationRange`, `IterationRangeIndex`, `ContextBySource`, `ContextSlotSummary`, `ContextSourceSummary`, `Humanizer`.

### Changed — `selectSubAgents()` heuristic

A topology subflow classifies as a sub-agent only if its descendants include one of the API-slot subflows (`sf-system-prompt` / `sf-messages` / `sf-tools`). This correctly distinguishes:
- **Single-agent runs** — the API-slot subflows are top-level, nothing wraps them → no sub-agents
- **Multi-agent runs** (Pipeline/Parallel/Swarm/Conditional) — each Agent wraps its own slots → each qualifies

Robust against future internal-agent subflow additions (auto-classifies as "internal").

### Composed primitive

`AgentTimelineRecorder` now composes footprintjs's `TopologyRecorder` (new in footprintjs 4.15.0) internally. Runner-side `setComposition()` handshake — DELETED. Composition shape discovered at runtime from the executor's traversal (subflow / fork / decision / loop events).

### Memoized selectors

Every selector is memoized by `(name, version, cursor)`. `version` increments on every `emit()` / `setHumanizer()` / `clear()` — long runs don't recompute unchanged views. Same selector call returns the same reference until new events arrive (referential equality for React).

### 10+ new pattern tests

selectActivities state machine + cursor, selectStatus idle/at-cursor, selectCommentary, selectRunSummary totals, humanizer override + fall-through + swap invalidation, selectIterationRanges, memoization reference equality, clear() invalidation, selectContextBySource grouping + cursor.

### Migration

```diff
- const t = agentTimeline();
- const timeline = t.getTimeline();
- timeline.turns;
- timeline.messages;
- timeline.subAgents;
+ const t = agentTimeline();
+ const turns = t.selectTurns();
+ const messages = t.selectMessages();
+ const subAgents = t.selectSubAgents();
```

UI libraries that want a bundled shape define their own helper (Lens ships `timelineFromRecorder(recorder)`).

## [1.22.0]

### attachRecorder() on every runner — multi-agent flows end-to-end

- **FlowChartRunner / ConditionalRunner / ParallelRunner / SwarmRunner**
  all gain `attachRecorder(recorder)` matching the AgentRunner contract.
  Returns detach function; idempotent on recorder id.
- Without this, `<Lens for={runner} />` for these multi-agent
  composition runners fell back to `runner.observe()` + flat
  AgentStreamEvent translation — losing `subflowPath`, which
  broke multi-agent grouping in Lens (subAgents always empty).
- New shared helper `attachRecorderToList()` so the four
  composition runners + AgentRunner stay in sync; future *Runner
  classes get the same behavior with one line of glue.
- 1960 / 1960 tests pass.

End-to-end multi-agent now works in `<Lens for={runner} />`:
- FlowChart pipeline (classify → analyze → respond) renders 3
  stacked sub-agent boxes
- Conditional / Parallel / Swarm samples render the right number
  of sub-agent boxes for their composition pattern

## [1.21.0]

### Multi-agent foundations

- **`runner.attachRecorder(rec)`** — new method on AgentRunner. Attach
  a recorder POST-BUILD; it participates in every subsequent `.run()`
  with the standard recorder lifecycle (clear() + emit-channel hookup
  via forwardEmitRecorders). Returns a detach function; idempotent on
  recorder id (matching the rest of the recorder-attachment contract).
  Lets `<Lens for={runner} />` consume EmitEvents directly (real
  runtimeStageId + subflowPath), unblocking multi-agent grouping.
- **`AgentTimeline.subAgents`** — new field on the timeline shape.
  Per-sub-agent slices for multi-agent runs (Pipeline / Swarm /
  Routing). Empty array for single-agent runs. Each entry is its own
  SubAgentTimeline with `id`, `name`, own `turns`, own `tools` —
  derived by grouping TimelineEntries by `subflowPath[0]`.
- **`SubAgentTimeline`** — new exported type. Self-contained sub-
  agent timeline shape that UIs iterate over for multi-agent
  rendering.
- **TimelineEntry now carries `subflowPath`** internally — preserved
  verbatim from the EmitEvent so the folder can derive sub-agents
  without re-reading source events.
- 7th pattern test added covering multi-agent grouping (Pipeline-style
  classify→analyze→respond) + single-agent's empty subAgents.

The data shape is the contract every UI library reads. `agentfootprint-
lens` 0.11+ uses it to render N agent containers (one per sub-agent)
for Pipeline / Swarm / Routing samples.

## [1.20.0]

### Agent identity surfaces on `AgentTimeline`

- **`agentTimeline({ name })`** — new option on the recorder factory.
  Set the display name once at recorder construction; surfaces on
  `timeline.agent.name`. Match this to `Agent.create({ name })` for
  end-to-end identity consistency.
- **`AgentTimeline.agent`** — new required field of shape
  `{ id, name }`. UI libraries read this directly instead of fishing
  the agent name out of `runtimeSnapshot.agentName / .name` or asking
  the consumer to thread a separate prop. Single source of truth.
- **New exported type `AgentInfo`** —
  `{ id: string; name: string }`. Shape of the new field.
- **Defaults**: `id` falls back to `agentfootprint-agent-timeline`,
  `name` falls back to `Agent`. UIs that get the fallback render
  "Agent · Agent" rather than crashing on undefined.
- **Multi-agent foundation**: each sub-agent recorder
  (`agentTimeline({ id: 'classify', name: 'Classify Bot' })`) carries
  its own identity → multi-agent shells render N labeled containers
  pulling each name from `timeline.agent.name` directly.
- 6th pattern test added, full suite green (1959 tests).

This is the data-layer counterpart to lens 0.9.0's "Agent container +
LLM rename" UI work. Lens reads `timeline.agent.name` to label the
dotted Agent boundary that wraps the LLM / Tool / Skill / satellites.

## [1.19.0]

### New recorder — `agentTimeline()` (the canonical agent narrative)

Parallels footprintjs's `CombinedNarrativeRecorder`. One place every UI
/ observability consumer translates the agentfootprint emit stream into
the agent-shaped narrative they render against — turns → iterations →
tool calls + per-iteration context injections + folded ledger. UI
libraries (`agentfootprint-lens`, `agentfootprint-grafana`, custom
dashboards) consume the same shape instead of each re-implementing
their own translation.

- **`agentTimeline(options?)`** factory, exported from both
  `agentfootprint` and `agentfootprint/observe`. Returns an
  `AgentTimelineRecorder` that extends footprintjs
  `SequenceRecorder<TimelineEntry>` and implements `EmitRecorder`.
  Gets storage, keyed index, range index, progressive `accumulate()`,
  and the `clear()` lifecycle hook for free — no reinvented
  bookkeeping.
- Attach via the standard `.recorder(t)` on AgentBuilder;
  `forwardEmitRecorders` routes to `executor.attachEmitRecorder(t)`.
- **Public types**: `AgentTimeline`, `AgentTurn`, `AgentIteration`,
  `AgentToolInvocation`, `AgentToolCallStub`, `AgentMessage`,
  `AgentContextInjection`, `AgentContextLedger`. These are the data
  contract every UI library consumes.
- **Context-injection routing** preserves semantics: events during the
  LLM phase shape THIS iter's prompt; events between phases shape the
  NEXT iter (skill activation post-`read_skill`).
- **Multi-agent**: `agentTimeline({ id: 'classify' })` — each sub-agent
  in a Pipeline/Swarm gets its own named recorder, its own snapshot
  slot.
- 5 pattern tests (`test/unit/agent-timeline-recorder.test.ts`):
  basic shape, ReAct loop ordering (tool_start after llm_end),
  context-injection routing, multi-turn, clear() lifecycle.
- Docs update in `src/recorders/README.md`.

## [1.18.0]

### Context engineering — first-class teaching surface

- **New `contextEngineering()` recorder** (`src/recorders/ContextEngineeringRecorder.ts`).
  Public consumer-facing recorder that subscribes to the emit channel and
  exposes a structured query API: `injections()`, `ledger()`,
  `ledgerByIteration()`, `bySource()`, `bySlot()`, `clear()`. Lets any
  UI layer (Lens, Datadog, custom panels) observe **who** injected
  **what** into **which** Agent slot, on every iteration. Mirrors
  `agentObservability()` in shape — same factory, same emit-channel
  substrate, different domain focus.

- **Context-injection emits land at the source of truth.**
  - `agentfootprint.context.rag.chunks` fires from
    `src/stages/augmentPrompt.ts` with role + targetIndex + chunkCount +
    topScore (was previously emitted before role/index were known).
  - `agentfootprint.context.skill.activated` fires from
    `src/lib/call/toolExecutionSubflow.ts` whenever
    `decision.currentSkill` flips post-`read_skill`. Carries `skillId`,
    `previousSkillId`, `deltaCount: { systemPromptChars, toolsFromSkill }`.
  - `agentfootprint.context.instructions.fired` fires when
    AgentInstructions fire on a turn — counted, with delta info.
  - `agentfootprint.context.memory.injected` fires from memory subsystem
    when prior-turn memory writes flow back into the prompt.

- **`forwardEmitRecorders()` helper**
  (`src/recorders/forwardEmitRecorders.ts`). Detects whether a
  user-supplied recorder implements `onEmit` and routes it to
  `executor.attachEmitRecorder()`. Wired into all 7 runners (Agent,
  LLMCall, RAG, FlowChart, Parallel, Swarm, Conditional) so
  `.recorder(contextEngineering())` Just Works without consumers having
  to know about footprintjs's three-channel observer architecture.

- **`StreamEventRecorder` forwards `agentfootprint.context.*`** events to
  the `AgentStreamEventHandler`, so consumers using `<Lens for={runner} />`
  see context events alongside stream events without a separate
  subscription.

### Multi-agent + EventDispatcher

- **`EventDispatcher`** — per-runner observer list pattern in
  `src/streaming/EventDispatcher.ts`. Foundation for the
  `runner.observe()` contract Lens consumes.
- Multi-agent type updates in `src/types/multiAgent.ts` + tests.

### Examples + tests

- Snapshot tests updated for the new emit events in execution traces.
- New test scaffolding for context-engineering recorder e2e
  (`test/integration/ce-recorder-e2e.test.ts`,
  `test/unit/context-engineering-recorder.test.ts`,
  `test/unit/context-injection-emits.test.ts`,
  `test/unit/runner-observe-contract.test.ts`).

### Docs

- New / updated guides: `dynamic-react.mdx`, `rag.mdx`, `swarm.mdx`,
  `key-concepts.mdx`, `quick-start.mdx`, `why.mdx`, `vs.mdx`,
  `debug.mdx`.
- README + index.mdx refreshed for the new context-engineering surface.

## [1.17.6]

### Examples — full footprintjs-style parity

- **Wrote 19 missing `.md` explainer files** so every `.ts` example now has
  a paired `.md` (31 / 31 — full 1:1 coverage matching the
  footprintjs/examples/ pattern). New explainers cover: `providers/` (3),
  `runtime-features/{streaming,instructions,parallel-tools,custom-route,memory}/`
  (6), `observability/` (4), `security/` (1), `resilience/` (2),
  `advanced/` (1), `integrations/` (2). Same frontmatter format
  (`name`, `group`, `guide`, `defaultInput`) and same section structure
  (When to use / What you'll see in the trace / Key API / Failure modes /
  Related) as the `concepts/` and `patterns/` explainers shipped in
  v1.17.5.

### Tests — snapshot regression detection

- **`test/examples-smoke.test.ts` now asserts `toMatchSnapshot()`** on
  every example's `run()` output. The previous version only verified
  "does it run without throwing?" — too weak to catch silent behavior
  drift. Now if a library change alters tool counts, iteration counts,
  branch selection, content shape, or any other observable result, the
  snapshot diff fails loudly and forces the author to either fix the
  example or update the golden with `npm test -- -u`.
- 31 baseline snapshots committed to `test/__snapshots__/`. Stable across
  re-runs (verified) — non-determinism (timestamps, latencies, generated
  trace IDs, JSON byte sizes) is scrubbed by a small `sanitize()` helper
  before comparison.
- Brings the in-repo gate to parity with footprintjs's
  `footprint-samples/test/integration` snapshot suite — but inside the
  main repo, no external sibling required.

## [1.17.5]

### Examples

- **Restructured `examples/` from feature-buckets into a lifecycle-based
  ladder** that mirrors the footprintjs/examples/ pattern. New folders:
  `concepts/` (the 7-concept ladder, in order), `patterns/` (Regular vs
  Dynamic + the 4 composition patterns each in their own file),
  `providers/`, `runtime-features/{streaming,instructions,memory,parallel-tools,custom-route}`,
  `observability/`, `security/`, `resilience/`, `advanced/`,
  `integrations/`. The old folders (`basics/`, `orchestration/`,
  `memory/`, `integration/`) are gone — files renumbered sequentially
  within their new home so `01,02,03,...` reflects learning order.
- **Added `examples/DESIGN.md`** explaining the categorization rationale,
  the file contract, and the playground-injection pattern. Added
  `examples/README.md` as the reader's entry point.
- **Every example now follows a single contract**: exports
  `run(input, provider?)` (factory pattern) + `meta: ExampleMeta`
  (catalog metadata for the playground) + a CLI fallback so
  `npx tsx examples/...` still works. The optional `provider` parameter
  lets the playground inject any LLMProvider at runtime — the example
  source stays clean and copy-pastable. Multi-provider examples
  (`planExecute`, `reflexion`, `treeOfThoughts`, `mapReduce`) accept an
  object with named slots declared in `meta.providerSlots`.
- **Split `orchestration/28-patterns.ts`** into four separate files
  under `patterns/` — one per pattern — so each is independently
  citable and runnable.
- **Added `concepts/05-parallel.ts`** — the Parallel concept previously
  had no standalone example.
- **Added paired `.md` files** for `concepts/` (7) and `patterns/` (5)
  with frontmatter (`name`, `group`, `guide`, `defaultInput`),
  "When to use", "What you'll see in the trace", "Key API",
  "Failure modes", and "Related concepts" sections — same shape as
  footprintjs/examples/building-blocks/*.md. Other folders' .md files
  will be added in follow-up patches.
- **New `examples/helpers/cli.ts`** centralizes the
  `isCliEntry(import.meta.url)` guard, the `printResult()` formatter,
  and the `ExampleMeta` type.

### Tests

- **New `test/examples-smoke.test.ts`** auto-discovers every example
  under `examples/`, verifies the file contract (`run` + `meta`
  exports with the right shape), and invokes each `run()` with the
  example's own scripted mock provider. 32 examples covered. This
  replaces the previous gate-5 dependency on
  `agent-samples/npm-run-all` — examples are now self-validating
  inside the agentfootprint repo.

### `agent-samples` (separate repo)

- **Updated `agent-samples/package.json`** to point at the new example
  paths so the cross-repo `npm run all` keeps working through the
  transition. Marked the package as DEPRECATED in its description —
  the in-repo smoke test supersedes it; the directory will be removed
  once the playground migration is complete.

## [1.17.4]

### Documentation

- **New `docs/guides/patterns.md`** covering both loop patterns
  (`AgentPattern.Regular` vs `Dynamic`) and the four composition pattern
  factories (`planExecute`, `reflexion`, `treeOfThoughts`, `mapReduce`)
  that ship from `agentfootprint/patterns` but were previously
  undocumented. Each pattern section includes an everyday analogy, the
  canonical research citation (Yao et al. 2023, Shinn et al. 2023, Wang
  et al. 2023, Madaan et al. 2023, Dean & Ghemawat 2004), an
  "honesty box" naming the simplification (e.g. shipped `reflexion`
  factory is closer to Self-Refine than full Reflexion), per-pattern
  observability + failure-mode notes, and a
  "Picking a quality pattern" decision table.
- **`docs/guides/concepts.md` updated to reflect the seven shipped
  concepts** (was documenting five — `Parallel` and `Conditional` were
  missing). Added builder + runner sections for both, plus
  per-concept analogies, ReAct/RAG/Swarm citations, and failure-mode
  notes for every concept.
- **`docs/guides/recorders.md` adds the missing `ExplainRecorder`
  section** — the per-iteration grounding evidence recorder that the
  README pitches as the differentiator. Also adds the LLM-as-judge
  caveat (Zheng et al. 2023) on `QualityRecorder`, the recorder-id
  idempotency rule, and updates the summary table with `ExplainRecorder`,
  `PermissionRecorder`, and `agentObservability()`.
- **All other guides (`quick-start`, `providers`, `adapters`,
  `orchestration`, `security`, `instructions`, `streaming`) reviewed
  through a four-persona lens** (student / professor / senior engineer
  / researcher) and updated with: opening analogies, prior-art
  citations where applicable, "Failure modes" / "Cost note" /
  "What's novel" subsections at production-relevant spots, and honest
  positioning language separating shipped behavior from prior art.
- Quick-start example tool replaced (deterministic `add` instead of a
  fake `web_search` returning a hallucinated answer); a new
  "Before You Ship" production checklist links the security /
  orchestration / observability primitives readers should add before
  deploying with a real provider.
- No source code changes — documentation-only release.

## [1.17.3]

### Fixed

- **`agentfootprint.stream.llm_end` now forwards token usage and stop
  reason.** The typed `AgentStreamEvent` schema carried
  `{iteration, toolCallCount, content, model, latencyMs}` but omitted
  `usage` and `stopReason` — so stream consumers (Lens, cost meters,
  any dashboard subscribing to the stream) got `0→0` tokens and no
  finish reason, even though the same data was already present on the
  sibling `agentfootprint.llm.response` event. Three emit sites
  (`callLLMStage.ts` + both paths in `streamingCallLLMStage.ts`) now
  include `usage: response.usage` and
  `stopReason: response.finishReason`. Schema additions are optional
  fields → backwards-compatible for consumers that ignore them.

## [1.17.2]

### Fixed

- **InstructionsToLLM subflow was concatenating arrays across Dynamic
  ReAct iterations.** `buildAgentLoop` mounted `sf-instructions-to-llm`
  without `arrayMerge: ArrayMergeMode.Replace`, so each loop iteration
  appended its `promptInjections` / `toolInjections` to the parent
  scope — the effective system prompt grew 7→14→21→28 lines, and the
  tool list doubled on every turn, triggering Anthropic's
  `"tools: Tool names must be unique"` rejection on iter 4+. Matches the
  existing Replace flag on `sf-messages` / `sf-tools`.
- **`.skills(registry)` did not register per-skill tools for dispatch.**
  Skill tools were declared to the LLM via `AgentInstruction.tools`
  injections, but the dispatch registry only had `list_skills` +
  `read_skill`. When an LLM called a skill-gated tool,
  `staticTools.execute()` returned `{error: true, content: "Unknown
  tool: ..."}` and the turn wedged. `.skills()` now iterates each
  skill's `tools: []` and registers them into the agent's `ToolRegistry`
  so dispatch is always reachable.
- **ToolProvider dispatch now falls back to the registry on "Unknown
  tool" errors.** Callers who use a narrow resolve-time provider
  (`staticTools([listSkills, readSkill])` + injection-based visibility)
  need dispatch to reach the registered skill tools. Both the
  sequential and parallel dispatch paths in `lib/call/helpers.ts` now
  check: if the primary provider reports the tool as unknown AND the
  registry has it, fall through to the registry handler.
- **Decision scope now persists across `.run()` calls.** Previously
  `scope.decision = { ...initialDecision }` reset the decision on every
  turn, so follow-up messages would silently lose the `currentSkill`
  written by the prior turn's `read_skill` — causing `autoActivate` to
  stop surfacing the skill's tools on iter 1 of turn 2+. The runner now
  captures `state.decision` after each run and re-seeds from it next
  time. Cleared by `resetConversation()` for clean new dialogues.
  Unblocks multi-turn chat where the skill context should feel
  continuous.
- **`buildToolsSubflow` now defensively dedupes on three axes.** Base
  tools vs. base tools (in case the provider returned duplicates),
  base vs. injections (pre-existing check), and within injections
  themselves. First-wins on every axis. Belt-and-braces safety net
  against the Anthropic "tool names must be unique" rejection even if
  a future bug reintroduces an injection collision.
- Added 2 new tests to `test/lib/slots/tools.test.ts` pinning the dedup
  behaviors — 15/15 slot tests pass, 1874/1874 full suite still green.

## [1.17.1]

### Fixed

- `SkillRegistry.toTools()` aliased `this` via `const registry = this` which
  tripped the `@typescript-eslint/no-this-alias` rule post-release CI.
  Replaced with explicit `.bind(this)` method captures + a direct reference
  to `this.options.autoActivate` — cleaner closure pattern, no behavioral
  change, 1872/1872 tests still pass.

## [1.17.0]

### Added

- **`SkillRegistry.autoActivate`** — one-line skill-gated tool visibility
  (`agentfootprint/skills`). Unlocks the 25+-tool regime without
  customers hand-wiring a ~30-LOC bridge for every adopter.

  When configured, the auto-generated `read_skill(id)` tool writes the
  loaded skill's id into agent decision scope. Downstream
  `AgentInstruction.activeWhen: (d) => d[stateField] === 'my-skill'`
  predicates fire naturally — so each skill's `tools: [...]` only reach
  the LLM when that skill is active. Smaller tool menus per turn, no
  token-budget drift on long tool lists.

  ```ts
  const registry = new SkillRegistry<TriageDecision>({
    surfaceMode: 'auto',
    autoActivate: { stateField: 'currentSkill' },
  });
  ```

  - `SkillRegistryOptions.autoActivate?: AutoActivateOptions` — new
    config shape: `{ stateField: string, onUnknownSkill?: 'leave'|'clear' }`
  - `read_skill` now returns `{ content, decisionUpdate: { [stateField]: id } }`
    when configured; decisionUpdate is merged into agent decision scope
    by the tool-execution stage.
  - `toInstructions()` auto-fills `activeWhen: (d) => d[stateField] === skill.id`
    on any skill that doesn't declare its own — so consumers set
    `autoActivate` once and every skill gates its own tools by id.
  - `AgentBuilder.skills(registry)` auto-switches agent pattern to
    `Dynamic` when registry has autoActivate, because Regular pattern
    assembles instructions once per turn and wouldn't re-materialize
    tools on the next iteration. Explicit `.pattern(AgentPattern.Regular)`
    after `.skills()` overrides.
  - `SkillRegistry.hasAutoActivate` / `.autoActivate` getters for
    consumers writing custom builders.

- **`ToolResult.decisionUpdate` + `ToolExecutionResult.decisionUpdate`**
  — new optional field any tool (not just auto-generated skill tools)
  can use to write a partial update into the agent's decision scope.
  The tool-execution stage applies shallow `Object.assign(decision, update)`
  after the tool runs. Built-in ToolProviders (`staticTools`,
  `gatedTools`, `compositeTools`, `agentAsTool`) pass it through from
  the inner handler.

### Changed

- Tool-execution subflow: `decisionRef` is now always allocated as `{}`
  when the inbound decision scope is undefined (previously tri-state).
  Simpler invariant + fixes a latent bug where the first turn's
  decision writes from any tool (decide() or decisionUpdate) could be
  dropped if no initial decision scope was configured.

### Tests

- 13 new 5-pattern tests for `autoActivate` (unit / boundary / scenario
  / property / security). Library total: **1872 tests passing**
  (was 1859).

## [1.16.0]

### Added

- **Skills** (`agentfootprint/skills`) — typed, versioned agent skills
  with cross-provider correct delivery. The Claude Agent SDK pattern,
  packaged at `agentfootprint`'s framework layer.
  - `defineSkill<TDecision>(skill)` factory — typed, inference-friendly.
  - `SkillRegistry<TDecision>` — compile skills into `AgentInstruction[]`
    + auto-generated `list_skills` / `read_skill` tools + optional
    system-prompt fragment.
  - `Skill extends AgentInstruction` — every `activeWhen` / `prompt` /
    `tools` / `onToolResult` field inherited, skills add `id`,
    `version`, `title`, `description`, optional `scope[]`, `steps[]`,
    and `body` (string or async loader for disk/blob/Notion).
  - Four surface modes: `'tool-only'` (portable default, works on every
    provider), `'system-prompt'`, `'both'`, `'auto'` (library picks per
    provider — Claude ≥ 3.5 → `'both'`, everyone else → `'tool-only'`).
  - `AgentBuilder.skills(registry)` — one-line wiring. Idempotent
    replace (call twice, latest wins).
  - Tag-escape defense in rendered skill bodies: `</memory>`,
    `</tool_use>`, `</skill>` escaped in author-controlled fields.
  - Error paths (unknown id, lazy-loader throws, path-traversal
    attempts) return `isError: true` in the tool result — agent
    recovers, no crash.
  - Full documentation: `/guides/skills`.
  - `ToolRegistry.unregister(id)` — small focused API for builder-layer
    idempotent replace flows.

### Tests

- 41 new tests across 2 files (32 unit + 9 acceptance).
- Library total: 1859 tests passing.

## [1.15.0]

### Added

- **`autoPipeline()`** — the opinionated default memory preset
  (`agentfootprint/memory`). Composes facts (dedup-on-key) + beats
  (append-only narrative) on a single store, emitting ONE combined
  system message on read.
  - Zero-LLM-cost defaults (`patternFactExtractor` + `heuristicExtractor`).
  - Single `provider` config knob upgrades BOTH extractors to
    LLM-backed in one line.
  - Explicit `factExtractor` / `beatExtractor` escape hatches for
    mixed-quality configurations.
  - READ subflow: `LoadAll` (one `store.list`, split by payload shape
    via `isFactId` + `isNarrativeBeat`) → `FormatAuto` (facts block +
    narrative paragraph in one system msg).
  - WRITE subflow: `LoadFacts` (update-awareness) → `ExtractFacts` →
    `WriteFacts` → `ExtractBeats` → `WriteBeats`.
  - `AutoPipelineState` extends both `FactPipelineState` +
    `ExtractBeatsState` for typed scope.
  - Full documentation: `/guides/auto-memory`.

### Tests

- 16 new tests across 2 files (5-pattern coverage + acceptance).
- Library total: 1818 tests passing.

## [1.14.0]

### Added

- **Fact extraction** (`agentfootprint/memory`). Stable key/value
  fact memory with dedup-on-write — "what's currently true" as a
  complement to beats ("what happened").
  - `Fact<V>` type with `key` / `value` / optional `confidence` /
    `category` / `refs[]` (source-message provenance, like beats).
  - `factId(key)` helper → stable `fact:${key}` MemoryStore ids.
    Last-write-wins: the same key written twice REPLACES the prior
    entry (unlike beats/messages which are append-only).
  - `FactExtractor` interface + two implementations:
    - `patternFactExtractor()` — zero-dep regex heuristics for
      identity / contact / location / preference. Free.
    - `llmFactExtractor({ provider })` — LLM-backed extraction with
      `existing`-facts prompt injection so the model can update
      rather than duplicate. One call per turn. Malformed JSON falls
      back to `[]` with `onParseError` callback.
  - Stages: `extractFacts`, `writeFacts`, `loadFacts`, `formatFacts`.
    `formatFacts` renders a compact `Known facts:` key/value block
    (not `<memory>` tags, not a paragraph) — the shape LLMs parse
    most efficiently.
  - `factPipeline({ store, extractor? })` preset. Read subflow:
    LoadFacts → FormatFacts. Write subflow: LoadFacts → ExtractFacts
    → WriteFacts (LoadFacts-on-write surfaces existing facts to the
    extractor for update-awareness).
  - Full documentation: `/guides/fact-extraction`.

### Tests

- 104 new tests across 6 files (5-pattern coverage per layer).
- Library total: 1802 tests passing.

## [1.13.0]

### Added

- **Semantic retrieval** (`agentfootprint/memory`). Vector-based
  recall via cosine similarity over entry embeddings.
  - `Embedder` interface with `embed()` / optional `embedBatch()` —
    pluggable (OpenAI / Voyage / Cohere / custom). Ships
    `mockEmbedder()` (deterministic character-frequency hash) for tests.
  - `MemoryEntry.embedding?` + `embeddingModel?` fields for indexing.
  - `MemoryStore.search?(identity, query, options)` optional method;
    `InMemoryStore` implements O(n) cosine scan. Options: `k`,
    `minScore`, `tiers`, `embedderId` (cross-model safety).
  - `cosineSimilarity(a, b)` helper; length-mismatch throws,
    zero-magnitude returns 0 (never NaN).
  - Stages: `embedMessages` (write-side) + `loadRelevant` (read-side,
    pulls query from last user message by default).
  - `semanticPipeline({ store, embedder, embedderId? })` preset —
    drop-in replacement for `defaultPipeline` with vector recall.
  - Write-side: `writeMessages` attaches per-message embeddings
    from `scope.newMessageEmbeddings` when present.
  - Read-side: `mountMemoryRead` passes `scope.messages` into the
    subflow so `loadRelevant` derives the query from the user turn.
  - 85 new 5-pattern tests + 4-scenario acceptance test.
  - `/guides/semantic-retrieval` docs.

### Changed

- `test/lib/concepts/Agent.parallelTools.test.ts` — perf threshold
  relaxed from 2× to 2.5×DELAY to tolerate dev-machine jitter while
  still discriminating parallel (≤2.5×) from sequential (3×).

## [1.12.0] — BREAKING

### Added

- **Narrative memory** (`agentfootprint/memory`). A new memory strategy
  that compresses each turn into `NarrativeBeat`s on write and recalls
  them as a single cohesive paragraph on read — instead of storing
  raw messages.
  - `NarrativeBeat` type: `{ summary, importance, refs, category? }`
    — every beat carries `refs[]` traceable back to source messages
    for explainability / audit.
  - `BeatExtractor` interface with two built-in implementations:
    - `heuristicExtractor()` — zero-dep, zero-cost baseline.
    - `llmExtractor({ provider, systemPrompt?, onParseError? })` —
      one LLM call per turn, produces semantically rich beats. Robust
      JSON parsing; malformed responses skipped without crashing turns.
  - `extractBeats(config)` + `writeBeats(config)` write-side stages.
  - `formatAsNarrative(config)` read-side stage — composes selected
    beats into a single paragraph (vs `formatDefault`'s per-entry blocks).
  - `narrativePipeline({ store, extractor?, ... })` preset — drop-in
    replacement for `defaultPipeline` with beat-based memory.
  - **Differentiator**: no other open-source agent framework provides
    beat-level traceability for recalled memory.
  - 77 new 5-pattern tests + 4-scenario acceptance test.
  - `/guides/narrative-memory` docs.

### Removed (hard break — pre-GA, no deprecation cycle)

- **`Agent.memory(config: MemoryConfig)`** builder method.
  Superseded by `.memoryPipeline(pipeline)` which landed in 1.11.0.
- **`MemoryConfig` / `ConversationStore`** interfaces and the legacy
  `InMemoryStore` adapter from `src/adapters/memory/`. The canonical
  store interface is now `MemoryStore` in `agentfootprint/memory`.
- **`createCommitMemoryStage` / `CommitMemoryConfig`** —
  `CommitMemory` stage retired; the memory pipeline's write subflow
  lives inside the `final` branch subflow and is composed via
  `mountMemoryWrite`.
- **`createPrepareMemorySubflow` / `PrepareMemoryConfig`** —
  absorbed into the memory pipeline's read subflow.
- **`persistentHistory()` message strategy + its bundled `InMemoryStore`** —
  message strategies now focus on in-context reshaping (sliding
  window, char budget, summary). Durable persistence lives in the
  memory pipeline.
- **`MessagesSlotConfig.store` / `.conversationId`** fields — the
  Messages slot is now strategy-only. Durable persistence is owned by
  the memory pipeline.
- **`AgentLoopConfig.commitMemory` / `.useCommitFlag` / `.onStreamEvent`**.
  Memory wiring flows via `memoryPipeline`. Stream events route
  through the emit channel — attach an onEvent callback via
  `agent.run(msg, { onEvent })`.
- **`memory_storedHistory` scope field + `MEMORY_PATHS.STORED_HISTORY`** —
  dead after `CommitMemory` removal.
- **Legacy store adapters** `redisStore`, `dynamoStore`, `postgresStore`
  — real backends land in Phase 3 against the new `MemoryStore` interface.

### Changed

- **Conditional concept** (`Agent.route()` extensions) now mounts
  branches as subflows when the runner exposes `toFlowChart()`,
  matching the `FlowChart.ts` / `Swarm` patterns. UI consumers get
  drill-down into routed-to agents for free.
- **Stream events now flow through the emit channel.**
  `agentfootprint.stream.llm_start` / `llm_end` / `token` / `thinking`
  / `tool_start` / `tool_end` events are emitted with the full
  `AgentStreamEvent` as the payload. `AgentRunner` attaches a
  `StreamEventRecorder` (public API in `agentfootprint/stream`) that
  forwards emits to the consumer's `{ onEvent }` callback — zero
  closure capture of handlers inside stage code.
- **Agent chart is now CACHED** — built once per agent, reused across
  all `.run()` and `.toFlowChart()` calls. Per-run data (stream handler,
  memory identity, seed messages) flows via args / attached recorders.
- **`pickByBudget`** restructured as a proper decider stage with three
  branches (`skip-empty`, `skip-no-budget`, `pick`) — decision evidence
  now lands on `FlowRecorder.onDecision` with structured `rules[]`.
- **`MemoryStore.putMany`** added for batched writes. `writeMessages`
  now persists a turn's messages in one round-trip instead of N.
- **`RouteResponse` decider** uses the filter-form `decide()` DSL with
  structured evidence (`{ key: 'hasToolCalls', op: 'eq', threshold: true, … }`).
  `ParseResponse` lifts `parsedResponse.hasToolCalls` to the flat
  `scope.hasToolCalls` so the filter form can reach it.
- **`buildSwarmRouting` + `Conditional`** deciders return full
  `DecisionResult` objects so `FlowRecorder.onDecision` captures
  evidence (no more silent `.branch`-only returns).

### Migration

Replace:

```ts
const store = new InMemoryStore();
const agent = Agent.create({ provider })
  .memory({ store, conversationId: 'user-123' })
  .build();
```

With:

```ts
import { defaultPipeline, InMemoryStore } from 'agentfootprint/memory';

const pipeline = defaultPipeline({ store: new InMemoryStore() });
const agent = Agent.create({ provider })
  .memoryPipeline(pipeline)
  .build();

await agent.run(message, {
  identity: { conversationId: 'user-123' },
});
```



## [1.11.0]

### Added

- **`agentfootprint/memory` subpath — full memory pipeline system.** Built bottom-up in 9 reviewed layers, 190 tests, composing into a flowchart-first architecture consistent with the rest of the library.
  - **Identity + entries** — `MemoryIdentity { tenant?, principal?, conversationId }`, `MemoryEntry<T>` with decay/tier/source/version, pure `computeDecayFactor()` with exponential time decay + access boost.
  - **`MemoryStore` interface** — 9-method CRUD boundary with pagination cursor, `putIfVersion` optimistic concurrency, `seen()` recognition, `feedback()` usefulness aggregation, `forget()` GDPR delete. `InMemoryStore` reference implementation (zero deps, TTL-aware, tenant-isolated).
  - **Reusable stages** — `loadRecent`, `writeMessages`, `pickByBudget` (decider — budget-aware selection with `decide()` evidence), `formatDefault` (source-cited `<memory>` blocks + prompt-injection escape), `summarize` (deterministic contract for prompt caching).
  - **Pipeline presets** — `defaultPipeline()` (load → pick → format for read; persist for write), `ephemeralPipeline()` (read-only, compliance-grade no-write guarantee).
  - **Wire helpers** — `mountMemoryRead`, `mountMemoryWrite`, `mountMemoryPipeline` for composing pipelines into custom flowcharts.
- **`Agent.memoryPipeline(pipeline)` builder method** — first-class integration wiring the pipeline's read subflow before `AssemblePrompt` and write subflow after `Finalize`. Prior-turn memory is injected as citation-tagged `system` messages that AssemblePrompt prepends to the LLM prompt.
- **Per-run identity via `agent.run(msg, { identity, turnNumber?, contextTokensRemaining? })`** — same agent instance can serve many tenants / sessions with hardware-enforced isolation. Identity defaults to `{ conversationId: 'default' }` when omitted.
- **Example** `examples/memory/30-remember-across-turns.ts` — Alice/Bob session isolation demo using `mock` adapter.
- **5 integration tests** in `test/integration/memoryPipeline.test.ts` covering turn-1 persistence, turn-2 retrieval, per-run identity scoping, tenant isolation, and `.memory()` vs `.memoryPipeline()` mutual exclusivity.

### Process

- Every one of the 9 layers cleared an 8-person review gate (performance, DS/algorithms, security, research/RAG, platform, Anthropic, abstract/modular, 5-pattern tests) — iterating until no actionable findings remained. All 7 industry + 3 research reviewer asks from the design phase landed (hierarchical identity, pagination, `putIfVersion`, source-tagged recall, budget-aware picker, `seen()` + `feedback()`, decay math, ephemeral mode, deterministic summarizer, prompt-injection escape in formatter).

### Compatibility

- Existing `Agent.memory(MemoryConfig)` legacy API is unchanged. New consumers should prefer `.memoryPipeline()`. The two cannot be combined on the same builder — builder throws if both are set.
- Internals: `AgentLoopConfig` gains optional `memoryPipeline?: MemoryPipeline` alongside the existing `commitMemory?`. Legacy `commitMemory` path takes precedence when both somehow reach the loop (guards exist at the builder level).

## [1.10.0]

### Added

- **`exportTrace(runner, { redact?: boolean })`** — capture an agent run's full state as a portable JSON trace for external sharing. Bundles `snapshot`, `narrativeEntries`, `narrative`, and `spec` into a `AgentfootprintTrace` shape with `schemaVersion: 1`. Default `redact: true` requests `getSnapshot({ redact: true })` from the runner so footprintjs's [4.14.0 redacted-mirror](https://github.com/footprintjs/footPrint/blob/main/docs/internals/adr-002-redacted-mirror.md) feature scrubs `sharedState`. Use this to ship traces to a viewer, support engineer, or audit log without leaking PII.
- **`AgentfootprintTrace` + `ExportTraceOptions` types** exported from the main entry. Pin consumers to `schemaVersion: 1`; future shape changes will bump the version.
- **Example** `examples/observability/29-export-trace.ts` — captures and prints a trace using the `mock` adapter.
- **10 new tests** (5 patterns) covering schema version, snapshot pass-through, missing-method graceful degradation, JSON round-trip, and the safe-by-default `redact: true` choice.

### Changed

- **`footprintjs` peer dep + devDep bumped to `^4.14.0`** — required for the redacted-mirror `getSnapshot({ redact })` API. `exportTrace` falls back to a 0-arg `getSnapshot()` if the runner predates 4.14, so older deployments still produce a (raw) trace.

## [1.9.0]

### Added

- **`agentfootprint/patterns` — canonical composition patterns as thin factories.** Each pattern composes existing concepts (FlowChart / Parallel / Conditional / Agent / LLMCall) and returns a standard Runner — no new primitives, no new classes. Source files are short and teach the composition pattern.
  - `planExecute({ planner, executor })` — sequential planning → execution (FlowChart of 2).
  - `mapReduce({ provider, mappers, reduce })` — N pre-bound mappers fanned out, then reduced via LLM or pure fn (Parallel with named merge).
  - `treeOfThoughts({ provider, branches, thinker, judge })` — N parallel thinkers, judge picks the best (FlowChart of Parallel → judge).
  - `reflexion({ solver, critic, improver })` — single-pass Solve → Critique → Improve (FlowChart of 3). Multi-iteration variants compose with `Conditional`.
- **Example**: `examples/orchestration/28-patterns.ts` — all four patterns + a composed `Conditional` routing between them, all using the `mock` adapter.
- **10 new tests** covering wiring, input propagation, argument validation, and patterns-inside-patterns composition.

## [1.8.0]

### Added

- **`Conditional` concept — the DAG branch primitive.** Thin wrapper over footprintjs `addDeciderFunction` + `addFunctionBranch` that routes between runners based on synchronous predicates. First-match-wins; failing predicate fail-opens to the next branch; `.otherwise(runner)` is required. Exposes the same Runner surface as other concepts (`run`, `getNarrative`, `getSnapshot`, `getSpec`, `toFlowChart`) and composes inside `FlowChart` / `Parallel` / `Agent.route()` / another `Conditional`.
  ```ts
  const triage = Conditional.create({ name: 'triage' })
    .when((input) => /refund/i.test(input), refundAgent, { id: 'refund' })
    .when((input) => input.length > 500, ragRunner)
    .otherwise(generalAgent)
    .build();

  await triage.run('I want a refund');
  // narrative: "[triage] Chose refund — predicate 0 matched"
  ```
  Completes the DAG primitive set: **leaf** (LLMCall/RAG), **cycle** (Agent), **sequence** (FlowChart), **fan-out** (Parallel), **branch** (Conditional), **dispatch** (Swarm). Users can now build any composition from existing concepts without dropping to raw footprintjs.
- **Guards on `Conditional.when()`** — rejects non-function predicates, non-runner values, reserved `'default'` id, branch IDs with `/` or whitespace (would break `runtimeStageId`), and duplicate IDs. Fail-open on throwing predicates (never blocks a valid branch). Frozen state snapshot passed to predicate — mutation attempts silently no-op.
- **Example**: `examples/orchestration/27-conditional-triage.ts` — deterministic triage demo using the `mock` adapter.
- **25 new tests** across 5 patterns (unit/boundary/scenario/property/security), including real Agent composition and nested Conditionals.

## [1.7.1]

### Fixed

- **CI + npm publish** — `devDependencies.footprintjs` was pinned to `file:../footPrint`, which doesn't resolve in CI. Switched to `^4.13.0` so CI installs from the registry. `footprintjs` is also now declared as a `peerDependency` (`>=4.13.0`) to make the install-time contract explicit. This is why v1.7.0 failed to publish.

## [1.7.0]

### Added

- **Emit-channel LLM diagnostics.** `CallLLM` stage (both streaming and non-streaming) now fires `scope.$emit('agentfootprint.llm.request', {...})` before the provider call and `scope.$emit('agentfootprint.llm.response', {...})` after, surfacing the exact shape being sent/received. Payloads include iteration, message roles, tool names + required fields, usage, stop reason, and tool-call signatures.
- **`agentRenderer.renderEmit`** — custom narrative rendering for `agentfootprint.llm.request`/`response` events. Output like `LLM request (iter 2): 5 msgs [system,user,assistant,tool,tool], 4 tools — calculator required:[expression]` appears inline under each `CallLLM` stage in combined narratives.
- **`AgentBuilder.maxIdenticalFailures(n)`** — threshold for repeated-identical-failure escalation. When a tool call with the exact same `(name, args)` has failed `n` times in a row, a one-shot `escalation` field is injected into that tool result content urging the LLM to change arguments, switch tools, or finalize. Fires exactly once per `(name, args)` key per conversation. Defaults to `3`. Pass `0` to disable. Uses strict JSON parsing (not substring sniffing) so legitimate prose containing `"error":true` is not misclassified; stable key-sorted stringify so equivalent arg objects match regardless of insertion order.
- **`scope.maxIterationsReached` signal** — when the agent loop hits `maxIterations`, the structural guard now sets this flag AND force-routes to the default branch. Any terminal stage (default `Finalize`, `Swarm.RouteSpecialist` fallback, user-supplied terminals) can detect forced termination and synthesize an appropriate final message. Finalize now emits a user-facing fallback when the flag is set.
- **Tool-call signatures in narrative.** `ParseResponse` now renders `responseType` as `tool_calls: [calculator({"expression":"4+5"}), web_search({"query":"weather"})]` — names plus JSON-stringified args (tight cap) so debuggers see at a glance whether the LLM passed required fields. Names alone hid the common failure mode of retrying with empty / wrong args.

### Fixed

- **Anthropic streaming adapters dropped tool arguments.** `BrowserAnthropicAdapter.chatStream()` and `AnthropicAdapter.chatStream()` yielded `tool_call` chunks with `arguments: {}` at `content_block_start`, then accumulated `input_json_delta` chunks into a buffer that was never consumed. The streaming stage pushed the empty-args version, causing LLMs to re-attempt calls with `{}` until `maxIterations` exhausted. Fixed by deferring the `tool_call` yield until args are complete — emit at `content_block_stop` with parsed JSON (browser) / after `stream.finalMessage()` (Node SDK). Combined with the new emit-channel diagnostics, this bug was diagnosable for the first time.

### Changed

- **Requires `footprintjs` >= 4.13.0** for emit-channel features. Install explicitly: `npm install footprintjs@^4.13.0 agentfootprint@^1.7.0`.

## [1.6.1]

### Fixed

- **CI + publish workflows** — `npm install` instead of `npm ci`, no npm cache (lockfile not committed due to platform-specific native deps). This is why v1.5.0 and v1.6.0 failed to publish to npm.
- **footprintjs devDep** bumped to `^4.12.2` (resume continuation fix).

## [1.6.0]

### Added

- **`examples/` directory** — 22 type-checked examples as single source of truth (was in separate agent-samples repo). 8 categories: basics, providers, orchestration, observability, security, resilience, memory, integration.
- **`test:examples` npm script** — type-checks all examples against library source.
- **Barrel exports** — `agentLoop`, `AgentLoopConfig`, `defineInstruction`, `AgentPattern`, `quickBind`, `AgentInstruction`, `InstructedToolDefinition`, `TokenRecorder`, `ToolUsageRecorder`, `TurnRecorder`, `CostRecorder` from main entry. `staticTools`, `noTools` from `/providers`. `ExplainRecorder` from `/observe`.
- **3 new examples** — agent-loop (low-level engine), instructions (conditional context injection), explain-recorder (grounding evidence).

### Changed

- **`ToolHandler` type** — `(input: any)` instead of `(input: Record<string, unknown>)`. Allows typed destructured params in tool handlers: `({ query }: { query: string }) =>`. Non-breaking.
- **`footprintjs` peer dep** — bumped to `>=4.12.0` (backtracking, quality trace, staged optimization).

### Fixed

- **4 pre-existing type errors** in examples (API drift from agent-samples): resilience callbacks, ToolDefinition.name→id, message strategy args, instruction type casts.

## [1.5.0] - 2026-04-09

### Added

- **`runtimeStageId`** — mandatory on `LLMCallEvent` and `ToolCallEvent`. The universal key linking recorder data to execution tree nodes and commit log entries. Format: `[subflowPath/]stageId#executionIndex`.
- **Map-based recorders** — `TokenRecorder`, `ToolUsageRecorder`, `CostRecorder` extend `KeyedRecorder<T>` from `footprintjs/trace`. O(1) lookup via `getByKey(runtimeStageId)`, `getMap()`. Zero fallback keys.
- **`EvalIteration.runtimeStageId`** — each iteration links to its execution step
- **`createLLMCaptureRecorder()`** — shared factory for run() and resume() LLM capture. Both paths now track `runtimeStageId` for stream bridge tool events.
- **`RecorderBridge.setToolRuntimeStageId()`** — encapsulated state tracking (was public mutable field)
- 5 new tests for runtimeStageId on all recorder types

### Changed

- **footprintjs >=4.7.0 required** — added to `dependencies` (was only in devDependencies)
- **`agentLoop.ts`** — uses `buildRuntimeStageId` + `createExecutionCounter` from `footprintjs/trace`
- **`LLMCallRunner` + `RAGRunner`** — use `findCommit` from `footprintjs/trace` (zero `(b: any)` casts)
- CLAUDE.md + AGENTS.md — documented `runtimeStageId`, `KeyedRecorder`, `getByKey()` pattern

### Removed

- All `__auto_` fallback keys — runtimeStageId is always provided
- Duplicate LLM capture code in resume() path — replaced by shared factory

## [1.4.2] - 2026-04-07

### Fixed

- **README rewrite** — Architecture moved to 3rd section, headers renamed to relatable terms (Conditional Behavior, Observability, Human-in-the-Loop), 4 broken import paths fixed, redundant sections folded, 380→280 lines
- **5 folder READMEs** — concepts, adapters, providers, memory, tools with relatable naming and code examples
- **recorders/README.md** — 5 categories, event→recorder mapping, design principles
- **What's Different section** — 10 unique features grouped by concern (Quality/Safety/UX/Debugging)

## [1.4.1] - 2026-04-07

### Fixed

- **`RecorderBridge.loopIteration`** — now increments after each `dispatchLLMCall` (was always 0)
- **Per-iteration context** — each LLM call gets its own context snapshot (was sharing last state for all)
- **`resume()` path** — captures context same as `run()` (was empty)
- **`ExplainRecorder`** — guards `iteration: -1` when `onTurnComplete` fires without `onLLMCall`
- **Format gate** — release script fails on unformatted files instead of silently fixing

### Added

- **5 folder READMEs** — concepts, adapters, providers, memory, tools — with relatable naming (Single LLM / Multi-Agent), code examples, and cross-references
- **Main README** — 5-layer architecture diagram (Build → Compose → Evaluate → Monitor → Infrastructure), updated Recorders section with 5 categories
- **recorders/README.md** — event → recorder mapping, design principles
- **5 tests** for `EvalIteration`, per-iteration context, flat/iteration consistency
- **Flattened `recorders/v2/`** → `recorders/` — removed unnecessary indirection

### Changed

- `CLAUDE.md` + `AGENTS.md` — updated directory tree descriptions

## [1.4.0] - 2026-04-07

### Added

- **`explain().iterations`** — per-iteration evaluation units with connected data. Each iteration captures context (what the LLM had), decisions (tools chosen), sources (results), and claim (LLM output). Evaluators walk iterations to check faithfulness, relevance, and hallucination.
- **`EvalIteration` type** — self-contained evaluation unit for each loop iteration

## [1.3.0] - 2026-04-07

### Added

- **`explain().context`** — ExplainRecorder captures evaluation context during traversal: input, systemPrompt, availableTools, messages, model
- **`LLMContext` type** — what the LLM had when making decisions
- **`LLMCallEvent.systemPrompt`/`toolDescriptions`/`messages`** — context fields on events (optional, backward-compatible)

## [1.2.0] - 2026-04-07

### Added

- **`obs.explain()`** — ExplainRecorder bundled into `agentObservability()` preset. Grounding analysis (sources vs claims) out of the box — the differentiator.
- **8-gate release script** — mirrors footprintjs: doc check, dup type check, build, tests, sample projects, CHANGELOG validation
- **`scripts/check-docs.sh`** — blocks release if docs reference removed APIs
- **`scripts/check-dup-types.mjs`** — blocks release if duplicate type definitions found across src/

### Fixed

- **ModelPricing duplicate** — CostRecorder now imports from `models/types` instead of redefining

## [1.1.0] - 2026-04-07

### Added

- **Message strategies in providers barrel** — `slidingWindow`, `charBudget`, `fullHistory`, `withToolPairSafety`, `summaryStrategy`, `compositeMessages`, `persistentHistory` now exported from `agentfootprint/providers`
- **Error utilities in resilience barrel** — `classifyStatusCode`, `wrapSDKError` now exported from `agentfootprint/resilience`

### Removed

- **`getGroundingSources`, `getLLMClaims`, `getFullLLMContext`** from `agentfootprint/explain` — post-processed narrative entries (anti-pattern). Use `ExplainRecorder` instead, which collects during traversal.
- **`slidingWindow`, `truncateToCharBudget`** from internal `memory/conversationHelpers` — dead code duplicating the public `MessageStrategy` API in `providers/messages/`

## [1.0.0] - 2026-04-06

### Added

- **Capability-based subpath exports** — 7 focused import paths, tree-shakeable:
  - `agentfootprint/providers` — LLM providers, adapters, prompt/tool strategies
  - `agentfootprint/instructions` — defineInstruction, AgentPattern, InstructionRecorder
  - `agentfootprint/observe` — all 9 recorders + agentObservability preset
  - `agentfootprint/resilience` — withRetry, withFallback, resilientProvider
  - `agentfootprint/security` — gatedTools, PermissionPolicy
  - `agentfootprint/explain` — grounding helpers, narrative renderer
  - `agentfootprint/stream` — AgentStreamEvent, SSEFormatter
- **Full backward compatibility** — `import { everything } from 'agentfootprint'` still works
- **`typesVersions`** in package.json for older TypeScript resolution

### Changed

- `index.ts` reorganized with comments pointing to capability subpaths
- PermissionRecorder canonical home is `agentfootprint/observe` (removed from security barrel)

## [0.6.2] - 2026-04-05

### Added

- **Instructions guide** — `docs/guides/instructions.md` (Decision Scope, 3-position injection, decide())
- **Streaming guide** — `docs/guides/streaming.md` (AgentStreamEvent, onEvent, SSE, event timeline)
- **Sample 17** — Instructions (defineInstruction, decide, conditional activation, tool injection)
- **Sample 18** — Streaming events (lifecycle, tool events, ordering, backward compat, SSE)
- **Module READMEs** — `src/lib/instructions/`, `src/streaming/`, `src/lib/narrative/`
- **CLAUDE.md + AGENTS.md** — Instructions, Streaming, Grounding sections + anti-patterns
- **README.md** — Instructions, Streaming, Grounding Analysis sections
- **JSDoc** — `@example` on `getGroundingSources()`, `getLLMClaims()`

## [0.6.1] - 2026-04-05

### Added

- **AgentStreamEvent** — 9-event discriminated union for real-time agent lifecycle
  - `turn_start`, `llm_start`, `thinking`, `token`, `llm_end`, `tool_start`, `tool_end`, `turn_end`, `error`
  - `onEvent` callback on `agent.run()` — full lifecycle visibility for CLI/web/mobile consumers
  - Works in both streaming and non-streaming mode (only `token` requires `.streaming(true)`)
  - `turn_end` emits `paused: true` on ask_human pause
- **Backward compat** — `onToken` still works (deprecated, sugar for `onEvent` token filter)
- **Collision guard** — `onEvent` + `onToken` together: `onToken` ignored + dev-mode warn
- **Error isolation** — `onEvent` handler errors swallowed (never crash agent pipeline)

### Fixed

- `streamingCallLLMStage` fallback path now passes `signal` for cancellation
- `tool_end.latencyMs` excludes instruction processing overhead

## [0.6.0] - 2026-04-05

### Added

- **Instruction Architecture** — `AgentInstruction`, `defineInstruction()`, `InstructionsToLLM` subflow
  - 3-position injection: system prompt, tools, tool-result recency window
  - `activeWhen(decision)` — state-driven conditional instruction activation
  - `decide()` field on `LLMInstruction` — tool results update Decision Scope
  - `AgentScopeKey` enum — type-safe scope key references
- **Agent builder API** — `.instruction()`, `.instructions()`, `.decision()`, `.verbose()`
- **Grounding helpers** — `getGroundingSources()`, `getLLMClaims()`, `getFullLLMContext()`
- **Verbose narrative** — `createAgentRenderer({ verbose: true })` shows full values
- **Dynamic ReAct + Instructions** — `AgentPattern.Dynamic` loops back to `InstructionsToLLM`

### Fixed

- Tool names duplication in Dynamic mode (uses `ArrayMergeMode.Replace`)
- `toolProvider` wired through `buildConfig` for execution
- AssemblePrompt replaces system message in Dynamic mode
- Browser compat (`process.env` guarded)
- Registry mutation moved to constructor (runs once)
- Pausable root stage (no post-build graph mutation)
- Streaming stage typed as `TypedScope<AgentLoopState>`

### Changed

- Peer dependency: `footprintjs >= 4.4.1` (was `>= 4.0.0`)
- Eliminated `ApplyPreparedMessages` and `ApplyResolvedTools` copy stages

## [0.3.0] - 2026-03-29

### Fixed

- `setEnableNarrative()` removed from FlowChartBuilder chain — call `executor.enableNarrative()` instead (footprintjs v3.x API)
- Stage functions in LLMCall, Agent, RAG, FlowChart now receive a plain `ScopeFacade` via `agentScopeFactory`, bypassing TypedScope proxy (required for `getValue`/`setValue` access)

### Changed

- Peer dependency: `footprintjs >= 3.0.0` (was `>= 0.10.0`)

## [0.2.0] - 2026-03-17

### Added

- **Browser LLM adapters**: `BrowserAnthropicAdapter` and `BrowserOpenAIAdapter` — fetch-based, zero peer dependencies
  - Direct browser-to-API calls using user's own API key
  - Full chat() + chatStream() with SSE streaming via ReadableStream
  - Tool call support, AbortSignal, custom baseURL for compatible APIs
  - Anthropic CORS via `anthropic-dangerous-direct-browser-access` header
  - OpenAI `stream_options.include_usage` for streaming token counts
- 18 browser adapter tests

### Removed

- Legacy v1 recorders: LLMRecorder, CostRecorder, RAGRecorder, MultiAgentRecorder (no users yet, replaced by v2 AgentRecorder interface)

## [0.1.0] - 2026-03-15

### Added

- **Concept ladder**: LLMCall, Agent, RAG, FlowChart, Swarm — each builds on the previous
- **LLM Adapters**: AnthropicAdapter, OpenAIAdapter, BedrockAdapter with full chat + streaming
- **Provider bridge**: `createProvider()` connects config factories (`anthropic()`, `openai()`, `ollama()`, `bedrock()`) to adapter instances
- **Mock adapter**: `mock()` for $0 deterministic testing — same code path as production
- **Multi-modal content**: Base64 and URL image support across all adapters
- **Error normalization**: `LLMError` with 9 error codes, `retryable` flag, `wrapSDKError()` auto-classifier
- **Compositions**: `withRetry()`, `withFallback()`, `CircuitBreaker` for resilient agent execution
- **V2 Recorders**: TokenRecorder, TurnRecorder, ToolUsageRecorder, QualityRecorder, GuardrailRecorder, CostRecorderV2, CompositeRecorder
- **V1 Recorders**: LLMRecorder, CostRecorder, RAGRecorder, MultiAgentRecorder *(removed in 0.2.0)*
- **Protocol adapters**: `mcpToolProvider()` for MCP, `a2aRunner()` for A2A
- **Prompt providers**: staticPrompt, templatePrompt, skillBasedPrompt, compositePrompt
- **Tool providers**: agentAsTool, compositeTools, ToolRegistry, defineTool
- **Memory management**: slidingWindow, truncateToCharBudget, appendMessage
- **Streaming**: StreamEmitter, SSEFormatter
- **Agent loop**: Low-level `agentLoop()` for custom control flow
- **16 sample tests** covering every feature
- **608 tests** across 63 test files
