[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PermissionCapability

# Type Alias: PermissionCapability

> **PermissionCapability** = [`ToolCapability`](/agentfootprint/api/generated/type-aliases/ToolCapability.md) \| `"tool_call"` \| `"skill_read"`

Defined in: [src/adapters/types.ts:582](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/adapters/types.ts#L582)

The full vocabulary a [PermissionRequest](/agentfootprint/api/generated/interfaces/PermissionRequest.md) can carry.

## What is actually ENFORCED, said plainly

`'tool_call'` has been enforced since v2.4: every tool dispatch asks the
checker before `tool.execute`. The rest are enforced **only when both sides
speak** (9.11.0):

- a tool DECLARES `Tool.capabilities`, and
- the checker DECLARES [PermissionChecker.governs](/agentfootprint/api/generated/interfaces/PermissionChecker.md#governs).

With either side silent, nothing extra is asked and nothing extra is refused
— byte-identical to every earlier release. This is deliberate: a framework
that started sending `'memory_write'` to existing fail-closed allowlists would
deny work those deployments have always permitted.

**What is still NOT gated by this port, and is not pretended to be:** the
agent's own memory pipeline. Recall and write stages are scoped by
`MemoryIdentity` (tenant / principal / conversation), which is a
different mechanism from a permission check, and no memory stage builds a
`PermissionRequest`. So `'memory_read'` / `'memory_write'` reach a checker
only for a TOOL that declared them.
