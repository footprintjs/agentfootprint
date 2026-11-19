---
title: CodeReadOptions
---

# Interface: CodeReadOptions

Defined in: [src/provider-contract/types.ts:1267](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1267)

How one [CodeSession.readFile](/docs/api/interfaces/CodeSession#readfile) is bounded.

## Properties

### maxBytes

> `readonly` **maxBytes**: `number`

Defined in: [src/provider-contract/types.ts:1272](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1272)

The most bytes this read may return. Required, and a positive whole
number: a file larger than this is refused, never cut.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/provider-contract/types.ts:1274](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1274)

Stop waiting for the read.
