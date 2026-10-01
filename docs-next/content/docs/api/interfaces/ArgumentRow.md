---
title: ArgumentRow
---

# Interface: ArgumentRow

Defined in: [src/core/agent/arguments/rows.ts:80](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L80)

The inputs layer's verdict on ONE ruled argument of ONE tool call — a row on
`AgentState.findingsLedger` (`kind: 'argument'`).

Filed: `source: 'default'` (the library filled the declared default, or the
model sent that same value itself — `proposed` says which), `source:
'model'` (the model sent another value, and the record does not trace it),
`asked` with no source (the call left an `ask` argument out and the person
was asked — `missing` — or asked again after an answer that did not fit —
`invalid-answer`), and `source: 'answered'` (the person's answer filled the
value; `free` when it came through a free-text field).

Under declared sources (`.inputsLayer({ argumentSources: true })` or
`.findings({ argumentSources: true })`) a present
value's row also carries the model's claim and the library's check of it
(`sourcedRowOf`): `claimed` (`'none'` when it declared nothing), `source`
`said` / `result` / `app` / `answered` when the check traced it (`matched`,
`reading`, `earlier`, `result`, `setAside`, `argumentsFrom`, `appSource`),
`failed` when it did not, `coincides` for the library's own lookup (a hint,
never a source), and `asked: 'unverified'` with the model's value as
`proposed` when an `ask` rule asks about it. A FREE argument a `from` entry
named is filed with no `rule`. A reader skips a member it does not know.

## Properties

### appSource?

> `readonly` `optional` **appSource?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L129)

***

### argument

> `readonly` **argument**: `string`

Defined in: [src/core/agent/arguments/rows.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L88)

The top-level argument name — schema vocabulary, like `toolName`.

***

### argumentsFrom?

> `readonly` `optional` **argumentsFrom?**: `"listed"` \| `"unlisted"`

Defined in: [src/core/agent/arguments/rows.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L128)

***

### asked?

> `readonly` `optional` **asked?**: `ArgumentAsked`

Defined in: [src/core/agent/arguments/rows.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L95)

***

### claimed?

> `readonly` `optional` **claimed?**: `ArgumentClaim`

Defined in: [src/core/agent/arguments/rows.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L108)

***

### coincides?

> `readonly` `optional` **coincides?**: `"person"` \| `"app"` \| `"result"`

Defined in: [src/core/agent/arguments/rows.ts:131](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L131)

***

### earlier?

> `readonly` `optional` **earlier?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L125)

***

### failed?

> `readonly` `optional` **failed?**: `ArgumentCheckFailed`

Defined in: [src/core/agent/arguments/rows.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L133)

***

### free?

> `readonly` `optional` **free?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:130](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L130)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/arguments/rows.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L86)

***

### kind

> `readonly` **kind**: `"argument"`

Defined in: [src/core/agent/arguments/rows.ts:81](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L81)

***

### malformed?

> `readonly` `optional` **malformed?**: `number`

Defined in: [src/core/agent/arguments/rows.ts:132](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L132)

***

### matched?

> `readonly` `optional` **matched?**: `ArgumentMatched`

Defined in: [src/core/agent/arguments/rows.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L116)

How the value was traced to its source: the quote holds it, a declared
phrase names it, an earlier answer in another spelling — or, under
`.time()`, it IS the window of a mention the reader recorded (`mention`:
the library filled it from that window, or the model's quote named that
mention and its value equals the window).

***

### period?

> `readonly` `optional` **period?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L92)

Set on the argument `Tool.period` names.

***

### proposed?

> `readonly` `optional` **proposed?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L107)

The MODEL's own value, same view: on a `default` row, the default the model
sent itself (absent = the library filled it); on an `answered` row, the
value the person's answer replaced.

***

### quote?

> `readonly` `optional` **quote?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L123)

The model's `quote`, clipped (`QUOTE_CHARS`) — `'REDACTED'` on an agent
where ANY tool in reach can hide arguments (it registers a tool that
carries an argument view, or wires a ToolProvider — whatever it lists): a
quote is free text, and may hold any value a tool hides, in any spelling.

***

### reading?

> `readonly` `optional` **reading?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:124](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L124)

***

### result?

> `readonly` `optional` **result?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:126](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L126)

***

### rule?

> `readonly` `optional` **rule?**: `"ask"` \| `"assume"`

Defined in: [src/core/agent/arguments/rows.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L90)

The rule on the argument; absent on a free argument a `from` entry named.

***

### setAside?

> `readonly` `optional` **setAside?**: `"open"` \| `"noise"` \| `"ruled-out"`

Defined in: [src/core/agent/arguments/rows.ts:127](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L127)

***

### source?

> `readonly` `optional` **source?**: `ArgumentSource`

Defined in: [src/core/agent/arguments/rows.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L94)

Where the value came from; absent only on an asked row.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/arguments/rows.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L84)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/arguments/rows.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L85)

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/agent/arguments/rows.ts:83](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L83)

`AgentState.turnNumber` when the row was filed — the conversation turn.

***

### value?

> `readonly` `optional` **value?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L101)

The value the call runs with, in the tool's own argument view, clipped
(`integrity/argumentLeaves.ts` · `clipValue`); `'REDACTED'` when the view
hides the argument.
