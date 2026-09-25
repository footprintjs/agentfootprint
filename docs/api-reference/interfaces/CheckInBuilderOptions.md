[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInBuilderOptions

# Interface: CheckInBuilderOptions

Defined in: [src/core/checkin.ts:536](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/checkin.ts#L536)

What `.checkIn({...})` accepts on the Agent builder.

## Properties

### evidence?

> `readonly` `optional` **evidence?**: [`CheckInAssembler`](/agentfootprint/api/generated/type-aliases/CheckInAssembler.md) \| [`EvidencePreset`](/agentfootprint/api/generated/type-aliases/EvidencePreset.md)

Defined in: [src/core/checkin.ts:542](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/checkin.ts#L542)

How much evidence rides the ask. `'standard'` (default) fills all four
fields; `'minimal'` fills only `willDo` (zero cost); or pass your own
[CheckInAssembler](/agentfootprint/api/generated/type-aliases/CheckInAssembler.md).

***

### scorer?

> `readonly` `optional` **scorer?**: [`CheckInScorer`](/agentfootprint/api/generated/type-aliases/CheckInScorer.md)

Defined in: [src/core/checkin.ts:547](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/checkin.ts#L547)

The scorer that ranks `drivers`. Default [lexicalDriverScorer](/agentfootprint/api/generated/variables/lexicalDriverScorer.md)
(deterministic, zero LLM). Only consulted by the `'standard'` assembler.
