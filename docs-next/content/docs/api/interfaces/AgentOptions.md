---
title: AgentOptions
---

# Interface: AgentOptions

Defined in: [src/core/agent/types.ts:147](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L147)

## Properties

### artifacts?

> `readonly` `optional` **artifacts?**: [`ArtifactStore`](/docs/api/interfaces/ArtifactStore) \| [`AgentArtifactsOptions`](/docs/api/interfaces/AgentArtifactsOptions)

Defined in: [src/core/agent/types.ts:416](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L416)

The artifact store (9.21.0) — the claim-check seam. When set, every tool's
`ctx.artifacts` is this store bound to the RUN's scope (the same
tenant/principal/conversation tuple memory scopes on, composed by the
framework — a tool can never name or widen it), and every mint / resolve /
sweep / refusal lands on the typed record as
`agentfootprint.artifacts.*`. From the main barrel:
`inMemoryArtifacts()`, `fileArtifacts({ directory })`,
`sqliteArtifacts({ file })` — or any `ArtifactStore`.

Since 9.22.0 the store also switches on the data legs: tools may declare
`wants` (ref arguments resolved at dispatch), the `present` tool is
auto-attached, and — via the object form — the operator may set the
placement threshold: `artifacts: { store, placement: { maxInlineChars } }`
checks any tool result over the threshold into the store and hands the
model the claim ticket instead ([AgentArtifactsOptions](/docs/api/interfaces/AgentArtifactsOptions)). The bare
`ArtifactStore` form stays exactly what it was: the store, no placement.

Unset — the default — the agent is byte-identical to earlier releases:
no events, no state, no `present` tool, and `ctx.artifacts` is a
fail-closed capability whose every method throws a teaching refusal
naming this option (`ctx.hasArtifacts` is the fact to branch on).

***

### cacheStrategy?

> `readonly` `optional` **cacheStrategy?**: `CacheStrategy`

Defined in: [src/core/agent/types.ts:733](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L733)

Optional explicit CacheStrategy override (v2.6+). Defaults to
`getDefaultCacheStrategy(provider.name)` — so Anthropic/OpenAI/
Bedrock/Mock providers auto-resolve to their respective strategies
once those land in Phase 7+.

***

### caching?

> `readonly` `optional` **caching?**: `"off"`

Defined in: [src/core/agent/types.ts:726](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L726)

Global cache kill switch (v2.6+). `'off'` disables the cache
layer entirely — the CacheGate decider routes to `'no-markers'`
every iteration regardless of other rules. Default: caching
enabled (auto-resolved per provider via the strategy registry).

Use `'off'` for low-frequency agents (cron jobs running once per
hour) where the cache TTL guarantees zero cache hits and the
cache-write penalty isn't worth paying.

***

### checkColumnTypes?

> `readonly` `optional` **checkColumnTypes?**: `"warn"` \| `"enforce"` \| `"off"`

Defined in: [src/core/agent/types.ts:645](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L645)

Check a tool's rows against the columns it declared (9.78.0) — the write
seam's COLUMN-TYPE CONTRACT. **Default `'off'`.**

THE RECORDED FAILURES, three of them, all one shape — a number became
something else and nothing noticed at the seam. A mapping report wrote
`str(m.get("logical_unit_number") or "")`, so LUN 0 — falsy — was stored
as an EMPTY STRING on 2,094 mappings, and a host group missing the LUN an
initiator probes first was indistinguishable from one that had it. A
capacity view rendered an 8 MiB disk as `0.0 GB`, which reads as NO DISK
during a live incident. And a whole family of tools returned their
numbers as quoted strings (`"1240"`), which silently blanked every chart,
because nothing downstream could tell a measure from a label.

The library already lets a tool declare what its result IS
(`Tool.resultKind`). This dial reads the sibling declaration —
`Tool.resultColumns`, what the result CONTAINS — and checks the rows
against it at the moment the tool answers.

THE THREE WORDS, and they are `toolArgsValidation`'s own:

  • `'off'` (default) — nothing measured. Byte-identical to every release
    before this existed.
  • `'warn'` — findings are filed on
    `agentfootprint.integrity.context_error` and the model reads the rows
    EXACTLY as the tool returned them. Nothing is blocked, changed or
    retried.
  • `'enforce'` — the rows are REFUSED and the model reads a teaching
    sentence naming the column, what it declared, what arrived and how
    many rows — the `resultCeiling` idiom, not a thrown stack trace. The
    refusal is the whole payload, on every channel.

