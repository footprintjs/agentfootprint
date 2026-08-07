[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SelfExplainOptions

# Interface: SelfExplainOptions

Defined in: [src/lib/trace-toolpack/selfExplain.ts:83](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/lib/trace-toolpack/selfExplain.ts#L83)

Consumer surface for `.selfExplain()` on the Agent builder.

## Properties

### delegate?

> `readonly` `optional` **delegate?**: `object`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:91](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/lib/trace-toolpack/selfExplain.ts#L91)

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

Defined in: [src/lib/trace-toolpack/selfExplain.ts:97](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/lib/trace-toolpack/selfExplain.ts#L97)

Skill id (activation key for `read_skill`). Default 'self-explain'.

***

### include?

> `readonly` `optional` **include?**: [`SelfExplainInclude`](/agentfootprint/api/generated/interfaces/SelfExplainInclude.md)

Defined in: [src/lib/trace-toolpack/selfExplain.ts:101](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/lib/trace-toolpack/selfExplain.ts#L101)

Which optional parts of a turn's evidence to capture. Both default true.

***

### instruction?

> `readonly` `optional` **instruction?**: `string`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:85](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/lib/trace-toolpack/selfExplain.ts#L85)

Appended to the recommended skill body (ours stays; yours adds).

***

### maxEvents?

> `readonly` `optional` **maxEvents?**: `number`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:108](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/lib/trace-toolpack/selfExplain.ts#L108)

Cap on retained events per turn (only with `include.events`). Default
2,000 — enough for a long tool-using turn, small enough that a server
holding one binding per agent does not grow without limit. A tail that
dropped events says so in `inspect_tool_call`.

***

### toolpack?

> `readonly` `optional` **toolpack?**: `TraceToolpackOptions`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:99](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/lib/trace-toolpack/selfExplain.ts#L99)

Bounding dials forwarded to the toolpack.
