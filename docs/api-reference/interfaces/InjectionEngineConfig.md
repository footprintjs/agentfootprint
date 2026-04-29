[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / InjectionEngineConfig

# Interface: InjectionEngineConfig

Defined in: [agentfootprint/src/lib/injection-engine/buildInjectionEngineSubflow.ts:37](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/buildInjectionEngineSubflow.ts#L37)

## Properties

### injections

> `readonly` **injections**: readonly [`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)[]

Defined in: [agentfootprint/src/lib/injection-engine/buildInjectionEngineSubflow.ts:43](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/buildInjectionEngineSubflow.ts#L43)

The Injection list. Frozen at build time. To change at runtime,
rebuild the agent / chart — the primitive is intentionally
declarative.
