[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EscalationPolicy

# Interface: EscalationPolicy

Defined in: [src/core/agent/skillBrains.ts:58](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/skillBrains.ts#L58)

Escalate-on-evidence policy (see the module header).

## Extends

- [`ProviderChoice`](/agentfootprint/api/generated/interfaces/ProviderChoice.md)

## Properties

### afterRefusals

> `readonly` **afterRefusals**: `number`

Defined in: [src/core/agent/skillBrains.ts:68](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/skillBrains.ts#L68)

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

Defined in: [src/core/agent/skillBrains.ts:54](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/skillBrains.ts#L54)

#### Inherited from

[`ProviderChoice`](/agentfootprint/api/generated/interfaces/ProviderChoice.md).[`model`](/agentfootprint/api/generated/interfaces/ProviderChoice.md#model)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/core/agent/skillBrains.ts:53](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/skillBrains.ts#L53)

#### Inherited from

[`ProviderChoice`](/agentfootprint/api/generated/interfaces/ProviderChoice.md).[`provider`](/agentfootprint/api/generated/interfaces/ProviderChoice.md#provider)
