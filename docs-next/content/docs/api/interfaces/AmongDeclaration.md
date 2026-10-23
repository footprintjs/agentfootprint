---
title: AmongDeclaration
---

# Interface: AmongDeclaration

Defined in: [src/semantics/coverage/types.ts:262](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L262)

The list a missed name was looked up in — `absent({ what, among })`.

A lookup that checks a name against a known list IS a search, and its miss
says only that the name is not on THAT list. `among` declares the list, and
the mint composes the rest: the names facet the tool searched, the gap the
author cannot remove ("names outside <source>" — and, for a `partial` read,
"not every name in <source> was read"), and the absence's `provenance` from
`source` and `measuredAt`. The gap holds where `among` is declared; a plain
`absent({ what })` or a thrown refusal never passes through it.

## Example

```ts
a name lookup that found nothing in the inventory export
  if (!array) return absent({
    what: array_id,
    among: { argument: 'array_id', source: inventory.source, measuredAt: inventory.readAt,
             count: inventory.names.length, names: inventory.names },
  });
```

## Properties

### argument

> `readonly` **argument**: `string`

Defined in: [src/semantics/coverage/types.ts:264](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L264)

The input argument whose value was looked up ('array_id').

***

### authoritative?

> `readonly` `optional` **authoritative?**: `object`

Defined in: [src/semantics/coverage/types.ts:294](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L294)

The ONE opt-out of the "names outside <source>" gap: the author says the
source is every name there is, and why — the tool's claim, not verified.
Every use is listed for review by `check:semantics` (`authoritative-names`).

#### why

> `readonly` **why**: `string`

***

### count

> `readonly` **count**: `number`

Defined in: [src/semantics/coverage/types.ts:275](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L275)

How many names the list holds — a whole number. The tool's claim; served on the facet.

***

### measuredAt

> `readonly` **measuredAt**: `string`

Defined in: [src/semantics/coverage/types.ts:273](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L273)

When that list was read — the tool's own words (the `provenance` rule).
When it is an ISO 8601 instant this library can read, the names facet
also carries a dated note, "names as of <measuredAt>" — no judgement of
whether that is old.

***

### names?

> `readonly` `optional` **names?**: readonly `string`[]

Defined in: [src/semantics/coverage/types.ts:281](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L281)

The names the list holds, read ONLY to check `count`: when given,
`names.length` must equal it (`names-count-mismatch`). No name is served
to the model or written to an event or a record.

***

### partial?

> `readonly` `optional` **partial?**: `boolean`

Defined in: [src/semantics/coverage/types.ts:288](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L288)

`true` when the read did not see every name in the source — a truncated
or paged inventory. The mint then composes a completeness gap, "not every
name in <source> was read" (`bears: 'completeness'`), beside "names
outside <source>", and `authoritative` never removes it.

***

### source

> `readonly` **source**: `string`

Defined in: [src/semantics/coverage/types.ts:266](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L266)

The list the names were read from, in the author's words ('the PowerStore inventory export'). One line.
