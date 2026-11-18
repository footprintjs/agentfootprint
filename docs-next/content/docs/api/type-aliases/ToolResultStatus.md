---
title: ToolResultStatus
---

# Type Alias: ToolResultStatus

> **ToolResultStatus** = `"success"` \| `"failure"` \| `"denied"` \| `"invalid"` \| `"partial"` \| `"pending"` \| `"absent"`

Defined in: [src/semantics/toolOutcome.ts:40](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolOutcome.ts#L40)

Normalized outcome of one tool call, declared by the tool itself. Seven
values, deliberately closed: routing keyed on meaning needs a vocabulary
both sides spell identically. A word a tool wrote is read by this
module's `readToolResultStatus`: another case or surrounding spaces still
name the same word, and a string that names none of the seven makes the
value NOT an envelope (data path, unchanged).

`'absent'` is the seventh (the `absent()` primitive, from field use), and
it earns its own word rather than folding into `'success'` or `'failure'`
for the reason the primitive exists: *nothing found* and *could not look*
must not route down the same edge. Under `'failure'` an honest empty answer
sends an operator to investigate a healthy collector; under `'success'` a
route that wants to escalate on "we found nothing" has nothing to key on.
A tool may declare it directly (`{ content, effects: [], status:
'absent' }`); returning `absent(…)` makes the framework declare it.
