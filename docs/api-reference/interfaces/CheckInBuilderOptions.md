[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInBuilderOptions

# Interface: CheckInBuilderOptions

Defined in: [src/core/checkin.ts:532](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/checkin.ts#L532)

What `.checkIn({...})` accepts on the Agent builder.

## Properties

### evidence?

> `readonly` `optional` **evidence?**: [`CheckInAssembler`](/agentfootprint/api/generated/type-aliases/CheckInAssembler.md) \| [`EvidencePreset`](/agentfootprint/api/generated/type-aliases/EvidencePreset.md)

Defined in: [src/core/checkin.ts:538](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/checkin.ts#L538)

How much evidence rides the ask. `'standard'` (default) fills all four
fields; `'minimal'` fills only `willDo` (zero cost); or pass your own
[CheckInAssembler](/agentfootprint/api/generated/type-aliases/CheckInAssembler.md).

***

### scorer?

> `readonly` `optional` **scorer?**: [`CheckInScorer`](/agentfootprint/api/generated/type-aliases/CheckInScorer.md)

Defined in: [src/core/checkin.ts:543](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/checkin.ts#L543)

The scorer that ranks `drivers`. Default [lexicalDriverScorer](/agentfootprint/api/generated/variables/lexicalDriverScorer.md)
(deterministic, zero LLM). Only consulted by the `'standard'` assembler.
