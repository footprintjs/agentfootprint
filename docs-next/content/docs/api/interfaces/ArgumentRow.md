---
title: ArgumentRow
---

# Interface: ArgumentRow

Defined in: [src/core/agent/arguments/rows.ts:64](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L64)

The inputs layer's verdict on ONE ruled argument of ONE tool call — a row on
`AgentState.findingsLedger` (`kind: 'argument'`).

This version files `source: 'default'` (the library filled the declared
default, or the model sent that same value itself — `proposed` says which)
and `source: 'model'` (the model sent another value, and the record does not
show where it came from). The other members of each union are the layer's
vocabulary for its later steps — the batch ask (`answered`, `asked`, `free`)
and the declared sources (`said`, `result`, `app`, `claimed`, `failed`, …);
a reader skips what it does not know.

## Properties

### appSource?

> `readonly` `optional` **appSource?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L100)

***

### argument

> `readonly` **argument**: `string`

Defined in: [src/core/agent/arguments/rows.ts:72](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L72)

The top-level argument name — schema vocabulary, like `toolName`.

***

### argumentsFrom?

> `readonly` `optional` **argumentsFrom?**: `"listed"` \| `"unlisted"`

Defined in: [src/core/agent/arguments/rows.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L99)

***

### asked?

> `readonly` `optional` **asked?**: `ArgumentAsked`

Defined in: [src/core/agent/arguments/rows.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L79)

***

### claimed?

> `readonly` `optional` **claimed?**: `ArgumentClaim`

Defined in: [src/core/agent/arguments/rows.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L92)

***

### coincides?

> `readonly` `optional` **coincides?**: `"person"` \| `"app"` \| `"result"`

Defined in: [src/core/agent/arguments/rows.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L102)

***

### earlier?

> `readonly` `optional` **earlier?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L96)

***

### failed?

> `readonly` `optional` **failed?**: `ArgumentCheckFailed`

Defined in: [src/core/agent/arguments/rows.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L104)

***

### free?

> `readonly` `optional` **free?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L101)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/arguments/rows.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L70)

***

### kind

> `readonly` **kind**: `"argument"`

Defined in: [src/core/agent/arguments/rows.ts:65](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L65)

***

### malformed?

> `readonly` `optional` **malformed?**: `number`

Defined in: [src/core/agent/arguments/rows.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L103)

***

### matched?

> `readonly` `optional` **matched?**: `"quote"` \| `"phrase"` \| `"spelling"`

Defined in: [src/core/agent/arguments/rows.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L93)

***

### period?

> `readonly` `optional` **period?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:76](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L76)

Set on the argument `Tool.period` names.

***

### proposed?

> `readonly` `optional` **proposed?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L91)

The MODEL's own value, same view: on a `default` row, the default the model
sent itself (absent = the library filled it); on an `answered` row, the
value the person's answer replaced.

***

### quote?

> `readonly` `optional` **quote?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L94)

***

### reading?

> `readonly` `optional` **reading?**: `true`

Defined in: [src/core/agent/arguments/rows.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L95)

***

### result?

> `readonly` `optional` **result?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L97)

***

### rule?

> `readonly` `optional` **rule?**: `"ask"` \| `"assume"`

Defined in: [src/core/agent/arguments/rows.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L74)

The rule on the argument; absent on a free argument a `from` entry named.

***

### setAside?

> `readonly` `optional` **setAside?**: `"open"` \| `"noise"` \| `"ruled-out"`

Defined in: [src/core/agent/arguments/rows.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L98)

***

### source?

> `readonly` `optional` **source?**: `ArgumentSource`

Defined in: [src/core/agent/arguments/rows.ts:78](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L78)

Where the value came from; absent only on an asked row.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/arguments/rows.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L68)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/arguments/rows.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L69)

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/agent/arguments/rows.ts:67](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L67)

`AgentState.turnNumber` when the row was filed — the conversation turn.

***

### value?

> `readonly` `optional` **value?**: `string`

Defined in: [src/core/agent/arguments/rows.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/rows.ts#L85)

The value the call runs with, in the tool's own argument view, clipped
(`integrity/argumentLeaves.ts` · `clipValue`); `'REDACTED'` when the view
hides the argument.
