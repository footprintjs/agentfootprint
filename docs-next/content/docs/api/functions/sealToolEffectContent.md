---
title: sealToolEffectContent
---

# Function: sealToolEffectContent()

> **sealToolEffectContent**(`json`): `unknown`

Defined in: [src/semantics/sealedToolEffectContent.ts:14](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/sealedToolEffectContent.ts#L14)

Prepare bounded JSON data for a tool result carrying effects. Result
middleware can inspect the value, but cannot edit it in place. Use a
replacement value to rewrite it. Invalid or oversized text throws.

## Parameters

### json

`string`

## Returns

`unknown`
