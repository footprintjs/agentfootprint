---
title: CheckInBuilderOptions
---

# Interface: CheckInBuilderOptions

Defined in: [src/core/checkin.ts:536](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L536)

What `.checkIn({...})` accepts on the Agent builder.

## Properties

### evidence?

> `readonly` `optional` **evidence?**: [`CheckInAssembler`](/docs/api/type-aliases/CheckInAssembler) \| [`EvidencePreset`](/docs/api/type-aliases/EvidencePreset)

Defined in: [src/core/checkin.ts:542](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L542)

How much evidence rides the ask. `'standard'` (default) fills all four
fields; `'minimal'` fills only `willDo` (zero cost); or pass your own
[CheckInAssembler](/docs/api/type-aliases/CheckInAssembler).

***

### scorer?

> `readonly` `optional` **scorer?**: [`CheckInScorer`](/docs/api/type-aliases/CheckInScorer)

Defined in: [src/core/checkin.ts:547](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L547)

The scorer that ranks `drivers`. Default [lexicalDriverScorer](/docs/api/variables/lexicalDriverScorer)
(deterministic, zero LLM). Only consulted by the `'standard'` assembler.
