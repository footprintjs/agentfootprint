[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RedactionPolicy

# Interface: RedactionPolicy

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:57

Declarative redaction configuration — define once, applied everywhere.

Configure at the scope class level (static property) or pass to
FlowChartExecutor to apply across all stages.

## Properties

### emitPatterns?

> `optional` **emitPatterns?**: `RegExp`[]

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:82

Regex patterns matched against `EmitEvent.name` for `scope.$emit(...)`
calls. Any emit event whose name matches has its payload replaced with
the string `'[REDACTED]'` before dispatch to recorders.

Example:
```ts
{ emitPatterns: [/\.auth\./, /\.billing\./] }
// Hides payloads of events like 'myapp.auth.check' and 'myapp.billing.spend'
```

***

### fields?

> `optional` **fields?**: `Record`\<`string`, `string`[]\>

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:70

Field-level redaction within objects — key → array of fields to scrub.
 Supports dot-notation for nested paths (e.g. 'address.zip').

***

### keys?

> `optional` **keys?**: `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:59

Exact key names to always redact (e.g. ['ssn', 'creditCard']).

***

### patterns?

> `optional` **patterns?**: `RegExp`[]

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:67

Regex patterns — any key matching a pattern is auto-redacted.

Pattern matching is skipped for keys that exceed an internal length cap
(designed to prevent ReDoS on pathological patterns). For very long key
names, use `keys` (exact match) instead of patterns.
