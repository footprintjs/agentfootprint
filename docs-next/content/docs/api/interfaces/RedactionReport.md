---
title: RedactionReport
---

# Interface: RedactionReport

Defined in: node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:61

Compliance-friendly report of what was redacted. Never includes values.

## Properties

### fieldRedactions

> **fieldRedactions**: `Record`\<`string`, `string`[]\>

Defined in: node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:65

Keys with field-level redaction → which fields were scrubbed.

***

### patterns

> **patterns**: `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:67

Pattern sources that were active (e.g. ['password|secret']).

***

### redactedKeys

> **redactedKeys**: `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:63

Keys fully redacted (exact match or pattern match).
