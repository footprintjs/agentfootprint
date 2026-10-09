---
title: FindingsDeclaration
---

# Interface: FindingsDeclaration

Defined in: [src/core/agent/findings/types.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L108)

The wire shape under `_findings` — on a tool call's args, or as the top-level
key of a JSON answer. Every field optional: the model declares what it
declares, and `reserved.ts · splitFindings` drops what it cannot read.

## Properties

### basis?

> `readonly` `optional` **basis?**: [`Basis`](/docs/api/type-aliases/Basis)

Defined in: [src/core/agent/findings/types.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L109)

***

### expect?

> `readonly` `optional` **expect?**: [`Expect`](/docs/api/type-aliases/Expect)

Defined in: [src/core/agent/findings/types.ts:110](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L110)

***

### from?

> `readonly` `optional` **from?**: readonly `DeclaredSource`[]

Defined in: [src/core/agent/findings/types.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L128)

Where each argument value of THIS call came from — read only under the
inputs layer's declared sources (`.inputsLayer({ argumentSources: true })`
or `.findings({ argumentSources: true })`, `arguments/sources.ts` ·
`readSources`); ignored otherwise, as an unknown key always was. A claim
the library checks, never evidence.

***

### predicts?

> `readonly` `optional` **predicts?**: `string`

Defined in: [src/core/agent/findings/types.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L119)

What the result should show if the proposition holds — one line, optional.

***

### previous?

> `readonly` `optional` **previous?**: readonly `PreviousStanding`[]

Defined in: [src/core/agent/findings/types.ts:120](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L120)

***

### proposition?

> `readonly` `optional` **proposition?**: `string`

Defined in: [src/core/agent/findings/types.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L117)

What the call tests — one line, declared BEFORE the result exists, so a
later `ruled-out` or `open` standing on that result can be read against
a proposition the model wrote without seeing the result. Optional; the
schema recommends it when `basis` is `'exploratory'`.
