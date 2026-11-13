---
title: LLMResponse
---

# Interface: LLMResponse

Defined in: [src/provider-contract/types.ts:373](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L373)

## Properties

### content

> `readonly` **content**: `string`

Defined in: [src/provider-contract/types.ts:378](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L378)

***

### providerRef?

> `readonly` `optional` **providerRef?**: `string`

Defined in: [src/provider-contract/types.ts:439](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L439)

***

### rawThinking?

> `readonly` `optional` **rawThinking?**: `unknown`

Defined in: [src/provider-contract/types.ts:454](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L454)

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

Defined in: [src/provider-contract/types.ts:375](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L375)

Ordered replay evidence, retained with the assistant message.

***

### replayOmissions?

> `readonly` `optional` **replayOmissions?**: readonly `ThinkingReplayOmission`[]

Defined in: [src/provider-contract/types.ts:377](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L377)

Leaf-side omissions, also available to standalone callers without hooks.

***

### stopReason

> `readonly` **stopReason**: `string`

Defined in: [src/provider-contract/types.ts:438](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L438)

***

### toolCalls

> `readonly` **toolCalls**: readonly `object`[]

Defined in: [src/provider-contract/types.ts:379](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L379)

***

### usage

> `readonly` **usage**: `object`

Defined in: [src/provider-contract/types.ts:413](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L413)

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

Defined in: [src/provider-contract/types.ts:469](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L469)

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
