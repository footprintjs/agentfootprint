---
title: LLMResponse
---

# Interface: LLMResponse

Defined in: [src/adapters/types.ts:218](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L218)

## Properties

### content

> `readonly` **content**: `string`

Defined in: [src/adapters/types.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L219)

***

### providerRef?

> `readonly` `optional` **providerRef?**: `string`

Defined in: [src/adapters/types.ts:271](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L271)

***

### rawThinking?

> `readonly` `optional` **rawThinking?**: `unknown`

Defined in: [src/adapters/types.ts:286](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L286)

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

### stopReason

> `readonly` **stopReason**: `string`

Defined in: [src/adapters/types.ts:270](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L270)

***

### toolCalls

> `readonly` **toolCalls**: readonly `object`[]

Defined in: [src/adapters/types.ts:220](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L220)

***

### usage

> `readonly` **usage**: `object`

Defined in: [src/adapters/types.ts:245](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L245)

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
