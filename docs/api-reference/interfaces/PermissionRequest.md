[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PermissionRequest

# Interface: PermissionRequest

Defined in: [agentfootprint/src/adapters/types.ts:167](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L167)

## Properties

### actor

> `readonly` **actor**: `string`

Defined in: [agentfootprint/src/adapters/types.ts:169](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L169)

***

### capability

> `readonly` **capability**: `"tool_call"` \| `"memory_read"` \| `"memory_write"` \| `"external_net"` \| `"user_data"`

Defined in: [agentfootprint/src/adapters/types.ts:168](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L168)

***

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [agentfootprint/src/adapters/types.ts:171](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L171)

***

### target?

> `readonly` `optional` **target?**: `string`

Defined in: [agentfootprint/src/adapters/types.ts:170](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L170)
