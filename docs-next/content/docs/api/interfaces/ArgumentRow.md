---
title: ArgumentRow
---

# Interface: ArgumentRow

Defined in: [src/core/agent/arguments/rows.ts:72](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L72)

The inputs layer's verdict on ONE ruled argument of ONE tool call — a row on
`AgentState.findingsLedger` (`kind: 'argument'`).

This version files `source: 'default'` (the library filled the declared
default, or the model sent that same value itself — `proposed` says which),
`source: 'model'` (the model sent another value, and the record does not
show where it came from), `asked` with no source (the call left an `ask`
argument out and the person was asked — `missing` — or asked again after an
answer that did not fit — `invalid-answer`), and `source: 'answered'` (the
person's answer filled the value; `free` when it came through a free-text
field). The other members of each union are the layer's vocabulary for its
later steps — the declared sources (`said`, `result`, `app`, `claimed`,
`failed`, …); a reader skips what it does not know.

## Properties

### appSource?

> `readonly` `optional` **appSource?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L108)

***

### argument

> `readonly` **argument**: `string`

Defined in: [src/core/agent/arguments/rows.ts:80](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L80)

The top-level argument name — schema vocabulary, like `toolName`.

***

### argumentsFrom?

> `readonly` `optional` **argumentsFrom?**: `"listed"` \| `"unlisted"`

Defined in: [src/core/agent/arguments/rows.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L107)

***

### asked?

> `readonly` `optional` **asked?**: `ArgumentAsked`

Defined in: [src/core/agent/arguments/rows.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L87)

***

### claimed?

> `readonly` `optional` **claimed?**: `ArgumentClaim`

Defined in: [src/core/agent/arguments/rows.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L100)

***

### coincides?

> `readonly` `optional` **coincides?**: `"person"` \| `"app"` \| `"result"`

Defined in: [src/core/agent/arguments/rows.ts:110](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L110)

***

### earlier?

> `readonly` `optional` **earlier?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L104)

***

### failed?

> `readonly` `optional` **failed?**: `ArgumentCheckFailed`

Defined in: [src/core/agent/arguments/rows.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L112)

***

### free?

> `readonly` `optional` **free?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L109)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/arguments/rows.ts:78](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L78)

***

### kind

> `readonly` **kind**: `"argument"`

Defined in: [src/core/agent/arguments/rows.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L73)

***

### malformed?

> `readonly` `optional` **malformed?**: `number`

Defined in: [src/core/agent/arguments/rows.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L111)

***

### matched?

> `readonly` `optional` **matched?**: `"quote"` \| `"phrase"` \| `"spelling"`

Defined in: [src/core/agent/arguments/rows.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L101)

***

### period?

> `readonly` `optional` **period?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L84)

Set on the argument `Tool.period` names.

***

### proposed?

> `readonly` `optional` **proposed?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L99)

The MODEL's own value, same view: on a `default` row, the default the model
sent itself (absent = the library filled it); on an `answered` row, the
value the person's answer replaced.

***

### quote?

> `readonly` `optional` **quote?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L102)

***

### reading?

> `readonly` `optional` **reading?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L103)

***

### result?

> `readonly` `optional` **result?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L105)

***

### rule?

> `readonly` `optional` **rule?**: `"ask"` \| `"assume"`

Defined in: [src/core/agent/arguments/rows.ts:82](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L82)

The rule on the argument; absent on a free argument a `from` entry named.

***

### setAside?

> `readonly` `optional` **setAside?**: `"open"` \| `"noise"` \| `"ruled-out"`

Defined in: [src/core/agent/arguments/rows.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L106)

***

### source?

> `readonly` `optional` **source?**: `ArgumentSource`

Defined in: [src/core/agent/arguments/rows.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L86)

Where the value came from; absent only on an asked row.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/arguments/rows.ts:76](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L76)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/arguments/rows.ts:77](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L77)

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/agent/arguments/rows.ts:75](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L75)

`AgentState.turnNumber` when the row was filed — the conversation turn.

***

### value?

> `readonly` `optional` **value?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L93)

The value the call runs with, in the tool's own argument view, clipped
(`integrity/argumentLeaves.ts` · `clipValue`); `'REDACTED'` when the view
hides the argument.
