---
title: RedactionReport
---

# Interface: RedactionReport

Defined in: node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:131

State redaction report. Never includes values; emit and diagnostic
selectors/activity are not represented here.

## Properties

### fieldRedactions

> **fieldRedactions**: `Record`\<`string`, `string`[]\>

Defined in: node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:135

Keys with field-level redaction → which fields were scrubbed.

***

### patterns

> **patterns**: `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:137

Pattern sources that were active (e.g. ['password|secret']).

***

### redactedKeys

> **redactedKeys**: `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/memory/redaction.d.ts:133

Keys fully redacted (exact match or pattern match).
