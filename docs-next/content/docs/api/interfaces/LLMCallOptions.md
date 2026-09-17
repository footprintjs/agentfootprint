---
title: LLMCallOptions
---

# Interface: LLMCallOptions

Defined in: [src/core/LLMCall.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L93)

## Properties

### contextBudget?

> `readonly` `optional` **contextBudget?**: `object`

Defined in: [src/core/LLMCall.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L115)

Per-slot context budgets, in characters (8.11.0). The LLMCall twin of
`AgentOptions.contextBudget` — two slots here, since an LLMCall has no
tools slot.

Each slot warns (and emits `agentfootprint.context.budget_pressure`) when
it composes over its budget. **Nothing is truncated** — the full content
still reaches the LLM; the budget is a signal, not a limiter. Defaults:
`systemPrompt` 4000, `messages` 10000.

#### messages?

> `readonly` `optional` **messages?**: `number`

#### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `number`

***

### costBudget?

> `readonly` `optional` **costBudget?**: `number` \| \{ `onExceed`: `"warn"` \| `"halt"`; `usd`: `number`; \}

Defined in: [src/core/LLMCall.ts:162](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L162)

Cumulative USD budget per run. When provided along with `pricingTable`,
LLMCall emits `agentfootprint.cost.limit_hit` with `action: 'warn'`
the first time cumulative USD crosses the budget. Execution continues
— consumers choose whether to abort by listening to the event.

The object form `{ usd, onExceed }` is accepted for symmetry with `Agent`,
but `onExceed` must be `'warn'` here: halting means "stop at the next
iteration boundary", and one call has no next boundary. `'halt'` is
refused at build rather than silently ignored.

***

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/docs/api/interfaces/GroupTranslator)\<`unknown`\>

Defined in: [src/core/LLMCall.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L180)

Optional per-COMPOSITION translator (UI-agnostic). See
`core/translator.ts`. When attached, `runner.getUIGroup()` invokes
it with the LLMCall's `GroupMetadata` (kind `'LLMCall'`, id, name,
empty `members[]`, plus `extra.slots` with the three slot ids —
`system-prompt`, `messages`, `tools` — so Lens can render the slot
cards inside an LLMCall card without inspecting `buildTimeStructure`).
Returns `undefined` when omitted.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core/LLMCall.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L98)

Stable id used for topology + events. Default: 'llm-call'.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [src/core/LLMCall.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L104)

Optional max output tokens.

***

### model

> `readonly` **model**: `string`

Defined in: [src/core/LLMCall.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L100)

Model to request from the provider.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core/LLMCall.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L96)

Human-friendly name shown in events/metrics. Default: 'LLMCall'.

***

### pricingTable?

> `readonly` `optional` **pricingTable?**: [`PricingTable`](/docs/api/interfaces/PricingTable)

Defined in: [src/core/LLMCall.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L150)

Pricing adapter. When set, LLMCall emits `agentfootprint.cost.tick`
after every LLM response with per-call and cumulative USD. Run-scoped
— the cumulative resets on each `.run()`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/core/LLMCall.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L94)

***

### recordReceipt?

> `readonly` `optional` **recordReceipt?**: `boolean`

Defined in: [src/core/LLMCall.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L144)

Mint a receipt on the call (9.91.0). Default ON — the LLMCall twin of
`AgentOptions.recordReceipt`, same field, same contract, same default.

A receipt is the fingerprint of what the model was actually handed,
committed at the call so a reader can check the rebuilt view against it.
`false` declines it, for the reason the agent's switch exists: the mint is
a SHA-256 per system piece, per message and per tool schema, plus one
commit-log value. Declining does not make the log unreadable — `servedAt`
still rebuilds the view; what is gone is the witness, and `servedAt` says
so with the same gap a pre-9.88 recording raises.

#### Example

```ts
decline the receipt in a bulk eval loop
  new LLMCall({ provider, model, recordReceipt: false })
```

***

### recordSystemPrompt?

> `readonly` `optional` **recordSystemPrompt?**: `boolean`

Defined in: [src/core/LLMCall.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L128)

Record the ASSEMBLED system prompt on the LLM call (9.50.0). The LLMCall
twin of `AgentOptions.recordSystemPrompt` — same field, same contract,
same default. **Opt-in, default OFF**: when `true`,
`agentfootprint.stream.llm_start` carries `systemPromptText`, the joined
prompt verbatim as sent. PRIVACY: with the dial on, the full prompt rides
into every recorder, sink and persisted recording — off, only
`systemPromptChars` (the length) is on the record.

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core/LLMCall.ts:170](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L170)

Optional build-time recorders threaded into footprintjs's
`flowChart()` factory. Each recorder observes per-node build
events (`onStageAdded` / `onSubflowMounted` / etc.) for this
LLMCall's internal chart (Initialize + slot mounts + CallLLM). When
omitted, no build-time observation is wired up.

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/core/LLMCall.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L102)

Optional sampling temperature.
