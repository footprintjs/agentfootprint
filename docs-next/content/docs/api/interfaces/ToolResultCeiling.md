---
title: ToolResultCeiling
---

# Interface: ToolResultCeiling

Defined in: [src/core/tools.ts:163](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L163)

A declared cap on ONE tool's result that REFUSES instead of truncating
(9.20.0).

WHY refusal: a truncated result reads as a complete one — the model cannot
tell the data ends where the cut happened, so it fabricates from the part it
saw. A refusal that names the size, the ceiling and the parameters to narrow
produces a clean retry instead (field-verified on a ~191k-char return). The
agent-level `maxToolResultChars` remains the OTHER answer — truncate with a
verbatim head and a marker — for operators capping tools they did not write;
this one is the TOOL AUTHOR's contract, and only the author knows which
parameters (`narrowBy`) make the retry smaller.

The record keeps the truth: a typed `agentfootprint.tools.result_refused`
event carries the true size, and the delivered result carries status
`'invalid'` so `onToolStatus` edges can route on it.

## Properties

### maxChars

> `readonly` **maxChars**: `number`

Defined in: [src/core/tools.ts:166](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L166)

The ceiling, in characters of the stringified result. Positive whole
 number; anything else is refused at `defineTool`.

***

### narrowBy?

> `readonly` `optional` **narrowBy?**: readonly `string`[]

Defined in: [src/core/tools.ts:171](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L171)

Parameter names the refusal suggests narrowing by (e.g. `['limit',
 'fields']`). Optional; when present it must name at least one — an empty
 list is refused, because omitting the field is how "no suggestions" is
 said.
