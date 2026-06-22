# Design: Governance (budgets + governor)

> **Status:** design spec (converged from research). Nothing here is built yet.
> Governance is a **harness** sub-category — it changes what the agent *does*
> (it can halt the run), so it lives on the builder, NOT under `enable.*`
> (which is observability). See `docs/design/local-observability-and-pii.md`
> for the harness-vs-observability rule this builds on.

## 1. What governance is

The runtime controls that **bound and enforce** a run's resource consumption:

- **Budget** — a depletable quantity you cap: iteration count, total tokens, total cost, wall-clock.
- **Governor** — the runtime component that *enforces* the budget (warn or halt).
- **Runtime governance** — the umbrella; a sub-area of the harness.

Distinct from **observability** (passive — watches) and from **safety guardrails**
(PII / jailbreak / content). "Budget" is the precise term; "guardrail" is broader.

## 2. The API — `.governance()` (builder-fluent)

Mirrors `.reliability()` — its closest cousin (call-level resilience). Governance
is its **run-level** sibling. No `add` prefix (every builder method drops it).

```ts
Agent.create({ provider, model })
  .governance({
    budgets: { iterations: 10, tokens: 200_000, cost: 5.00 },
    onLimit: 'halt',          // 'warn' | 'halt'  — the governor's enforcement policy
  });
```

Plain, consumer-facing field names (`iterations`/`tokens`/`cost`, not `maxX`).

### `maxTokens` is NOT governance — keep it

Two different axes hide behind the word "tokens"; only one is a budget:

| API | Axis | Governance? |
|---|---|---|
| `maxIterations` | per-**run** loop cap | ✅ → `budgets.iterations` |
| `costBudget` (warn-only today) | per-**run** cost | ✅ → `budgets.cost` (+ the `halt` it lacks) |
| `budgets.tokens` | per-**run** *total* tokens | ✅ **new** — no equivalent today |
| **`maxTokens`** | per-**request** output cap | ❌ a generation param like `temperature` — leave it |

Folding `maxTokens` (per-request output length) into a per-run budget would
confuse consumers. `budgets.tokens` is a genuinely new per-run total.

## 3. Multi-user: layer it — don't make `.governance()` the per-user quota engine

**Research verdict (high confidence): per-user/per-tenant budgets live at the
GATEWAY, not the agent framework and not the provider.**

| Layer | Owns | Evidence |
|---|---|---|
| **Agent framework** (us) | per-**run** caps, identity-blind | LangGraph `recursion_limit`/rate-limiter are per-run; *"isolate state, not spend"* |
| **Gateway** (LiteLLM/Portkey/Helicone/Cloudflare) | per-**user/tenant** budgets, hard-block | *"consensus layer for per-user budgets = the gateway"*; LiteLLM keys budget on the request `user` field |
| **Provider** | per-org/project ceiling | OpenAI: *"rate limits are org/project, not user level"* |

So:

1. **`.governance()` owns per-RUN caps** with `onLimit: 'warn' | 'halt'`. `halt` =
   LangGraph's `recursion_limit` hard-abort; `warn` = the `soft_budget` analog.
2. **Defer per-USER quotas to a gateway** — bridge via `MemoryIdentity`
   (tenant/principal already on every run): emit it onto each LLM request / OTel
   `gen_ai.*` span so an external gateway keys the durable budget on it (mirrors
   LiteLLM's `user`-field pattern). Optionally accept an injectable budget-store /
   `onLimit` callback so a consumer *can* plug Redis — but ship the engine owning
   only per-run caps.

### Concurrency is the boundary marker

Per-user budgets share a counter across concurrent runs/workers, so the
read-check-increment **races** (two requests both read "under cap" → both proceed
→ overspend; a lost update). Correct enforcement needs an **atomic** shared-store
op (Redis `INCRBY`/Lua, DB txn + row lock, CAS, or two-phase reserve→commit) —
exactly why LiteLLM has a Redis spend-counter + `fail_closed_budget_enforcement`.

- **Per-run caps** = one run, **single in-process writer, no concurrency** →
  provably race-free → the framework owns it.
- **Per-user budgets** = shared counter → atomic store required → an in-process
  limiter *"cannot rate limit across processes"* → gateway concern.
- **If a consumer plugs an in-process per-identity budget store**, document the
  contract loudly: **the increment MUST be atomic** (never app-side read-then-write).

## 4. Enforcement gap to fix

Today enforcement is **inconsistent**: `maxIterations` hard-caps (halts), but
`costBudget` **only warns** (`cost.limit_hit action:'warn'`, execution continues).
A unified force-stop is a deferred backlog item. `.governance({ onLimit: 'halt' })`
is the fix — a consistent `warn | halt` across all budgets. For multi-user
production you want to *halt* a runaway, not just log it.

## 5. Governance is observable — promote it to a `DomainEvent`

The governor **acts** (harness) but must **emit its decision** (observable) — so the
trace records *why* the run halted. Partly built today:

- **`agentfootprint.cost.limit_hit`** — a registered typed event (live stream +
  `CostRecorder` + Lens commentary *"hit a cost limit and stopped"*).
- **`composition.end status: 'budget_exhausted'`** — a first-class boundary status.

**Gap:** `cost.limit_hit` is a *typed/live* event but NOT a `DomainEvent`, so it
does **not** land in the `BoundaryRecorder` log → **not in the `Trace`/offline
`<Replay>`** (only the coarse `composition.end` status does). To show *"⛔ halted:
cost budget $5.00 exceeded at iteration 7"* in Replay:

1. **Promote the limit-hit to a first-class `DomainEvent`** (joins the Trace timeline).
2. **Extend it** beyond `cost`+`warn` → cover `iterations`/`tokens` and `action: 'halt'`,
   all on the same observable seam. Carries `runtimeStageId` → backtrackable to the step.

## 6. Migration (semver-clean)

- **Minor release N**: ship `.governance()`. Mark `.maxIterations()` + `costBudget`
  `@deprecated — use .governance({ budgets })`; they keep working (delegate
  internally). Add a **dev-mode** runtime warning (gated on `isDevMode()`) + a
  CHANGELOG migration table. `maxTokens` is untouched.
- **Next major (7.0)**: remove the two deprecated APIs.

## 7. Open decisions

1. Injectable per-identity budget store + `onLimit` callback — ship in v1 or later?
   (Engine ships per-run caps regardless.)
2. `MemoryIdentity` emission onto LLM request / OTel span — part of `.governance()`
   or a separate `observability` concern? (Leans: emit it regardless; governance
   just consumes per-run.)
3. The governance `DomainEvent` shape — extend `cost.limit_hit` vs a new
   `governance.limit_hit` covering all budgets.

## 8. Build order

1. `.governance({ budgets, onLimit })` builder method (per-run caps; `halt` enforcement).
2. Governance limit-hit as a `DomainEvent` (Trace/Replay visibility) + extend to iterations/tokens/halt.
3. `@deprecate` `maxIterations` + `costBudget` → delegate to governance (+ dev-mode warn).
4. `MemoryIdentity` emission onto requests/spans for gateway bridging.
5. Docs (Build → governance) + examples (Convention 2/3).
