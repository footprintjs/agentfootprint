[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / OutputSchemaParser

# Interface: OutputSchemaParser\<T\>

Defined in: [src/core/outputSchema.ts:62](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/core/outputSchema.ts#L62)

Minimum shape any validation library must expose to satisfy
`outputSchema`. Covers Zod (`schema.parse`), Valibot
(`v.parse(schema, value)` — pass `{ parse: v => v.parse(schema, v) }`),
ArkType (`type.assert`), and hand-written parsers.

Implementations MUST throw on validation failure (the runtime
catches the throw, wraps it in `OutputSchemaError`, and emits the
diagnostic event).

## Type Parameters

### T

`T`

## Properties

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/core/outputSchema.ts:71](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/core/outputSchema.ts#L71)

Human-readable description of the output shape. Used by
`outputSchema` to auto-build the system-prompt instruction when
`opts.instruction` is not provided. Zod schemas expose this via
`.describe('...')`; consumers can attach the field directly on
hand-written parsers.

## Methods

### parse()

> **parse**(`value`): `T`

Defined in: [src/core/outputSchema.ts:63](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/core/outputSchema.ts#L63)

#### Parameters

##### value

`unknown`

#### Returns

`T`
