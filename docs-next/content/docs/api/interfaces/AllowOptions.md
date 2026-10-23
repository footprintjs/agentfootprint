---
title: AllowOptions
---

# Interface: AllowOptions

Defined in: [src/core/agent/middleware/outcomes.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/outcomes.ts#L98)

The third argument of `allow`: where rewritten arguments came from
(`from`), and — after a tool ran — which of the names an
`absent({ among })` read the model may see (`knownNames`: the block, a
narrower one, or `null` for none). At least one; nothing else.

## Properties

### from?

> `readonly` `optional` **from?**: `Readonly`\<`Record`\<`string`, `"person"` \| `"default"` \| `"app"`\>\>

Defined in: [src/core/agent/middleware/outcomes.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/outcomes.ts#L99)

***

### knownNames?

> `readonly` `optional` **knownNames?**: `KnownNames` \| `null`

Defined in: [src/core/agent/middleware/outcomes.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/outcomes.ts#L100)
