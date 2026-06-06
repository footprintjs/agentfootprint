[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / buildDefaultInstruction

# Function: buildDefaultInstruction()

> **buildDefaultInstruction**(`parser`): `string`

Defined in: [src/core/outputSchema.ts:125](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/outputSchema.ts#L125)

Default instruction template — used when `opts.instruction` is not
provided. Concatenates the parser's `.description` (if present) so
Zod schemas authored with `.describe('...')` propagate naturally.

## Parameters

### parser

[`OutputSchemaParser`](/agentfootprint/api/generated/interfaces/OutputSchemaParser.md)\<`unknown`\>

## Returns

`string`
