---
title: semanticsForModel
---

# Function: semanticsForModel()

> **semanticsForModel**(`sem`): `Record`\<`string`, `unknown`\>

Defined in: [src/lib/semantics/envelope.ts:963](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/envelope.ts#L963)

The MODEL's view of one recognized envelope — compact and rendering-free.

Keeps: the data (`series`/`facts`/`edges`), the caveats that must travel
with it (`grain`, `provenance`), the composed `not_covered` prose, a
non-null `clarify`, and the static note. Drops: the marker, `render`
(UI hint), the three-list `coverage` detail (rides the coverage channel
and the record), and a `clarify: null`. Shallow-copied so the history
entry is not the object the tool still holds.

The period is served as the tool declared it — plus, when the store did not
hold all of the time the read asked about, the verdict word inside it and
that word's one clause after the note (`coverage/period.ts` ·
`servedPeriod`; honesty step 7b, bench round 1). A `covered` period and an
envelope with none are served byte for byte as before.

## Parameters

### sem

[`ToolSemantics`](/docs/api/interfaces/ToolSemantics)

## Returns

`Record`\<`string`, `unknown`\>
