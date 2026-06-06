[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RedactionReport

# Interface: RedactionReport

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:87

Compliance-friendly report of what was redacted. Never includes values.

## Properties

### fieldRedactions

> **fieldRedactions**: `Record`\<`string`, `string`[]\>

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:91

Keys with field-level redaction → which fields were scrubbed.

***

### patterns

> **patterns**: `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:93

Source strings of registered patterns.

***

### redactedKeys

> **redactedKeys**: `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:89

Keys fully redacted (exact match or pattern match).
