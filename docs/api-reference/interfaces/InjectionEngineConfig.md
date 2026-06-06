[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / InjectionEngineConfig

# Interface: InjectionEngineConfig

Defined in: [src/lib/injection-engine/buildInjectionEngineSubflow.ts:38](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/buildInjectionEngineSubflow.ts#L38)

## Properties

### injections

> `readonly` **injections**: readonly [`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)[]

Defined in: [src/lib/injection-engine/buildInjectionEngineSubflow.ts:44](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/buildInjectionEngineSubflow.ts#L44)

The Injection list. Frozen at build time. To change at runtime,
rebuild the agent / chart — the primitive is intentionally
declarative.
