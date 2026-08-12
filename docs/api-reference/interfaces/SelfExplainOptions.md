[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SelfExplainOptions

# Interface: SelfExplainOptions

Defined in: [src/lib/trace-toolpack/selfExplain.ts:84](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/lib/trace-toolpack/selfExplain.ts#L84)

Consumer surface for `.selfExplain()` on the Agent builder.

## Properties

### delegate?

> `readonly` `optional` **delegate?**: `object`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:92](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/lib/trace-toolpack/selfExplain.ts#L92)

Answer why-questions on a SEPARATE (typically cheaper) model: the
skill unlocks one `explain_run` tool that runs a nested
`traceDebugAgent` and returns its evidence-cited answer.

#### maxIterations?

> `readonly` `optional` **maxIterations?**: `number`

#### model

> `readonly` **model**: `string`

#### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:98](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/lib/trace-toolpack/selfExplain.ts#L98)

Skill id (activation key for `read_skill`). Default 'self-explain'.

***

### include?

> `readonly` `optional` **include?**: [`SelfExplainInclude`](/agentfootprint/api/generated/interfaces/SelfExplainInclude.md)

Defined in: [src/lib/trace-toolpack/selfExplain.ts:102](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/lib/trace-toolpack/selfExplain.ts#L102)

Which optional parts of a turn's evidence to capture. Both default true.

***

### instruction?

> `readonly` `optional` **instruction?**: `string`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:86](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/lib/trace-toolpack/selfExplain.ts#L86)

Appended to the recommended skill body (ours stays; yours adds).

***

### maxEvents?

> `readonly` `optional` **maxEvents?**: `number`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:109](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/lib/trace-toolpack/selfExplain.ts#L109)

Cap on retained events per turn (only with `include.events`). Default
2,000 — enough for a long tool-using turn, small enough that a server
holding one binding per agent does not grow without limit. A tail that
dropped events says so in `inspect_tool_call`.

***

### toolpack?

> `readonly` `optional` **toolpack?**: `TraceToolpackOptions`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:100](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/lib/trace-toolpack/selfExplain.ts#L100)

Bounding dials forwarded to the toolpack.
