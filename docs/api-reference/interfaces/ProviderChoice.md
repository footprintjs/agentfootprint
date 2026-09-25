[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ProviderChoice

# Interface: ProviderChoice

Defined in: [src/core/agent/skillBrains.ts:52](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/skillBrains.ts#L52)

One brain: a provider port, optionally pinned to a model. `model` absent
 → resolved down the precedence chain (legal only while the provider is
 the agent's own — see the module header for why a foreign provider must
 name its model).

## Extended by

- [`EscalationPolicy`](/agentfootprint/api/generated/interfaces/EscalationPolicy.md)

## Properties

### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/core/agent/skillBrains.ts:54](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/skillBrains.ts#L54)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/core/agent/skillBrains.ts:53](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/skillBrains.ts#L53)
