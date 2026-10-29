---
title: ScriptRow
---

# Interface: ScriptRow

Defined in: [src/core/agent/scripts/types.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L45)

One call of a declared code-running tool (`Tool.script`), on the findings
ledger — F1 (the program submitted) and F2 (what its execution record
proves), and nothing about any value.

Filed by the dispatch loop (`stages/toolCalls.ts`) while
`.namesAndNumbersFromEvidence({ code: 'match' })` or
`.scriptTravelsWithTheAnswer()` is on, through ONE writer (`rows.ts` ·
`recordScriptRow`): the call's row is KEPT CURRENT — its outcome is written
when the call settles, and a row that never settles stays `submitted`. At
the next turn boundary (seed) the row keeps its facts and loses its `text`.

## Properties

### argument

> `readonly` **argument**: `string`

Defined in: [src/core/agent/scripts/types.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L51)

The declared argument that carried the program.

***

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/core/agent/scripts/types.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L55)

UTF-8 bytes of the program submitted to the tool.

***

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/core/agent/scripts/types.ts:65](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L65)

Exactly the runner's exit code, only when it supplied one.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/scripts/types.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L74)

***

### kind

> `readonly` **kind**: `"script"`

Defined in: [src/core/agent/scripts/types.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L46)

***

### language?

> `readonly` `optional` **language?**: `string`

Defined in: [src/core/agent/scripts/types.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L53)

The declared language, when the tool declared one.

***

### lines

> `readonly` **lines**: `number`

Defined in: [src/core/agent/scripts/types.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L57)

Lines of that program (LF-separated; `0` for an empty program).

***

### outcome

> `readonly` **outcome**: [`ScriptLabel`](/docs/api/type-aliases/ScriptLabel)

Defined in: [src/core/agent/scripts/types.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L63)

***

### resultWithheld?

> `readonly` `optional` **resultWithheld?**: `"over-ceiling"`

Defined in: [src/core/agent/scripts/types.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L69)

The tool's own `resultCeiling` replaced the delivered result.

***

### rewritten?

> `readonly` `optional` **rewritten?**: `true`

Defined in: [src/core/agent/scripts/types.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L71)

A before-tool rule changed the program before dispatch; the earlier text is on no row.

***

### serviceError?

> `readonly` `optional` **serviceError?**: `true`

Defined in: [src/core/agent/scripts/types.ts:67](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L67)

The runner's failure verdict was the service's, with no exit code.

***

### text?

> `readonly` `optional` **text?**: `string`

Defined in: [src/core/agent/scripts/types.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L62)

The program submitted to the tool, byte for byte. ABSENT over
`MAX_SCRIPT_BYTES`, and after the row's turn ended.

***

### tool

> `readonly` **tool**: `string`

Defined in: [src/core/agent/scripts/types.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L49)

The name the model called.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/scripts/types.ts:47](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L47)

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/agent/scripts/types.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/scripts/types.ts#L73)

`AgentState.turnNumber` when the call was made.