The words are borrowed rather than invented deliberately: this is the
MIRROR of `toolArgsValidation` — that boundary validates the arguments
going IN against the tool's declared `inputSchema`, this one validates
the rows coming OUT against the tool's declared `resultColumns`. Two
validators at one seam that graded themselves in different vocabularies
would be a worse defect than either could catch.

TWO FINDINGS, because the field bug turned on the difference:
`column-type-mismatch` (the column is there and holds the wrong thing)
and `missing-column` (the declared column is in none of the rows). They
send a person to two different files.

THE CEILING: this judges TYPE, never MEANING. It sees that a column
declared `number` holds a string; it can never see that the string should
have been `0`, or that `0.0` should have been `0.0078` — so the `0.0 GB`
failure above passes it cleanly. The bound ships as `COLUMN_TYPE_CEILING`
and is quoted verbatim into every finding.

WHAT IT REFUSES TO JUDGE: a result is read only when it is an ARRAY OF
PLAIN OBJECTS with at least one row. Prose, a `null`, a bespoke
`{ rows: [...] }` wrapper, a claim ticket — and the ZERO-ROW result,
which has no columns to be wrong about and belongs to `empty-lookup`
next door — all file an explicit `not-applicable` row and NO finding.

TWO HALVES ARM IT: this dial AND at least one tool declaring
`resultColumns`. Absent, the run is byte-identical; the one visible
difference is the registered `column-type-mismatch` / `missing-column`
rows in the disposition report, filed `not-applicable` — the family's
law, not an exception to it.

***

### commitValues?

> `readonly` `optional` **commitValues?**: `CommitValuesMode`

Defined in: [src/core/agent/types.ts:342](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L342)

Commit-log value encoding (#13c-B) — forwarded to the internal
executor as `{ commitValues }`. Agent default is **`'delta'`**: a
stage whose net change to a tracked array is "the old array plus a
tail" (the agent's `history` every iteration) records ONLY the tail
(`append` verb); key removals record a `delete` verb. LOSSLESS — any
step's full value reconstructs by replay (`commitValueAt` from
`footprintjs/trace`), which is why this is safe for audit trails.
Retained commit-log memory becomes linear instead of quadratic.
Set `'full'` for footprintjs's default encoding (every changed key
stores its full final value) if a downstream consumer reads
`bundle.overwrite[key]` as the complete value.

***

### contextBudget?

> `readonly` `optional` **contextBudget?**: `object`

Defined in: [src/core/agent/types.ts:216](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L216)

Per-slot context budgets, in characters (8.11.0).

Each of the three context slots warns — and emits
`agentfootprint.context.budget_pressure` — when what it composed for an
iteration exceeds its budget. **Nothing is ever truncated:** the full
content still reaches the LLM. The budget is a signal that the slot is
growing past what you expected, not a limiter.

Defaults: `systemPrompt` 4000, `messages` 10000, `tools` 2000. The keys
are the three slots the context model already names
(`ContextSlot = 'system-prompt' | 'messages' | 'tools'`), so the option
and the event it produces speak one vocabulary.

Before 8.11.0 these caps existed but no public door reached them, and the
over-budget warning told you to "raise budgetCap" — a knob nothing could
set. Raising a budget is the right answer when the slot is legitimately
that big (a long conversation easily passes the 10000-character messages
default); trimming is the right answer when it isn't.

#### messages?

> `readonly` `optional` **messages?**: `number`

#### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `number`

#### tools?

> `readonly` `optional` **tools?**: `number`

#### Example

```ts
Give a long-running support agent more room for history
  Agent.create({ provider, model, contextBudget: { messages: 40_000 } })
```

***

### costBudget?

> `readonly` `optional` **costBudget?**: `number` \| \{ `onExceed`: `"warn"` \| `"halt"`; `usd`: `number`; \}

Defined in: [src/core/agent/types.ts:192](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L192)

Cumulative USD cap for one run. Requires a `pricingTable` — the budget is
money and only a pricing table turns tokens into money (refused at build
otherwise since 8.13.0).

A bare number WARNS: `agentfootprint.cost.limit_hit` fires once with
`action: 'warn'` and the run carries on. That is what this option has
always done, and it stays exactly that.

`{ usd, onExceed: 'halt' }` makes it a stop. The loop ends at the next
iteration boundary — the same boundary `maxIterations` uses — so a call
already in flight completes, is billed and is recorded; nothing is
abandoned mid-request. The run returns the answer it has (possibly `''`)
and `agent.stoppedEarly()` says why.

