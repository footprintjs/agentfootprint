[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SERVED\_GAPS

# Variable: SERVED\_GAPS

> `const` **SERVED\_GAPS**: `Readonly`\<`Record`\<[`ServedGapKind`](/agentfootprint/api/generated/type-aliases/ServedGapKind.md), `Omit`\<[`ServedGap`](/agentfootprint/api/generated/interfaces/ServedGap.md), `"gap"`\>\>\>

Defined in: [src/lib/time-travel/servedView.ts:348](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/servedView.ts#L348)

The gap catalogue. Exported because a reader that renders a served view
renders its gaps beside it, and a renderer should print the library's own
sentence rather than invent one.
