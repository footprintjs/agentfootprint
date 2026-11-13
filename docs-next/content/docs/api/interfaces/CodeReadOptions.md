---
title: CodeReadOptions
---

# Interface: CodeReadOptions

Defined in: [src/provider-contract/types.ts:1293](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1293)

How one [CodeSession.readFile](/docs/api/interfaces/CodeSession#readfile) is bounded.

## Properties

### maxBytes

> `readonly` **maxBytes**: `number`

Defined in: [src/provider-contract/types.ts:1298](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1298)

The most bytes this read may return. Required, and a positive whole
number: a file larger than this is refused, never cut.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/provider-contract/types.ts:1300](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1300)

Stop waiting for the read.
