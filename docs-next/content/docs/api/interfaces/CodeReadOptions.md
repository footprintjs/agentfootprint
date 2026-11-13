---
title: CodeReadOptions
---

# Interface: CodeReadOptions

Defined in: [src/provider-contract/types.ts:1322](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1322)

How one [CodeSession.readFile](/docs/api/interfaces/CodeSession#readfile) is bounded.

## Properties

### maxBytes

> `readonly` **maxBytes**: `number`

Defined in: [src/provider-contract/types.ts:1327](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1327)

The most bytes this read may return. Required, and a positive whole
number: a file larger than this is refused, never cut.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/provider-contract/types.ts:1329](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1329)

Stop waiting for the read.