#### Example

```ts
Agent.create({ provider, model, pricingTable, costBudget: 0.50 })           // warns
Agent.create({ provider, model, pricingTable,
               costBudget: { usd: 0.50, onExceed: 'halt' } })               // stops
```

***

### credentials?

> `readonly` `optional` **credentials?**: `CredentialProvider`

Defined in: [src/core/agent/types.ts:392](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L392)

Credential provider for downstream OAuth (declare-and-push). When set, a
tool that declares `needs: { credential }` has it resolved BEFORE `execute`
and injected as `ctx.credential`; tools can also pull via `ctx.credentials`.
From `agentfootprint/security` (`agentCoreIdentity({ region })`,
`staticTokens({ ... })`, or any `CredentialProvider`).

***

### externalGrounds?

> `readonly` `optional` **externalGrounds?**: [`ExternalGroundsProvider`](/docs/api/type-aliases/ExternalGroundsProvider)

Defined in: [src/core/agent/types.ts:533](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L533)

App-verified ground for the choice-seam integrity check (9.72.0).

The `unsupported-argument` check judges every armed tool call's
identifier-like arguments against what the RUN served the model. Some
ground the run never serves: a person clicked a row in the app's data
panel, the app VERIFIED the clicked cells against the artifact the panel
renders, and the model was told to act on that selection. An identifier
the model takes from a verified selection is not fabricated — this door
is how the app says so.

Register a provider that yields the currently-verified entries, each a
`{ value, source }` pair — `source` is a short label for where the value
came from (e.g. `'viewer-selection'`). The provider is consulted once per
LLM response that contains an armed call, so entries may change between
turns as the person's selection does. Entries join the grounded corpus:
a value they contain files no finding, and each excusal is put on the
record as `agentfootprint.integrity.external_ground_used`, carrying the
`source` label of the entry that excused it.

DECLARED, NEVER AMBIENT — this option is the only door; there is no
global registry to mutate. Absent, or a provider that yields nothing,
is byte-identical to today. A provider that throws or returns garbage
contributes nothing and never aborts the run.

HONESTY NOTE, because this is an assertion door: the library records
what the app asserts — verifying the assertion (against the artifact,
the click, whatever the app's ground truth is) is the APP's duty, done
before the entry is yielded. The `source` label travels with every
excusal precisely so a reader can audit that chain instead of having to
trust it.

***

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/docs/api/interfaces/GroupTranslator)\<`unknown`\>

Defined in: [src/core/agent/types.ts:760](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L760)

Optional per-COMPOSITION translator (UI-agnostic). See
`core/translator.ts`. When attached, `agent.getUIGroup()` invokes
it with the Agent's `GroupMetadata` (kind `'Agent'`, id, name,
empty `members[]`, plus `extra.slots` and `extra.toolNames`).
Tools are not `Runner` instances (they're function executors)
so they're conveyed by name in `extra`, not as group members.
Returns `undefined` when omitted.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core/agent/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L152)

Stable id used for topology + events. Default: 'agent'.

***

### integrityPosture?

> `readonly` `optional` **integrityPosture?**: `"observe"` \| `"dev"`

Defined in: [src/core/agent/types.ts:500](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L500)

How loud the Context Integrity checkers are about their OWN health
(9.60.0). Default `'observe'`.

Every run keeps a disposition ledger — one row per applicable check,
counting checked-pass / checked-fail / not-applicable / unreachable —
and files it once at the run boundary as
`agentfootprint.integrity.disposition` (listener-gated, like every
typed event). `'dev'` adds the two liveness theorems: a canary at run
start proves each check's pure function can still catch its own
synthetic defect, and a run whose registered checkers demonstrably
never ran fails with `CheckerDeadError` instead of returning a green
answer — because a green report from a check that never ran is
decoration, and two shipped checks in this codebase decayed exactly
that way.

***

### keepLastToolResults?

> `readonly` `optional` **keepLastToolResults?**: `number` \| `false`

Defined in: [src/core/agent/types.ts:483](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L483)

How many tools' most recent results the window keeps beyond
`keepRecentTurns` (9.57.0). **On by default, at 2.** Only meaningful
beside `.window(...)` / `.compaction(...)`; an agent with no window
strategy never builds the stage and pays nothing either way.

