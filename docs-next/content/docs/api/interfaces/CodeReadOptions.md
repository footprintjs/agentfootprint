---
title: CodeReadOptions
---

# Interface: CodeReadOptions

Defined in: [src/provider-contract/types.ts:1268](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1268)

How one [CodeSession.readFile](/docs/api/interfaces/CodeSession#readfile) is bounded.

## Properties

### maxBytes

> `readonly` **maxBytes**: `number`

Defined in: [src/provider-contract/types.ts:1273](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1273)

The most bytes this read may return. Required, and a positive whole
number: a file larger than this is refused, never cut.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/provider-contract/types.ts:1275](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1275)

Stop waiting for the read.
