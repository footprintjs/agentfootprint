---
title: composeMessages
---

# Function: composeMessages()

> **composeMessages**\<`T`\>(`defaults`, `overrides?`): `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/locales/index.ts:99](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/locales/index.ts#L99)

Spread `overrides` on top of `defaults` so every key in `defaults`
has a value (the override or the original). The result is a fresh
object — neither input is mutated.

Missing override keys fall back to the default; extra override
keys are preserved (forward-compat for consumer-defined keys).

## Type Parameters

### T

`T` *extends* `Readonly`\<`Record`\<`string`, `string`\>\>

## Parameters

### defaults

`T`

### overrides?

`Readonly`\<`Record`\<`string`, `string`\>\> = `{}`

## Returns

`Readonly`\<`Record`\<`string`, `string`\>\>

## Example

```ts
const merged = composeMessages(defaultCommentaryMessages, {
    'stream.llm_start.iter1': 'My custom thinking line',
  });
```
