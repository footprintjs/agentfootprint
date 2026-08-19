[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ProviderChoice

# Interface: ProviderChoice

Defined in: [src/core/agent/skillBrains.ts:51](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/skillBrains.ts#L51)

One brain: a provider port, optionally pinned to a model. `model` absent
 → resolved down the precedence chain (legal only while the provider is
 the agent's own — see the module header for why a foreign provider must
 name its model).

## Extended by

- [`EscalationPolicy`](/agentfootprint/api/generated/interfaces/EscalationPolicy.md)

## Properties

### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/core/agent/skillBrains.ts:53](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/skillBrains.ts#L53)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/core/agent/skillBrains.ts:52](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/skillBrains.ts#L52)
