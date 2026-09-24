[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RequestJsonSize

# Interface: RequestJsonSize

Defined in: [src/lib/time-travel/requestMeasurement.ts:3](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/requestMeasurement.ts#L3)

Counts only: the initial prepared request at the library's provider port.
No token estimate, payload retention, retry total or vendor wire claim.

## Properties

### jsonBytes

> `readonly` **jsonBytes**: `number`

Defined in: [src/lib/time-travel/requestMeasurement.ts:7](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/requestMeasurement.ts#L7)

UTF-8 bytes in that same JSON representation.

***

### jsonChars

> `readonly` **jsonChars**: `number`

Defined in: [src/lib/time-travel/requestMeasurement.ts:5](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/requestMeasurement.ts#L5)

UTF-16 code units in the JSON representation, including JSON punctuation.
