[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolCapability

# Type Alias: ToolCapability

> **ToolCapability** = `"memory_read"` \| `"memory_write"` \| `"external_net"` \| `"user_data"`

Defined in: [src/adapters/types.ts:674](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/adapters/types.ts#L674)

What a tool DECLARES it touches (9.11.0).

The four values a tool can honestly say about itself. Deliberately a subset
of [PermissionCapability](/agentfootprint/api/generated/type-aliases/PermissionCapability.md): `'tool_call'` is the framework's own word for
"a tool was dispatched" and `'skill_read'` is the framework's word for "a
skill was activated" — neither is something a tool declares about its own
behaviour.

**The framework never infers these.** A tool's capabilities are not knowable
from its name, its schema or its description; classifying them by guess would
put a policy decision on a heuristic. Declared or absent — see `Tool.capabilities`.
