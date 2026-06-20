---
title: SelfExplainOptions
---

# Interface: SelfExplainOptions

Defined in: [src/lib/trace-toolpack/selfExplain.ts:59](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/trace-toolpack/selfExplain.ts#L59)

Consumer surface for `.selfExplain()` on the Agent builder.

## Properties

### delegate?

> `readonly` `optional` **delegate?**: `object`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:67](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/trace-toolpack/selfExplain.ts#L67)

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

Defined in: [src/lib/trace-toolpack/selfExplain.ts:73](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/trace-toolpack/selfExplain.ts#L73)

Skill id (activation key for `read_skill`). Default 'self-explain'.

***

### instruction?

> `readonly` `optional` **instruction?**: `string`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:61](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/trace-toolpack/selfExplain.ts#L61)

Appended to the recommended skill body (ours stays; yours adds).

***

### toolpack?

> `readonly` `optional` **toolpack?**: `TraceToolpackOptions`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:75](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/trace-toolpack/selfExplain.ts#L75)

Bounding dials forwarded to the toolpack.
