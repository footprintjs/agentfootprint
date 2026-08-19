---
title: ProviderChoice
---

# Interface: ProviderChoice

Defined in: [src/core/agent/skillBrains.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/skillBrains.ts#L51)

One brain: a provider port, optionally pinned to a model. `model` absent
 → resolved down the precedence chain (legal only while the provider is
 the agent's own — see the module header for why a foreign provider must
 name its model).

## Extended by

- [`EscalationPolicy`](/docs/api/interfaces/EscalationPolicy)

## Properties

### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/core/agent/skillBrains.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/skillBrains.ts#L53)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/core/agent/skillBrains.ts:52](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/skillBrains.ts#L52)
