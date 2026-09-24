[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / actKeyFor

# Function: actKeyFor()

> **actKeyFor**(`moment`): `"input"` \| `"output"` \| `"window"` \| `"beforeTool"` \| `"afterTool"`

Defined in: [src/core/agent/moments.ts:61](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/moments.ts#L61)

The runtime twin of [ActKey](/agentfootprint/api/generated/type-aliases/ActKey.md). `.act()`'s accepted key set is built
from this over `LOOP_MOMENTS`, so an unknown key is refused by a rule that
cannot fall behind the list it is derived from.

## Parameters

### moment

`"input"` \| `"output"` \| `"before-tool"` \| `"after-tool"` \| `"window"`

## Returns

`"input"` \| `"output"` \| `"window"` \| `"beforeTool"` \| `"afterTool"`
