---
title: PermissionPolicyOptions
---

# Interface: PermissionPolicyOptions

Defined in: [src/security/PermissionPolicy.ts:66](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/security/PermissionPolicy.ts#L66)

## Properties

### activeRole

> `readonly` **activeRole**: `string`

Defined in: [src/security/PermissionPolicy.ts:78](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/security/PermissionPolicy.ts#L78)

Which role is active for this policy instance. Calls to
`.isAllowed(toolId)` check against this role's allowlist.
Use `.withActiveRole(name)` to derive a sibling policy with a
different active role.

***

### roles

> `readonly` **roles**: [`RoleAllowlist`](/docs/api/type-aliases/RoleAllowlist)

Defined in: [src/security/PermissionPolicy.ts:71](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/security/PermissionPolicy.ts#L71)

The role allowlist. Each role maps to the tool ids it can invoke.
Tool ids match the `name` field of `Tool.schema.name` exactly.