The failure it addresses is measured, not imagined. An agent drove a
screen through tools; one tool result carried the only list of valid ids.
Under a small window that result left after about two iterations — while
the 9.55.0 anchor kept the REQUEST, so the model still knew what it had
been asked to do and no longer had what it needed to do it. It assembled
a plausible id out of an entity name it remembered, was refused, and
spent actions on it. In one archived run the final answer to the person
named a host that appears in no tool result at all.

So for each tool that has spoken since the request, the window keeps that
tool's MOST RECENT result — at most this many beyond the recent-turns
window — until the agent calls that tool again or the person asks
something new. One pin per tool name, superseded on the next call, so it
cannot accumulate past your tool roster; a parallel batch is one turn and
costs one slot; and a pin that has provably blocked two consecutive
boundaries stands down ON THE RECORD rather than let a window grow.

What it costs, and how to see it: `WindowRecord.observations` names every
turn the pin held and its exact character count, so the window's size
without the pin is computable from the record. What it gets wrong is
documented rather than buried — the pin is CONTENT-BLIND (a tool's last
result may be a one-word acknowledgement while the load-bearing one was
the call before), and under `summarizeOldest` a pinned turn stays raw
while everything around it is folded.

Set `false` (or `0`) to switch it off — no pins, no `observations` key,
and the window behaves exactly as it did in 9.56.0.

***

### maxIterations?

> `readonly` `optional` **maxIterations?**: `number`

Defined in: [src/core/agent/types.ts:157](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L157)

Hard budget on ReAct iterations. Default: 10. Hard cap: 50.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [src/core/agent/types.ts:155](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L155)

***

### maxToolResultChars?

> `readonly` `optional` **maxToolResultChars?**: `number`

Defined in: [src/core/agent/types.ts:288](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L288)

The ceiling on ONE tool result, in characters (9.11.0). **Opt-in — there
is no default, and there will not be one.**

Over the cap, the result is REPLACED by a marker that names the tool, the
size, the cap, and the one action that helps — and carries the first
characters of the real answer verbatim:

```json
{ "truncated": true,
  "reason": "orders_export returned 812431 chars, over the 20000-char cap. Narrow the request and call again.",
  "head": "id,customer,total\n1001,…" }
```

The marker IS the result. It is what the model reads on the `role: 'tool'`
message AND what `agentfootprint.stream.tool_end` carries — so a run that
capped a 800KB result does not then ship that same 800KB to an event sink,
and a trace shows the truncation instead of hiding it. `head` gets whatever
the cap has left after the sentence explaining it, so a bigger cap buys a
proportionally bigger head.

**Why no default.** A default would silently modify tool results: a tool
that returns 200KB of rows is doing what somebody wrote it to do, and a
framework that quietly replaced that the first time it ran would be lying
to the app about its own tool. Omitted, results are never measured and
never replaced — byte-identical to every earlier release.

It composes with, and never replaces, what a tool already does: a tool with
its own paging keeps it, `CodeResult.truncated` still means what it means,
and an `onToolResult` middleware that summarizes runs FIRST — the cap
measures what the chain produced. It is the last-resort net, not the plan.
When big tool DATA is the norm rather than the accident, the answer is the
`CodeRunner` port ("summarize prose, compute data"), not a bigger cap.

Refused at construction for a non-positive or non-integer value: `0` is not
"off" — omitting the option is.

#### Example

```ts
a support agent whose search tool can return a whole knowledge base
  Agent.create({ provider, model, maxToolResultChars: 20_000 })
```

***

### model

> `readonly` **model**: `string`

Defined in: [src/core/agent/types.ts:153](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L153)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core/agent/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L150)

Human-friendly name shown in events/metrics. Default: 'Agent'.

***

### noticeEmptyLookups?

> `readonly` `optional` **noticeEmptyLookups?**: `boolean`

Defined in: [src/core/agent/types.ts:582](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L582)

Notice when a lookup for a value THIS RUN PRODUCED comes back empty
(9.77.0) — the write seam's `empty-lookup` advisory. **Default off.**

The recorded failure: a triage agent's reverse-lookup tool filtered a
column before a pivot, so the column did not exist yet and every reverse
lookup returned an empty result — for every identifier, always. The tool
answered successfully with an empty list, and the agent reported in a
table, with confidence, that the device was logged in to no port on any
collected switch, advising a check of the physical cabling. The device was
logged in the whole time. Nothing noticed, because an empty result from a
broken filter is byte-identical to an empty result from a genuine absence.

