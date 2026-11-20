---
title: DeclaredPeriod
---

# Interface: DeclaredPeriod

Defined in: [src/semantics/coverage/period.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/period.ts#L87)

The period a result declares — what its READ covered — in the camelCase
spelling an author writes on `absent()`, `coverage()` and
`describedResult()`, and the record keeps (the `coverageDeclared` row, the
`tools.absent` / `tools.coverage_declared` events). The wire spells it
snake_case (`read_at`).

## Example

```ts
absent({
  what: 'failed backup runs for host-103',
  checked: ['every job in the 02:00 export'],
  period: {
    queried: { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' },
    held: { from: '2026-08-27T02:00:00Z', to: '2026-09-26T02:00:00Z' },
  },
});
```

## Properties

### held

> `readonly` **held**: `"unknown"` \| \{ `from`: `string`; `to`: `string`; \}

Defined in: [src/semantics/coverage/period.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/period.ts#L93)

What the store holds at the time of the read — the same shape — or
 `'unknown'`, said out loud when the tool cannot vouch for it.

***

### queried

> `readonly` **queried**: `object`

Defined in: [src/semantics/coverage/period.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/period.ts#L90)

The instants of the READ that produced this result — not of "this call".
 ISO 8601 instants WITH a zone; `from` is not after `to`.

#### from

> `readonly` **from**: `string`

#### to

> `readonly` **to**: `string`

***

### readAt?

> `readonly` `optional` **readAt?**: `string`

Defined in: [src/semantics/coverage/period.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/period.ts#L96)

When the read ran — a cached answer is served minutes after the read it
 describes. An ISO 8601 instant with a zone.
