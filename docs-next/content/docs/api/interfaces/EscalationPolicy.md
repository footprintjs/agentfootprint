---
title: EscalationPolicy
---

# Interface: EscalationPolicy

Defined in: [src/core/agent/skillBrains.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/skillBrains.ts#L58)

Escalate-on-evidence policy (see the module header).

## Extends

- [`ProviderChoice`](/docs/api/interfaces/ProviderChoice)

## Properties

### afterRefusals

> `readonly` **afterRefusals**: `number`

Defined in: [src/core/agent/skillBrains.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/skillBrains.ts#L68)

Gate refusals (`skill.rejected`) in ONE turn that flip the rest of the
 turn onto this brain. Integer ≥ 1.

 ALL THREE refusal arms count — an unreachable pick, a pick a `strictness`
 posture declined, and a SELF-CALL (`read_skill` naming the cursor's own
 skill). The self-call arm composes a notice rather than a refusal, and it
 still counts here on purpose: what this budget measures is a model asking
 the graph where it stands instead of working, which is the same stuck loop
 whichever arm answered it.

***

### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/core/agent/skillBrains.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/skillBrains.ts#L54)

#### Inherited from

[`ProviderChoice`](/docs/api/interfaces/ProviderChoice).[`model`](/docs/api/interfaces/ProviderChoice#model)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/core/agent/skillBrains.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/skillBrains.ts#L53)

#### Inherited from

[`ProviderChoice`](/docs/api/interfaces/ProviderChoice).[`provider`](/docs/api/interfaces/ProviderChoice#provider)