What the library CAN see is the pair: the identifier came out of an
earlier tool result in this run — from a tool named in the consumer's
`Tool.argumentsFrom` — and the lookup keyed on it came back with nothing.
Turn this on and each such pair files one `advisory` finding on
`agentfootprint.integrity.context_error`, naming the value, the producing
tool, the consuming tool and the call id.

THE CEILING, and it is why this never accuses: an empty result can be
perfectly true — the thing may exist and simply have nothing to show
right now — so this is a place to look, never a verdict that anything is
wrong. The SAME advisory is filed for a true absence and for a lookup that
could never have matched, because nothing in this library can tell them
apart. Every finding carries the ceiling sentence in its own message.

WHAT IT JUDGES, and what it refuses to. A result is read only when the
library can COUNT it: an array (zero rows is zero rows) or the `absent()`
envelope. A prose sentence, a bespoke `{ rows: [] }` wrapper, a `null`, a
placement claim ticket — nothing in there is countable, so the encounter
files a `not-applicable` row and NO finding. That row is the point: a
check that silently skipped what it could not read would be the
decoration the disposition ledger exists to make impossible.

TWO HALVES ARM IT: this dial AND at least one tool declaring
`argumentsFrom`. The declaration alone is deliberately not enough — it
already arms `dangling-reference` and `unsupported-argument`, and an
advisory that armed itself off a declaration made for something else would
not be opt-in. Absent, the run is byte-identical: no finding, no event,
nothing on the wire changes. The one visible difference is the registered
`empty-lookup` row in the disposition report, filed `not-applicable` —
which is the family's law, not an exception to it: registered-but-unarmed
is a ROW, never silence.

Nothing is ever blocked, retried or rewritten; the model reads exactly the
result the tool returned.

***

### observerDelivery?

> `readonly` `optional` **observerDelivery?**: `"inline"` \| `"deferred"`

Defined in: [src/core/agent/types.ts:821](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L821)

Observer delivery tier (RFC-001 Block 10). Default `'inline'` —
byte-identical to every prior release: the Agent's bridge recorders
(and your `.watch()` attachments) run synchronously inside the
producing statement, so a slow `agent.on()` listener taxes every
stage of every iteration.

`'deferred'` moves observation off the hot path: every observer event
is captured into footprintjs's bounded queue (≈ microseconds) and
delivered at the next microtask checkpoint — "one beat behind", with
listener work overlapping the LLM/tool await windows instead of
serializing with the loop. Same events, same payloads, same order;
only the timing meta (`wallClockMs` / `runOffsetMs`) reflects the
later delivery. Terminal boundaries (run resolve, reject, pause)
drain the queue synchronously BEFORE control returns, so crash
reports / checkpoints always carry the complete record.

Exception kept inline for correctness: the causal-evidence harvest
recorder (mounted with CAUSAL memories) — the memory write stage
reads its accumulators MID-run, so it cannot run one beat behind.

Per-recorder override: a consumer recorder that declares its own
`delivery` field keeps it — the agent-level option is the default
tier for recorders that don't declare one.

For serverless / graceful shutdown, settle async listener work with
`await agent.drainObservers({ timeoutMs })` before the process exits.
Queue stats surface on `agent.getLastSnapshot()?.observerStats`.

***

### observerDeliveryOptions?

> `readonly` `optional` **observerDeliveryOptions?**: [`ObserverDeliveryOptions`](/docs/api/type-aliases/ObserverDeliveryOptions)

Defined in: [src/core/agent/types.ts:827](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L827)

Queue dials for `observerDelivery: 'deferred'` — see
`ObserverDeliveryOptions`. Throws at construction when set without
`observerDelivery: 'deferred'` (no silently-ignored combinations).

***

### onAuthorizationRequired?

> `readonly` `optional` **onAuthorizationRequired?**: `AuthorizationRequiredMode`

Defined in: [src/core/agent/types.ts:715](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L715)

What the run does when a tool's DECLARED credential (`needs: { credential }`)
comes back `authorization-required` — a person has to click a consent link
before the tool can run. Default **`'pause'`** (8.6.0).

- `'pause'` — the run stops at the block. `agent.run()` returns a pause
  outcome whose `pauseData.authorization` carries `{ service, sessionId,
  authorizationUrl }`; a `standingAgent` answers **202** with
  `{ awaiting }`; `agent.resume(checkpoint)` re-resolves the credential and
  runs the tool that was waiting. The model is never told, so it cannot
  adapt around work that has not happened.
