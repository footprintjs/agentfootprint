---
title: ArgumentRow
---

# Interface: ArgumentRow

Defined in: [src/core/agent/arguments/rows.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L79)

The inputs layer's verdict on ONE ruled argument of ONE tool call — a row on
`AgentState.findingsLedger` (`kind: 'argument'`).

Filed: `source: 'default'` (the library filled the declared default, or the
model sent that same value itself — `proposed` says which), `source:
'model'` (the model sent another value, and the record does not trace it),
`asked` with no source (the call left an `ask` argument out and the person
was asked — `missing` — or asked again after an answer that did not fit —
`invalid-answer`), and `source: 'answered'` (the person's answer filled the
value; `free` when it came through a free-text field).

Under declared sources (`.findings({ argumentSources: true })`) a present
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

Defined in: [src/core/agent/arguments/rows.ts:120](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L120)

***

### argument

> `readonly` **argument**: `string`

Defined in: [src/core/agent/arguments/rows.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L87)

The top-level argument name — schema vocabulary, like `toolName`.

***

### argumentsFrom?

> `readonly` `optional` **argumentsFrom?**: `"listed"` \| `"unlisted"`

Defined in: [src/core/agent/arguments/rows.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L119)

***

### asked?

> `readonly` `optional` **asked?**: `ArgumentAsked`

Defined in: [src/core/agent/arguments/rows.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L94)

***

### claimed?

> `readonly` `optional` **claimed?**: `ArgumentClaim`

Defined in: [src/core/agent/arguments/rows.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L107)

***

### coincides?

> `readonly` `optional` **coincides?**: `"person"` \| `"app"` \| `"result"`

Defined in: [src/core/agent/arguments/rows.ts:122](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L122)

***

### earlier?

> `readonly` `optional` **earlier?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L116)

***

### failed?

> `readonly` `optional` **failed?**: `ArgumentCheckFailed`

Defined in: [src/core/agent/arguments/rows.ts:124](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L124)

***

### free?

> `readonly` `optional` **free?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L121)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/arguments/rows.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L85)

***

### kind

> `readonly` **kind**: `"argument"`

Defined in: [src/core/agent/arguments/rows.ts:80](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L80)

***

### malformed?

> `readonly` `optional` **malformed?**: `number`

Defined in: [src/core/agent/arguments/rows.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L123)

***

### matched?

> `readonly` `optional` **matched?**: `"quote"` \| `"phrase"` \| `"spelling"`

Defined in: [src/core/agent/arguments/rows.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L108)

***

### period?

> `readonly` `optional` **period?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L91)

Set on the argument `Tool.period` names.

***

### proposed?

> `readonly` `optional` **proposed?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L106)

The MODEL's own value, same view: on a `default` row, the default the model
sent itself (absent = the library filled it); on an `answered` row, the
value the person's answer replaced.

***

### quote?

> `readonly` `optional` **quote?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L114)

The model's `quote`, clipped (`QUOTE_CHARS`) — `'REDACTED'` whenever the
tool's view hid ANY argument of the call: a quote is free text, and may
hold another argument's value.

***

### reading?

> `readonly` `optional` **reading?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L115)

***

### result?

> `readonly` `optional` **result?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L117)

***

### rule?

> `readonly` `optional` **rule?**: `"ask"` \| `"assume"`

Defined in: [src/core/agent/arguments/rows.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L89)

The rule on the argument; absent on a free argument a `from` entry named.

***

### setAside?

> `readonly` `optional` **setAside?**: `"open"` \| `"noise"` \| `"ruled-out"`

Defined in: [src/core/agent/arguments/rows.ts:118](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L118)

***

### source?

> `readonly` `optional` **source?**: `ArgumentSource`

Defined in: [src/core/agent/arguments/rows.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L93)

Where the value came from; absent only on an asked row.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/arguments/rows.ts:83](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L83)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/arguments/rows.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L84)

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/agent/arguments/rows.ts:82](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L82)

`AgentState.turnNumber` when the row was filed — the conversation turn.

***

### value?

> `readonly` `optional` **value?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L100)

The value the call runs with, in the tool's own argument view, clipped
(`integrity/argumentLeaves.ts` · `clipValue`); `'REDACTED'` when the view
hides the argument.
