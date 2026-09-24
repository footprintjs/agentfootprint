[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / checkerGoverns

# Function: checkerGoverns()

> **checkerGoverns**(`checker`, `capability`): `boolean`

Defined in: [src/adapters/types.ts:904](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L904)

Does this checker ask to be consulted about `capability`? (9.11.0)

`'tool_call'` is always true — it has been enforced since v2.4 and needs no
declaration. Everything else is true only when the checker named it.
Absence is NO.

## Parameters

### checker

[`PermissionChecker`](/agentfootprint/api/generated/interfaces/PermissionChecker.md) \| `undefined`

### capability

[`PermissionCapability`](/agentfootprint/api/generated/type-aliases/PermissionCapability.md)

## Returns

`boolean`
