---
title: assertResultKind
---

# Function: assertResultKind()

> **assertResultKind**(`toolName`, `resultKind`): `void`

Defined in: [src/core/tools.ts:381](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L381)

Refuse a `resultKind` that could never be redeemed, at definition time —
naming the tool and the fix (the `assertResultCeiling` / `assertResultClass`
law: a declaration this library cannot honor fails HERE, never at the first
oversized result of the first run). Exported beside them for consumers
assembling `Tool` objects by hand.

The one rule is non-blankness, and it is not a formality: the kind is what a
`wants` argument is matched against by exact string equality, so a blank or
whitespace-only kind mints a ticket no declaration can ever name — the same
refusal `assertToolWants` raises on the consuming end, raised on the
producing end too. There is deliberately NO charset or shape rule: the kind
is the consumer's vocabulary, and the library does not own it.

## Parameters

### toolName

`string`

### resultKind

`string` \| `undefined`

## Returns

`void`
