---
title: ScriptBlockVerdict
---

# Type Alias: ScriptBlockVerdict

> **ScriptBlockVerdict** = \{ `alsoMatches?`: `number`; `block`: `number`; `exitCode?`: `number`; `label`: [`ScriptLabel`](/docs/api/type-aliases/ScriptLabel); `tool`: `string`; `toolCallId`: `string`; \} \| \{ `block`: `number`; `label`: `"unmatched"`; `reason`: [`UnmatchedReason`](/docs/api/type-aliases/UnmatchedReason); \}

Defined in: [src/lib/scriptRecord.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L58)

The verdict on one fenced block of the answer, under `code: 'match'`.

## Union Members

### Type Literal

\{ `alsoMatches?`: `number`; `block`: `number`; `exitCode?`: `number`; `label`: [`ScriptLabel`](/docs/api/type-aliases/ScriptLabel); `tool`: `string`; `toolCallId`: `string`; \}

#### alsoMatches?

> `readonly` `optional` **alsoMatches?**: `number`

Other calls of this turn that submitted byte-identical programs (the latest is named).

#### block

> `readonly` **block**: `number`

1-based position among the answer's fenced blocks that were read.

#### exitCode?

> `readonly` `optional` **exitCode?**: `number`

#### label

> `readonly` **label**: [`ScriptLabel`](/docs/api/type-aliases/ScriptLabel)

The matched call's own label — F2, never a fixed "executed".

#### tool

> `readonly` **tool**: `string`

#### toolCallId

> `readonly` **toolCallId**: `string`

***

### Type Literal

\{ `block`: `number`; `label`: `"unmatched"`; `reason`: [`UnmatchedReason`](/docs/api/type-aliases/UnmatchedReason); \}
