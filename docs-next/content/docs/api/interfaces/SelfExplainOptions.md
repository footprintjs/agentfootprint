---
title: SelfExplainOptions
---

# Interface: SelfExplainOptions

Defined in: [src/lib/trace-toolpack/selfExplain.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/trace-toolpack/selfExplain.ts#L89)

Consumer surface for `.selfExplain()` on the Agent builder.

## Properties

### delegate?

> `readonly` `optional` **delegate?**: `object`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/trace-toolpack/selfExplain.ts#L97)

Answer why-questions on a SEPARATE (typically cheaper) model: the
skill unlocks one `explain_run` tool that runs a nested
`traceDebugAgent` and returns its evidence-cited answer.

#### maxIterations?

> `readonly` `optional` **maxIterations?**: `number`

#### model

> `readonly` **model**: `string`

#### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/trace-toolpack/selfExplain.ts#L103)

Skill id (activation key for `read_skill`). Default 'self-explain'.

***

### include?

> `readonly` `optional` **include?**: [`SelfExplainInclude`](/docs/api/interfaces/SelfExplainInclude)

Defined in: [src/lib/trace-toolpack/selfExplain.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/trace-toolpack/selfExplain.ts#L107)

Which optional parts of a turn's evidence to capture. Both default true.

***

### instruction?

> `readonly` `optional` **instruction?**: `string`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/trace-toolpack/selfExplain.ts#L91)

Appended to the recommended skill body (ours stays; yours adds).

***

### maxEvents?

> `readonly` `optional` **maxEvents?**: `number`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/trace-toolpack/selfExplain.ts#L114)

Cap on retained events per turn (only with `include.events`). Default
2,000 — enough for a long tool-using turn, small enough that a server
holding one binding per agent does not grow without limit. A tail that
dropped events says so in `inspect_tool_call`.

***

### toolpack?

> `readonly` `optional` **toolpack?**: `TraceToolpackOptions`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/trace-toolpack/selfExplain.ts#L105)

Bounding dials forwarded to the toolpack.
