[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RoleAllowlist

# Type Alias: RoleAllowlist

> **RoleAllowlist** = `Readonly`\<`Record`\<`string`, readonly `string`[]\>\>

Defined in: [src/security/PermissionPolicy.ts:64](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/security/PermissionPolicy.ts#L64)

Map of role name → list of tool ids that role is allowed to invoke.
The shape consumers extend over time as new tools / roles arrive.
