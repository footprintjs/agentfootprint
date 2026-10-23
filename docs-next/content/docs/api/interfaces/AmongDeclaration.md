---
title: AmongDeclaration
---

# Interface: AmongDeclaration

Defined in: [src/semantics/coverage/types.ts:236](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L236)

The list a missed name was looked up in — `absent({ what, among })`.

A lookup that checks a name against a known list IS a search, and its miss
says only that the name is not on THAT list. `among` declares the list, and
the mint composes the rest: the names facet the tool searched, the gap the
author cannot remove ("names outside <source>"), and the absence's
`provenance` from `source` and `measuredAt`.

## Example

```ts
a name lookup that found nothing in the inventory export
  if (!array) return absent({
    what: array_id,
    among: { argument: 'array_id', source: inventory.source, measuredAt: inventory.readAt,
             count: inventory.names.length, names: inventory.names, visible: 'caller' },
  });
```

## Properties

### argument

> `readonly` **argument**: `string`

Defined in: [src/semantics/coverage/types.ts:238](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L238)

The input argument whose value was looked up ('array_id').

***

### authoritative?

> `readonly` `optional` **authoritative?**: `object`

Defined in: [src/semantics/coverage/types.ts:264](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L264)

The ONE opt-out of the "names outside <source>" gap: the author says the
source is every name there is, and why. Every use is listed for review by
`check:semantics` (`authoritative-names`).

#### why

> `readonly` **why**: `string`

***

### count

> `readonly` **count**: `number`

Defined in: [src/semantics/coverage/types.ts:244](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L244)

How many names the list holds — a whole number. Always served.

***

### measuredAt

> `readonly` **measuredAt**: `string`

Defined in: [src/semantics/coverage/types.ts:242](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L242)

When that list was read — the tool's own words, never parsed (the `provenance` rule).

***

### names?

> `readonly` `optional` **names?**: readonly `string`[]

Defined in: [src/semantics/coverage/types.ts:251](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L251)

The names the list holds. When given, `names.length` must equal `count`
(`names-count-mismatch`). Served only with [AmongDeclaration.visible](/docs/api/interfaces/AmongDeclaration#visible)
`'caller'`, and then only the import('./among.js').KNOWN\_NAMES\_SHOWN
nearest the looked-for value.

***

### source

> `readonly` **source**: `string`

Defined in: [src/semantics/coverage/types.ts:240](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L240)

The list the names were read from, in the author's words ('the PowerStore inventory export'). One line.

***

### visible?

> `readonly` `optional` **visible?**: `"caller"`

Defined in: [src/semantics/coverage/types.ts:258](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L258)

`'caller'` — the tool read this list under the caller's OWN identity, so
the caller may see names from it. Required for any name to be served:
there is no default, because a list visible by default would enumerate one
principal's names to another.