- `'tell-model'` — the model reads a refusal naming the service (never the
  URL) and may route around the block. The turn still cannot report a clean
  completion: `agent.run()` raises `CredentialConsentRequiredError`, which
  carries the URL to the caller.

In BOTH modes the authorization URL stays out of the conversation, the
snapshot, the narrative, the typed event stream and any recording. It is a
bearer capability carrying a session-correlating `state` parameter; before
8.6.0 it was interpolated into the tool result and copied into all of them.

***

### permissionChecker?

> `readonly` `optional` **permissionChecker?**: [`PermissionChecker`](/docs/api/interfaces/PermissionChecker)

Defined in: [src/core/agent/types.ts:229](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L229)

Permission adapter. When set, the Agent calls
`permissionChecker.check({capability: 'tool_call', ...})` BEFORE every
`tool.execute()`. Emits `agentfootprint.permission.check` with the
decision. On `deny`, the tool is skipped and its result is a
synthetic denial string; on `allow` / `gate_open`, execution proceeds
normally.

***

### pricingTable?

> `readonly` `optional` **pricingTable?**: [`PricingTable`](/docs/api/interfaces/PricingTable)

Defined in: [src/core/agent/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L163)

Pricing adapter. When set, Agent emits `agentfootprint.cost.tick`
after every LLM response (once per ReAct iteration) with per-call
and cumulative USD. Run-scoped — the cumulative resets each `.run()`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/core/agent/types.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L148)

***

### reactMode?

> `readonly` `optional` **reactMode?**: `"classic"` \| `"dynamic"` \| `"dynamic-grouped"`

Defined in: [src/core/agent/types.ts:791](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L791)

How the ReAct loop behaves — a single setting with three honest choices.
Default `'dynamic'`. (Merged in 6.0.0 from the old `reactMode` +
`reactStructure` pair, which had a silently-ignored combination.)

`'dynamic'` (default) — every iteration re-runs the InjectionEngine and
all three slots (system-prompt ‖ messages ‖ tools), because which
injections are active can change per turn (a skill activates, a rule
fires, a tool-return triggers something). The right shape when the agent
uses skills, rule/on-tool-return triggers, or any per-turn context
steering. Flat chart shape.

`'classic'` — textbook ReAct: context is engineered ONCE. The
InjectionEngine, system-prompt and tools run a single time up front; the
loop targets only the Messages slot, so each iteration just appends the
new tool result and re-calls the LLM. Use when the system prompt and tool
set are FIXED for the whole run (the common case). Flat chart shape — the
chart reads honestly: `ToolCalls → Messages` loops, static slots outside.
CAVEAT: because static slots are cached after turn 1, do NOT use `'classic'`
with skills or dynamic-trigger injections — a mid-run activation would not
surface into the cached system-prompt/tools. Use `'dynamic'` for those.

`'dynamic-grouped'` — same semantics as `'dynamic'`, but the whole LLM turn
(injection engine + 3 slots + cache + call + thinking) is wrapped in a
single `sf-llm-call` SUBFLOW — the same boundary the `LLMCall` primitive
produces. Lens (and any explainable-ui consumer) renders it as an LLM group
with its slots inside, with zero bespoke collapsing. Behaviour is identical
to `'dynamic'`; only the chart's nesting differs. (Grouping is dynamic-only:
it re-seeds context every turn by design, so there is no classic-grouped.)

***

### readTracking?

> `readonly` `optional` **readTracking?**: `RetentionPolicy`

Defined in: [src/core/agent/types.ts:328](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L328)

Read-tracking policy for the snapshot's per-stage read view
(footprintjs `StageSnapshot.stageReads`) — the observability-cost
lever for LONG runs. Forwarded to the Agent's internal
`FlowChartExecutor` as `{ readTracking }`.

- `'summary'` (Agent default) — each tracked read records a cheap
  `ReadSummaryMarker` (type + size proxy + short preview) instead of
  a `structuredClone` of the value. Measured at N=200 full-feature
  iterations, `'full'` clones ~18MB of read values that nothing in
  the agentfootprint/lens/explainable-ui stack consumes.
- `'full'` — footprintjs's own default: every tracked read clones the
  value into `stageReads`. Set explicitly if you inspect
  `agent.getSnapshot()` read VALUES (not just keys/shapes).
- `'off'` — reads are not recorded; `stageReads` is absent.

