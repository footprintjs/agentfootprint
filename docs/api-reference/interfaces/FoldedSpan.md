[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FoldedSpan

# Interface: FoldedSpan

Defined in: [src/core/agent/window/types.ts:241](https://github.com/footprintjs/agentfootprint/blob/748af7710d9294f3d459d9a2d042f65ccd396a5a/src/core/agent/window/types.ts#L241)

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

Defined in: [src/core/agent/window/types.ts:261](https://github.com/footprintjs/agentfootprint/blob/748af7710d9294f3d459d9a2d042f65ccd396a5a/src/core/agent/window/types.ts#L261)

Wall clock of the fold.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/types.ts:259](https://github.com/footprintjs/agentfootprint/blob/748af7710d9294f3d459d9a2d042f65ccd396a5a/src/core/agent/window/types.ts#L259)

ReAct iteration the fold happened at, in that run.

***

### messageCount

> `readonly` **messageCount**: `number`

Defined in: [src/core/agent/window/types.ts:265](https://github.com/footprintjs/agentfootprint/blob/748af7710d9294f3d459d9a2d042f65ccd396a5a/src/core/agent/window/types.ts#L265)

How many messages the summary stands for. Always recorded, both policies.

***

### messages?

> `readonly` `optional` **messages?**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/window/types.ts:277](https://github.com/footprintjs/agentfootprint/blob/748af7710d9294f3d459d9a2d042f65ccd396a5a/src/core/agent/window/types.ts#L277)

The folded messages, verbatim and in order. Present exactly when
`retained` is `'conversation'`.

Absent under `'discard'` — and absent is the honest shape there, rather
than an empty array that reads like "there were none".

***

### model

> `readonly` **model**: `string`

Defined in: [src/core/agent/window/types.ts:263](https://github.com/footprintjs/agentfootprint/blob/748af7710d9294f3d459d9a2d042f65ccd396a5a/src/core/agent/window/types.ts#L263)

The model that wrote the summary — a claim's author is part of the claim.

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:267](https://github.com/footprintjs/agentfootprint/blob/748af7710d9294f3d459d9a2d042f65ccd396a5a/src/core/agent/window/types.ts#L267)

`runtimeStageId`s of the stages that appended those messages.

***

### retained

> `readonly` **retained**: [`CompactionRetention`](/agentfootprint/api/generated/type-aliases/CompactionRetention.md)

Defined in: [src/core/agent/window/types.ts:269](https://github.com/footprintjs/agentfootprint/blob/748af7710d9294f3d459d9a2d042f65ccd396a5a/src/core/agent/window/types.ts#L269)

Which policy this fold ran under.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/window/types.ts:257](https://github.com/footprintjs/agentfootprint/blob/748af7710d9294f3d459d9a2d042f65ccd396a5a/src/core/agent/window/types.ts#L257)

The run whose commit log held these messages. Diagnostic, and the honest
answer to "where else could I have found this?" — that log is gone with
the process, which is why the messages are here.

***

### summaryFingerprint

> `readonly` **summaryFingerprint**: `string`

Defined in: [src/core/agent/window/types.ts:251](https://github.com/footprintjs/agentfootprint/blob/748af7710d9294f3d459d9a2d042f65ccd396a5a/src/core/agent/window/types.ts#L251)

Fingerprint of the summary message this span was folded into — the join
key back to the message sitting in `history`.

It is a hash of the message's full content (authored frame included), so
it costs no extra bytes on the wire and cannot be forged by a summary that
merely copies the frame's opening words: different content, different
fingerprint, no match.
