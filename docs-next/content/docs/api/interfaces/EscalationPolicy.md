---
title: EscalationPolicy
---

# Interface: EscalationPolicy

Defined in: [src/core/agent/skillBrains.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/skillBrains.ts#L57)

Escalate-on-evidence policy (see the module header).

## Extends

- [`ProviderChoice`](/docs/api/interfaces/ProviderChoice)

## Properties

### afterRefusals

> `readonly` **afterRefusals**: `number`

Defined in: [src/core/agent/skillBrains.ts:60](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/skillBrains.ts#L60)

Gate refusals (`skill.rejected` — reachability OR posture) in ONE turn
 that flip the rest of the turn onto this brain. Integer ≥ 1.

***

### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/core/agent/skillBrains.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/skillBrains.ts#L53)

#### Inherited from

[`ProviderChoice`](/docs/api/interfaces/ProviderChoice).[`model`](/docs/api/interfaces/ProviderChoice#model)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/core/agent/skillBrains.ts:52](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/skillBrains.ts#L52)

#### Inherited from

[`ProviderChoice`](/docs/api/interfaces/ProviderChoice).[`provider`](/docs/api/interfaces/ProviderChoice#provider)
