**Mixed** — a classifier's reading of WHICH TOOL answers each step, filed
beside the model's own call, and (under a dial) a narrowing of what the model
is served. Lens: `pick.ts · narrowServed` decides the served list the tools
slot commits — the wire the model reads. Trace: `record.ts` is the one writer
of `AgentState.toolChoices`; `types.ts` the row shapes.
Map: `types.ts` (the rows, the question id, the framework's doors).
Walker: `pick.ts` — `toolChoiceQuestion` (pure), `pickTools` (one classifier
call, never throws), `narrowServed` (pure: top-N + doors, or the full wire
with the reason); `compose.ts` — `composeToolChoice`, the slot's armed tail
behind one `import()`. Trace: `record.ts` — `recordToolChoice`, `outcomeRowFor`.
The site that asks and commits is `src/core/slots/buildToolsSlot.ts ·
composeStage`; the site that files the outcome is
`src/core/agent/stages/callLLM.ts · buildCallLLMStage`.

# `toolChoice/` — tool choice by classifier

## Why

Every model call with tools is a choice the model makes by generating a call,
and the record holds only what it chose. A calibrated classifier
(`agentfootprint/classify`) can read the same step and answer with a
probability per offered tool. Filed beside the model's call, that is a
SECOND READING of every choice the loop makes — agreement, disagreement and
cost all on the record, measured from the rows rather than estimated. And
because the tools slot is where the served list is built, the same reading
can NARROW what is served: fewer schemas on the wire, fewer bytes per call,
with every narrowing on the committed record the receipt hashes and the
served view rebuilds.

## The two dials

- **Advisory** (`serve: 'all'`, the default). At every model call the tools
  slot asks the classifier one `choice` question over the tools it is about
  to serve — the merged wire MINUS the always-served doors, each by its own
  description — and files a `ToolChoiceRow` under `AgentState.toolChoices`
  BEFORE the call: `offered`, the provider's `ranked` distribution (highest
  first, an unscored tool absent), its `chosen`, `confidence`, `usage`,
  `latencyMs`, and `served` (the full wire; `narrowed: false`). After the
  reply `callLLM` files a `ToolChoiceOutcomeRow`: `called` (the model's tool
  calls in order, empty on an answer), `firstAgrees` (`chosen === called[0]`,
  absent when either is absent) and no `miss`. The wire is byte for byte
  what it was without the option.
- **Narrowing** (`serve: { top: N }`). The slot commits the classifier's
  top-N plus the doors, in the merged wire's order, as `scope.toolSchemas`
  — the list the mount maps to `dynamicToolSchemas`, the list `callLLM`
  sends, the list the receipt's `tools.schemaHashes` covers and the list
  `servedAt(k).tools.schemas` rebuilds, all by construction because the
  narrowing happens at the ONE decoration site. The row says `narrowed:
true` and `served` names exactly N + the doors. The full wire is served,
  with the reason on the row as `narrowedSkipped`, when the classifier
  failed or scored fewer than N names (`unavailable`), fewer than N + 1
  candidates were offered (`too-few`), the previous call's outcome carried a
  miss (`after-miss`), or the call is the out-of-budget wrap-up
  (`wrap-up`).

## The laws

- **The model's call is the emission; the pick is a second reading.** A
  `pick` row and an `outcome` row per call, marked `source: 'classifier'`,
  never merged with the call, never substituted for it. The comparison is
  computed at the one moment both exist and lives on the outcome row.
- **A score is data only when the provider produced it.** `ranked` is the
  provider's distribution as sent — no padding, no renormalising, an
  unscored name absent. `chosen` is the provider's own pick (absent when it
  named nothing offered), never an argmax the library took. A failed call
  is a `ToolChoiceErrorRow` with the provider's status and the full wire is
  served: fail open, never fail narrow.
- **Narrowing changes what is served, so it is on the committed record.**
  Nothing is recomposed at read time; `servedView.viewOf` reads the
  committed `dynamicToolSchemas` and that IS the narrowed list. No new
  `SERVED_GAPS` kind.
- **The doors are never narrowed away**: `read_skill`, `list_skills`,
  `skip_step`, `present` (`ALWAYS_SERVED_TOOLS`) and every name the app
  lists in `alwaysServe`. They are not offered as candidates either — a door
  is served whatever the ranking says, so asking about it would only dilute
  the distribution. The `'tool-forced'` schema tool never enters the slot
  (it is appended at request assembly) and is untouched.
