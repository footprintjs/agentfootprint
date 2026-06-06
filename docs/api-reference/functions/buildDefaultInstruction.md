[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / buildDefaultInstruction

# Function: buildDefaultInstruction()

> **buildDefaultInstruction**(`parser`): `string`

Defined in: [src/core/outputSchema.ts:125](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/outputSchema.ts#L125)

Default instruction template — used when `opts.instruction` is not
provided. Concatenates the parser's `.description` (if present) so
Zod schemas authored with `.describe('...')` propagate naturally.

## Parameters

### parser

[`OutputSchemaParser`](/agentfootprint/api/generated/interfaces/OutputSchemaParser.md)\<`unknown`\>

## Returns

`string`
