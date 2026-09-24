[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMMessage

# Interface: LLMMessage

Defined in: [src/adapters/types.ts:21](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L21)

## Properties

### content

> `readonly` **content**: `string`

Defined in: [src/adapters/types.ts:23](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L23)

***

### ephemeral?

> `readonly` `optional` **ephemeral?**: `boolean`

Defined in: [src/adapters/types.ts:91](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L91)

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

Defined in: [src/adapters/types.ts:111](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L111)

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

### notDispatched?

> `readonly` `optional` **notDispatched?**: `object`

Defined in: [src/adapters/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L163)

9.113.0 — this `role: 'tool'` message answers a call that was NEVER
DISPATCHED. The library wrote it; no gate judged the call and no tool ran.

Stamped by the batch settlement (`core/agent/stages/toolCalls.ts` ·
`settleBatch`, which takes each copy from `notDispatchedMarker`). The
model proposed several calls in one turn, one of them paused the run, and
the resume answered each call after it with a fixed sentence
(`notDispatchedResult`) instead of running it. The sentence is what the
MODEL reads. This field is the same fact as data, for the readers that ask
"did this call run?" or "is this message a tool's result?":
`security/extractSequence.ts` · `extractSequence`, which builds the
`sequence` a permission policy judges (pairing each marker with the ONE
proposal it answers, by position — a provider may reuse an id); the
empty-lookup check's producer corpus (`toolCalls.ts` ·
`producerCorpusOf`); the check-in evidence trail
(`core/checkin.ts` · `CheckInTrail` — its `toolCalls` are the calls
already completed); the window's result naming
(`core/agent/window/toolNames.ts` · `toolNameOfMessage` — the
last-tool-result pin, the drop notice, the dangling-reference check); and
the trace toolpack's `inspect_tool_call`
(`lib/trace-toolpack/traceToolpack.ts` · `notDispatchedOf`); and, under
`.findings()`, the offer, the identity source, the piece's `undeclared:`
line, the collapse, the window's `droppedStandings` and a turn's standing
(`core/agent/findings/offer.ts`, `findings/serve.ts` · `collapseJudged`,
`stages/window.ts`, `core/agent/window/ledgerFactPins.ts` ·
`turnStandingOf` — the `'ledger-fact'` pin and
`WindowStrategyInput.standingOf`) — a settled message is not a result to
judge. None of them parses the sentence.

**One definition, two carriers.** The settled call's two brackets on the
event stream carry the same fact under the same name, typed off THIS field
(`events/payloads.ts` · `ToolStartPayload.notDispatched`,
`ToolEndPayload.notDispatched`), so a reader of the stream alone never has
to guess from a `durationMs: 0` bracket whether the call ran.

**Never reaches a provider.** `core/agent/composeRequest.ts` ·
`stripFrameworkFields` removes it with `injectedBy` before a request
exists, so the wire carries the sentence and nothing else.

Absent on every other message.

#### pausedCall

> `readonly` **pausedCall**: `object`

The call in the same batch the run paused on — the one the sentence names.

##### pausedCall.toolCallId

> `readonly` **toolCallId**: `string`

##### pausedCall.toolName

> `readonly` **toolName**: `string`

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/adapters/types.ts:22](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L22)

***

### thinkingBlocks?

> `readonly` `optional` **thinkingBlocks?**: readonly `ThinkingBlock`[]

Defined in: [src/adapters/types.ts:67](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L67)

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

Defined in: [src/adapters/types.ts:25](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L25)

For `role: 'tool'` — the tool_use id this result corresponds to.

***

### toolCalls?

> `readonly` `optional` **toolCalls?**: readonly `object`[]

Defined in: [src/adapters/types.ts:42](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L42)

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

Defined in: [src/adapters/types.ts:27](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L27)

For `role: 'tool'` — the tool name this result corresponds to.