- **A miss is a fact, not a refusal.** When a narrowed call's reply names a
  tool outside `served`, the outcome row carries `miss.wanted` and
  `agentfootprint.tool_choice.outcome` carries `missed`; the dispatcher
  treats the call exactly as it treated an off-wire call before this
  release — a registry tool the model last read under a party that can
  still answer RUNS, recorded as `tools.answered_off_wire`
  (`stages/toolCalls.ts · resolveTool`); a name no party can answer is
  refused as a tool result, as before. The NEXT call serves the full wire
  (`after-miss`). So on a provider whose wire lets the model name an
  unserved tool, a miss costs a record and one full-width call, never the
  answer. On a hosted API the wire constrains `tool_use` to the served
  schemas, so a narrowed-away tool cannot be named at all — there the risk
  of a wrong ranking shows up as a wrong pick or an answer, which
  `firstAgrees` measures and `miss` cannot.
- **Events carry identities, enums and numbers only** (a tool name is an
  identity): `tool_choice.picked` (`chosen`, `confidence`, `offered` and
  `served` as counts, `narrowed`, `narrowedSkipped`, `latencyMs`, tokens),
  `tool_choice.outcome` (`called`, `firstAgrees`, `missed`),
  `tool_choice.failed` (`status`, `latencyMs`). Never a description, never
  the user's message.
- **Unarmed agents are byte-identical.** The stage stays synchronous, the
  mount maps no new key, the module that asks is loaded through `import()`
  under the arm. The eighteen byte-identity references are untouched; the
  one armed reference is `agent-tool-choice`.

## When the pick runs — and when it does not

The pick runs in the tools slot's Compose stage, once per model call, after
`mergeWire` and before the commit, so `offered` is exactly the merged wire
minus the doors and `served` is exactly what was committed. It is awaited;
the stage returns a promise only under the arm. `reactMode: 'classic'` is
refused at build: the slot runs on turn 1 only there, so a pick would be made
once and a narrowed list served on every later call. The seed's static
fallback (`callLLM.ts · registeredToolSchemas`, `scope.dynamicToolSchemas ??
deps.toolSchemas` — a chart with no tools slot) runs no pick and narrows
nothing: with no Compose stage to ask from, the request simply carries the
build-time schemas as sent. A call with no candidate beyond the doors makes
no classifier call and files no row (and therefore no outcome). The wrap-up call still files a pick (advisory data)
and never narrows — `callLLM` withholds every tool at assembly on that call,
so `served` on that row is the slot's list while the receipt says `withheld:
'wrap-up'`.

## One example

```ts
import { Agent } from 'agentfootprint';
import { typesafe } from 'agentfootprint/classify';

const agent = Agent.create({ provider, model })
  .tool(lookupOrder)
  .tool(refundCharge)
  .tool(listInvoices)
  .toolChoice({ classifier: typesafe(), serve: { top: 2 } })
  .build();
await agent.run({ message: 'refund order 42' });

for (const row of agent.getSnapshot()?.sharedState.toolChoices ?? []) {
  if (row.kind === 'pick') row.chosen; // 'refundCharge', with row.ranked and row.served
  if (row.kind === 'outcome') row.firstAgrees; // did the model's first call match?
}
```

`npm run bench:tool-choice` measures the two dials on the mock provider —
`first-agrees`, `misses`, `extra-calls`, `tools-slot-bytes` (from the
receipt's `requestMeasurement`), `pick-tokens`, `pick-latency-ms` — and
exits non-zero if the unarmed twin's tools-slot bytes move.

## Files

- `types.ts` — `ToolChoiceRow`, `ToolChoiceErrorRow`, `ToolChoiceOutcomeRow`,
  `ToolChoiceEntry`, `ToolChoiceLedger`, `ToolChoiceScore`,
  `NarrowSkipReason`, `TOOL_CHOICE_QUESTION`, `ALWAYS_SERVED_TOOLS`.
- `pick.ts` — `toolChoiceQuestion`, `pickTools`, `narrowServed`,
  `alwaysServedNames` (not a root export).
- `compose.ts` — `composeToolChoice`: the slot's whole armed tail (ask,
  decide, file the row, hand back what to commit), the one module the slot
  loads through `import()`.
- `record.ts` — `recordToolChoice`, `outcomeRowFor`, `pickRowFor`,
  `pickAttemptedFor`.
