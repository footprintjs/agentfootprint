[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / assertToolWants

# Function: assertToolWants()

> **assertToolWants**(`toolName`, `wants`, `inputSchema`): `void`

Defined in: [src/artifacts/wants.ts:47](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/wants.ts#L47)

Refuse a `wants` declaration this library cannot honor, at definition time
— naming the tool and the fix, never at the first dispatch of the first
run. Checks, per declared argument:
  • the kind is a non-empty string (a blank kind can never match a mint);
  • when the tool's `inputSchema` declares `properties`, the argument
    exists there (a wants-arg the model is never offered can never be
    filled);
  • when that property declares a `type`, it is `'string'` — the model
    passes the REF, never the bytes, so any other type is a schema that
    asks the model to inline what this feature exists to keep out.

## Parameters

### toolName

`string`

### wants

`Readonly`\<`Record`\<`string`, `string`\>\> \| `undefined`

### inputSchema

`Readonly`\<`Record`\<`string`, `unknown`\>\> \| `undefined`

## Returns

`void`
