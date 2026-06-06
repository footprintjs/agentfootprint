[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / InjectionEvaluation

# Interface: InjectionEvaluation

Defined in: [src/lib/injection-engine/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/types.ts#L163)

Returned by `evaluateInjections()`. Slot subflows consume `active`;
`skipped` is observability metadata (predicate errors).

## Properties

### active

> `readonly` **active**: readonly [`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)[]

Defined in: [src/lib/injection-engine/types.ts:164](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/types.ts#L164)

***

### skipped

> `readonly` **skipped**: readonly `object`[]

Defined in: [src/lib/injection-engine/types.ts:165](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/types.ts#L165)
