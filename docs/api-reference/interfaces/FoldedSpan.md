[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FoldedSpan

# Interface: FoldedSpan

Defined in: [src/core/agent/window/types.ts:232](https://github.com/footprintjs/agentfootprint/blob/52c477b2ecd2d7726225ffb62f954a70f5d77804/src/core/agent/window/types.ts#L232)

One fold, as it survives the process: the summary's fingerprint, what it
stands for, and — under `retain: 'conversation'` — the messages themselves.

These accumulate on the conversation checkpoint across every turn and every
restart, so a standing agent that folded week one in April can still produce
week one in July.

## Joining a span to its summary

By CONTENT FINGERPRINT, never by index: a later fold can swallow an earlier
summary, and every index in the window moves when it does. [foldedSpanFor](/agentfootprint/api/generated/functions/foldedSpanFor.md) does the join for you.

## Properties

### foldedAtMs

> `readonly` **foldedAtMs**: `number`

Defined in: [src/core/agent/window/types.ts:252](https://github.com/footprintjs/agentfootprint/blob/52c477b2ecd2d7726225ffb62f954a70f5d77804/src/core/agent/window/types.ts#L252)

Wall clock of the fold.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/types.ts:250](https://github.com/footprintjs/agentfootprint/blob/52c477b2ecd2d7726225ffb62f954a70f5d77804/src/core/agent/window/types.ts#L250)

ReAct iteration the fold happened at, in that run.

***

### messageCount

> `readonly` **messageCount**: `number`

Defined in: [src/core/agent/window/types.ts:256](https://github.com/footprintjs/agentfootprint/blob/52c477b2ecd2d7726225ffb62f954a70f5d77804/src/core/agent/window/types.ts#L256)

How many messages the summary stands for. Always recorded, both policies.

***

### messages?

> `readonly` `optional` **messages?**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/window/types.ts:268](https://github.com/footprintjs/agentfootprint/blob/52c477b2ecd2d7726225ffb62f954a70f5d77804/src/core/agent/window/types.ts#L268)

The folded messages, verbatim and in order. Present exactly when
`retained` is `'conversation'`.

Absent under `'discard'` — and absent is the honest shape there, rather
than an empty array that reads like "there were none".

***

### model

> `readonly` **model**: `string`

Defined in: [src/core/agent/window/types.ts:254](https://github.com/footprintjs/agentfootprint/blob/52c477b2ecd2d7726225ffb62f954a70f5d77804/src/core/agent/window/types.ts#L254)

The model that wrote the summary — a claim's author is part of the claim.

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:258](https://github.com/footprintjs/agentfootprint/blob/52c477b2ecd2d7726225ffb62f954a70f5d77804/src/core/agent/window/types.ts#L258)

`runtimeStageId`s of the stages that appended those messages.

***

### retained

> `readonly` **retained**: [`CompactionRetention`](/agentfootprint/api/generated/type-aliases/CompactionRetention.md)

Defined in: [src/core/agent/window/types.ts:260](https://github.com/footprintjs/agentfootprint/blob/52c477b2ecd2d7726225ffb62f954a70f5d77804/src/core/agent/window/types.ts#L260)

Which policy this fold ran under.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/window/types.ts:248](https://github.com/footprintjs/agentfootprint/blob/52c477b2ecd2d7726225ffb62f954a70f5d77804/src/core/agent/window/types.ts#L248)

The run whose commit log held these messages. Diagnostic, and the honest
answer to "where else could I have found this?" — that log is gone with
the process, which is why the messages are here.

***

### summaryFingerprint

> `readonly` **summaryFingerprint**: `string`

Defined in: [src/core/agent/window/types.ts:242](https://github.com/footprintjs/agentfootprint/blob/52c477b2ecd2d7726225ffb62f954a70f5d77804/src/core/agent/window/types.ts#L242)

Fingerprint of the summary message this span was folded into — the join
key back to the message sitting in `history`.

It is a hash of the message's full content (authored frame included), so
it costs no extra bytes on the wire and cannot be forged by a summary that
merely copies the frame's opening words: different content, different
fingerprint, no match.
