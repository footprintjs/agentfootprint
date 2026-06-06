[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / OutputSchemaOptions

# Interface: OutputSchemaOptions

Defined in: [src/core/outputSchema.ts:77](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/outputSchema.ts#L77)

Optional configuration for `outputSchema`.

## Properties

### instruction?

> `readonly` `optional` **instruction?**: `string`

Defined in: [src/core/outputSchema.ts:92](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/outputSchema.ts#L92)

Custom system-prompt instruction text. Defaults to a generic
"Respond with valid JSON matching the output schema. Do not
include prose." sentence (extended with `parser.description`
when present). Override when the LLM benefits from a
domain-specific framing.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core/outputSchema.ts:84](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/outputSchema.ts#L84)

Injection id for the auto-generated "respond with this shape"
instruction. Defaults to `'output-schema'`. Override when you
have multiple agents with different schemas in one process and
want the diagnostic events to disambiguate.
