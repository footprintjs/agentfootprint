---
title: CodeReadOptions
---

# Interface: CodeReadOptions

Defined in: [src/provider-contract/types/code.ts:288](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/code.ts#L288)

How one [CodeSession.readFile](/docs/api/interfaces/CodeSession#readfile) is bounded.

## Properties

### maxBytes

> `readonly` **maxBytes**: `number`

Defined in: [src/provider-contract/types/code.ts:293](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/code.ts#L293)

The most bytes this read may return. Required, and a positive whole
number: a file larger than this is refused, never cut.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/provider-contract/types/code.ts:295](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/code.ts#L295)

Stop waiting for the read.
