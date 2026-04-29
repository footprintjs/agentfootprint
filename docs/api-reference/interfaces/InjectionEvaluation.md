[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / InjectionEvaluation

# Interface: InjectionEvaluation

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L163)

Returned by `evaluateInjections()`. Slot subflows consume `active`;
`skipped` is observability metadata (predicate errors).

## Properties

### active

> `readonly` **active**: readonly [`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)[]

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:164](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L164)

***

### skipped

> `readonly` **skipped**: readonly `object`[]

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:165](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L165)