Narrative, recorder events (`onRead` payloads), and commit history are
IDENTICAL in every mode — the policy scopes ONLY the snapshot's
`stageReads` payload. Note the Agent default (`'summary'`) is
deliberately cheaper than footprintjs's (`'full'`); see CHANGELOG
behavior-change callout.

***

### recordSystemPrompt?

> `readonly` `optional` **recordSystemPrompt?**: `boolean`

Defined in: [src/core/agent/types.ts:384](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L384)

Record the ASSEMBLED system prompt on every LLM call (9.50.0).
**Opt-in. Default OFF — and the default is a privacy decision.**

When `true`, each `agentfootprint.stream.llm_start` event carries
`systemPromptText`: the joined injection pieces verbatim, exactly as the
provider received them. That is the string today's recordings only
describe (each piece is on the record; the assembled whole is not), so a
debugger no longer has to render "not in this recording" for the one
artifact the model actually read.

WHY OFF BY DEFAULT: the assembled prompt is as sensitive as everything
in it — skill bodies, RAG passages, memory recalls, per-user
instructions — and it can be LARGE, once per iteration. With the dial on,
it rides into every attached recorder, every vendor sink, every
`recordRun` recording and every persisted envelope; treat those artifacts
accordingly. Off (the default), `llm_start` keeps its exact prior bytes —
`systemPromptChars` still reports the length, and the text is honestly
absent rather than summarized.

#### Example

```ts
capture the prompt while debugging context assembly
  Agent.create({ provider, model, recordSystemPrompt: true })
```

***

### repeatedCallNudge?

> `readonly` `optional` **repeatedCallNudge?**: `boolean`

Defined in: [src/core/agent/types.ts:448](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L448)

Tell the model when it has already made this exact call and already got
this exact answer (9.26.0). **On by default.**

When one tool is dispatched with deeply-equal arguments and returns a
byte-identical result for the second time in a turn, one sentence is
appended to that result: *identical call, identical result — calling again
will not change it.* The call still RAN, the result is unchanged beside
the note, and a third identical call is not blocked. It is evidence, not a
gate.

The failure it addresses is measured rather than imagined: a traced run in
which a model called one tool three times with identical arguments after
the backend silently ignored a filter, reading the same rows as a fresh
answer each time. Nothing inside the conversation can see that; the
framework watched all three land.

**A turn that repeats nothing is byte-identical either way** — the same
results, the same events, and the same tracked state down to the key set.
The counters are held run-keyed beside the dispatch loop, never written to
scope: a within-turn tally is not conversation state, and tracked state is
the commit log, the snapshot, the narrative and every recording. Only an
actual repeat is visible, as one sentence on that result and one
`agentfootprint.tools.repeated_call` event.

Set `false` to switch it off — nothing is fingerprinted, no counter is
kept, and even a repeating turn is byte-identical to earlier releases.
Worth doing when a deployment's tools are deliberately polled (an identical
call returning an identical status IS the expected shape while a job runs)
and the note would be noise rather than news.

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core/agent/types.ts:750](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L750)

Optional build-time recorders threaded into footprintjs's
`flowChart()` factory. Each recorder fires `onStageAdded` once per
node in the Agent's internal chart (Seed, CallLLM, Route, tool
handler, slot mounts, PrepareFinal, BreakFinal), and
`onSubflowMounted` once per mounted subflow. Recorders own their
own accumulators — agentfootprint just threads them through.

Cascade: each slot subflow (system-prompt, messages, tools)
was built earlier with its OWN recorders (or none).
footprintjs does NOT propagate StructureRecorders into mounted
subflows — attach the same recorders to every nested composition
for full coverage.

When omitted, no build-time observation is wired up.

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/core/agent/types.ts:154](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L154)

***

### toolArgValidation?

> `readonly` `optional` **toolArgValidation?**: [`ToolArgValidationMode`](/docs/api/type-aliases/ToolArgValidationMode)

Defined in: [src/core/agent/types.ts:247](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L247)

