---
title: CoveredResult<T>
---

# Interface: CoveredResult\<T\>

Defined in: [src/core/agent/coverage/types.ts:249](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L249)

The rendered coverage ledger, wrapped around the result it bounds.

## Type Parameters

### T

`T` = `unknown`

## Properties

### af\_coverage

> `readonly` **af\_coverage**: `object`

Defined in: [src/core/agent/coverage/types.ts:250](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L250)

#### cannot\_cover?

> `readonly` `optional` **cannot\_cover?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

#### checked?

> `readonly` `optional` **checked?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

#### not\_checked?

> `readonly` `optional` **not\_checked?**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

#### note

> `readonly` **note**: `string`

#### period?

> `readonly` `optional` **period?**: `object`

What the read behind the value covered in time — honesty step 7b.
 Serialized before `result`, like the lists.

##### period.held

> `readonly` **held**: `"unknown"` \| \{ `from`: `string`; `to`: `string`; \}

##### period.queried

> `readonly` **queried**: `object`

##### period.queried.from

> `readonly` **from**: `string`

##### period.queried.to

> `readonly` **to**: `string`

##### period.read\_at?

> `readonly` `optional` **read\_at?**: `string`

***

### result

> `readonly` **result**: `T`

Defined in: [src/core/agent/coverage/types.ts:260](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L260)

The tool's own answer, untouched.
