[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMMessage

# Interface: LLMMessage

Defined in: [src/adapters/types.ts:21](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L21)

## Properties

### content

> `readonly` **content**: `string`

Defined in: [src/adapters/types.ts:23](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L23)

***

### ephemeral?

> `readonly` `optional` **ephemeral?**: `boolean`

Defined in: [src/adapters/types.ts:91](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L91)

v2.13 — PERSISTENCE flag (NOT a visibility flag). When `true`:
  • The message IS sent to the LLM as part of the next request
    (visible to the model, counts toward its context window).
  • The message is OBSERVABLE via narrative/recorders/audit log
    (visible to humans for debugging + forensics).
  • The message is NOT persisted to `scope.history` after the gate
    loop that produced it completes — long-term memory writes,
    `getNarrative()` snapshots, and downstream consumers see only
    non-ephemeral messages.

Use case: Instructor-style schema retry. The reliability gate
appends `{ role: 'user', content: feedbackForLLM, ephemeral: true }`
before retry — the LLM sees the validation feedback for the next
call, but the conversation history (and any memory persistence
downstream) sees only the final accepted exchange.

Audit-trail safety: ephemeral DOES NOT mean invisible to security
review. `getNarrative()`, recorders, and the typed-event stream all
see ephemeral messages; only the persistent conversation log filters
them out. An attacker cannot use the ephemeral marker to construct
audit-invisible prompts.

***

### injectedBy?

> `readonly` `optional` **injectedBy?**: `object`

Defined in: [src/adapters/types.ts:111](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L111)

v7.21 — WHO let this message into the window.

Stamped by the agent's `Deliver` stage on a message that came from a
`slot: 'messages'` Injection rather than from the conversation. It is the
stable marker the messages slot reads to attribute the message to its
injection (source / sourceId / reason) instead of inferring a baseline
source from the role — so one wire message produces exactly one
`context.injected` record, naming whoever put it there.

**Never reaches a provider.** `callLLM` strips this field from every
message before the request is handed to `provider.complete()` / `stream()`,
so no adapter — first-party or consumer-authored — can leak framework
metadata onto a wire, even one that serializes a message wholesale.
Stripping removes a field, never a message, so wire indices are unchanged
(which is what lets a `CacheMarker{field:'messages'}` name a real position).

Absent on every message that came from the conversation itself.

#### flavor

> `readonly` **flavor**: `ContextSource`

The injection's flavor — the `source` the slot records.

#### injectionId

> `readonly` **injectionId**: `string`

The `Injection.id` that produced this message.

#### iteration

> `readonly` **iteration**: `number`

The ReAct iteration whose boundary delivered it.

#### reason?

> `readonly` `optional` **reason?**: `string`

The injection's description, when it had one.

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/adapters/types.ts:22](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L22)

***

### thinkingBlocks?

> `readonly` `optional` **thinkingBlocks?**: readonly `ThinkingBlock`[]

Defined in: [src/adapters/types.ts:67](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L67)

v2.14 — Thinking blocks emitted by the LLM on assistant turns.

Required for Anthropic extended-thinking + tool-use flows: signed
blocks MUST be echoed BYTE-EXACT in subsequent assistant turns or
Anthropic's API rejects with 400. The framework persists blocks
here so the AnthropicProvider's serializer (Phase 4b) can restore
them on the next request.

**Persistence model — DIFFERENT from `ephemeral`:**
  - `ephemeral` messages: NOT persisted to scope.history
  - `thinkingBlocks`: PERSISTED (required for signature round-trip)

Visible to recorders + audit by default. Use
`RedactionPolicy.thinkingPatterns` (Phase 3) to scrub sensitive
reasoning content before audit-log adapters fire.

Empty array OR undefined when no thinking is present (most calls).

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/adapters/types.ts:25](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L25)

For `role: 'tool'` — the tool_use id this result corresponds to.

***

### toolCalls?

> `readonly` `optional` **toolCalls?**: readonly `object`[]

Defined in: [src/adapters/types.ts:42](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L42)

For `role: 'assistant'` only — the tool calls the LLM requested in this
turn. Required for providers (Anthropic, OpenAI) that need to round-trip
tool_use blocks across iterations: when the next `complete()` includes
a `role: 'tool'` message, the provider reconstructs the matching
`tool_use` block on the previous assistant turn from this field.
Empty array on text-only turns; undefined for non-assistant roles.

`providerMeta` (9.29.0) rides back UNCHANGED — it is the same bag the
response put there, and for Gemini it holds the `thoughtSignature` without
which the model refuses the turn after a tool call. See
[LLMResponse](/agentfootprint/api/generated/interfaces/LLMResponse.md)'s `toolCalls[].providerMeta`. Unlike `injectedBy`, it
is NOT stripped on the way to a provider: it exists to be sent.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/adapters/types.ts:27](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L27)

For `role: 'tool'` — the tool name this result corresponds to.
