[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EscalationPolicy

# Interface: EscalationPolicy

Defined in: [src/core/agent/skillBrains.ts:57](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/skillBrains.ts#L57)

Escalate-on-evidence policy (see the module header).

## Extends

- [`ProviderChoice`](/agentfootprint/api/generated/interfaces/ProviderChoice.md)

## Properties

### afterRefusals

> `readonly` **afterRefusals**: `number`

Defined in: [src/core/agent/skillBrains.ts:60](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/skillBrains.ts#L60)

Gate refusals (`skill.rejected` — reachability OR posture) in ONE turn
 that flip the rest of the turn onto this brain. Integer ≥ 1.

***

### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/core/agent/skillBrains.ts:53](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/skillBrains.ts#L53)

#### Inherited from

[`ProviderChoice`](/agentfootprint/api/generated/interfaces/ProviderChoice.md).[`model`](/agentfootprint/api/generated/interfaces/ProviderChoice.md#model)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/core/agent/skillBrains.ts:52](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/skillBrains.ts#L52)

#### Inherited from

[`ProviderChoice`](/agentfootprint/api/generated/interfaces/ProviderChoice.md).[`provider`](/agentfootprint/api/generated/interfaces/ProviderChoice.md#provider)