Tool-args validation mode (#9). Default `'enforce'`: LLM-produced args
are validated against the tool's declared `inputSchema` BEFORE dispatch.
On mismatch the tool is NOT executed — the model receives a structured
retry message as the tool result (paths + expected shapes + received
TYPES) and corrects itself on the next iteration. Emits
`agentfootprint.validation.args_invalid`.
`'warn'` emits the event but executes anyway; `'off'` disables.
Validation is an honest JSON-Schema subset (type/required/properties/
items/enum/explicit additionalProperties:false, plus the string SHAPE
keywords pattern/minLength/maxLength) — unsupported keywords are
ignored, never false-rejecting.

A string-shape refusal quotes a CAPPED excerpt of the offending value
and the parameter's own `description`, because "expected string, got
string" cannot be acted on; every other issue still names types only.

***

### toolTeardownTimeoutMs?

> `readonly` `optional` **toolTeardownTimeoutMs?**: `number`

Defined in: [src/core/agent/types.ts:305](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L305)

How long ONE tool teardown may take before the runner stops waiting
(default 5000ms). See `ctx.onTeardown`.

Bounded because teardown sits on the SIGTERM path: an unbounded vendor
`Stop()` turns a container stop into a thirty-second wait for SIGKILL, and
a shutdown that hangs is indistinguishable from one that crashed. When the
budget runs out the cleanup is ABANDONED, not cancelled — there is nothing
to cancel a vendor's in-flight call with — and
`agentfootprint.tools.session_close_failed` fires with
`errorClass: 'ToolTeardownTimeoutError'`, because a session that may still
be live is a fact somebody is paying for.

Raise it for a backend whose `Stop` is genuinely slow; lower it for a
latency-critical shutdown where an abandoned session is the cheaper loss.

***

### wrapUpAtMaxIterations?

> `readonly` `optional` **wrapUpAtMaxIterations?**: `boolean`

Defined in: [src/core/agent/types.ts:693](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L693)

What a turn does when its ACTION BUDGET runs out mid-task (9.56.0).
Default **on**.

`maxIterations` is a cap on actions, and the model does not know it is
about to be hit. Before this, a turn that reached the cap while the model
was still asking for tools handed back whatever text happened to ride that
last call — which, mid-task, is a fragment: *"The third finding focus is
not settling… Let me check what's on screen now:"*. That sentence went to
the person as if it were the answer, and nothing on the record said the
budget had run out.

With this on, the run spends ONE more LLM call with **the tools withheld**
and this instruction appended, then hands back what comes back:

> *Your action budget for this turn is exhausted. Do not request tools.
> Give your best final answer from what you have: what you completed, what
> remains undone, and anything the person should know.*

That call is exempt from `maxIterations` by design — it cannot loop,
because with no tools on the wire there is nothing for the model to ask
for. It costs one call and it is on the record like any other turn (its
own `iteration_start` / `llm_start` / `cost.tick`).

It rides the ITERATION budget only. A halting `costBudget` keeps today's
behaviour, because there the person capped the MONEY and one more call
would spend past the cap; an action cap says nothing about a call that
takes no action.

The fact is on the record either way — `agent.stoppedEarly()` and
`agentfootprint.agent.budget_exhausted` both say whether the turn was
wrapped up (`action: 'wrapped-up'`) or cut short (`'cut-short'`), so a
dashboard can tell "answered" from "answered after the budget ran out".

**A turn that never runs out of budget is byte-identical either way** —
same calls, same events, same tracked state down to the key set.

Set `false` to keep the pre-9.56.0 behaviour: the turn ends on whatever
the last call produced. Worth doing when a caller renders `stoppedEarly`
itself and would rather not pay for the extra call.

#### Example

```ts
Agent.create({ provider, model, maxIterations: 8 });                     // wraps up
Agent.create({ provider, model, wrapUpAtMaxIterations: false });         // cuts short
```

***

### writeProvenance?

> `readonly` `optional` **writeProvenance?**: [`WriteProvenanceMode`](/docs/api/type-aliases/WriteProvenanceMode)

Defined in: [src/core/agent/types.ts:360](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L360)

Per-write read provenance — forwarded to the internal executor as
`{ writeProvenance }`. Default **`'off'`** (footprintjs's own default):
every recording is byte-identical to earlier releases.

With `'reads-prefix'`, each recorded write also stores the keys that were
tracked-read BEFORE it, which upgrades what the trace layer can claim about
a value: a downstream write is linked to this value because that write's
own read-prefix names the key — and a write whose prefix omits it is
excluded exactly. That is the difference between "this stage read A and
wrote B, in some order the log cannot see" and a recorded dependency.

Turn it on when you intend to DEBUG the run: `traceVariable` reports
`coverage: 'exact'` only under this dial, and only then will `walkToRoot`
take a deterministic `narrowedBy: 'dataflow'` hop instead of an embedding
guess. Cost is one small array copy per write.
