---
title: ScriptBlockVerdict
---

# Type Alias: ScriptBlockVerdict

> **ScriptBlockVerdict** = \{ `alsoMatches?`: `number`; `block`: `number`; `dispatch`: `number`; `exitCode?`: `number`; `label`: [`ScriptLabel`](/docs/api/type-aliases/ScriptLabel); `tool`: `string`; `toolCallId`: `string`; \} \| \{ `block`: `number`; `label`: `"unmatched"`; `reason`: [`UnmatchedReason`](/docs/api/type-aliases/UnmatchedReason); \}

Defined in: [src/lib/scriptRecord.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/scriptRecord.ts#L58)

The verdict on one fenced block of the answer, under `code: 'match'`.

## Union Members

### Type Literal

\{ `alsoMatches?`: `number`; `block`: `number`; `dispatch`: `number`; `exitCode?`: `number`; `label`: [`ScriptLabel`](/docs/api/type-aliases/ScriptLabel); `tool`: `string`; `toolCallId`: `string`; \}

#### alsoMatches?

> `readonly` `optional` **alsoMatches?**: `number`

Other calls of this turn that submitted byte-identical programs (the latest is named).

#### block

> `readonly` **block**: `number`

1-based position among the answer's fenced blocks that were read.

#### dispatch

> `readonly` **dispatch**: `number`

The library's identity for the matched call: the 1-based order of the
actual dispatch within its turn. A reused provider id is a new dispatch;
a pause and its settlement are one.

#### exitCode?

> `readonly` `optional` **exitCode?**: `number`

#### label

> `readonly` **label**: [`ScriptLabel`](/docs/api/type-aliases/ScriptLabel)

The matched call's own label — F2, never a fixed "executed".

#### tool

> `readonly` **tool**: `string`

#### toolCallId

> `readonly` **toolCallId**: `string`

The provider's id for the call — display only; two calls may share one.

***

### Type Literal

\{ `block`: `number`; `label`: `"unmatched"`; `reason`: [`UnmatchedReason`](/docs/api/type-aliases/UnmatchedReason); \}
