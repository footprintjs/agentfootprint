---
title: RoleAllowlist
---

# Type Alias: RoleAllowlist

> **RoleAllowlist** = `Readonly`\<`Record`\<`string`, readonly `string`[]\>\>

Defined in: [src/security/PermissionPolicy.ts:64](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/security/PermissionPolicy.ts#L64)

Map of role name → list of tool ids that role is allowed to invoke.
The shape consumers extend over time as new tools / roles arrive.
