[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInBuilderOptions

# Interface: CheckInBuilderOptions

Defined in: [src/core/checkin.ts:449](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/checkin.ts#L449)

What `.checkIn({...})` accepts on the Agent builder.

## Properties

### evidence?

> `readonly` `optional` **evidence?**: [`CheckInAssembler`](/agentfootprint/api/generated/type-aliases/CheckInAssembler.md) \| [`EvidencePreset`](/agentfootprint/api/generated/type-aliases/EvidencePreset.md)

Defined in: [src/core/checkin.ts:455](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/checkin.ts#L455)

How much evidence rides the ask. `'standard'` (default) fills all four
fields; `'minimal'` fills only `willDo` (zero cost); or pass your own
[CheckInAssembler](/agentfootprint/api/generated/type-aliases/CheckInAssembler.md).

***

### scorer?

> `readonly` `optional` **scorer?**: [`CheckInScorer`](/agentfootprint/api/generated/type-aliases/CheckInScorer.md)

Defined in: [src/core/checkin.ts:460](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/checkin.ts#L460)

The scorer that ranks `drivers`. Default [lexicalDriverScorer](/agentfootprint/api/generated/variables/lexicalDriverScorer.md)
(deterministic, zero LLM). Only consulted by the `'standard'` assembler.
