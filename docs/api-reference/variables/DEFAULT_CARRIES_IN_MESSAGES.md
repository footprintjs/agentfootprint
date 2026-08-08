[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DEFAULT\_CARRIES\_IN\_MESSAGES

# Variable: DEFAULT\_CARRIES\_IN\_MESSAGES

> `const` **DEFAULT\_CARRIES\_IN\_MESSAGES**: readonly [`WireRole`](/agentfootprint/api/generated/type-aliases/WireRole.md)[]

Defined in: [src/adapters/types.ts:130](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/adapters/types.ts#L130)

The floor every known wire supports. Used for any provider that does not
declare `carriesInMessages` — a third-party adapter is assumed to carry
only what all of them do, never more.
