---
title: buildDefaultInstruction
---

# Function: buildDefaultInstruction()

> **buildDefaultInstruction**(`parser`): `string`

Defined in: [src/core/outputSchema.ts:125](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/outputSchema.ts#L125)

Default instruction template — used when `opts.instruction` is not
provided. Concatenates the parser's `.description` (if present) so
Zod schemas authored with `.describe('...')` propagate naturally.

## Parameters

### parser

[`OutputSchemaParser`](/docs/api/interfaces/OutputSchemaParser)\<`unknown`\>

## Returns

`string`
