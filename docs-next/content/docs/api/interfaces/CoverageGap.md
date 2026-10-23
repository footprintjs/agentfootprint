---
title: CoverageGap
---

# Interface: CoverageGap

Defined in: [src/semantics/coverage/composedCoverage.ts:165](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L165)

One piece of ground the call did NOT cover, typed.

  • `argument-unsent` — a classified argument the call did not send and the
    declaration gives no `whenOmitted` for: its default may live inside
    `execute`, so it bears on that argument's facet.
  • `cap-reached` — the rows reached the cap in effect (an argument's, or the
    declared server cap), or the server cap is `'unknown'`.
  • `paged` — a page argument was sent, the result's `paging.next` is not
    null, or a tool with a `page` argument returned no `paging`.
  • `period` — the declared period's verdict is not `covered`.
  • `partial` — the tool declared its outcome `partial` (or `pending`): the
    result is never held in full.
  • `scope` — a declared constant (`search.gaps`).
  • `prose` — a hand-written `notChecked` / `cannotCover` item. It names no
    facet, so it bears on every claim, and a row with one is never complete.

## Properties

### argument?

> `readonly` `optional` **argument?**: `string`

Defined in: [src/semantics/coverage/composedCoverage.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L173)

The argument the gap is about (`argument-unsent`, `cap-reached`, `paged`).

***

### bears?

> `readonly` `optional` **bears?**: [`GapFacet`](/docs/api/type-aliases/GapFacet)

Defined in: [src/semantics/coverage/composedCoverage.ts:171](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L171)

The facet it bears on. Absent only on `prose`: it bears on everything.

***

### kind

> `readonly` **kind**: `CoverageGapKind`

Defined in: [src/semantics/coverage/composedCoverage.ts:166](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L166)

***

### what

> `readonly` **what**: `string`

Defined in: [src/semantics/coverage/composedCoverage.ts:168](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L168)

Library-composed for every kind but `scope` and `prose` (the author's words).

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: [src/semantics/coverage/composedCoverage.ts:169](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L169)
