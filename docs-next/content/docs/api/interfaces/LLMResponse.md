---
title: LLMResponse
---

# Interface: LLMResponse

Defined in: [src/provider-contract/types.ts:356](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L356)

## Properties

### content

> `readonly` **content**: `string`

Defined in: [src/provider-contract/types.ts:361](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L361)

***

### providerRef?

> `readonly` `optional` **providerRef?**: `string`

Defined in: [src/provider-contract/types.ts:422](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L422)

***

### rawThinking?

> `readonly` `optional` **rawThinking?**: `unknown`

Defined in: [src/provider-contract/types.ts:437](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L437)

v2.14 — Provider-specific raw thinking data, opaque to the
framework. Providers that support extended thinking populate this
with their native shape (Anthropic: array of `{type, thinking,
signature}` blocks; OpenAI: `reasoning_summary` value; custom:
whatever the provider emits). The framework hands this to a
configured `ThinkingHandler.normalize(rawThinking)` to produce
the normalized `ThinkingBlock[]` that lands on
`LLMMessage.thinkingBlocks`.

Undefined when the provider has no thinking content for this call
— most calls (gpt-4o, claude without extended thinking enabled,
etc.). The thinking subflow's stage early-returns in this case.

***

### replay?

> `readonly` `optional` **replay?**: `MessageReplay`

Defined in: [src/provider-contract/types.ts:358](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L358)

Ordered replay evidence, retained with the assistant message.

***

### replayOmissions?

> `readonly` `optional` **replayOmissions?**: readonly `ThinkingReplayOmission`[]

Defined in: [src/provider-contract/types.ts:360](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L360)

Leaf-side omissions, also available to standalone callers without hooks.

***

### stopReason

> `readonly` **stopReason**: `string`

Defined in: [src/provider-contract/types.ts:421](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L421)

***

### toolCalls

> `readonly` **toolCalls**: readonly `object`[]

Defined in: [src/provider-contract/types.ts:362](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L362)

***

### usage

> `readonly` **usage**: `object`

Defined in: [src/provider-contract/types.ts:396](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L396)

#### cacheRead?

> `readonly` `optional` **cacheRead?**: `number`

#### cacheWrite?

> `readonly` `optional` **cacheWrite?**: `number`

#### input

> `readonly` **input**: `number`

#### output

> `readonly` **output**: `number`

#### thinking?

> `readonly` `optional` **thinking?**: `number`

v2.14 — count of reasoning/thinking tokens used by the model.
Distinct from `output` (which is visible-content tokens).

Semantics:
  - `undefined` — provider doesn't expose / no thinking enabled
                  on this call / call without extended thinking
  - `0`         — thinking enabled but model produced no
                  thinking tokens this call
  - `>0`        — actual reasoning token count (billing-relevant
                  for both Anthropic extended thinking and
                  OpenAI o1/o3 reasoning_tokens)

Cost dashboards reading `cost.tick` events should track this
separately from `output` — pricing differs (Anthropic charges
extended thinking at output rates; OpenAI o1/o3 reasoning tokens
are billed as a separate line item).

***

### wireManifest?

> `readonly` `optional` **wireManifest?**: [`WireToolManifest`](/docs/api/interfaces/WireToolManifest)

Defined in: [src/provider-contract/types.ts:452](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L452)

9.60.0 — what this request ACTUALLY carried, read back from the
serialized body after every transform (see adapters/llm/wireManifest.ts,
which builds it; the SHAPE lives here because it is part of the provider
port, and the skill-graph fence rightly refuses this file reaching
anything past the port).

The wire seam's evidence: the recorded defect was an adapter still
serializing four tool schemas after the internal frame said they were
removed — invisible to any check that reads only the pre-serialization
IR. Absent when the adapter states no manifest, and the wire check then
treats the request as INCOMPARABLE (never as "nothing crossed"); an
empty `toolNames` is the opposite — a stated zero.
