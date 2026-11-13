---
title: CodeTruncation
---

# Interface: CodeTruncation

Defined in: [src/provider-contract/types.ts:1412](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1412)

Present IFF output was cut, and then it says by how much.

Load-bearing, not politeness. A runner exists so big data is computed
outside the context window instead of pasted into it; a runner that
quietly slices its own output to fit is the same bug wearing a different
hat, and the model would go on to reason over a truncated table it was
never told was truncated. An unstated slice is a silent success.

## Properties

### ofChars?

> `readonly` `optional` **ofChars?**: `number`

Defined in: [src/provider-contract/types.ts:1416](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1416)

The pre-truncation length, in characters, of whichever stream was cut.

***

### stderr?

> `readonly` `optional` **stderr?**: `boolean`

Defined in: [src/provider-contract/types.ts:1414](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1414)

***

### stdout?

> `readonly` `optional` **stdout?**: `boolean`

Defined in: [src/provider-contract/types.ts:1413](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1413)
