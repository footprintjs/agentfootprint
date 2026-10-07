---
title: RedactionPolicy
---

# Interface: RedactionPolicy

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:59

Declarative key/path redaction for recorded state and boundary records.

Configure at the scope class level (static property) or pass to
FlowChartExecutor to apply across all stages.

## Properties

### diagnostics?

> `optional` **diagnostics?**: `Pick`\<`RedactionPolicy`, `"keys"` \| `"patterns"` \| `"fields"`\>

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:82

Diagnostic-only selectors, IN ADDITION to the state selectors above (which
already cover a diagnostic entry by its name: `keys: ['token']` masks
`$debug('token', …)`). Use these for names you mask in diagnostics but
not in state. Paths start with logs/errors/metrics/evals, e.g.
`logs.profile.token`. Only flowMessages.description and
flowMessages.rationale are payloads; flow topology/timing metadata stays
intact. Applied before retention, not retroactively to existing bags.

***

### emitPatterns?

> `optional` **emitPatterns?**: `RegExp`[]

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:96

Regex patterns matched against `EmitEvent.name` for `scope.$emit(...)`
calls. Any emit event whose name matches has its payload replaced with
the string `'[REDACTED]'` before dispatch to recorders.
Global/sticky patterns start at index zero on every test; their flags
retain their usual meaning. This does not scrub diagnostic side bags.

Example:
```ts
{ emitPatterns: [/\.auth\./, /\.billing\./] }
// Hides payloads of events like 'myapp.auth.check' and 'myapp.billing.spend'
```

***

### fields?

> `optional` **fields?**: `Record`\<`string`, `string`[]\>

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:72

Field-level redaction within objects — key → array of fields to scrub.
 Supports dot-notation for nested paths (e.g. 'address.zip').

***

### keys?

> `optional` **keys?**: `string`[]

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:61

Exact key names to always redact (e.g. ['ssn', 'creditCard']).

***

### patterns?

> `optional` **patterns?**: `RegExp`[]

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:69

Regex patterns — any key matching a pattern is auto-redacted.

Pattern matching is skipped for keys that exceed an internal length cap
(designed to prevent ReDoS on pathological patterns). For very long key
names, use `keys` (exact match) instead of patterns.
