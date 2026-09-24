[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DEFAULT\_CARRIES\_IN\_MESSAGES

# Variable: DEFAULT\_CARRIES\_IN\_MESSAGES

> `const` **DEFAULT\_CARRIES\_IN\_MESSAGES**: readonly [`WireRole`](/agentfootprint/api/generated/type-aliases/WireRole.md)[]

Defined in: [src/adapters/types.ts:183](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L183)

The floor every known wire supports. Used for any provider that does not
declare `carriesInMessages` — a third-party adapter is assumed to carry
only what all of them do, never more.
