---
title: ComposedCoverage
---

# Interface: ComposedCoverage

Defined in: [src/semantics/coverage/composedCoverage.ts:208](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L208)

What the funnel composes for one call of a `search` tool — revision 5's
§ 3.2 row, field for field, with the subject as a `checked` item.

`composed: 'remote'` marks a row whose declaration arrived over MCP or from a
`ToolProvider`: it is composed the same way so a reader sees one shape, it
is never `complete`, and it establishes nothing.

## Extends

- [`DeclaredCoverage`](/docs/api/interfaces/DeclaredCoverage)

## Properties

### cannotCover

> `readonly` **cannotCover**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/semantics/coverage/types.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L125)

#### Inherited from

[`DeclaredCoverage`](/docs/api/interfaces/DeclaredCoverage).[`cannotCover`](/docs/api/interfaces/DeclaredCoverage#cannotcover)

***

### checked

> `readonly` **checked**: readonly `ComposedItem`[]

Defined in: [src/semantics/coverage/composedCoverage.ts:224](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L224)

#### Overrides

[`DeclaredCoverage`](/docs/api/interfaces/DeclaredCoverage).[`checked`](/docs/api/interfaces/DeclaredCoverage#checked)

***

### complete

> `readonly` **complete**: `boolean`

Defined in: [src/semantics/coverage/composedCoverage.ts:231](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L231)

True only for a LOCAL row whose declaration says `complete:
'within-arguments'` and that carries no `argument-unsent`, no
`completeness` gap and no `prose` gap. Absent `complete` in the
declaration = never complete.

***

### composed

> `readonly` **composed**: `"local"` \| `"remote"`

Defined in: [src/semantics/coverage/composedCoverage.ts:209](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L209)

***

### gaps

> `readonly` **gaps**: readonly `CoverageGap`[]

Defined in: [src/semantics/coverage/composedCoverage.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L232)

***

### handle

> `readonly` **handle**: `string`

Defined in: [src/semantics/coverage/composedCoverage.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L223)

The read's short HANDLE (`r3`) — the reservation's ordinal, the only thing
a typed claim may cite once the arm serves it beside the result (design
R5). Library-minted, like `resultId`; never the provider's call id.

***

### inProgress?

> `readonly` `optional` **inProgress?**: readonly [`InProgressItem`](/docs/api/interfaces/InProgressItem)[]

Defined in: [src/semantics/coverage/types.ts:499](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L499)

What the call found still running — its outcome not known yet — as the
`coverage()` declared it (copied item by item; `short` and `count` when
valid). Present only on a `'ledger'` row whose envelope declared a
well-formed, non-empty `in_progress`.

#### Inherited from

[`DeclaredCoverage`](/docs/api/interfaces/DeclaredCoverage).[`inProgress`](/docs/api/interfaces/DeclaredCoverage#inprogress)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/semantics/coverage/types.ts:483](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L483)

#### Inherited from

[`DeclaredCoverage`](/docs/api/interfaces/DeclaredCoverage).[`iteration`](/docs/api/interfaces/DeclaredCoverage#iteration)

***

### kind

> `readonly` **kind**: `"absence"` \| `"ledger"`

Defined in: [src/semantics/coverage/types.ts:480](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L480)

#### Inherited from

[`DeclaredCoverage`](/docs/api/interfaces/DeclaredCoverage).[`kind`](/docs/api/interfaces/DeclaredCoverage#kind)

***

### lookedFor?

> `readonly` `optional` **lookedFor?**: `string`

Defined in: [src/semantics/coverage/types.ts:485](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L485)

Present for `'absence'` only — what the search was for.

#### Inherited from

[`DeclaredCoverage`](/docs/api/interfaces/DeclaredCoverage).[`lookedFor`](/docs/api/interfaces/DeclaredCoverage#lookedfor)

***

### notChecked

> `readonly` **notChecked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/semantics/coverage/types.ts:124](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L124)

#### Inherited from

[`DeclaredCoverage`](/docs/api/interfaces/DeclaredCoverage).[`notChecked`](/docs/api/interfaces/DeclaredCoverage#notchecked)

***

### overclaim?

> `readonly` `optional` **overclaim?**: readonly `string`[]

Defined in: [src/semantics/coverage/composedCoverage.ts:239](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L239)

Codes the dispatch-time overclaim check marked on this row (design § 4) —
written by that check, never by composition; absent when none.

***

### period?

> `readonly` `optional` **period?**: [`DeclaredPeriod`](/docs/api/interfaces/DeclaredPeriod)

Defined in: [src/semantics/coverage/composedCoverage.ts:234](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L234)

As on every row — the period the result declared.

#### Overrides

[`DeclaredCoverage`](/docs/api/interfaces/DeclaredCoverage).[`period`](/docs/api/interfaces/DeclaredCoverage#period)

***

### resultId

> `readonly` **resultId**: `string`

Defined in: [src/semantics/coverage/composedCoverage.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/composedCoverage.ts#L217)

The row's ADDRESS — the library-minted result identity
(`claim-result/<namespace>/<runId>/<ordinal>`, minted by
`integrity/claim-binding/capture.ts` · `resultIdentityOf`). Never a
provider's call id: those repeat across iterations, branches, resume legs
and turns, and some providers mint none.

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/semantics/coverage/types.ts:482](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L482)

#### Inherited from

[`DeclaredCoverage`](/docs/api/interfaces/DeclaredCoverage).[`toolCallId`](/docs/api/interfaces/DeclaredCoverage#toolcallid)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/semantics/coverage/types.ts:481](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L481)

#### Inherited from

[`DeclaredCoverage`](/docs/api/interfaces/DeclaredCoverage).[`toolName`](/docs/api/interfaces/DeclaredCoverage#toolname)
