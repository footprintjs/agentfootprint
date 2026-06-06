[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / parseSubflowPath

# Function: parseSubflowPath()

> **parseSubflowPath**(`raw`): readonly `string`[]

Defined in: [src/bridge/eventMeta.ts:97](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/bridge/eventMeta.ts#L97)

Parse footprintjs's `/`-separated subflow path into a readonly array.

The source of truth for runtimeStageId parsing lives in footprintjs at
`footprintjs/trace::parseRuntimeStageId`. We only need the path-split
convenience here; the `/` separator is stable across footprintjs
versions (covered by their `parseRuntimeStageId` tests).

## Parameters

### raw

`string` \| `undefined`

## Returns

readonly `string`[]
