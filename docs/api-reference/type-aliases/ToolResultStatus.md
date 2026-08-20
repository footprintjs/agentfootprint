[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolResultStatus

# Type Alias: ToolResultStatus

> **ToolResultStatus** = `"success"` \| `"failure"` \| `"denied"` \| `"invalid"` \| `"partial"` \| `"pending"` \| `"absent"`

Defined in: [src/lib/injection-engine/toolOutcome.ts:38](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/injection-engine/toolOutcome.ts#L38)

Normalized outcome of one tool call, declared by the tool itself. Seven
values, deliberately closed: routing keyed on meaning needs a vocabulary
both sides spell identically. A string outside this set makes the value
NOT an envelope (data path, unchanged).

`'absent'` is the seventh (the `absent()` primitive, from field use), and
it earns its own word rather than folding into `'success'` or `'failure'`
for the reason the primitive exists: *nothing found* and *could not look*
must not route down the same edge. Under `'failure'` an honest empty answer
sends an operator to investigate a healthy collector; under `'success'` a
route that wants to escalate on "we found nothing" has nothing to key on.
A tool may declare it directly (`{ content, effects: [], status:
'absent' }`); returning `absent(…)` makes the framework declare it.
