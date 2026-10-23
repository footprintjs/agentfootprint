---
title: DeclaredCoveredResult<T>
---

# Interface: DeclaredCoveredResult\<T\>

Defined in: [src/semantics/coverage/types.ts:337](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L337)

The envelope `coverage(rows, { checked: 'declared' })` mints, before the
dispatch funnel composes it. `readCoverageLedger` does not read it, so a
reader that predates it sees data; `recognize.ts` · `readDeclaredLedger` is
its one recognizer.

## Type Parameters

### T

`T` = `unknown`

## Properties

### af\_coverage

> `readonly` **af\_coverage**: `Omit`\<\{ `cannot_cover?`: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]; `checked?`: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]; `in_progress?`: readonly [`InProgressItem`](/docs/api/interfaces/InProgressItem)[]; `not_checked?`: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]; `note`: `string`; `period?`: \{ `held`: `"unknown"` \| \{ `from`: `string`; `to`: `string`; \}; `queried`: \{ `from`: `string`; `to`: `string`; \}; `read_at?`: `string`; \}; \}, `"checked"`\> & `object`

Defined in: [src/semantics/coverage/types.ts:338](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L338)

#### Type Declaration

##### checked

> `readonly` **checked**: `"declared"`

***

### result

> `readonly` **result**: `T`

Defined in: [src/semantics/coverage/types.ts:341](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/types.ts#L341)
