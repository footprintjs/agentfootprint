[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DEFAULT\_CARRIES\_IN\_MESSAGES

# Variable: DEFAULT\_CARRIES\_IN\_MESSAGES

> `const` **DEFAULT\_CARRIES\_IN\_MESSAGES**: readonly [`WireRole`](/agentfootprint/api/generated/type-aliases/WireRole.md)[]

Defined in: [src/adapters/types.ts:130](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/adapters/types.ts#L130)

The floor every known wire supports. Used for any provider that does not
declare `carriesInMessages` — a third-party adapter is assumed to carry
only what all of them do, never more.
