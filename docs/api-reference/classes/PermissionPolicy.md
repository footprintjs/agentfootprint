[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PermissionPolicy

# Class: PermissionPolicy

Defined in: [src/security/PermissionPolicy.ts:86](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/security/PermissionPolicy.ts#L86)

Data-driven role-based permission policy. Satisfies the v2.4
`PermissionChecker` interface AND exposes a sync `isAllowed` method
for use with `gatedTools` from `agentfootprint/tool-providers`.

## Implements

- [`PermissionChecker`](/agentfootprint/api/generated/interfaces/PermissionChecker.md)

## Properties

### name

> `readonly` **name**: `"PermissionPolicy"` = `'PermissionPolicy'`

Defined in: [src/security/PermissionPolicy.ts:87](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/security/PermissionPolicy.ts#L87)

#### Implementation of

[`PermissionChecker`](/agentfootprint/api/generated/interfaces/PermissionChecker.md).[`name`](/agentfootprint/api/generated/interfaces/PermissionChecker.md#name)

## Accessors

### activeRole

#### Get Signature

> **get** **activeRole**(): `string`

Defined in: [src/security/PermissionPolicy.ts:159](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/security/PermissionPolicy.ts#L159)

The role name currently active. Useful for observability.

##### Returns

`string`

***

### roles

#### Get Signature

> **get** **roles**(): readonly `string`[]

Defined in: [src/security/PermissionPolicy.ts:164](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/security/PermissionPolicy.ts#L164)

All defined role names. Stable order = registration order.

##### Returns

readonly `string`[]

## Methods

### allowedToolIds()

> **allowedToolIds**(): readonly `string`[]

Defined in: [src/security/PermissionPolicy.ts:169](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/security/PermissionPolicy.ts#L169)

All tool ids allowed under the current active role.

#### Returns

readonly `string`[]

***

### check()

> **check**(`request`): `Promise`\<[`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md)\>

Defined in: [src/security/PermissionPolicy.ts:132](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/security/PermissionPolicy.ts#L132)

Async check matching the `PermissionChecker` interface — consumed
by `Agent.create({ permissionChecker })`. Wraps `isAllowed` with
the structured `PermissionDecision` envelope (allow / deny + a
`policyRuleId` so observability can trace which role decided).

Today the policy only checks the tool name (request.target).
Future work: also gate by capability ('memory_write', etc.) when
the role allowlist is widened to capability-by-id.

#### Parameters

##### request

[`PermissionRequest`](/agentfootprint/api/generated/interfaces/PermissionRequest.md)

#### Returns

`Promise`\<[`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md)\>

#### Implementation of

[`PermissionChecker`](/agentfootprint/api/generated/interfaces/PermissionChecker.md).[`check`](/agentfootprint/api/generated/interfaces/PermissionChecker.md#check)

***

### fromRoles()

> `static` **fromRoles**(`roles`, `activeRole`): `PermissionPolicy`

Defined in: [src/security/PermissionPolicy.ts:106](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/security/PermissionPolicy.ts#L106)

Factory: build a role-based policy from a role → tool-ids map and
the role active for this instance.

Throws if `activeRole` isn't a key in `roles` — fail loud at
config time, not at first denied call.

#### Parameters

##### roles

[`RoleAllowlist`](/agentfootprint/api/generated/type-aliases/RoleAllowlist.md)

##### activeRole

`string`

#### Returns

`PermissionPolicy`

***

### isAllowed()

> **isAllowed**(`toolId`): `boolean`

Defined in: [src/security/PermissionPolicy.ts:118](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/security/PermissionPolicy.ts#L118)

Sync allowlist check. Use as a predicate with `gatedTools`:

  gatedTools(staticTools(allTools), (toolId) => policy.isAllowed(toolId))

Returns true iff `toolId` is in the active role's allowlist.
Closes-fail by design: missing role membership = denied.

#### Parameters

##### toolId

`string`

#### Returns

`boolean`

***

### withActiveRole()

> **withActiveRole**(`activeRole`): `PermissionPolicy`

Defined in: [src/security/PermissionPolicy.ts:154](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/security/PermissionPolicy.ts#L154)

Derive a sibling policy with a different active role. Same role
map; different active role. Useful for per-identity routing
(one policy instance per request, varying active role per caller).

Returns a NEW PermissionPolicy — original is unchanged.

#### Parameters

##### activeRole

`string`

#### Returns

`PermissionPolicy`
