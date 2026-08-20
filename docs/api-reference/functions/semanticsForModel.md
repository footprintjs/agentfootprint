[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / semanticsForModel

# Function: semanticsForModel()

> **semanticsForModel**(`sem`): `Record`\<`string`, `unknown`\>

Defined in: [src/lib/semantics/envelope.ts:793](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/semantics/envelope.ts#L793)

The MODEL's view of one recognized envelope — compact and rendering-free.

Keeps: the data (`series`/`facts`/`edges`), the caveats that must travel
with it (`grain`, `provenance`), the composed `not_covered` prose, a
non-null `clarify`, and the static note. Drops: the marker, `render`
(UI hint), the three-list `coverage` detail (rides the coverage channel
and the record), and a `clarify: null`. Shallow-copied so the history
entry is not the object the tool still holds.

## Parameters

### sem

[`ToolSemantics`](/agentfootprint/api/generated/interfaces/ToolSemantics.md)

## Returns

`Record`\<`string`, `unknown`\>
