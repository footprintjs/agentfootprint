[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PresentSnapshot

# Interface: PresentSnapshot

Defined in: [src/artifacts/present.ts:43](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/present.ts#L43)

The description snapshot — what the `present` result carries about the
parcel at speak time, so an expired artifact can still render an honest
placeholder from history. Meta only, never the payload.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/artifacts/present.ts:47](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/present.ts#L47)

***

### kind

> `readonly` **kind**: `string`

Defined in: [src/artifacts/present.ts:45](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/present.ts#L45)

The artifact's own consumer vocabulary (`meta.kind`).

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/artifacts/present.ts:49](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/present.ts#L49)

The human title — the call's `label` when given, else the mint's.

***

### mediaType

> `readonly` **mediaType**: `string`

Defined in: [src/artifacts/present.ts:46](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/present.ts#L46)
